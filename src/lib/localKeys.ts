import { findRegisteredKey } from '@3pino/app-kit-web/core/localKeys';

// localStorage のキーの一覧（このアプリのコードが使うものすべて）。読み書きは土台のストレージ（@3pino/app-kit-web/core/storage）を通す。
// ここに無いキーを使うと、試験（localKeys.test.ts）が止める。接頭辞は `fixplor.`。
// kind: state = 利用者の状態（消すと困る）／ cache = 再構成できる写し

export type LocalKey = { key: string; prefix?: true; owner: string; purpose: string; kind: 'state' | 'cache' };

export const LOCAL_KEYS: readonly LocalKey[] = [
  { key: 'fixplor.showHidden', owner: 'lib/settings.svelte.ts', purpose: '隠しファイルを出すか', kind: 'state' },
  { key: 'fixplor.dirs', owner: 'lib/settings.svelte.ts', purpose: 'フォルダごとの表示方法と並び順', kind: 'state' },
  { key: 'fixplor.columns', owner: 'lib/settings.svelte.ts', purpose: '詳細の列の幅（見出しの境目をつまんで変えた分）', kind: 'state' },
  { key: 'fixplor.menus', owner: 'lib/settings.svelte.ts', purpose: '上端の行の部品・右クリックのメニューの並びと、出さない項目（上端の行・項目の右クリック・空きの右クリック）', kind: 'state' },
  { key: 'fixplor.rules', owner: 'lib/settings.svelte.ts', purpose: '見た目のルール（条件に合うファイル・フォルダのアイコン・色）', kind: 'state' },
  { key: 'fixplor.views', owner: 'lib/settings.svelte.ts', purpose: 'ビュー（場所の欄など）の出す・出さない（デスクトップ）と、右スワイプで引き出す画面（Android）', kind: 'state' },
  { key: 'fixplor.hotkeys', owner: 'lib/hotkeys.svelte.ts', purpose: '利用者が変えたホットキー（既定と違う操作だけ）', kind: 'state' },
  { key: 'fixplor.tabs', owner: 'App.svelte', purpose: '開いているタブ（置き場所と開いているフォルダ）と、見ているタブ。起動で戻す', kind: 'state' },
  { key: 'fixplor.placesWidth', owner: 'App.svelte', purpose: '左の場所の欄の幅（px）', kind: 'state' },
  { key: 'fixplor.places', owner: 'lib/places.svelte.ts', purpose: '追加したネットワークの場所（名前と URL）', kind: 'state' },
  { key: 'fixplor.bookmarks', owner: 'lib/bookmarks.svelte.ts', purpose: 'ブックマーク（置き場所とフォルダ）。左の欄の上の節', kind: 'state' },
  { key: 'fixplor.updateCheckedAt', owner: 'lib/updateWatch.ts', purpose: 'アプリの更新を最後に確認した時刻', kind: 'cache' },
  { key: 'fixplor.updateNotifiedVersion', owner: 'lib/updateWatch.ts', purpose: '新しい版を知らせた版（同じ版は 1 回だけ知らせる）', kind: 'cache' },
];

export const registeredKey = (key: string): LocalKey | undefined => findRegisteredKey(LOCAL_KEYS, key);
