/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LOCORIS_CLOUD_URL?: string;
  readonly VITE_LOCORIS_ACCOUNT_URL?: string;
  readonly VITE_LOCORIS_SITE_URL?: string;
  readonly VITE_GOOGLE_DRIVE_CLIENT_ID?: string;
  readonly VITE_GOOGLE_DRIVE_DESKTOP_CLIENT_ID?: string;
  readonly VITE_GOOGLE_DRIVE_DESKTOP_CLIENT_SECRET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
