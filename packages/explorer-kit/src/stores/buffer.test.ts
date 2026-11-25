import { beforeEach, describe, expect, it } from 'vitest';
import { ExplorerBuffer } from './buffer.svelte';

const explorerBuffer = new ExplorerBuffer();

beforeEach(() => explorerBuffer.clear());

describe('アプリ内の切り取り・コピーのバッファ', () => {
  it('切り取りは、貼り付けたものを外し、残りがなければ空に戻す', () => {
    explorerBuffer.set('move', [
      { path: 'a.txt', kind: 'file' },
      { path: 'b.txt', kind: 'file' },
    ]);
    expect(explorerBuffer.isCut('a.txt')).toBe(true);
    explorerBuffer.remove(['a.txt']);
    expect(explorerBuffer.items.map((i) => i.path)).toEqual(['b.txt']);
    explorerBuffer.remove(['b.txt']);
    expect(explorerBuffer.empty).toBe(true);
    expect(explorerBuffer.mode).toBeNull();
  });

  it('コピーは切り取りの印を付けない（貼り付けても外さない）', () => {
    explorerBuffer.set('copy', [{ path: 'a.txt', kind: 'file' }]);
    expect(explorerBuffer.isCut('a.txt')).toBe(false);
    expect(explorerBuffer.empty).toBe(false);
  });

  it('OS のクリップボードに書いた印（clipToken）は、入れ替える・空にすると忘れる', () => {
    expect(explorerBuffer.clipToken).toBeNull();
    explorerBuffer.set('copy', [{ path: 'a/x.txt', kind: 'file' }]);
    explorerBuffer.clipToken = 'tok';
    explorerBuffer.set('move', [{ path: 'a/y.txt', kind: 'file' }]);
    expect(explorerBuffer.clipToken).toBeNull();
    explorerBuffer.clipToken = 'tok';
    explorerBuffer.clear();
    expect(explorerBuffer.clipToken).toBeNull();
  });

  it('コピーした時点のクリップボードの控え（clipSnapshot）も、入れ替える・空にすると忘れる。空文字の控えも「結び付いている」', () => {
    expect(explorerBuffer.tracked).toBe(false);
    explorerBuffer.set('copy', [{ path: 'a/x.txt', kind: 'file' }]);
    explorerBuffer.clipSnapshot = '';
    expect(explorerBuffer.tracked).toBe(true);
    explorerBuffer.set('move', [{ path: 'a/y.txt', kind: 'file' }]);
    expect(explorerBuffer.clipSnapshot).toBeNull();
    explorerBuffer.clipSnapshot = 't:x';
    explorerBuffer.clear();
    expect(explorerBuffer.clipSnapshot).toBeNull();
    expect(explorerBuffer.tracked).toBe(false);
  });
});
