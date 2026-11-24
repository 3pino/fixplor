// 右クリックのメニューの並びと表示（利用者が決める）。見た目は持たない。
// 項目は、ID で呼ぶ。出す条件（選んだ数・書けるか・貼れるか など）は、部品が決める。ここで決めるのは、順番と「出さない」だけ。

export type MenuLayout = {
  /** 並べた順の ID（ここに無い項目は、既定の順で、最後に続く） */
  order?: readonly string[];
  /** 出さない ID */
  hidden?: readonly string[];
};

/** 並びと表示（entry: 項目の右クリックのメニュー。space: 空きの右クリックのメニュー。header: 上端の行の部品） */
export type MenuLayouts = { entry?: MenuLayout; space?: MenuLayout; header?: MenuLayout };

export type MenuItemDef = { id: string; label: string };

/** 項目の右クリックのメニューにある項目（既定の順）。`app` は、本体が足す項目（entryMenu）のまとまり */
export const ENTRY_MENU_ITEMS: readonly MenuItemDef[] = [
  { id: 'copy', label: 'コピー' },
  { id: 'cut', label: '切り取り' },
  { id: 'pasteInto', label: 'ここへ貼り付け（フォルダ）' },
  { id: 'rename', label: '名前の変更' },
  { id: 'restore', label: '元へ戻す（ゴミ箱）' },
  { id: 'delete', label: '削除' },
  { id: 'properties', label: 'プロパティ' },
  { id: 'app', label: 'アプリの項目（ブックマークなど）' },
];

/** 空きの右クリックのメニューにある項目（既定の順） */
export const SPACE_MENU_ITEMS: readonly MenuItemDef[] = [
  { id: 'upload', label: 'アップロード' },
  { id: 'newFile', label: '新しいファイル' },
  { id: 'paste', label: '貼り付け' },
];

/**
 * 上端の行にある部品（既定の順）。戻る・進む・上へ・隠しファイルは、本体が足す（`headerItem`）。
 * パスは、残りの幅を使う。右端の ≡（メニュー）は、いつも出す
 */
export const HEADER_ITEMS: readonly MenuItemDef[] = [
  { id: 'back', label: '戻る' },
  { id: 'forward', label: '進む' },
  { id: 'up', label: '上のフォルダへ' },
  { id: 'path', label: 'パス' },
  { id: 'selectAll', label: 'すべて選ぶ' },
  { id: 'copy', label: 'コピー' },
  { id: 'cut', label: '切り取り' },
  { id: 'paste', label: '貼り付け' },
  { id: 'delete', label: '削除' },
  { id: 'search', label: '検索' },
  { id: 'hidden', label: '隠しファイルの表示' },
  { id: 'newFile', label: '新しいファイル' },
  { id: 'newFolder', label: '新しいフォルダ' },
];

/** 上端の行で、決めていないときに出さない部品（足したいときだけ、設定で出す） */
export const HEADER_DEFAULT_HIDDEN: readonly string[] = ['hidden', 'newFile', 'newFolder'];

/** 上端の行の並びと出さない部品。決めていなければ、既定（HEADER_DEFAULT_HIDDEN を出さない） */
export const headerLayout = (layout?: MenuLayout): MenuLayout => layout ?? { order: [], hidden: [...HEADER_DEFAULT_HIDDEN] };

/** 表示の順（出さない項目も含む）。知らない ID は捨て、並べていない項目は、既定の順で後ろに続く */
export function menuOrder(defaults: readonly string[], layout?: MenuLayout): string[] {
  const known = new Set(defaults);
  const out: string[] = [];
  for (const id of layout?.order ?? []) if (known.has(id) && !out.includes(id)) out.push(id);
  for (const id of defaults) if (!out.includes(id)) out.push(id);
  return out;
}

/** 出す項目の ID（表示の順。出さないものを除く） */
export function applyMenuLayout(defaults: readonly string[], layout?: MenuLayout): string[] {
  const hidden = new Set(layout?.hidden ?? []);
  return menuOrder(defaults, layout).filter((id) => !hidden.has(id));
}

/** id を、動かしたあとの位置（toIndex）へ。並び全体を、order として持つ */
export function reorderMenu(defaults: readonly string[], layout: MenuLayout | undefined, id: string, toIndex: number): MenuLayout {
  const order = menuOrder(defaults, layout).filter((x) => x !== id);
  order.splice(Math.max(0, Math.min(order.length, toIndex)), 0, id);
  return { order, hidden: [...(layout?.hidden ?? [])] };
}

/** id を、出す・出さない */
export function setMenuHidden(layout: MenuLayout | undefined, id: string, hidden: boolean): MenuLayout {
  const rest = (layout?.hidden ?? []).filter((x) => x !== id);
  return { order: [...(layout?.order ?? [])], hidden: hidden ? [...rest, id] : rest };
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** 保存した文字から読む（壊れていれば空） */
export function parseMenuLayouts(raw: string | null): MenuLayouts {
  if (raw === null) return {};
  try {
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    if (!v || typeof v !== 'object') return {};
    const one = (x: unknown): MenuLayout | undefined => {
      if (!x || typeof x !== 'object') return undefined;
      const o = x as Record<string, unknown>;
      return { order: strings(o.order), hidden: strings(o.hidden) };
    };
    return { entry: one(v.entry), space: one(v.space), header: one(v.header) };
  } catch {
    return {};
  }
}
