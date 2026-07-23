// Deno Edge Function: invite a user to a book without exposing a user directory.
// Deploy: supabase functions deploy invite-book-member
// Requires SUPABASE_SERVICE_ROLE_KEY (auto-injected) and never ship that key to the browser.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

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
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

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

    const body = await req.json();
    const bookId = String(body.bookId ?? '');
    const email = String(body.email ?? '')
      .trim()
      .toLowerCase();
    const role = body.role === 'editor' ? 'editor' : 'viewer';
    if (!bookId || !email) {
      return new Response(JSON.stringify({ error: 'bookId and email required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: book } = await admin
      .from('books')
      .select('id, owner_id')
      .eq('id', bookId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!book || book.owner_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Only the owner can invite' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = crypto.randomUUID();
    const { error: inviteError } = await admin.from('book_invites').insert({
      book_id: bookId,
      owner_id: user.id,
      email,
      role,
      token,
    });
    if (inviteError) {
      return new Response(JSON.stringify({ error: inviteError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // If the invitee already has an account, add membership immediately.
    const { data: listed } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    const existing = listed?.users?.find(
      (u) => (u.email ?? '').toLowerCase() === email,
    );
    if (existing) {
      await admin.from('book_members').upsert({
        book_id: bookId,
        user_id: existing.id,
        role,
      });
      await admin
        .from('book_invites')
        .update({ accepted_at: new Date().toISOString() })
        .eq('token', token);
    }

    return new Response(JSON.stringify({ token, invitedUserId: existing?.id ?? null }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }
});
