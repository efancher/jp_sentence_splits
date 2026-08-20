// Deno Edge Function: AI-assisted grammar-pattern suggestion/explanation
// (grammar-learning system, Phase 4 — see docs/STATUS.md). Mirrors
// invite-book-member's shape exactly: verify the caller via their Supabase
// session, hold the real secret (ANTHROPIC_API_KEY) server-side only, never
// ship it to the browser. Deliberately decoupled from the Hetzner/Tailscale
// forced-alignment box (a different kind of workload, already memory-tight)
// — this calls the Anthropic API directly over the public internet.
//
// AI output here is always a *suggestion* — nothing this function returns is
// written to Dexie/Supabase directly; the client (GrammarPicker.tsx) shows
// it for the learner to confirm, edit, or ignore before anything becomes a
// canonical GrammarPattern/SentenceGrammar row. See design brief §15.
//
// Deploy: supabase functions deploy grammar-assist
// Requires ANTHROPIC_API_KEY as a function secret (never ship to the browser).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

const ANTHROPIC_MODEL = 'claude-haiku-4-5';
const ANTHROPIC_VERSION = '2023-06-01';

interface ChunkContext {
  japanese: string;
  role: string;
  literalEnglish: string;
}

interface SuggestRequestBody {
  action: 'suggest';
  sentence: string;
  chunks?: ChunkContext[];
  /** Existing canonical pattern names/aliases in the learner's corpus, for canonicalization (design brief §15). */
  existingPatternNames?: string[];
}

interface ExplainRequestBody {
  action: 'explain';
  sentence: string;
  patternName: string;
  chunks?: ChunkContext[];
}

type RequestBody = SuggestRequestBody | ExplainRequestBody;

const SUGGEST_TOOL = {
  name: 'suggest_grammar_patterns',
  description:
    'Report reusable Japanese grammar constructions worth noticing in this sentence — not every grammatical fact, only constructions worth a learner tracking (design brief §16).',
  input_schema: {
    type: 'object',
    properties: {
      patterns: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            candidateName: {
              type: 'string',
              description:
                'Display form of the construction, e.g. "〜わけがない".',
            },
            matchedExistingName: {
              type: 'string',
              description:
                'If this construction is the same as one of the existing pattern names/aliases provided, the exact existing name it matches (even if the surface form here differs, e.g. kanji vs kana or a conjugated variant). Omit if genuinely new.',
            },
            shortMeaning: {
              type: 'string',
              description:
                'Concise communicative function, not a dictionary definition — e.g. "there\'s no way..." for わけがない.',
            },
            rank: {
              type: 'string',
              enum: ['important', 'familiar', 'nuance', 'optional'],
              description:
                'important = central to this sentence\'s meaning; familiar = basic structure worth a light note; nuance = interesting but secondary; optional = only if genuinely noteworthy.',
            },
            confidence: { type: 'number', description: '0 to 1.' },
          },
          required: ['candidateName', 'shortMeaning', 'rank', 'confidence'],
          additionalProperties: false,
        },
      },
    },
    required: ['patterns'],
    additionalProperties: false,
  },
  strict: true,
};

const EXPLAIN_TOOL = {
  name: 'explain_grammar_pattern',
  description:
    "Explain what a grammar construction is doing in this specific sentence — not a generic dictionary entry (design brief §4).",
  input_schema: {
    type: 'object',
    properties: {
      shortMeaning: {
        type: 'string',
        description: 'Concise communicative function of the pattern in general.',
      },
      structuralNotes: {
        type: 'string',
        description:
          'Cure-Dolly-style literal/structural breakdown (e.g. "わけ = circumstance/reason, が marks it, ない = does not exist").',
      },
      explanation: {
        type: 'string',
        description:
          'What this construction contributes to THIS sentence specifically: literal mechanics, then communicative function, then a natural English reading — not collapsed into one gloss.',
      },
    },
    required: ['shortMeaning', 'structuralNotes', 'explanation'],
    additionalProperties: false,
  },
  strict: true,
};

function chunkContextText(chunks?: ChunkContext[]): string {
  if (!chunks?.length) return '';
  const lines = chunks
    .map((chunk) => `- ${chunk.japanese} (${chunk.role}): ${chunk.literalEnglish}`)
    .join('\n');
  return `\n\nExisting structural (Cure-Dolly) analysis, for context only — do not repeat it:\n${lines}`;
}

async function callAnthropic(
  apiKey: string,
  system: string,
  userText: string,
  tool: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: userText }],
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${text}`);
  }

  const message = await response.json();
  const toolUse = (message.content as Array<Record<string, unknown>>)?.find(
    (block) => block.type === 'tool_use',
  );
  if (!toolUse) {
    throw new Error('Anthropic response did not include a tool call');
  }
  return toolUse.input as Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicApiKey) {
      return new Response(
        JSON.stringify({ error: 'Grammar AI is not configured on the server' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.49.1');
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = (await req.json()) as RequestBody;

    if (body.action === 'suggest') {
      const sentence = String(body.sentence ?? '').trim();
      if (!sentence) {
        return new Response(JSON.stringify({ error: 'sentence is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const existing = (body.existingPatternNames ?? []).slice(0, 200);
      const system =
        'You are assisting a Japanese-language learning app that teaches grammar constructions ' +
        'as they naturally occur in native sentences (not a fixed syllabus). Given one sentence, ' +
        'identify reusable grammar constructions worth a learner noticing — particles, ordinary ' +
        'conjugations, and basic sentence structure do NOT count; focus on constructions with a ' +
        'distinct communicative function (e.g. わけがない, てしまう, ~ば). Prefer matching an ' +
        'existing pattern name over inventing a near-duplicate. Report at most 4 patterns, ranked ' +
        'by how central each is to this sentence.';
      const existingText = existing.length
        ? `\n\nExisting canonical pattern names/aliases already in the learner's corpus (prefer matching one of these via matchedExistingName when the same construction recurs, even if the surface form here differs):\n${existing.join('、')}`
        : '';
      const userText = `Sentence: ${sentence}${chunkContextText(body.chunks)}${existingText}`;
      const result = await callAnthropic(anthropicApiKey, system, userText, SUGGEST_TOOL);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.action === 'explain') {
      const sentence = String(body.sentence ?? '').trim();
      const patternName = String(body.patternName ?? '').trim();
      if (!sentence || !patternName) {
        return new Response(
          JSON.stringify({ error: 'sentence and patternName are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      const system =
        'You are assisting a Japanese-language learning app built around Cure-Dolly-style ' +
        'structural analysis (what modifies what, where the topic/subject/object are, where the ' +
        'zero-が is). Explain a grammar construction the same way: literal/structural mechanics ' +
        'first, then its communicative function, then a natural English reading — never collapse ' +
        'these into one flat gloss, and never claim a single English phrase is "the" translation.';
      const userText = `Sentence: ${sentence}\nConstruction: ${patternName}${chunkContextText(body.chunks)}`;
      const result = await callAnthropic(anthropicApiKey, system, userText, EXPLAIN_TOOL);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
