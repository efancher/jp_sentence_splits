// Deno Edge Function: AI-assisted vocabulary glossing. Mirrors grammar-assist's
// shape exactly — verify the caller via their Supabase session, hold
// ANTHROPIC_API_KEY server-side only, never ship it to the browser.
//
// Given one sentence and a list of words (dictionary form + reading) the
// tokenizer flagged as worth studying, return a concise dictionary-style
// meaning for the sense as used IN THAT SENTENCE. Fixes the blank
// "Meaning (optional)" field on mined vocabulary, where fugashi gives
// surface/lemma/reading/POS but never a gloss, and JMDict's first sense is
// wrong out of context (先 -> "point", する -> "bamboo screen").
//
// AI output here is always a *suggestion* — the client (VocabularyReviewPage /
// VocabularyPicker) pre-fills the editable field with it; the learner still
// confirms/edits before anything is materialized into a vocabulary_items row.
//
// Deploy: supabase functions deploy vocab-assist
// Requires ANTHROPIC_API_KEY as a function secret (never ship to the browser).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

const ANTHROPIC_MODEL = 'claude-haiku-4-5';
const ANTHROPIC_VERSION = '2023-06-01';

const MAX_WORDS = 40;

interface WordInput {
  expression: string;
  reading?: string;
  surface?: string;
}

interface GlossRequestBody {
  action: 'gloss';
  sentence: string;
  words: WordInput[];
}

const GLOSS_TOOL = {
  name: 'gloss_vocabulary',
  description:
    'Report a concise English meaning for each Japanese word as it is used in the given sentence.',
  input_schema: {
    type: 'object',
    properties: {
      glosses: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            expression: {
              type: 'string',
              description: 'The dictionary-form expression, copied exactly from the input.',
            },
            reading: {
              type: 'string',
              description: 'The reading, copied exactly from the input (empty string if none was given).',
            },
            meaning: {
              type: 'string',
              description:
                'Concise dictionary-style gloss (roughly 2 to 6 words) for the sense used in THIS sentence — not a fluent translation of the sentence, not every sense the word can have. E.g. "senior colleague", "to persevere", "now / at present".',
            },
            partOfSpeech: {
              type: 'string',
              description:
                'Short English part-of-speech tag: "noun", "godan verb", "ichidan verb", "suru verb", "i-adjective", "na-adjective", "adverb", "expression", etc. Omit if genuinely unclear.',
            },
            confidence: { type: 'number', description: '0 to 1.' },
          },
          required: ['expression', 'reading', 'meaning', 'confidence'],
          additionalProperties: false,
        },
      },
    },
    required: ['glosses'],
    additionalProperties: false,
  },
  strict: true,
};

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
      max_tokens: 2048,
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
        JSON.stringify({ error: 'Vocabulary AI is not configured on the server' }),
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

    const body = (await req.json()) as GlossRequestBody;

    if (body.action !== 'gloss') {
      return new Response(JSON.stringify({ error: 'Unknown action' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sentence = String(body.sentence ?? '').trim();
    const words = Array.isArray(body.words) ? body.words.slice(0, MAX_WORDS) : [];
    if (!sentence || words.length === 0) {
      return new Response(
        JSON.stringify({ error: 'sentence and a non-empty words array are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const system =
      'You are assisting a Japanese-language learning app. Given one native sentence and a list ' +
      'of words from it (dictionary form + reading), provide a concise English meaning for each ' +
      'word AS IT IS USED IN THAT SENTENCE — the specific sense, not a full list of senses, and ' +
      'not a translation of the whole sentence. Keep each meaning to roughly 2-6 words, the way a ' +
      'compact dictionary would. Return exactly one entry per input word, echoing the expression ' +
      'and reading back unchanged and in the same order.';
    const wordLines = words
      .map((w, i) => {
        const reading = String(w.reading ?? '').trim();
        const surface = String(w.surface ?? '').trim();
        const surfaceNote = surface && surface !== w.expression ? ` — appears as 「${surface}」` : '';
        return `${i + 1}. ${w.expression}${reading ? `（${reading}）` : ''}${surfaceNote}`;
      })
      .join('\n');
    const userText = `Sentence: ${sentence}\n\nWords:\n${wordLines}`;
    const result = await callAnthropic(anthropicApiKey, system, userText, GLOSS_TOOL);
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
