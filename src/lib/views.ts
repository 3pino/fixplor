// 画面に出す「ビュー」（場所の欄・親フォルダ・プレビューのような、一覧のほかの面）。
// デスクトップでは、出す・出さないを選ぶ。Android では、右へのスワイプで引き出す画面を選ぶ（選べるのは、引き出せるビュー = drawer の中から）。
// 親フォルダとプレビューは、部品だけ用意してあり、Android では出さない。

export type ViewDef = { id: string; label: string; /** Android で、右スワイプで引き出せるか */ drawer?: boolean };

/** ビューの一覧（ID は保存する。足すときは、ここへ足す） */
export const VIEWS: readonly ViewDef[] = [
  { id: 'places', label: '場所の欄（ブックマーク・ドライブ）', drawer: true },
  { id: 'parents', label: '親フォルダ' },
  { id: 'preview', label: 'プレビュー（カーソルの項目の中身）' },
];

/** ビューの設定（hidden: デスクトップで出さないビュー。swipe: Android で右スワイプで引き出すビュー） */
export type ViewSettings = { hidden: string[]; swipe: string };

export const DEFAULT_VIEWS: ViewSettings = { hidden: [], swipe: VIEWS[0].id };

const known = (id: unknown): id is string => typeof id === 'string' && VIEWS.some((v) => v.id === id);
const knownDrawer = (id: unknown): id is string => typeof id === 'string' && VIEWS.some((v) => v.id === id && v.drawer);

/** 保存した文字から読む（壊れていれば既定。知らないビューは捨てる） */
export function parseViews(raw: string | null): ViewSettings {
  if (raw === null) return { ...DEFAULT_VIEWS, hidden: [] };
  try {
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    if (!v || typeof v !== 'object') return { ...DEFAULT_VIEWS, hidden: [] };
    const hidden = Array.isArray(v.hidden) ? [...new Set(v.hidden.filter(known))] : [];
    return { hidden, swipe: knownDrawer(v.swipe) ? v.swipe : DEFAULT_VIEWS.swipe };
  } catch {
    return { ...DEFAULT_VIEWS, hidden: [] };
  }
}

/** デスクトップで、そのビューを出すか */
export const viewShown = (views: ViewSettings, id: string): boolean => !views.hidden.includes(id);
