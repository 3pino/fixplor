// フォルダの一覧の表示方法と並び順（フォルダごと）の、純粋な部品。
// 保存先は、デバイスの設定の項目 `explorerDirs`（各デバイスに保存。stores/deviceSettings が読み書きする）。
// 形: { "<フォルダのパス（ルートは空文字）>": { view, sortKey, sortOrder } }。
// 上限は 200 件と 24 KiB（超えたら、古く変えたものから捨てる）。読めない値・知らない値は捨てる（古い「一覧」は詳細）。
// 注意: オブジェクトの並びは、数に見えるキーを先頭に寄せる。また、置き場所を通すと並びが変わりうる。
//       そのため「最後に変えたものを末尾」は、オブジェクトの並びが保つ範囲でだけ成り立つ。

import type { SortKey, SortOrder } from './listing';

export type ViewMode = 'details' | 'grid';
export type DirView = { view: ViewMode; sortKey: SortKey; sortOrder: SortOrder };
export type DirViewMap = Record<string, DirView>;

/** 覚えておくフォルダの数の上限 */
export const EXPLORER_DIRS_MAX = 200;
/** 保存の大きさの上限（UTF-8 のバイト数） */
export const EXPLORER_DIRS_MAX_BYTES = 24 * 1024;

export const DEFAULT_DIR_VIEW: DirView = { view: 'details', sortKey: 'name', sortOrder: 'asc' };
const VIEWS: readonly string[] = ['details', 'grid'];
const KEYS: readonly string[] = ['name', 'kind', 'modified', 'created', 'size'];
const ORDERS: readonly string[] = ['asc', 'desc'];

export function parseView(v: unknown): ViewMode | null {
  if (v === 'list') return 'details';
  return typeof v === 'string' && VIEWS.includes(v) ? (v as ViewMode) : null;
}

function parseDirView(v: unknown): DirView | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const view = parseView(o.view);
  if (!view || typeof o.sortKey !== 'string' || !KEYS.includes(o.sortKey) || typeof o.sortOrder !== 'string' || !ORDERS.includes(o.sortOrder)) return null;
  return { view, sortKey: o.sortKey as SortKey, sortOrder: o.sortOrder as SortOrder };
}

/** 保存された値を読む。知らない項目は捨て、残りは順番のまま。上限を超えたら古いもの（先頭）から捨てる */
export function parseDirViewMap(raw: unknown): DirViewMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const entries: [string, DirView][] = [];
  for (const [dir, v] of Object.entries(raw as Record<string, unknown>)) {
    const dv = parseDirView(v);
    if (dv) entries.push([dir, dv]);
  }
  return fitDirViewMap(entries);
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** 件数と大きさの上限に収める（先頭＝古いものから捨てる）。1 件だけでも大きさを超えるなら、その件は覚えない */
function fitDirViewMap(entries: [string, DirView][]): DirViewMap {
  let kept = entries.length > EXPLORER_DIRS_MAX ? entries.slice(entries.length - EXPLORER_DIRS_MAX) : entries;
  let out = Object.fromEntries(kept);
  while (kept.length > 0 && byteLength(JSON.stringify(out)) > EXPLORER_DIRS_MAX_BYTES) {
    kept = kept.slice(1);
    out = Object.fromEntries(kept);
  }
  return out;
}

/** フォルダの表示を 1 つ変えた結果（変えたものを最後に置く）。元の map は変えない */
export function withDirView(map: DirViewMap, dir: string, v: DirView): DirViewMap {
  const entries = Object.entries(map).filter(([d]) => d !== dir);
  entries.push([dir, v]);
  return fitDirViewMap(entries);
}

/** このフォルダの表示（決めていなければ、いちばん近い上のフォルダ。どこにも無ければ既定） */
export function inheritedDirView(map: DirViewMap, dir: string, parentOf: (d: string) => string): DirView {
  for (let d = dir; ; d = parentOf(d)) {
    const v = map[d];
    if (v) return v;
    if (d === '') return DEFAULT_DIR_VIEW;
  }
}

