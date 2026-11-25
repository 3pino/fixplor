// @vitest-environment jsdom
// 中継の URL は、Tauri の convertFileSrc（スキーム名つき）で作る。その形が、Rust の中継（proxy.rs の parse_path）が読む形であること。
import { beforeEach, describe, expect, it } from 'vitest';
import { davProxyUrl, PROXY_SCHEME } from './webdav';

/** Tauri の convertFileSrc の中身（Linux: scheme://localhost/<符号化>、Windows・Android: http://scheme.localhost/<符号化>） */
function stubTauri(os: 'linux' | 'windows'): void {
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    convertFileSrc: (path: string, protocol: string) => {
      const p = encodeURIComponent(path);
      return os === 'windows' ? `http://${protocol}.localhost/${p}` : `${protocol}://localhost/${p}`;
    },
  };
}

/** Rust の parse_path と同じ読み方（先頭の / を除き、全体を 1 回戻して、段ごとにもう 1 回戻す） */
function parse(urlPath: string): [string, string, string] {
  const whole = decodeURIComponent(urlPath.replace(/^\//, ''));
  const [place, base, ...rest] = whole.split('/');
  return [decodeURIComponent(place), decodeURIComponent(base), rest.map(decodeURIComponent).join('/')];
}

describe('davProxyUrl（Tauri の convertFileSrc 経由）', () => {
  beforeEach(() => stubTauri('linux'));

  it('スキームは fixdav。パスの部分は、Rust が (id, 接続先, パス) に戻せる', () => {
    expect(PROXY_SCHEME).toBe('fixdav');
    for (const rel of ['a.png', '写真/猫 と 犬.png', '100%/a#b?c.png']) {
      const url = new URL(davProxyUrl('id-1', 'https://nas.example/dav/', rel, '1-2'));
      expect(url.protocol).toBe('fixdav:');
      expect(url.hostname).toBe('localhost');
      expect(url.search).toBe('?v=1-2');
      expect(parse(url.pathname)).toEqual(['id-1', 'https://nas.example/dav/', rel]);
    }
  });

  it('Windows・Android は http://fixdav.localhost/… になる（同じ形のパス）', () => {
    stubTauri('windows');
    const url = new URL(davProxyUrl('id-1', 'https://nas.example/dav/', 'a b.png', 'v'));
    expect(url.host).toBe('fixdav.localhost');
    expect(parse(url.pathname)).toEqual(['id-1', 'https://nas.example/dav/', 'a b.png']);
  });
});
