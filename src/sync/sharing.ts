import { getSupabase } from './supabaseClient';
import { syncLog } from './logger';
import { createId } from '../lib/ids';

export type MemberRole = 'editor' | 'viewer';

export interface BookMemberRow {
  book_id: string;
  user_id: string;
  role: MemberRole;
  created_at: string;
  email?: string;
}

export async function listBookMembers(bookId: string): Promise<BookMemberRow[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('book_members')
    .select('book_id, user_id, role, created_at')
    .eq('book_id', bookId);
  if (error) {
    syncLog('error', error.message, 'SHARE_LIST');
    throw new Error(error.message);
  }
  return (data ?? []) as BookMemberRow[];
}

export async function updateMemberRole(
  bookId: string,
  userId: string,
  role: MemberRole,
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('book_members')
    .update({ role })
    .eq('book_id', bookId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
}

export async function removeMember(
  bookId: string,
  userId: string,
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('book_members')
    .delete()
    .eq('book_id', bookId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
}

/**
 * Invite by email via Edge Function when available; otherwise create a
 * book_invites row the recipient can accept after signing up with that email.
 */
export async function inviteBookMember(input: {
  bookId: string;
  email: string;
  role: MemberRole;
}): Promise<{ token: string; viaEdgeFunction: boolean }> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase not configured');
  const email = input.email.trim().toLowerCase();
  if (!email) throw new Error('Email is required');

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) throw new Error('Not signed in');

  try {
    const { data, error } = await supabase.functions.invoke('invite-book-member', {
      body: {
        bookId: input.bookId,
        email,
        role: input.role,
      },
    });
    if (!error && data?.token) {
      return { token: String(data.token), viaEdgeFunction: true };
    }
    syncLog('warn', error?.message ?? 'Edge function unavailable', 'SHARE_EDGE');
  } catch (err) {
    syncLog(
      'warn',
      err instanceof Error ? err.message : String(err),
      'SHARE_EDGE',
    );
  }

  const token = createId('invite');
  const { error } = await supabase.from('book_invites').insert({
    book_id: input.bookId,
    owner_id: session.user.id,
    email,
    role: input.role,
    token,
  });
  if (error) throw new Error(error.message);
  return { token, viaEdgeFunction: false };
}

export async function acceptBookInvite(token: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase not configured');
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) throw new Error('Not signed in');

  const { data: invite, error } = await supabase
    .from('book_invites')
    .select('*')
    .eq('token', token)
    .is('revoked_at', null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!invite) throw new Error('Invite not found');
  if (invite.accepted_at) return;

  const userEmail = (session.user.email ?? '').toLowerCase();
  if (userEmail !== String(invite.email).toLowerCase()) {
    throw new Error('Signed-in email does not match this invite');
  }

  const { error: memberError } = await supabase.from('book_members').upsert({
    book_id: invite.book_id,
    user_id: session.user.id,
    role: invite.role,
  });
  if (memberError) throw new Error(memberError.message);

  await supabase
    .from('book_invites')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invite.id);
}
