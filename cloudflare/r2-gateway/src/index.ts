import { handleRequest, type LedgerPort } from './handler';
import { limitsFromEnv, UsageLedger, type UsageSnapshot } from './ledger';
import type { Env, LedgerStorage } from './types';

/**
 * Worker entry point. Request logic lives in handler.ts and the accounting in
 * ledger.ts; this file only wires them to Cloudflare bindings.
 */

const LEDGER_NAME = 'global';

/** Calls the single ledger Durable Object. Its methods run one at a time, which makes reservations atomic. */
function ledgerPort(env: Env): LedgerPort {
  const stub = env.LEDGER.get(env.LEDGER.idFromName(LEDGER_NAME));
  async function call<T>(method: string, args: unknown[]): Promise<T> {
    const res = await stub.fetch(`https://ledger/${method}`, { method: 'POST', body: JSON.stringify(args) });
    if (!res.ok) throw new Error(`ledger ${method} failed: ${res.status}`);
    return (await res.json()) as T;
  }
  return {
    reserve: (key, size) => call('reserve', [key, size]),
    commit: (id, key, size) => call('commit', [id, key, size]),
    release: (id) => call('release', [id]),
    remove: (key) => call('remove', [key]),
    countOp: (kind) => call('countOp', [kind]),
    seed: (bytes) => call('seed', [bytes]),
    snapshot: () => call<UsageSnapshot>('snapshot', []),
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env, { bucket: env.AUDIO, ledger: ledgerPort(env), fetch });
    } catch {
      // Fail closed. Details stay out of the response; Workers logs hold the stack.
      return new Response(JSON.stringify({ error: 'internal_error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};

interface DurableObjectStateLike {
  storage: LedgerStorage;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

export class UsageLedgerDO {
  private readonly ledger: UsageLedger;
  private readonly ready: Promise<void>;

  constructor(state: DurableObjectStateLike, env: Env) {
    this.ledger = new UsageLedger(state.storage, limitsFromEnv(env as unknown as Record<string, string | undefined>));
    this.ready = state.blockConcurrencyWhile(() => this.ledger.load());
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    const method = new URL(request.url).pathname.slice(1);
    const args = (await request.json()) as unknown[];
    const l = this.ledger;
    let result: unknown;
    switch (method) {
      case 'reserve': result = await l.reserve(args[0] as string, args[1] as number); break;
      case 'commit': await l.commit(args[0] as string, args[1] as string, args[2] as number); result = null; break;
      case 'release': await l.release(args[0] as string); result = null; break;
      case 'remove': result = await l.remove(args[0] as string); break;
      case 'countOp': result = await l.countOp(args[0] as 'A' | 'B'); break;
      case 'seed': await l.seed(args[0] as number); result = null; break;
      case 'snapshot': result = l.snapshot(); break;
      default: return new Response('not found', { status: 404 });
    }
    return new Response(JSON.stringify(result));
  }
}
