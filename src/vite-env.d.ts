/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BUNGIE_API_KEY: string;
  readonly VITE_BUNGIE_CLIENT_ID: string;
  readonly VITE_AUTH_WORKER_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
