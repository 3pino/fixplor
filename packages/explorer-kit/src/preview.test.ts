import { describe, expect, it } from 'vitest';
import { highlightCode, languageOf } from './highlight';
import { isImageName, isSvgName } from './kinds';
import { headOf, looksLikeText, readHead } from './preview';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('文字か・先頭の行', () => {
  it('NUL を含むものは文字ではない。日本語・空は文字', () => {
    expect(looksLikeText(enc('hello\nworld'))).toBe(true);
    expect(looksLikeText(enc('日本語のテキスト'))).toBe(true);
    expect(looksLikeText(new Uint8Array())).toBe(true);
    expect(looksLikeText(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]))).toBe(false);
  });
  it('UTF-8 として読めない文字ばかりのものは、文字ではない。途中で切れた 1 文字は許す', () => {
    expect(looksLikeText(new Uint8Array(Array.from({ length: 200 }, (_, i) => 0x80 + (i % 40))))).toBe(false);
    const cut = enc('日本語').subarray(0, 7);
    expect(looksLikeText(cut)).toBe(true);
  });
  it('先頭から最大の行数まで。切ったかも返す', () => {
    const text = Array.from({ length: 150 }, (_, i) => `line${i}`).join('\n');
    const r = headOf(text, false);
    expect(r.text.split('\n')).toHaveLength(100);
    expect(r.truncated).toBe(true);
    expect(headOf('a\r\nb', false)).toEqual({ text: 'a\nb', truncated: false });
    expect(headOf('a\nb', true)).toEqual({ text: 'a\nb', truncated: true });
  });
});

describe('先頭だけ読む', () => {
  const streamOf = (chunks: Uint8Array[]): Response =>
    new Response(
      new ReadableStream<Uint8Array>({
        pull(c) {
          const next = chunks.shift();
          if (next) c.enqueue(next);
          else c.close();
        },
      }),
    );

  it('上限を超えたら、そこで切り上げる（続きがあると返す）', async () => {
    const big = new Uint8Array(100).fill(97);
    const r = await readHead('x://a', new AbortController().signal, 150, async () => streamOf([big, big, big]));
    expect(r.bytes.length).toBe(150);
    expect(r.more).toBe(true);
  });
  it('上限より短ければ、全部読む', async () => {
    const r = await readHead('x://a', new AbortController().signal, 1000, async () => streamOf([enc('abc'), enc('def')]));
    expect(new TextDecoder().decode(r.bytes)).toBe('abcdef');
    expect(r.more).toBe(false);
  });
  it('失敗した応答は、例外にする', async () => {
    await expect(readHead('x://a', new AbortController().signal, 10, async () => new Response('', { status: 404 }))).rejects.toThrow('404');
  });
});

describe('色付け', () => {
  it('名前から言語を決める（拡張子・ファイル名そのもの）', () => {
    expect(languageOf('main.rs')).toBe('rust');
    expect(languageOf('App.svelte')).toBe('xml');
    expect(languageOf('Dockerfile')).toBe('dockerfile');
    expect(languageOf('Dockerfile.dev')).toBe('dockerfile');
    expect(languageOf('.bashrc')).toBe('bash');
    expect(languageOf('a.TS')).toBe('typescript');
    expect(languageOf('memo.txt')).toBeNull();
    expect(languageOf('noext')).toBeNull();
  });
  it('言語が分かれば色付けした HTML（文字はエスケープされる）。分からなければ null', async () => {
    const html = await highlightCode('const a = "<b>";', 'a.js');
    expect(html).toContain('hljs-keyword');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;');
    expect(await highlightCode('hello', 'a.txt')).toBeNull();
  });
});

describe('SVG', () => {
  it('svg は画像として扱う（<img> で描く）', () => {
    expect(isImageName('a.svg')).toBe(true);
    expect(isSvgName('A.SVG')).toBe(true);
    expect(isSvgName('a.png')).toBe(false);
    expect(isSvgName('x', 'image/svg+xml')).toBe(true);
  });
});
