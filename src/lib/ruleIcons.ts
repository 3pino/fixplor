import { BRAND_ALIASES, BRAND_ICONS, brandCanonical } from '@3pino/ui-kit-web/brandIcons';
import type { EntryIcon } from '@3pino/explorer-kit';
import { isLucideName, lucideCanonical, searchLucide } from './lucideIcons';

// 見た目のルールで使うアイコン: 共通の登録簿（@3pino/ui-kit-web/icons）の名前。lucide のすべて（名前は lucide のもの）と、
// 共通の独自アイコン（アプリのロゴ `fixplor-logo`・`disnans-logo` など。ui-kit-web の BRAND_ICONS）。保存するのは名前だけ。

/** アプリのロゴの名前（以前の版は `logo`・`fixplor` で保存した。どちらも読める） */
export const LOGO_ICON = 'fixplor-logo';
const OLD_LOGO = new Set(['logo', 'fixplor']);

/** 新しく「アイコンを設定する」にしたときの、アイコンの名前 */
export const DEFAULT_ICON = 'file';

/** 保存した名前を、登録簿の名前にする（昔のロゴの名前・独自アイコンと lucide の別名は、今の名前へ） */
export const iconName = (name: string): string => {
  if (OLD_LOGO.has(name)) return LOGO_ICON;
  const brand = brandCanonical(name);
  return brand in BRAND_ICONS ? brand : lucideCanonical(name);
};

/** 保存した名前から、表示するアイコンにする。知らない名前は、undefined（既定のアイコンのまま） */
export function iconOf(name: string | undefined): EntryIcon | undefined {
  if (!name) return undefined;
  const n = iconName(name);
  return n in BRAND_ICONS || isLucideName(n) ? { iconName: n } : undefined;
}

/** 一覧に出す、共通の独自アイコンの名前 */
const BRAND_NAMES = Object.keys(BRAND_ICONS).sort();

/** アイコンを、名前で絞り込む（lucide の別名でも探せる。共通の独自アイコン（ロゴなど）は、名前が合えば先頭） */
export function searchIcons(query: string): string[] {
  const terms = query.toLowerCase().split(/[\s-]+/).filter(Boolean);
  const has = (n: string): boolean => terms.every((t) => n.includes(t) || n.replace(/-/g, '').includes(t));
  // 別名（brand-js など）でも見つかる。見つかるのは、いつも本来の名前
  const brand = BRAND_NAMES.filter((n) => has(n) || Object.entries(BRAND_ALIASES).some(([a, c]) => c === n && has(a)));
  return [...brand, ...searchLucide(query)];
}
