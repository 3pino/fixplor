import type { ExplorerHost } from '@3pino/explorer-kit';
import { tauriCall, type Call } from './fs/call';

/** OS のクリップボードへ、ファイルとして書く口（エクスプローラー・ファイルマネージャーに貼り付けられる） */
export type FileClipboard = NonNullable<ExplorerHost['clipboard']['files']>;

/** この端末のファイルを、OS のクリップボードへ書ける OS（Rust の clipboard/ がある）。Android は、アプリの中のバッファだけ */
export function canWriteFiles(os: string): boolean {
  return os === 'windows' || os === 'linux';
}

/**
 * OS のクリップボードの口（Rust の `clipboard_set_files`・`clipboard_token`）。
 * 画面のパスは、`osPath` で OS の絶対パスにして渡す（Windows のいちばん上（ドライブの一覧）は OS のパスが無いので、書かない）。
 * 失敗は、黙って「書けなかった」にする（そのときは、アプリの中のバッファだけで貼る）
 */
export function fileClipboard(osPath: (path: string) => string, call: Call = tauriCall): FileClipboard {
  return {
    async write(paths, op, token) {
      const abs = paths.map(osPath);
      if (abs.length === 0 || abs.some((p) => p === '')) return false;
      try {
        await call('clipboard_set_files', { paths: abs, op, token });
        return true;
      } catch {
        return false;
      }
    },
    async token() {
      try {
        return (await call<string | null>('clipboard_token')) ?? null;
      } catch {
        return null;
      }
    },
  };
}
