/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

/** Commit short sha + build time, injected by vite.config.ts ("dev" outside CI). */
declare const __BUILD_ID__: string;

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_DEPLOY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
