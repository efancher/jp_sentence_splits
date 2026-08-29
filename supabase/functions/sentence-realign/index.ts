// Deno Edge Function: realign an existing human translation across a
// re-segmented Japanese sentence. Mirrors vocab-assist/grammar-assist —
// verify the caller via their Supabase session, hold ANTHROPIC_API_KEY
// server-side only.
//
// The "Re-segment captions" flow (ResegmentSourcePage) fixes badly-split
// caption sentences, but the per-piece English then has to be reconstructed
// by hand because the original translations were misaligned to the broken
// Japanese. Given the original Japanese + its existing English + the new
// pieces it was re-split into, return the English for each piece — reusing
// the original wording, redistributed to match. Output is always a
// suggestion; the client pre-fills the editable field and the user still
// reviews.
//
// Deploy: supabase functions deploy sentence-realign
// Requires ANTHROPIC_API_KEY as a function secret.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

const ANTHROPIC_MODEL = 'claude-haiku-4-5';
const ANTHROPIC_VERSION = '2023-06-01';

const MAX_GROUPS = 60;
const MAX_PIECES_PER_GROUP = 12;

interface RealignGroup {
  originalJapanese: string;
  originalTranslation: string;
  pieces: string[];
}

interface RealignRequestBody {
  action: 'realign';
  groups: RealignGroup[];
}

const REALIGN_TOOL = {
  name: 'realign_translations',
  description:
    'Report the English for each new Japanese piece of every re-segmented group.',
  input_schema: {
    type: 'object',
    properties: {
      groups: {
        type: 'array',
        description: 'Exactly one entry per input group, in the same order.',
        items: {
          type: 'object',
          properties: {
            pieceTranslations: {
              type: 'array',
              description:
                'Exactly one English string per piece of this group, in order.',
              items: { type: 'string' },
            },
          },
          required: ['pieceTranslations'],
          additionalProperties: false,
        },
      },
    },
    required: ['groups'],
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
      max_tokens: 4096,
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
        JSON.stringify({ error: 'Translation AI is not configured on the server' }),
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

    const body = (await req.json()) as RealignRequestBody;
    if (body.action !== 'realign') {
      return new Response(JSON.stringify({ error: 'Unknown action' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const groups = (Array.isArray(body.groups) ? body.groups : [])
      .slice(0, MAX_GROUPS)
      .map((group) => ({
        originalJapanese: String(group.originalJapanese ?? '').trim(),
        originalTranslation: String(group.originalTranslation ?? '').trim(),
        pieces: (Array.isArray(group.pieces) ? group.pieces : [])
          .slice(0, MAX_PIECES_PER_GROUP)
          .map((piece) => String(piece ?? '').trim())
          .filter(Boolean),
      }))
      .filter((group) => group.pieces.length > 0);

    if (groups.length === 0) {
      return new Response(JSON.stringify({ error: 'groups is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const system =
      'You are assisting a Japanese-language learning app. A learner re-segmented some ' +
      'auto-caption sentences onto real sentence boundaries. For each group you get the ' +
      'ORIGINAL Japanese, its existing human ENGLISH translation, and the NEW Japanese ' +
      'pieces the sentence was re-split into. Return the English for each piece:\n' +
      '- Reuse the original translation\'s wording, redistributed across the pieces so ' +
      'each piece\'s English matches that piece\'s Japanese.\n' +
      '- The original English was sometimes itself misaligned or incomplete. If a piece ' +
      'clearly says something the original English omits, translate that piece concisely ' +
      'yourself.\n' +
      '- Each piece\'s English must read as a natural standalone sentence.\n' +
      '- Do not add meaning that is not in the Japanese. Keep it plain.\n' +
      'Return exactly one English string per piece, in order, one group entry per input group.';

    const userText = groups
      .map((group, groupIndex) => {
        const pieceLines = group.pieces
          .map((piece, pieceIndex) => `    ${pieceIndex + 1}. ${piece}`)
          .join('\n');
        return (
          `Group ${groupIndex + 1}\n` +
          `  Original Japanese: ${group.originalJapanese}\n` +
          `  Original English: ${group.originalTranslation || '(none)'}\n` +
          `  New pieces:\n${pieceLines}`
        );
      })
      .join('\n\n');

    const result = await callAnthropic(anthropicApiKey, system, userText, REALIGN_TOOL);
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
