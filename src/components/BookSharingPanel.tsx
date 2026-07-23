import { useEffect, useState } from 'react';

import { useAuth } from '../sync/auth';
import {
  acceptBookInvite,
  inviteBookMember,
  listBookMembers,
  removeMember,
  updateMemberRole,
  type BookMemberRow,
  type MemberRole,
} from '../sync/sharing';

export function BookSharingPanel({ bookId }: { bookId: string }) {
  const auth = useAuth();
  const [members, setMembers] = useState<BookMemberRow[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('viewer');
  const [inviteToken, setInviteToken] = useState('');
  const [acceptToken, setAcceptToken] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh(): Promise<void> {
    try {
      setMembers(await listBookMembers(bookId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    if (!auth.user) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when book/user changes
  }, [auth.user, bookId]);

  if (!auth.user) {
    return (
      <p className="muted">Sign in to share this book with other accounts.</p>
    );
  }

  return (
    <div className="stack">
      <h3 style={{ margin: 0 }}>Sharing</h3>
      <p className="muted" style={{ margin: 0 }}>
        Invite an existing email by role. Invites do not expose a global user
        directory. Only the book owner can change membership.
      </p>
      {members.length ? (
        <ul className="stack" style={{ paddingLeft: '1.2rem', margin: 0 }}>
          {members.map((member) => (
            <li key={member.user_id} className="row" style={{ flexWrap: 'wrap' }}>
              <span>
                {member.user_id.slice(0, 8)}… · {member.role}
              </span>
              <select
                value={member.role}
                onChange={(event) =>
                  void updateMemberRole(
                    bookId,
                    member.user_id,
                    event.target.value as MemberRole,
                  ).then(refresh)
                }
              >
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
              </select>
              <button
                type="button"
                className="danger"
                onClick={() =>
                  void removeMember(bookId, member.user_id).then(refresh)
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          No shared members yet.
        </p>
      )}
      <label>
        Invite email
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <label>
        Role
        <select
          value={role}
          onChange={(event) => setRole(event.target.value as MemberRole)}
        >
          <option value="viewer">Viewer</option>
          <option value="editor">Editor</option>
        </select>
      </label>
      <button
        type="button"
        className="primary"
        disabled={busy || !email.trim()}
        onClick={async () => {
          setBusy(true);
          setError('');
          setMessage('');
          try {
            const result = await inviteBookMember({ bookId, email, role });
            setInviteToken(result.token);
            setMessage(
              result.viaEdgeFunction
                ? 'Invite sent via Edge Function.'
                : 'Invite created. Share the token with the recipient after they sign up with that email.',
            );
            await refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        Create invite
      </button>
      {inviteToken ? (
        <p className="muted" style={{ margin: 0, wordBreak: 'break-all' }}>
          Invite token: {inviteToken}
        </p>
      ) : null}
      <label>
        Accept invite token
        <input
          value={acceptToken}
          onChange={(event) => setAcceptToken(event.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={busy || !acceptToken.trim()}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await acceptBookInvite(acceptToken.trim());
            setMessage('Invite accepted.');
            setAcceptToken('');
            await refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        Accept invite
      </button>
      {error ? <div style={{ color: 'var(--danger)' }}>{error}</div> : null}
      {message ? <div className="status-pill complete">{message}</div> : null}
    </div>
  );
}
