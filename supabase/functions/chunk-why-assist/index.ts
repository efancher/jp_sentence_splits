// Deno Edge Function: AI-drafted "why this role, in this sentence" reasoning
// for a single AnalysisChunk on AnalyzePage's guided walkthrough (2026-09-28
// glossing-pedagogy pass — see docs/STATUS.md). Mirrors grammar-assist's
// shape exactly: verify the caller via their Supabase session, hold the
// real secret (ANTHROPIC_API_KEY) server-side only, never ship it to the
// browser.
//
// AI output here only ever pre-fills the same editable `AnalysisChunk.notes`
// field a hand-typed explanation would use — nothing is auto-materialized
// as the authoritative chunk gloss (that boundary is `literalEnglish`,
// never touched by AI anywhere in this app). The client (AnalyzePage) calls
// this automatically for a small set of commonly-confused roles (topic は
// vs が, zero-が) rather than requiring a manual button press, since the
// learner is already stepping through the walkthrough one chunk at a time —
// but the result still lands in the plain editable notes field, so it reads
// and behaves exactly like a hand-written note once saved.
//
// Deploy: supabase functions deploy chunk-why-assist
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

interface RequestBody {
  sentence: string;
  chunk: ChunkContext;
  /** Every chunk in the sentence, in order, for context — includes `chunk` itself. */
  chunks?: ChunkContext[];
}

const EXPLAIN_CHUNK_TOOL = {
  name: 'explain_chunk_role',
  description:
    'Explain, Cure-Dolly style, why this specific chunk has this specific grammatical role in this specific sentence.',
  input_schema: {
    type: 'object',
    properties: {
      explanation: {
        type: 'string',
        description:
          'One to two sentences, plain English, explaining why this chunk plays this role here — contrastive against the most plausible alternative reading when one genuinely exists (e.g. "this is は marking the topic, not が, because the sentence is about the day in general, not reporting a new fact about it"). Ground it in this sentence, not a generic dictionary definition of the particle/role.',
      },
    },
    required: ['explanation'],
    additionalProperties: false,
  },
  strict: true,
};

function chunkContextText(chunks: ChunkContext[] | undefined, focus: ChunkContext): string {
  if (!chunks?.length) return '';
  const lines = chunks
    .map(
      (chunk) =>
        `- ${chunk.japanese} (${chunk.role})${chunk === focus || (chunk.japanese === focus.japanese && chunk.role === focus.role) ? ' ← this chunk' : ''}: ${chunk.literalEnglish}`,
    )
    .join('\n');
  return `\n\nFull chunk analysis, for context (this sentence's other chunks, so the reasoning can be contrastive):\n${lines}`;
}

async function callAnthropic(
  apiKey: string,
  system: string,
  userText: string,
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
      max_tokens: 512,
      system,
      messages: [{ role: 'user', content: userText }],
      tools: [EXPLAIN_CHUNK_TOOL],
      tool_choice: { type: 'tool', name: EXPLAIN_CHUNK_TOOL.name },
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
        JSON.stringify({ error: 'Chunk-why AI is not configured on the server' }),
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
    const sentence = String(body.sentence ?? '').trim();
    const chunk = body.chunk;
    if (!sentence || !chunk?.japanese?.trim() || !chunk.role?.trim()) {
      return new Response(
        JSON.stringify({ error: 'sentence and chunk (japanese, role) are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const system =
      'You are assisting a Japanese-language learning app built around Cure-Dolly-style ' +
      'structural analysis (find the "engine" — the predicate — then identify each other ' +
      'chunk\'s role: the visible or invisible/zero が-marked subject, を/に/で/と/etc.-marked ' +
      '"cars", or the topic marked by は, which marks aboutness and is not always the same as ' +
      'the grammatical subject). The learner is stepping through this sentence chunk by chunk ' +
      'and wants to understand *why* this particular chunk has this particular role here — not ' +
      'a generic definition of the particle, and not a restatement of the literal English gloss ' +
      'they already have. When the role could plausibly be confused with a different one (most ' +
      'often topic は vs subject が, or an implied/zero-が subject whose referent isn\'t obvious), ' +
      'make the explanation explicitly contrastive.';
    const userText = `Sentence: ${sentence}\n\nChunk to explain: ${chunk.japanese} (role: ${chunk.role}) — literal English: ${chunk.literalEnglish}${chunkContextText(body.chunks, chunk)}`;
    const result = await callAnthropic(anthropicApiKey, system, userText);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
