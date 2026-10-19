/**
 * Minimal structural types for the Cloudflare bindings this Worker uses, so the
 * repository typechecks without `@cloudflare/workers-types`. The real runtime
 * objects are structurally compatible.
 */
export interface R2ObjectInfo {
  size: number;
  httpMetadata?: { contentType?: string };
}

export interface R2ObjectBody extends R2ObjectInfo {
  body: ReadableStream<Uint8Array>;
}

export interface R2BucketLike {
  head(key: string): Promise<R2ObjectInfo | null>;
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: ReadableStream<Uint8Array> | ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<R2ObjectInfo>;
  delete(key: string): Promise<void>;
}

/** Durable Object storage subset used by the ledger. */
export interface LedgerStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
}

export interface DurableObjectStubLike {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

export interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubLike;
}

export interface Env {
  AUDIO: R2BucketLike;
  LEDGER: DurableObjectNamespaceLike;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  /** Secret. Guards /v1/admin/*; never exposed to the browser. */
  ADMIN_TOKEN: string;
  /** Comma-separated browser origins allowed by CORS. */
  ALLOWED_ORIGINS?: string;
  /** "1" is the emergency switch: refuse every non-admin request. */
  GATEWAY_DISABLED?: string;
  STORAGE_WARN_BYTES?: string;
  STORAGE_STOP_BYTES?: string;
  CLASS_A_WARN?: string;
  CLASS_A_STOP?: string;
  CLASS_B_WARN?: string;
  CLASS_B_STOP?: string;
}
