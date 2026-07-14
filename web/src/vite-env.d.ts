interface ImportMetaEnv {
  /** 后端地址;留空=同源。构建期注入,如 VITE_SERVER_URL=https://api.example.com */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  /** 运行时后端地址(可在 index.html 注入,改动无需重新构建) */
  __DG_SERVER_URL__?: string;
}
