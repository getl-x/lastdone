/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  readonly VITE_LASTDONE_SERVER_URL?: string;
  readonly VITE_LASTDONE_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
