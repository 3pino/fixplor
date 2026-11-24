// 一覧の決まり（並び順・種類の文字・パス・押したときの動き）。見た目は持たない。

import type { Entry } from './types';

/** 並べる key（名前・種類・更新日時・作成日時・サイズ）と向き。作成日時を持たない項目は、いちばん古い扱い */
export type SortKey = 'name' | 'kind' | 'modified' | 'created' | 'size';
export type SortOrder = 'asc' | 'desc';

const byName = (a: Entry, b: Entry) => a.name.localeCompare(b.name, 'ja', { numeric: true, sensitivity: 'base' });

/**
 * 並び順: フォルダは向きに関係なく先。同じ種類の中を key で並べる（向きは asc・desc）。
 * 同じ値のものは、向きに関係なく名前の順（大文字・小文字・数字の桁を区別しない）。
 * 種類（kind）で並べるときは、種類の文字を返す kindOf（一覧の「種類」の列と同じもの）を渡す（無ければ、名前の順）
 */
export function sortEntries(entries: Iterable<Entry>, key: SortKey = 'name', order: SortOrder = 'asc', kindOf?: (e: Entry) => string): Entry[] {
  const dir = order === 'asc' ? 1 : -1;
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    if (key === 'name') return byName(a, b) * dir;
    const c =
      key === 'kind'
        ? kindOf
          ? kindOf(a).localeCompare(kindOf(b), 'ja', { numeric: true, sensitivity: 'base' })
          : 0
        : key === 'modified'
          ? a.modified - b.modified
          : key === 'created'
            ? (a.created ?? 0) - (b.created ?? 0)
            : a.size - b.size;
    // 同じ値の中は、向きに関係なく名前の順
    return c !== 0 ? c * dir : byName(a, b);
  });
}

/** 種類の文字（一覧の「種類」）: フォルダ・画像・拡張子（大文字）・ファイル */
export function kindLabel(e: Entry, isImage: (name: string, mime?: string | null) => boolean): string {
  if (e.kind === 'dir') return 'フォルダ';
  if (isImage(e.name, e.mime)) return '画像';
  const dot = e.name.lastIndexOf('.');
  return dot > 0 && dot < e.name.length - 1 ? e.name.slice(dot + 1).toUpperCase() : 'ファイル';
}

/** 名前を、名前の本体と拡張子（ドット付き。`.txt`）に分ける。収まらないとき、拡張子は残して、本体を省略するために使う。拡張子が無い・長すぎる（10 文字より長い）ときは、分けない */
export function splitExt(name: string): [string, string] {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1 || name.length - dot > 10) return [name, ''];
  return [name.slice(0, dot), name.slice(dot)];
}

/** パン屑（置き場所のいちばん上から、いまのフォルダまで）。path は各階層のパス */
export function breadcrumbs(dir: string): { name: string; path: string }[] {
  const out: { name: string; path: string }[] = [];
  let acc = '';
  for (const seg of dir === '' ? [] : dir.split('/')) {
    acc = acc === '' ? seg : `${acc}/${seg}`;
    out.push({ name: seg, path: acc });
  }
  return out;
}

/** パス欄に出す文字。ドライブ（`C:`）・ネットワーク（`\\nas\share`）のほかは、先頭に `/` を付ける */
export function pathToText(dir: string): string {
  return /^[A-Za-z]:|^\\\\/.test(dir) ? dir : `/${dir}`;
}

/**
 * パス欄に打った文字を、画面のパスにする（`/home/me/../you/` → `home/you`）。
 * 区切りは `/` も `\` も受ける。`.` は無視し、`..` は 1 つ上へ。先頭の `\\server\share` は、いちばん上の 1 段のまま
 */
export function textToPath(text: string): string {
  const t = text.trim();
  const unc = t.startsWith('\\\\');
  const parts: string[] = [];
  for (const seg of (unc ? t.slice(2) : t).split(/[\\/]+/)) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  if (!unc) return parts.join('/');
  return [`\\\\${parts.slice(0, 2).join('\\')}`, ...parts.slice(2)].join('/');
}

/**
 * パス欄に打った文字を、移る先の画面のパスにする。`textToPath` に加えて、次を解く。
 * - `~`・`~/docs`（`~\docs`）: ホーム（`home`。無い置き場所では、そのまま `textToPath` に渡す）から
 * - `.`・`..`・`./a`・`../a`: 今いるフォルダ（`cwd`）から
 * 先頭が `/`・`\`・ドライブ・`\\`・ほかの名前なら、これまでどおり、いちばん上からのパス
 */
export function resolveTypedPath(text: string, cwd: string, home?: string): string {
  const t = text.trim();
  const tilde = /^~(?=$|[\\/])/.test(t);
  if (tilde && home !== undefined) return textToPath(`${pathToText(home)}/${t.slice(1)}`);
  if (/^\.\.?(?=$|[\\/])/.test(t)) return textToPath(`${pathToText(cwd)}/${t}`);
  return textToPath(t);
}

/**
 * 項目を押したときの動き: フォルダは中へ（enter）、拡大表示で見られるものはその種類（image・pdf など。lib/viewers.ts）、
 * ほかはファイルとして開く・保存する（file）
 */
export function entryAction(e: Entry, viewerKind: (name: string, mime?: string | null) => string | null): string {
  if (e.kind === 'dir') return 'enter';
  return viewerKind(e.name, e.mime) ?? 'file';
}
