import { describe, expect, it } from 'vitest';
import type { Entry } from './types';
import * as listing from './listing';
import { basicViewerKind, isImageName } from './kinds';
import { breadcrumbs, sortEntries, splitExt } from './listing';

const kindLabel = (x: Entry): string => listing.kindLabel(x, isImageName);
const entryAction = (x: Entry): string => listing.entryAction(x, basicViewerKind);

const e = (name: string, kind: 'file' | 'dir' = 'file', mime: string | null = null, size = 0, modified = 0): Entry => ({
  name,
  path: name,
  kind,
  size,
  modified,
  mime,
});

describe('sortEntries', () => {
  it('フォルダが先、名前は大文字小文字・数字の桁を区別せずに並べる', () => {
    const names = sortEntries([e('b.txt'), e('a10.txt'), e('A2.txt'), e('zdir', 'dir'), e('adir', 'dir')]).map((x) => x.name);
    expect(names).toEqual(['adir', 'zdir', 'A2.txt', 'a10.txt', 'b.txt']);
  });
});

describe('sortEntries（並べ方と向き）', () => {
  const list = () => [e('b.txt', 'file', null, 20, 300), e('a.txt', 'file', null, 5, 100), e('zdir', 'dir', null, 0, 200), e('c.txt', 'file', null, 20, 200)];
  it('更新日時・サイズは、向きに従う（フォルダは先のまま）', () => {
    expect(sortEntries(list(), 'modified', 'asc').map((x) => x.name)).toEqual(['zdir', 'a.txt', 'c.txt', 'b.txt']);
    expect(sortEntries(list(), 'modified', 'desc').map((x) => x.name)).toEqual(['zdir', 'b.txt', 'c.txt', 'a.txt']);
    expect(sortEntries(list(), 'size', 'desc').map((x) => x.name)).toEqual(['zdir', 'b.txt', 'c.txt', 'a.txt']);
  });
  it('同じ値のものは名前の順（向きを逆にしても、名前は同じ順）', () => {
    expect(sortEntries(list(), 'size', 'asc').map((x) => x.name)).toEqual(['zdir', 'a.txt', 'b.txt', 'c.txt']);
  });
  it('名前の降順は、フォルダを先に、名前を逆に', () => {
    expect(sortEntries(list(), 'name', 'desc').map((x) => x.name)).toEqual(['zdir', 'c.txt', 'b.txt', 'a.txt']);
  });
  it('種類の順: 渡した種類の文字で並べる（フォルダは先。同じ種類は名前の順）。種類の文字が無ければ、名前の順', () => {
    const kinds = [e('b.txt'), e('a.png'), e('c.txt'), e('d.md'), e('zdir', 'dir')];
    const kindOf = (x: { name: string; kind: string }) => (x.kind === 'dir' ? 'フォルダ' : x.name.split('.').pop()!.toUpperCase());
    expect(sortEntries(kinds, 'kind', 'asc', kindOf).map((x) => x.name)).toEqual(['zdir', 'd.md', 'a.png', 'b.txt', 'c.txt']);
    expect(sortEntries(kinds, 'kind', 'desc', kindOf).map((x) => x.name)).toEqual(['zdir', 'b.txt', 'c.txt', 'a.png', 'd.md']);
    expect(sortEntries(kinds, 'kind').map((x) => x.name)).toEqual(['zdir', 'a.png', 'b.txt', 'c.txt', 'd.md']);
  });
});

describe('kindLabel（一覧の「種類」）', () => {
  it('フォルダ・画像・拡張子・ファイル', () => {
    expect(kindLabel(e('d', 'dir'))).toBe('フォルダ');
    expect(kindLabel(e('a.png'))).toBe('画像');
    expect(kindLabel(e('x', 'file', 'image/jpeg'))).toBe('画像');
    expect(kindLabel(e('report.pdf'))).toBe('PDF');
    expect(kindLabel(e('README'))).toBe('ファイル');
    expect(kindLabel(e('.env'))).toBe('ファイル');
  });
});

describe('breadcrumbs', () => {
  it('直下は空', () => expect(breadcrumbs('')).toEqual([]));
  it('階層ごとのパス', () => {
    expect(breadcrumbs('docs/a/b')).toEqual([
      { name: 'docs', path: 'docs' },
      { name: 'a', path: 'docs/a' },
      { name: 'b', path: 'docs/a/b' },
    ]);
  });
});

describe('entryAction', () => {
  it('フォルダは中へ、画像は拡大、PDF はプレビュー、ほかはファイル', () => {
    expect(entryAction(e('d', 'dir'))).toBe('enter');
    expect(entryAction(e('a.PNG'))).toBe('image');
    expect(entryAction(e('x', 'file', 'image/jpeg'))).toBe('image');
    expect(entryAction(e('a.pdf'))).toBe('pdf');
    expect(entryAction(e('x', 'file', 'application/pdf'))).toBe('pdf');
    expect(entryAction(e('a.txt'))).toBe('file');
  });
});

describe('sortEntries（作成日時）', () => {
  it('作成日時の順に並べる。持たない項目は、いちばん古い扱い（フォルダは先のまま）', () => {
    const c = (name: string, created?: number, kind: 'file' | 'dir' = 'file'): Entry => ({ ...e(name, kind), ...(created ? { created } : {}) });
    const list = () => [c('b.txt', 300), c('a.txt'), c('zdir', 50, 'dir'), c('c.txt', 100)];
    expect(sortEntries(list(), 'created', 'asc').map((x) => x.name)).toEqual(['zdir', 'a.txt', 'c.txt', 'b.txt']);
    expect(sortEntries(list(), 'created', 'desc').map((x) => x.name)).toEqual(['zdir', 'b.txt', 'c.txt', 'a.txt']);
  });
});

describe('パス欄の文字（pathToText・textToPath）', () => {
  it('表示は、先頭に / を付ける。ドライブ（C:）・ネットワーク（\\\\nas\\share）は、そのまま', () => {
    expect(listing.pathToText('')).toBe('/');
    expect(listing.pathToText('home/me')).toBe('/home/me');
    expect(listing.pathToText('C:/Users/me')).toBe('C:/Users/me');
    expect(listing.pathToText('\\\\nas\\share/a')).toBe('\\\\nas\\share/a');
  });
  it('打った文字は、/ も \\ も区切りにして、. と .. を解いた、画面のパスにする', () => {
    expect(listing.textToPath('/home/me/')).toBe('home/me');
    expect(listing.textToPath('  home//me/./docs ')).toBe('home/me/docs');
    expect(listing.textToPath('/home/me/../you')).toBe('home/you');
    expect(listing.textToPath('/')).toBe('');
    expect(listing.textToPath('')).toBe('');
    expect(listing.textToPath('C:\\Users\\me')).toBe('C:/Users/me');
    expect(listing.textToPath('\\\\nas\\share\\a\\b')).toBe('\\\\nas\\share/a/b');
    expect(listing.textToPath('\\\\wsl$\\Ubuntu')).toBe('\\\\wsl$\\Ubuntu');
    // 往復
    for (const d of ['', 'home/me', 'C:/Users', '\\\\nas\\share/a']) expect(listing.textToPath(listing.pathToText(d))).toBe(d);
  });
  it('resolveTypedPath: ~ はホームから、. や .. は今いるフォルダから。それ以外は、いちばん上から', () => {
    const r = listing.resolveTypedPath;
    expect(r('~', 'a/b', 'home/me')).toBe('home/me');
    expect(r('~/docs', 'a/b', 'home/me')).toBe('home/me/docs');
    expect(r('~\\docs\\..', 'a/b', 'home/me')).toBe('home/me');
    expect(r('~', 'C:/x', 'C:/Users/me')).toBe('C:/Users/me');
    expect(r('~me', 'a/b', 'home/me')).toBe('~me'); // ~me は、ユーザー名の指定ではないので、そのまま
    expect(r('~', 'a/b')).toBe('~'); // ホームが無い置き場所: 解かない（開けない、と出る）
    expect(r('..', 'a/b/c')).toBe('a/b');
    expect(r('../..', 'a/b/c')).toBe('a');
    expect(r('../x/', 'a/b/c')).toBe('a/b/x');
    expect(r('.', 'a/b')).toBe('a/b');
    expect(r('./docs', 'a/b')).toBe('a/b/docs');
    expect(r('..', '')).toBe('');
    expect(r('..', 'C:/Users/me')).toBe('C:/Users');
    expect(r('..\\..', '\\\\nas\\share/a')).toBe('\\\\nas');
    expect(r('/home/me/../you', 'a/b')).toBe('home/you');
    expect(r('home/me', 'a/b')).toBe('home/me');
    expect(r('.hidden', 'a/b')).toBe('.hidden'); // .hidden は、.. や . ではない
  });
});

describe('splitExt（収まらないとき、拡張子を残すための分け方）', () => {
  it('最後のドットから分ける。ドットで始まるだけ・末尾がドット・拡張子が長すぎるときは分けない', () => {
    expect(splitExt('verylongfilename.txt')).toEqual(['verylongfilename', '.txt']);
    expect(splitExt('a.tar.gz')).toEqual(['a.tar', '.gz']);
    expect(splitExt('.env')).toEqual(['.env', '']);
    expect(splitExt('name.')).toEqual(['name.', '']);
    expect(splitExt('noext')).toEqual(['noext', '']);
    expect(splitExt('a.thisisverylong')).toEqual(['a.thisisverylong', '']);
  });
});
