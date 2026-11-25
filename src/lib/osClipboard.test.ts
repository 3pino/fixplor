import { describe, expect, it, vi } from 'vitest';
import { canWriteFiles, fileClipboard } from './osClipboard';

describe('OS のクリップボードへファイルとして書く口', () => {
  it('書ける OS は Windows と Linux だけ（Android・macOS は、アプリの中のバッファだけ）', () => {
    expect(['windows', 'linux', 'android', 'macos', ''].map(canWriteFiles)).toEqual([true, true, false, false, false]);
  });

  it('画面のパスを OS のパスにして Rust へ渡す。書けたら true', async () => {
    const call = vi.fn(async () => undefined);
    const files = fileClipboard((p) => `/home/${p}`, call as never);
    expect(await files.write(['a.txt', 'docs'], 'move', 'tok')).toBe(true);
    expect(call).toHaveBeenCalledWith('clipboard_set_files', { paths: ['/home/a.txt', '/home/docs'], op: 'move', token: 'tok' });
  });

  it('OS のパスが無い項目（Windows のドライブの一覧）を含むとき・空のときは、書かない', async () => {
    const call = vi.fn(async () => undefined);
    const files = fileClipboard((p) => (p === 'drive' ? '' : `C:\\${p}`), call as never);
    expect(await files.write(['drive', 'a'], 'copy', 't')).toBe(false);
    expect(await files.write([], 'copy', 't')).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });

  it('Rust が失敗したら、黙って false（印は null）。アプリの中のバッファだけで貼る', async () => {
    const call = vi.fn(async () => {
      throw new Error('unsupported');
    });
    const files = fileClipboard((p) => p, call as never);
    expect(await files.write(['a'], 'copy', 't')).toBe(false);
    expect(await files.token()).toBeNull();
  });

  it('印は、Rust の答えのまま（無ければ null）', async () => {
    const call = vi.fn(async () => 'tok-1');
    expect(await fileClipboard((p) => p, call as never).token()).toBe('tok-1');
    expect(call).toHaveBeenCalledWith('clipboard_token');
    expect(await fileClipboard((p) => p, (async () => null) as never).token()).toBeNull();
  });
});
