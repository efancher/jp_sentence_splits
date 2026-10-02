// Deno Edge Function: AI-written wrong-answer choices for the sentence-led
// "pick the English meaning" review. Mirrors vocab-assist's shape — verify the
// caller via their Supabase session, hold ANTHROPIC_API_KEY server-side only.
//
// Given a batch of Japanese sentences (with preceding context and, when
// known, the correct English translation) return ~10 plausible but wrong
// English meanings per sentence, plus the correct meaning when it was not
// supplied. The client validates every wrong meaning again (duplicates,
// paraphrases, length) before saving; AI output is always a suggestion.
//
// Deploy: supabase functions deploy meaning-assist
// Requires ANTHROPIC_API_KEY as a function secret (never ship to the browser).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ANTHROPIC_MODEL = 'claude-haiku-4-5';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_ITEMS = 10;

interface ItemInput {
  id: string;
  japanese: string;
  context?: string[];
  correct?: string;
  existing?: string[];
}

const TOOL = {
  name: 'write_meaning_choices',
  description: 'Report wrong English meanings (and the correct one when missing) for each Japanese sentence.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Copied exactly from the input.' },
            correct: {
              type: 'string',
              description:
                'The correct natural English meaning in context. Copy the supplied correct meaning unchanged when one was given.',
            },
            wrong: {
              type: 'array',
              items: { type: 'string' },
              description: 'Up to 10 plausible but clearly wrong English meanings.',
            },
          },
          required: ['id', 'correct', 'wrong'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  },
  strict: true,
};

const SYSTEM =
  'You write answer choices for a Japanese reading-comprehension question ("which English ' +
  'sentence is the meaning of this Japanese sentence?"). For each sentence write up to 10 ' +
  'plausible but WRONG English meanings. Each wrong meaning must reflect one specific ' +
  'misunderstanding a learner could make: actor/object reversal (who did what to whom), ' +
  'negation, tense, intention/desire/obligation, or the meaning of one key word. Each must be ' +
  'unambiguously wrong given the context, match the correct meaning in length, specificity and ' +
  'style, not duplicate another wrong meaning, not merely paraphrase the correct meaning, and ' +
  'not be nonsense. Never change the Japanese. Quality beats quantity: return fewer than 10 ' +
  'if you cannot find good ones. Do not repeat wrong meanings listed as already existing. When ' +
  'a correct meaning is supplied, copy it unchanged; otherwise write a faithful, natural one.';

async function callAnthropic(apiKey: string, userText: string): Promise<Record<string, unknown>> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 4096,
      system: SYSTEM,
      messages: [{ role: 'user', content: userText }],
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name },
    }),
  });
  if (!response.ok) {
    throw new Error(`Anthropic API error ${response.status}: ${await response.text()}`);
  }
  const message = await response.json();
  const toolUse = (message.content as Array<Record<string, unknown>>)?.find(
    (block) => block.type === 'tool_use',
  );
  if (!toolUse) throw new Error('Anthropic response did not include a tool call');
  return toolUse.input as Record<string, unknown>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization' }, 401);
    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicApiKey) return json({ error: 'Meaning AI is not configured on the server' }, 503);

    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.49.1');
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: 'Unauthorized' }, 401);

    const body = (await req.json()) as { items?: ItemInput[] };
    const items = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : [];
    if (items.length === 0) return json({ error: 'a non-empty items array is required' }, 400);

    const userText = items
      .map((item) =>
        [
          `id: ${item.id}`,
          `context (preceding sentences): ${(item.context ?? []).join(' / ') || '(none)'}`,
          `sentence: ${item.japanese}`,
          item.correct ? `correct meaning: ${item.correct}` : 'correct meaning: (not given — write it)',
          (item.existing ?? []).length
            ? `already existing wrong meanings: ${(item.existing ?? []).join(' | ')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
      )
      .join('\n\n');
    return json(await callAnthropic(anthropicApiKey, userText));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
