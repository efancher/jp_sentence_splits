import type { LedgerStorage } from './types';

/**
 * Usage ledger behind the gateway's admission control (docs/CLOUDFLARE_R2_PLAN.md).
 *
 * It tracks committed object sizes, in-flight upload reservations and monthly
 * Class A/B operation counts. The gateway is the only intended writer, so
 * these numbers are an application-side limit, not a provider-wide cap: writes
 * made outside the gateway are invisible to it. Uploads are refused until an
 * operator seeds the baseline, because an unseeded ledger cannot be trusted.
 */
export interface Limits {
  storageWarnBytes: number;
  storageStopBytes: number;
  classAWarn: number;
  classAStop: number;
  classBWarn: number;
  classBStop: number;
}

export const DEFAULT_LIMITS: Limits = {
  storageWarnBytes: 8_000_000_000,
  storageStopBytes: 9_000_000_000,
  classAWarn: 500_000,
  classAStop: 800_000,
  classBWarn: 5_000_000,
  classBStop: 8_000_000,
};

/** A reservation outlives any single Worker invocation; expiry only reclaims abandoned ones. */
export const RESERVATION_TTL_MS = 30 * 60 * 1000;

interface Reservation {
  key: string;
  /** Bytes this upload may add beyond the object it replaces. */
  delta: number;
  size: number;
  expiresAt: number;
}

interface State {
  seeded: boolean;
  /** Baseline bytes the ledger was seeded with (objects it never saw uploaded). */
  baselineBytes: number;
  /** Committed size per object key, tracked since seeding. */
  objects: Record<string, number>;
  reservations: Record<string, Reservation>;
  month: string;
  classA: number;
  classB: number;
  nextId: number;
}

export type Denial =
  | 'not_seeded'
  | 'storage_limit'
  | 'class_a_limit'
  | 'class_b_limit'
  | 'bad_size';

export type ReserveResult = { ok: true; id: string; warning: boolean } | { ok: false; reason: Denial };
export type OpResult = { ok: true; warning: boolean } | { ok: false; reason: Denial };

export interface UsageSnapshot {
  seeded: boolean;
  month: string;
  storageBytes: number;
  reservedBytes: number;
  objectCount: number;
  classA: number;
  classB: number;
  limits: Limits;
  warnings: string[];
}

const STATE_KEY = 'state';

export const monthOf = (now: number): string => new Date(now).toISOString().slice(0, 7);

export class UsageLedger {
  private state!: State;
  private readonly storage: LedgerStorage;
  private readonly limits: Limits;
  private readonly now: () => number;

  constructor(storage: LedgerStorage, limits: Limits, now: () => number = Date.now) {
    this.storage = storage;
    this.limits = limits;
    this.now = now;
  }

  /** Loads persisted state once; call before any other method. */
  async load(): Promise<void> {
    this.state = (await this.storage.get<State>(STATE_KEY)) ?? {
      seeded: false,
      baselineBytes: 0,
      objects: {},
      reservations: {},
      month: monthOf(this.now()),
      classA: 0,
      classB: 0,
      nextId: 1,
    };
  }

  private async save(): Promise<void> {
    await this.storage.put(STATE_KEY, this.state);
  }

  private rollMonth(): void {
    const month = monthOf(this.now());
    if (month !== this.state.month) {
      // Operation counts reset each billing month; stored bytes persist.
      this.state.month = month;
      this.state.classA = 0;
      this.state.classB = 0;
    }
  }

  private expire(): void {
    const t = this.now();
    for (const [id, r] of Object.entries(this.state.reservations)) {
      if (r.expiresAt <= t) delete this.state.reservations[id];
    }
  }

  private committedBytes(): number {
    return this.state.baselineBytes + Object.values(this.state.objects).reduce((a, b) => a + b, 0);
  }

  private reservedBytes(): number {
    return Object.values(this.state.reservations).reduce((a, r) => a + r.delta, 0);
  }

  /** Sets the byte total of what already sits in the bucket. Replaces tracked objects. */
  async seed(baselineBytes: number): Promise<void> {
    if (!Number.isFinite(baselineBytes) || baselineBytes < 0) throw new Error('invalid baseline');
    this.state.seeded = true;
    this.state.baselineBytes = Math.floor(baselineBytes);
    this.state.objects = {};
    await this.save();
  }

  /** Atomically reserves room for an upload of `size` bytes to `key`. */
  async reserve(key: string, size: number): Promise<ReserveResult> {
    if (!Number.isInteger(size) || size <= 0) return { ok: false, reason: 'bad_size' };
    if (!this.state.seeded) return { ok: false, reason: 'not_seeded' };
    this.rollMonth();
    this.expire();
    if (this.state.classA + 1 > this.limits.classAStop) return { ok: false, reason: 'class_a_limit' };
    // Overwrites replace the tracked object; only growth needs headroom.
    const delta = Math.max(0, size - (this.state.objects[key] ?? 0));
    const projected = this.committedBytes() + this.reservedBytes() + delta;
    if (projected > this.limits.storageStopBytes) return { ok: false, reason: 'storage_limit' };
    const id = String(this.state.nextId++);
    this.state.reservations[id] = { key, delta, size, expiresAt: this.now() + RESERVATION_TTL_MS };
    this.state.classA += 1;
    await this.save();
    return { ok: true, id, warning: projected > this.limits.storageWarnBytes };
  }

  /** Records a completed upload. `size` is what R2 reports it stored. */
  async commit(id: string, key: string, size: number): Promise<void> {
    // An expired reservation is gone, but the bytes are in the bucket regardless.
    delete this.state.reservations[id];
    this.state.objects[key] = size;
    await this.save();
  }

  /** Releases a reservation whose upload verifiably did not store anything. */
  async release(id: string): Promise<void> {
    if (!this.state.reservations[id]) return;
    delete this.state.reservations[id];
    await this.save();
  }

  /** Counts a delete (Class A) and drops the object's tracked bytes. */
  async remove(key: string): Promise<OpResult> {
    const op = await this.countOp('A');
    if (!op.ok) return op;
    delete this.state.objects[key];
    await this.save();
    return op;
  }

  /** Counts one read-class (`B`) or write-class (`A`) operation against the monthly limits. */
  async countOp(kind: 'A' | 'B'): Promise<OpResult> {
    this.rollMonth();
    const used = kind === 'A' ? this.state.classA : this.state.classB;
    const stop = kind === 'A' ? this.limits.classAStop : this.limits.classBStop;
    const warn = kind === 'A' ? this.limits.classAWarn : this.limits.classBWarn;
    if (used + 1 > stop) return { ok: false, reason: kind === 'A' ? 'class_a_limit' : 'class_b_limit' };
    if (kind === 'A') this.state.classA += 1;
    else this.state.classB += 1;
    await this.save();
    return { ok: true, warning: used + 1 > warn };
  }

  snapshot(): UsageSnapshot {
    this.rollMonth();
    this.expire();
    const storageBytes = this.committedBytes();
    const warnings: string[] = [];
    if (!this.state.seeded) warnings.push('ledger not seeded: uploads are refused');
    if (storageBytes > this.limits.storageWarnBytes) warnings.push('storage above warning threshold');
    if (this.state.classA > this.limits.classAWarn) warnings.push('Class A operations above warning threshold');
    if (this.state.classB > this.limits.classBWarn) warnings.push('Class B operations above warning threshold');
    return {
      seeded: this.state.seeded,
      month: this.state.month,
      storageBytes,
      reservedBytes: this.reservedBytes(),
      objectCount: Object.keys(this.state.objects).length,
      classA: this.state.classA,
      classB: this.state.classB,
      limits: this.limits,
      warnings,
    };
  }
}

export function limitsFromEnv(env: Record<string, string | undefined>): Limits {
  const num = (value: string | undefined, fallback: number): number => {
    const n = Number(value);
    return value !== undefined && value !== '' && Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    storageWarnBytes: num(env.STORAGE_WARN_BYTES, DEFAULT_LIMITS.storageWarnBytes),
    storageStopBytes: num(env.STORAGE_STOP_BYTES, DEFAULT_LIMITS.storageStopBytes),
    classAWarn: num(env.CLASS_A_WARN, DEFAULT_LIMITS.classAWarn),
    classAStop: num(env.CLASS_A_STOP, DEFAULT_LIMITS.classAStop),
    classBWarn: num(env.CLASS_B_WARN, DEFAULT_LIMITS.classBWarn),
    classBStop: num(env.CLASS_B_STOP, DEFAULT_LIMITS.classBStop),
  };
}
