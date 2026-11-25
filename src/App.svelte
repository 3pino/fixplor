<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import Eye from '@lucide/svelte/icons/eye';
  import Check from '@lucide/svelte/icons/check';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import BookmarkIcon from '@lucide/svelte/icons/bookmark';
  import BookmarkX from '@lucide/svelte/icons/bookmark-x';
  import FileExplorer from '@3pino/explorer-kit/FileExplorer.svelte';
  import TabBar from './components/TabBar.svelte';
  import IconButton from '@3pino/ui-kit-web/IconButton.svelte';
  import MenuItem from '@3pino/ui-kit-web/MenuItem.svelte';
  import { baseName, createExplorer, ExplorerBuffer, type Entry, type Explorer, type FolderSizeCache, type ExplorerApi, type EntryUrls, type Rules } from '@3pino/explorer-kit';
  import Toasts from '@3pino/app-kit-web/shell/Toasts.svelte';
  import ConfirmDialog from '@3pino/app-kit-web/shell/ConfirmDialog.svelte';
  import { hotkeys } from './lib/hotkeys.svelte';
  import PlaceDialog from './components/PlaceDialog.svelte';
  import PlacesNav, { type NavEntry } from './components/PlacesNav.svelte';
  import { bookmarks } from './lib/bookmarks.svelte';
  import BookmarkSearch from './components/BookmarkSearch.svelte';
  import CertDialog from './components/CertDialog.svelte';
  import SettingsView from './components/SettingsView.svelte';
  import Settings from '@lucide/svelte/icons/settings';
  import { isAndroid } from '@3pino/app-kit-web/core/platform';
  import { detachedStart, exitApp, hasWindowControls, openTabInNewWindow, quitWindow } from './lib/windowControls';
  import { showUpdateBadge, UPDATE_BADGE_LABEL } from '@3pino/app-kit-web/updater';
  import { updater } from './lib/stores/updater.svelte';
  import { startUpdateWatch } from './lib/updateWatch';
  import Lightbox from './components/Lightbox.svelte';
  import { createLocalFs, type LocalFs } from './lib/fs/local';
  import { createDavFs } from './lib/fs/webdav';
  import { createCreds, type CredInfo } from './lib/fs/creds';
  import { createPins } from './lib/fs/pins';
  import Button from '@3pino/ui-kit-web/Button.svelte';
  import { FsError, type FsPlace } from './lib/fs/types';
  import type { Sources } from './lib/fs/sources';
  import { HostState, createHost, externalOpener, failureText } from './lib/host.svelte';
  import { placeLabel } from './lib/labels';
  import { entryStyleOf } from './lib/ruleStyle';
  import { viewShown } from './lib/views';
  import SidePane from './components/SidePane.svelte';
  import ParentView from '@3pino/explorer-kit/ParentView.svelte';
  import PreviewPane from '@3pino/explorer-kit/PreviewPane.svelte';
  import { allFilesGranted, openAllFilesSettings } from './lib/allFiles';
  import { startBackNav, type BackNav } from '@3pino/app-kit-web/core/backNav';
  import { places as saved, type DavPlace } from './lib/places.svelte';
  import { read, settings, write } from './lib/settings.svelte';
  import { APP_COMMANDS, type CommandId } from './lib/hotkeys';
  import { MAX_TABS, SETTINGS_PLACE, cycleIndex, indexAfterClose, moveItem, parseSavedTabs, serializeTabs, tabLabel } from './lib/tabs';

  // 外枠（上のバー・左の場所の一覧）と、エクスプローラーの本体。
  // 本体は共有の部品（@3pino/explorer-kit）に、置き場所（この端末、または追加したネットワークの場所）を渡したもの。
  // 外枠の見た目は仮（利用者の確認を取っていない）。
  const host = new HostState();
  /** Android の戻るボタン: 層（ライトボックス・パネルの戻る）の深さを WebView の履歴に合わせる（onMount で始める） */
  let backNav: BackNav | null = null;
  // 層が増えたり減ったりしたら、履歴の深さを合わせる（戻る操作は history の popstate で届く）
  $effect(() => {
    void host.shell.backDepth(0);
    backNav?.sync();
  });
  /** 開いている（または開いたことのある）置き場所。切り替えても、開いていたフォルダ・選びを保つ */
  type Bundle = { id: string; explorer: Explorer; open: (req: { url: string; name: string }) => Promise<void>; local?: LocalFs; dav?: { base: string } };
  const LOCAL = 'local';
  const TABS_KEY = 'fixplor.tabs';
  const PLACES_WIDTH_KEY = 'fixplor.placesWidth';
  /** タブ。タブごとに、開いた置き場所のエクスプローラー（切り替えても、開いていたフォルダ・選びを保つ）と、いま見ている置き場所を持つ */
  type Tab = { id: number; bundles: Map<string, Bundle>; currentId: string; /** 設定のタブ（中身は、設定の画面。見ていた置き場所は、裏に持っておく） */ settings?: boolean };
  let tabs = $state.raw<Tab[]>([]);
  let activeId = $state(0);
  let tabSeq = 0;
  /** 起動の復元が済んだか（済むまでは、タブの保存を上書きしない） */
  let tabsReady = $state(false);
  /** いま見ているタブの、いま見ている置き場所 */
  let current = $state.raw<Bundle | null>(null);
  /** この端末の置き場所（タブで共有）。ネットワークの置き場所は置き場所ごとに 1 つ（読んだ ETag を、タブのあいだで共有する） */
  let localFs: LocalFs | null = null;
  const davFsOf = new Map<string, ReturnType<typeof createDavFs>>();
  /** 切り取り・コピーのバッファは、同じ置き場所のタブで共有する（別の置き場所とは共有しない。パスが別のものになる） */
  const bufferOf = new Map<string, ExplorerBuffer>();
  /** 置き場所ごとの、数えたフォルダのサイズの写し（タブを切り替えても、数え直さない） */
  const sizeCacheOf = new Map<string, FolderSizeCache>();
  /** 状態の表示のために、作った置き場所の写し（bundles は反応しない入れ物なので） */
  let known = $state.raw<Record<string, Bundle>>({});
  let places = $state.raw<FsPlace[]>([]);
  let failed = $state('');
  let dialog = $state.raw<{ place?: DavPlace; cred?: CredInfo | null; credError?: string; focusPassword?: boolean; pin?: string | null } | null>(null);
  /** 証明書を確認できない・変わった置き場所。利用者に確かめてもらうまで、案内を出す */
  let certIssue = $state.raw<Record<string, 'tls' | 'cert_changed'>>({});
  /** 狭い画面（Android）の、左から出す場所の欄。開いているあいだは、「戻る」でも閉じる（ダイアログも同じく host.addBack で層を登録する） */
  let navOpen = $state(false);
  $effect(() => (navOpen ? untrack(() => host.addBack(() => (navOpen = false))) : undefined));
  // 設定の画面には場所の欄が無いので、開いたまま設定へ移ったら閉じる
  $effect(() => {
    if (activeSettings) navOpen = false;
  });
  $effect(() => (dialog ? untrack(() => host.addBack(() => (dialog = null))) : undefined));
  $effect(() => (certDialog ? untrack(() => host.addBack(() => (certDialog = null))) : undefined));
  /** 証明書を確かめるダイアログ（previous は、前に信頼した指紋） */
  let certDialog = $state.raw<{ place: DavPlace; previous: string | null } | null>(null);
  /** 認証が通らなかった置き場所（401）。入れ直してもらうまで、案内を出す */
  let authFailed = $state.raw<Record<string, true>>({});
  // 左の場所の欄の幅（つまみをドラッグして変える。各デバイスに保存する）
  const PLACES_MIN = 120;
  const PLACES_MAX = 480;
  const PLACES_DEFAULT = 200;
  const clampWidth = (w: number): number => Math.min(PLACES_MAX, Math.max(PLACES_MIN, Math.round(w)));
  const savedWidth = Number(read(PLACES_WIDTH_KEY));
  let placesWidth = $state(Number.isFinite(savedWidth) && savedWidth > 0 ? clampWidth(savedWidth) : PLACES_DEFAULT);
  let resizing = $state(false);

  function startResize(ev: PointerEvent): void {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const bar = ev.currentTarget as HTMLElement;
    bar.setPointerCapture(ev.pointerId);
    resizing = true;
    const left = bar.parentElement!.getBoundingClientRect().left;
    const move = (e: PointerEvent): void => {
      placesWidth = clampWidth(e.clientX - left);
    };
    const end = (): void => {
      resizing = false;
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', end);
      bar.removeEventListener('pointercancel', end);
      write(PLACES_WIDTH_KEY, String(placesWidth));
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
  }

  function resizeKey(ev: KeyboardEvent): void {
    const step = ev.shiftKey ? 40 : 10;
    if (ev.key === 'ArrowLeft') placesWidth = clampWidth(placesWidth - step);
    else if (ev.key === 'ArrowRight') placesWidth = clampWidth(placesWidth + step);
    else if (ev.key === 'Home') placesWidth = PLACES_DEFAULT;
    else return;
    ev.preventDefault();
    write(PLACES_WIDTH_KEY, String(placesWidth));
  }

  const creds = createCreds();
  const pins = createPins();

  const explorer = $derived(current?.explorer ?? null);
  /** 一覧のカーソルのある項目（プレビューのビューが見せる） */
  let cursorEntry = $state<Entry | null>(null);
  /** 見ているのが、設定のタブか（そのあいだ、一覧は裏に回る） */
  const activeSettings = $derived(tabs.find((t) => t.id === activeId)?.settings === true);
  const hasSettingsTab = $derived(tabs.some((t) => t.settings === true));
  /** 「ブックマークから検索」を開いているか */
  let bookmarkSearchOpen = $state(false);
  const viewStore = { read: () => settings.dirs, write: (map: unknown) => (settings.dirs = map) };

  function makeBundle(id: string, parts: { api: ExplorerApi; urls: EntryUrls; rules: Rules; open: (path: string) => Promise<void>; sources: Sources; isMissing: (e: unknown) => boolean }, extra: Pick<Parameters<typeof createExplorer>[0], 'caps' | 'labels'>): Explorer {
    let buffer = bufferOf.get(id);
    if (!buffer) bufferOf.set(id, (buffer = new ExplorerBuffer()));
    let folderSizeCache = sizeCacheOf.get(id);
    if (!folderSizeCache) sizeCacheOf.set(id, (folderSizeCache = new Map()));
    return createExplorer({
      buffer,
      folderSizeCache,
      api: parts.api,
      urls: parts.urls,
      rules: parts.rules,
      host: createHost(host, parts),
      isMissing: parts.isMissing,
      viewStore,
      ...extra,
    });
  }

  const activeTab = (): Tab => tabs.find((t) => t.id === activeId)!;

  /** タブの中に、置き場所のエクスプローラーを作る（この端末・ネットワークの場所。無ければ null） */
  function createBundle(tab: Tab, id: string): Bundle | null {
    let b: Bundle;
    if (id.startsWith(SD)) {
      const fs = sdFsOf.get(id);
      const v = sdList.find((s) => SD + s.id === id);
      if (!fs || !v) return null;
      const made = makeBundle(id, fs, { caps: fs.caps, labels: { root: v.name } });
      made.nav.dir = fs.start;
      b = { id, explorer: made, open: externalOpener(host, fs), local: fs };
    } else if (id === LOCAL) {
      const fs = localFs;
      if (!fs) return null;
      const made = makeBundle(LOCAL, fs, {
        // ゴミ箱の有無は置き場所の決まり（Android は「完全に削除」だけ）
        caps: fs.caps,
        labels: { root: fs.windows ? 'PC' : 'コンピューター' },
      });
      made.nav.dir = fs.start;
      b = { id: LOCAL, explorer: made, open: externalOpener(host, fs), local: fs };
    } else {
      const p = saved.get(id);
      if (!p) return null;
      let fs = davFsOf.get(id);
      if (!fs) {
        fs = createDavFs({ id: p.id, base: p.url, showHidden: () => settings.showHidden, onAuthError: () => (authFailed = { ...authFailed, [p.id]: true }), onCertError: (code) => (certIssue = { ...certIssue, [p.id]: code }) });
        davFsOf.set(id, fs);
      }
      // ゴミ箱は無い。削除は、確認のうえ完全に削除する
      const made = makeBundle(p.id, fs, { caps: { restore: false, trash: false }, labels: { root: p.name } });
      b = { id: p.id, explorer: made, open: externalOpener(host, fs), dav: { base: p.url } };
    }
    tab.bundles.set(id, b);
    known = { ...known, [id]: b };
    return b;
  }

  /** タブの中の置き場所のエクスプローラー（無ければ作る） */
  const bundleIn = (tab: Tab, id: string): Bundle | null => tab.bundles.get(id) ?? createBundle(tab, id);

  /** Android: 差した SD カード（置き場所の id は sd:<uuid>。ゴミ箱は無く、削除は完全に消す） */
  const SD = 'sd:';
  const sdFsOf = new Map<string, LocalFs>();
  let sdList = $state.raw<{ id: string; name: string }[]>([]);

  /** いま見るエクスプローラーを決める（見ているタブの、見ている置き場所として覚える） */
  function setCurrent(b: Bundle): void {
    const t = activeTab();
    t.currentId = b.id;
    // タブの名前・保存は、タブの並びの変化で更新する（タブの中身は反応しない入れ物なので、並びを作り直して知らせる）
    tabs = [...tabs];
    current = b;
  }

  /** タブを見る */
  function activate(id: number): void {
    const t = tabs.find((x) => x.id === id);
    if (!t) return;
    activeId = id;
    current = t.bundles.get(t.currentId) ?? null;
  }

  const startDir = (placeId: string): string => (placeId === LOCAL ? (localFs?.start ?? '') : '');

  /** 新しいタブ（見ているタブの右隣）。place・dir を省くと、いま見ている置き場所の、いちばん上（この端末は、ホーム） */
  function addTab(opts: { place?: string; dir?: string; afterId?: number; at?: number; focus?: boolean } = {}): void {
    if (tabs.length >= MAX_TABS) {
      host.toast(`タブは ${MAX_TABS} 個までです`, 'error');
      return;
    }
    const place = opts.place ?? current?.id ?? LOCAL;
    const tab: Tab = { id: ++tabSeq, bundles: new Map(), currentId: place };
    const b = bundleIn(tab, place);
    if (!b) return;
    b.explorer.nav.dir = opts.dir ?? startDir(place);
    const at = opts.at !== undefined ? Math.max(0, Math.min(tabs.length, opts.at)) : Math.max(0, tabs.findIndex((t) => t.id === (opts.afterId ?? activeId))) + 1;
    tabs = [...tabs.slice(0, at), tab, ...tabs.slice(at)];
    if (opts.focus !== false) activate(tab.id);
  }

  /** タブを閉じる。最後の 1 つなら、ウィンドウを閉じる（Android は、アプリを終える）。保存したタブは、そのまま残る */
  function closeTab(id: number): void {
    if (tabs.length <= 1) {
      void quitWindow().catch((e) => host.toast(failureText(e), 'error'));
      return;
    }
    const i = tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    const activeIndex = tabs.findIndex((t) => t.id === activeId);
    const next = tabs.filter((t) => t.id !== id);
    const nextActive = indexAfterClose(i, tabs.length, activeIndex);
    tabs = next;
    activate(next[nextActive].id);
  }

  function closeOthers(id: number): void {
    const keep = tabs.find((t) => t.id === id);
    if (!keep) return;
    tabs = [keep];
    activate(id);
  }

  function moveTab(from: number, to: number): void {
    tabs = moveItem(tabs, from, to);
  }

  function duplicateTab(id: number): void {
    const t = tabs.find((x) => x.id === id);
    const b = t?.bundles.get(t.currentId);
    if (t && b) addTab({ place: b.id, dir: b.explorer.nav.dir, afterId: id });
  }

  /** 設定のタブを開く（すでにあれば、そこへ。無ければ、見ているタブの右隣に作る） */
  function openSettings(): void {
    const existing = tabs.find((t) => t.settings);
    if (existing) {
      activate(existing.id);
      return;
    }
    if (tabs.length >= MAX_TABS) {
      host.toast(`タブは ${MAX_TABS} 個までです`, 'error');
      return;
    }
    // 見ていた置き場所は、裏に持つ（閉じるまで、場所の欄の操作は、新しいタブで開く）
    const tab: Tab = { id: ++tabSeq, bundles: new Map(), currentId: LOCAL, settings: true };
    if (!bundleIn(tab, LOCAL)) return;
    const at = Math.max(0, tabs.findIndex((t) => t.id === activeId)) + 1;
    tabs = [...tabs.slice(0, at), tab, ...tabs.slice(at)];
    activate(tab.id);
  }

  /** タブを、別のウィンドウで開く（タブをウィンドウの外へドラッグして離したとき）。開けたら、このウィンドウのタブは閉じる */
  async function detachTab(id: number, at: { x: number; y: number }): Promise<void> {
    const t = tabs.find((x) => x.id === id);
    if (!t || tabs.length <= 1) return;
    const place = t.settings ? SETTINGS_PLACE : t.currentId;
    const dir = t.bundles.get(t.currentId)?.explorer.nav.dir ?? '';
    try {
      await openTabInNewWindow({ place, dir }, at);
    } catch (e) {
      host.toast(`別のウィンドウで開けませんでした: ${failureText(e)}`, 'error');
      return;
    }
    closeTab(id);
  }

  /** エクスプローラーからドラッグされた項目のうち、フォルダを、新しいタブで開く（このフォルダの一覧で見つかるものだけ）。at 番目から並べる（見ているタブは変えない） */
  function openFoldersInTabs(paths: string[], at: number, focusFirst = false): void {
    const ex = explorer;
    const here = current?.id;
    if (!ex || !here) return;
    const st = ex.index.state(ex.nav.dir);
    if (st?.kind !== 'ok') return;
    let n = 0;
    for (const path of paths) {
      const e = st.entries.get(baseName(path));
      if (e?.kind === 'dir' && e.path === path) {
        const first = n === 0;
        addTab({ place: here, dir: path, at: at + n++, focus: focusFirst && first });
      }
    }
  }

  const tabItems = $derived(
    tabs.map((t) => {
      const b = t.bundles.get(t.currentId);
      const dir = b?.explorer.nav.dir ?? '';
      const place = b?.explorer.labels.root ?? '';
      if (t.settings) return { id: t.id, label: '設定', title: '設定', icon: 'settings' as const };
      return { id: t.id, label: tabLabel(place, dir), title: b?.local ? b.local.osPath(dir) : `${place}${dir === '' ? '' : ` / ${dir}`}` };
    }),
  );

  /** タブの保存（置き場所と開いているフォルダ）。復元が済んでから */
  $effect(() => {
    if (!tabsReady) return;
    const list = tabs.flatMap((t) => {
      const b = t.bundles.get(t.currentId);
      if (t.settings) return [{ place: SETTINGS_PLACE, dir: '' }];
      return b ? [{ place: t.currentId, dir: b.explorer.nav.dir }] : [];
    });
    if (list.length === 0) return;
    write(TABS_KEY, serializeTabs({ tabs: list, active: Math.max(0, tabs.findIndex((t) => t.id === activeId)) }));
  });

  /** Android: 全ファイルへのアクセスの許可が無い（許可されるまで、一覧の上に案内を出し続ける） */
  let needAllFiles = $state(false);

  /** Android: 全ファイルへのアクセスの許可を確かめる（起動時と、設定画面などから戻ったとき）。許可されたら、見ている一覧を読み直す */
  async function checkAllFiles(): Promise<void> {
    const granted = await allFilesGranted();
    const was = needAllFiles;
    needAllFiles = !granted;
    if (granted && was) {
      if (localFs) {
        places = await localFs.places();
        seedBookmarks();
      }
      for (const t of tabs) for (const b of t.bundles.values()) b.explorer.nav.reload();
    }
  }

  onMount(() => {
    backNav = startBackNav({ depth: () => host.shell.backDepth(0), back: () => host.back() }, history, window, { depthKey: 'fixplorDepth' });
    void checkAllFiles();
    // 設定画面（許可のダイアログ）から戻ったとき、許可されたかを確かめ直す
    const onFocus = () => void checkAllFiles();
    window.addEventListener('focus', onFocus);
    // アプリの更新を、裏で確かめる（対応している環境だけ。新しい版はトーストで 1 度だけ知らせる）
    void updater.loadVersion();
    const stopWatch = startUpdateWatch({ updater, notify: (text, action) => host.toast(text, 'info', action), openAbout: openSettings });
    void (async () => {
      try {
        localFs = await createLocalFs({ showHidden: () => settings.showHidden });
        places = await localFs.places();
        seedBookmarks();
        // 差した SD カード（あれば、それぞれを別の置き場所として）
        const vols = await localFs.volumes();
        sdList = [];
        for (const v of vols) {
          // 表の id は、保存領域の名前（/storage/<uuid> の uuid）
          const uuid = v.path.slice(v.path.lastIndexOf('/') + 1);
          sdFsOf.set(SD + uuid, await createLocalFs({ showHidden: () => settings.showHidden, volume: v.path }));
          sdList = [...sdList, { id: uuid, name: v.name }];
        }
        // 前回のタブを戻す（外した置き場所のタブは捨てる）。無ければ、この端末のホームで 1 つ
        const exists = (id: string): boolean => id === LOCAL || id === SETTINGS_PLACE || saved.get(id) !== undefined;
        // 別のウィンドウで開いたタブ（?place=…&dir=…）は、そのタブ 1 つで始める。保存は、元のウィンドウのもの（上書きしない）
        const detached = detachedStart(location.search);
        const own = detached && exists(detached.place) ? detached : null;
        const restored = own ? { tabs: [own], active: 0 } : parseSavedTabs(read(TABS_KEY), exists);
        const first = restored ?? { tabs: [{ place: LOCAL, dir: localFs.start }], active: 0 };
        const made: Tab[] = [];
        for (const s of first.tabs) {
          const isSettings = s.place === SETTINGS_PLACE;
          // 設定のタブは 1 つだけ。見ていた置き場所は、この端末（裏に持つ）
          if (isSettings && made.some((t) => t.settings)) continue;
          const place = isSettings ? LOCAL : s.place;
          const tab: Tab = { id: ++tabSeq, bundles: new Map(), currentId: place, ...(isSettings ? { settings: true } : {}) };
          const b = bundleIn(tab, place);
          if (!b) continue;
          b.explorer.nav.dir = isSettings ? localFs.start : s.dir;
          made.push(tab);
        }
        tabs = made;
        activate(made[Math.min(first.active, made.length - 1)].id);
        if (!own) tabsReady = true;
      } catch (e) {
        failed = failureText(e);
      }
    })();
    return () => {
      window.removeEventListener('focus', onFocus);
      backNav?.stop();
      backNav = null;
      stopWatch();
    };
  });

  /** 追加したネットワークの場所を開く（このタブで。初めてなら、置き場所を作る） */
  function openDav(p: DavPlace): void {
    // 設定のタブを見ているときは、新しいタブで開く（設定は、そのまま残す）
    if (activeTab().settings) return addTab({ place: p.id, dir: '' });
    const b = bundleIn(activeTab(), p.id);
    if (b) setCurrent(b);
  }

  /**
   * 場所（置き場所 + フォルダ）を開く。here: このタブで（フォルダを省くと、その置き場所で最後に見ていたところ）/ tab: 新しいタブで開いて移る / tabStay: 新しいタブで開く（このタブに残る）/ window: 新しいウィンドウで
   * （ウィンドウの操作が無い環境では、新しいタブ）。設定のタブを見ているときは、設定を残して、新しいタブで開く
   */
  function openAt(place: string, dir?: string, how: 'here' | 'tab' | 'tabStay' | 'window' = 'here'): void {
    if (how === 'window' && windowControls) {
      void openTabInNewWindow({ place, dir: dir ?? startDir(place) }).catch((e) => host.toast(`別のウィンドウで開けませんでした: ${failureText(e)}`, 'error'));
      return;
    }
    if (how !== 'here' || activeTab().settings) return addTab({ place, dir: dir ?? startDir(place), focus: how !== 'tabStay' });
    const b = bundleIn(activeTab(), place);
    if (!b) return;
    setCurrent(b);
    if (dir !== undefined) b.explorer.nav.open(dir);
  }

  /** 置き場所の名前（左の欄・ブックマークの名前に使う） */
  function placeName(place: string): string {
    if (place === LOCAL) return localFs?.windows ? 'PC' : 'コンピューター';
    if (place.startsWith(SD)) return sdList.find((s) => SD + s.id === place)?.name ?? place;
    return saved.get(place)?.name ?? place;
  }

  /** 置き場所が、いま使えるか（外した置き場所・抜いた SD カードのブックマークは、出さない） */
  const placeExists = (place: string): boolean => place === LOCAL || (place.startsWith(SD) ? sdList.some((s) => SD + s.id === place) : saved.get(place) !== undefined);

  // ---- 左の欄: ブックマーク（追加・削除できる）と、ドライブ（この端末のドライブ・SD カード・WSL・ネットワークの場所） ----

  /** ブックマークの名前: フォルダの名前。いちばん上は置き場所の名前、ドライブはその名前 */
  function bookmarkName(place: string, dir: string): string {
    if (dir === '') return placeName(place);
    const drive = place === LOCAL ? places.find((p) => (p.kind === 'volume' || p.kind === 'root') && p.path === dir) : undefined;
    return drive ? placeLabel(drive) : baseName(dir) || dir;
  }

  const hereOf = (): { place: string; dir: string } | null => (!current || !explorer || activeSettings ? null : { place: current.id, dir: explorer.nav.dir });
  const canAddBookmark = $derived.by(() => {
    const h = hereOf();
    return h !== null && !bookmarks.find(h.place, h.dir);
  });
  /** いま見ているフォルダを、ブックマークに足す */
  function addBookmarkHere(): void {
    const h = hereOf();
    if (h) bookmarks.add(h.place, h.dir, bookmarkName(h.place, h.dir));
  }
  /** いま見ている置き場所の、フォルダ（パス）を足す（ドラッグして落としたとき・右クリックのメニュー） */
  function addBookmarks(paths: string[]): void {
    const place = current?.id;
    if (!place) return;
    for (const dir of paths) bookmarks.add(place, dir, bookmarkName(place, dir));
  }

  const bookmarkEntries = $derived<NavEntry[]>(
    bookmarks.list
      .filter((b) => placeExists(b.place))
      .map((b) => ({
        key: b.id,
        label: b.name,
        title: b.place === LOCAL ? (localFs?.osPath(b.dir) || '/') : `${placeName(b.place)}: ${b.dir || '/'}`,
        current: !activeSettings && current?.id === b.place && explorer?.nav.dir === b.dir,
        open: () => openAt(b.place, b.dir),
        openTab: () => openAt(b.place, b.dir, 'tab'),
        openTabStay: () => openAt(b.place, b.dir, 'tabStay'),
        openWindow: () => openAt(b.place, b.dir, 'window'),
        remove: () => bookmarks.remove(b.id),
        // アイコン・色は、一覧のフォルダと同じ見た目のルールで決める
        look: entryStyleOf({ name: baseName(b.dir), path: b.dir, kind: 'dir', size: 0, modified: 0, mime: null } as Entry, settings.rules),
      })),
  );

  /** ブックマークを並べ替える（key は、ブックマークの id。toIndex は、左の欄に出ているブックマークの中での、動かしたあとの番号） */
  function moveBookmark(key: string, toIndex: number): void {
    const target = bookmarkEntries[toIndex];
    if (target) bookmarks.moveTo(key, target.key);
  }

  /** 一覧の項目を、ブックマークの上へドラッグして落とした: そのブックマークのフォルダへ移す（Ctrl を押していればコピー）。見ている置き場所のブックマークだけ */
  function moveIntoBookmark(key: string, op: 'move' | 'copy'): void {
    const b = bookmarks.list.find((x) => x.id === key);
    if (!b) return;
    if (!explorer || activeSettings || current?.id !== b.place) {
      host.toast('別の置き場所のブックマークへは、移せません', 'error');
      return;
    }
    void explorer.dropDragged?.(b.dir, op);
  }

  const driveEntries = $derived<NavEntry[]>([
    ...places
      .filter((p) => p.kind === 'volume' || p.kind === 'root')
      .map((p) => ({
        key: `drive:${p.path}`,
        label: placeLabel(p),
        // ドライブの中を見ているあいだも、そのドライブを示す（ルートは、いちばん上にいるときだけ）
        current: !activeSettings && current?.id === LOCAL && explorer !== null && (p.path === '' ? explorer.nav.dir === '' : explorer.nav.dir === p.path || explorer.nav.dir.startsWith(`${p.path}/`)),
        open: () => openAt(LOCAL, p.path),
        openTab: () => openAt(LOCAL, p.path, 'tab'),
        openWindow: () => openAt(LOCAL, p.path, 'window'),
      })),
    ...sdList.map((v) => ({
      key: `sd:${v.id}`,
      label: v.name,
      current: !activeSettings && current?.id === SD + v.id,
      open: () => openAt(SD + v.id),
      openTab: () => openAt(SD + v.id, '', 'tab'),
      openWindow: () => openAt(SD + v.id, '', 'window'),
    })),
    ...saved.list.map((p) => ({
      key: `net:${p.id}`,
      label: p.name,
      title: p.url,
      current: !activeSettings && current?.id === p.id,
      broken: broken(p.id),
      open: () => openAt(p.id),
      openTab: () => openAt(p.id, '', 'tab'),
      openWindow: () => openAt(p.id, '', 'window'),
      edit: () => void openDialog(p),
    })),
  ]);

  /** 初めて開いたときだけ、この端末のよく使うフォルダ（ホーム・ダウンロードなど）をブックマークに入れる */
  function seedBookmarks(): void {
    const initial = places.filter((p) => p.kind !== 'volume' && p.kind !== 'root').map((p) => ({ place: LOCAL, dir: p.path, name: placeLabel(p) }));
    if (initial.length > 0) bookmarks.seed(initial);
  }

  /** 置き場所の覚えを変えたとき、作ってあった置き場所を捨てる（URL・名前が変わったので、作り直す） */
  function forget(id: string): void {
    davFsOf.delete(id);
    bufferOf.delete(id);
    sizeCacheOf.delete(id);
    // どのタブでも、その置き場所を捨てる。見ていたタブは、この端末へ戻す
    for (const t of tabs) {
      t.bundles.delete(id);
      if (t.currentId === id) {
        t.currentId = LOCAL;
        tabs = [...tabs];
        if (t.id === activeId) {
          const b = bundleIn(t, LOCAL);
          if (b) current = b;
        }
      }
    }
    const { [id]: _gone, ...rest } = known;
    known = rest;
    const { [id]: _ok, ...stillFailed } = authFailed;
    authFailed = stillFailed;
    const { [id]: _cert, ...stillUntrusted } = certIssue;
    certIssue = stillUntrusted;
  }

  /** 追加・直すのダイアログを開く。直すときは、保管している資格情報（ユーザー名）を先に読む（読めなくても開く） */
  async function openDialog(place?: DavPlace, focusPassword = false): Promise<void> {
    if (!place) {
      dialog = {};
      return;
    }
    const pin = await pinOf(place);
    try {
      dialog = { place, cred: await creds.info(place.id), focusPassword, pin };
    } catch (e) {
      dialog = { place, cred: null, credError: errorMessage(e), focusPassword, pin };
    }
  }

  /** 置き場所の、いま効いている固定の指紋（接続先が同じものだけ。読めなければ null） */
  async function pinOf(place: DavPlace): Promise<string | null> {
    try {
      const info = await pins.info(place.id);
      return info && info.base === place.url ? info.fingerprint : null;
    } catch {
      return null;
    }
  }

  /** 証明書を確かめるダイアログを開く */
  async function openCert(place: DavPlace): Promise<void> {
    certDialog = { place, previous: await pinOf(place) };
  }

  /** 証明書を信頼する（指紋を固定して、読み直す）。できなければ理由の文を返す */
  async function trustCert(place: DavPlace, fingerprint: string): Promise<string | null> {
    try {
      await pins.set(place.id, place.url, fingerprint);
    } catch (e) {
      return errorMessage(e);
    }
    certDialog = null;
    reloadAfterPin(place.id);
    return null;
  }

  /** 固定を解除する（通常の確かめに戻る）。できなければ、トーストで知らせる */
  async function unpin(place: DavPlace): Promise<void> {
    dialog = null;
    try {
      await pins.clear(place.id);
    } catch (e) {
      host.toast(errorMessage(e), 'error');
      return;
    }
    reloadAfterPin(place.id);
  }

  /** 固定が変わった置き場所の案内を消して、読み直す（つながるか、また案内が出る） */
  function reloadAfterPin(id: string): void {
    const { [id]: _cert, ...rest } = certIssue;
    certIssue = rest;
    for (const t of tabs) t.bundles.get(id)?.explorer.nav.reload();
  }

  /** ダイアログに出す失敗の文（Rust が日本語で書いた説明があるものは、それを出す） */
  function errorMessage(e: unknown): string {
    return e instanceof FsError && (e.code === 'keychain' || e.code === 'invalid') ? e.message : failureText(e);
  }

  async function saveDialog(name: string, url: string, cred: { user: string; password: string | null } | null): Promise<string | null> {
    const editing = dialog?.place;
    const hadCred = dialog?.cred != null;
    const r = editing ? saved.update(editing.id, name, url) : saved.add(name, url);
    if (!r.ok) return r.reason;
    // 接続先を変えたら、前の接続先への固定は使わない（残さない）
    if (editing && editing.url !== r.place.url) await pins.clear(editing.id).catch(() => {});
    try {
      if (cred) await creds.set(r.place.id, r.place.url, cred.user, cred.password);
      else if (hadCred) await creds.clear(r.place.id);
    } catch (e) {
      // 資格情報を保管できなかったので、置き場所の覚えも元に戻す（認証のない置き場所に見えてしまわないように）
      if (editing) saved.update(editing.id, editing.name, editing.url);
      else saved.remove(r.place.id);
      return errorMessage(e);
    }
    dialog = null;
    if (editing) {
      const wasCurrent = current?.id === editing.id;
      forget(editing.id);
      if (wasCurrent) openDav(r.place);
    } else {
      openDav(r.place);
    }
    return null;
  }

  async function removeDialog(): Promise<void> {
    const p = dialog?.place;
    dialog = null;
    if (!p) return;
    const ok = await host.confirm({
      title: `「${p.name}」を一覧から外しますか`,
      body: 'このデバイスに保存した設定（と、保管した認証情報）を消すだけです。サーバーのファイルは消えません',
      okLabel: '外す',
      danger: true,
    });
    if (!ok) return;
    saved.remove(p.id);
    bookmarks.removePlace(p.id);
    forget(p.id);
    // 保管した資格情報も消す（キーチェーンが使えなくても、外すこと自体は止めない）
    await creds.clear(p.id).catch(() => {});
    await pins.clear(p.id).catch(() => {});
  }

  /** 左の一覧の項目に出す、つながらなかった印（開いた置き場所の、いちばん上の一覧が読めなかったとき） */
  function broken(id: string): string | null {
    const st = known[id]?.explorer.index.state('');
    return st?.kind === 'error' ? st.message : null;
  }

  function toggleHidden(): void {
    settings.showHidden = !settings.showHidden;
    // 一覧の写しは、隠しファイルを除いたもの。読み直す（フォルダのサイズは、数え直さない）
    explorer?.nav.reload(true);
  }

  /** 選んでいる項目のうち、フォルダのパス（このフォルダの一覧で見つかるものだけ） */
  function selectedDirs(): string[] {
    const ex = explorer;
    if (!ex || activeSettings) return [];
    const st = ex.index.state(ex.nav.dir);
    if (st?.kind !== 'ok') return [];
    return ex.selection.paths().filter((path) => {
      const e = st.entries.get(baseName(path));
      return e?.kind === 'dir' && e.path === path;
    });
  }

  /** 選んでいる項目（無ければ、いま開いているフォルダ）のパスを、OS の形でコピーする */
  async function copyPaths(): Promise<void> {
    const ex = explorer;
    const b = current;
    if (!ex || !b || activeSettings) return;
    const picked = ex.selection.paths();
    const list = picked.length > 0 ? picked : [ex.nav.dir];
    const text = list.map((p) => (b.local ? b.local.osPath(p) : p)).join('\n');
    if (await ex.host.clipboard.copyText(text)) host.toast(list.length === 1 ? 'パスをコピーしました' : `${list.length} 件のパスをコピーしました`);
    else host.toast('パスをコピーできませんでした', 'error');
  }

  /** すべてのウィンドウを閉じて、アプリを終える */
  async function quitApp(): Promise<void> {
    try {
      await exitApp();
    } catch (e) {
      host.toast(failureText(e), 'error');
    }
  }

  /**
   * アプリ側の操作を行う（設定で変えられるホットキーに、割り当てた操作）。行ったら true（ブラウザの既定の動きを止める）。
   * 一覧の操作（検索・コピー・矢印の移動など）は、共有の部品が受ける
   */
  function runCommand(id: CommandId): boolean {
    const at = tabs.findIndex((t) => t.id === activeId);
    const goto = (i: number): boolean => {
      if (tabs.length === 0) return false;
      activate(tabs[Math.max(0, Math.min(i, tabs.length - 1))].id);
      return true;
    };
    switch (id) {
      case 'tab.new':
        addTab();
        return true;
      case 'tab.duplicate':
        if (tabs.length === 0) return false;
        duplicateTab(activeId);
        return true;
      case 'tab.close':
        if (tabs.length === 0) return false;
        closeTab(activeId);
        return true;
      case 'tab.next':
        return tabs.length > 0 && goto(cycleIndex(at, tabs.length, 1));
      case 'tab.prev':
        return tabs.length > 0 && goto(cycleIndex(at, tabs.length, -1));
      case 'tab.last':
        return goto(tabs.length - 1);
      case 'tab.closeOthers':
        if (tabs.length < 2) return false;
        closeOthers(activeId);
        return true;
      case 'tab.moveLeft':
      case 'tab.moveRight': {
        const to = at + (id === 'tab.moveLeft' ? -1 : 1);
        if (at < 0 || to < 0 || to >= tabs.length) return false;
        moveTab(at, to);
        return true;
      }
      case 'bookmark.search':
        bookmarkSearchOpen = true;
        return true;
      case 'bookmark.moveUp':
      case 'bookmark.moveDown': {
        // フォーカスしているブックマーク。無ければ、いま開いているフォルダのブックマーク
        const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.bookmark : undefined;
        const key = focused ?? bookmarkEntries.find((b) => b.current)?.key;
        const from = bookmarkEntries.findIndex((b) => b.key === key);
        const to = from + (id === 'bookmark.moveUp' ? -1 : 1);
        if (from < 0 || to < 0 || to >= bookmarkEntries.length) return false;
        moveBookmark(bookmarkEntries[from].key, to);
        // 並べ替えで行が作り直されても、フォーカスを保つ
        if (focused) void tick().then(() => [...document.querySelectorAll<HTMLElement>('[data-bookmark]')].find((el) => el.dataset.bookmark === focused)?.focus());
        return true;
      }
      case 'app.settings':
        openSettings();
        return true;
      case 'app.quit':
        void quitApp();
        return true;
      case 'nav.back':
        return host.back();
      case 'nav.forward':
        return !activeSettings && !!explorer?.nav.forward();
      case 'nav.up':
        if (activeSettings || !explorer) return false;
        explorer.nav.up();
        return true;
      case 'view.reload':
        if (!activeSettings) explorer?.nav.reload();
        return true;
      case 'view.toggleHidden':
        toggleHidden();
        return true;
      case 'view.showHidden':
        if (!settings.showHidden) toggleHidden();
        return true;
      case 'view.hideHidden':
        if (settings.showHidden) toggleHidden();
        return true;
      case 'file.copyPath':
        void copyPaths();
        return true;
      case 'file.openNewTab': {
        const dirs = selectedDirs();
        if (dirs.length === 0) return false;
        openFoldersInTabs(dirs, at + 1);
        return true;
      }
      case 'file.openNewTabFocus': {
        const dirs = selectedDirs();
        if (dirs.length === 0) return false;
        // 開いたあと、いちばん最初のフォルダのタブへ移る
        openFoldersInTabs(dirs, at + 1, true);
        return true;
      }
      case 'file.openNewWindow': {
        const dirs = selectedDirs();
        const here = current?.id;
        if (dirs.length === 0 || !here || !hasWindowControls()) return false;
        for (const dir of dirs) void openTabInNewWindow({ place: here, dir }).catch((e) => host.toast(`別のウィンドウで開けませんでした: ${failureText(e)}`, 'error'));
        return true;
      }
      default: {
        // 番号のタブへ・番号のブックマークへ
        const n = /^tab\.goto(\d)$/.exec(id);
        if (n) return goto(Number(n[1]) - 1);
        const b = /^bookmark\.goto(\d)$/.exec(id);
        const entry = b ? bookmarkEntries[Number(b[1]) - 1] : undefined;
        if (!entry) return false;
        entry.open();
        return true;
      }
    }
  }

  /**
   * ホットキー（設定で変えられる。lib/hotkeys.ts）。
   * 文字を打っている入力欄の中では、修飾キー（Ctrl・Alt）のないホットキーは働かせない。設定でキーを記録している間は、何もしない
   */
  function onKey(ev: KeyboardEvent): void {
    if (hotkeys.recording || ev.defaultPrevented) return;
    const typing = ev.target instanceof Element && ev.target.closest('input, textarea, select, [contenteditable="true"]') !== null;
    if (typing && !(ev.ctrlKey || ev.metaKey || ev.altKey)) return;
    for (const c of APP_COMMANDS) {
      if (hotkeys.matches(ev, c.id) && runCommand(c.id)) {
        ev.preventDefault();
        return;
      }
    }
  }

  /** マウスの「戻る」「進む」のボタン（設定で変えられる。既定は、戻る・進む） */
  function onMouseUp(ev: MouseEvent): void {
    if (hotkeys.recording) return;
    for (const c of APP_COMMANDS) {
      if (hotkeys.matchesMouse(ev, c.id) && runCommand(c.id)) {
        ev.preventDefault();
        return;
      }
    }
  }

  // ---- Android の狭い画面: 右へのスワイプで場所の欄を出し、左へのスワイプ（か、外側を押す・戻る）で閉じる ----
  /** スワイプとみなす横の距離（px）。縦より横が大きいときだけ */
  const NAV_SWIPE_PX = 56;
  /** 向きを決めるまでの距離（px） */
  const NAV_SWIPE_START_PX = 12;
  /** CSS の「場所の欄を、左から出す画面」の幅と同じ */
  const NARROW_QUERY = '(max-width: 767px)';
  /** Android か（場所の欄の引き出しは、Android だけ） */
  const android = isAndroid();
  /** 一覧の横のビュー（親フォルダ・プレビュー）を出せる画面か（デスクトップで、設定でない。Android は出さない） */
  const sideViews = $derived(!android && !activeSettings && explorer !== null);
  /** デスクトップの自前のタイトルバー（タブの欄が兼ねる） */
  const windowControls = hasWindowControls();
  let swipe: { x: number; y: number; target: EventTarget | null; dir: 'h' | 'v' | null } | null = null;

  /** 指の下に、右へ動かすと横にスクロールするもの（左へ戻れる、横に長い一覧）があるか。あれば、スワイプはそちらの操作 */
  function scrollsBackLeft(target: EventTarget | null): boolean {
    for (let el = target instanceof Element ? target : null; el; el = el.parentElement) {
      if (el.scrollLeft > 0 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true;
    }
    return false;
  }

  function swipeStart(ev: TouchEvent): void {
    swipe = null;
    // デスクトップは、どんなに狭くても、場所の欄はいつも見える（引き出しにしない）
    // 設定の画面には、場所の欄が無い（開くと、暗い幕だけが残って、押すまで操作できなくなる）
    if (!android || activeSettings || ev.touches.length !== 1 || typeof window.matchMedia !== 'function' || !window.matchMedia(NARROW_QUERY).matches) return;
    // 入力欄・ダイアログ・メニューの上の操作は、スワイプにしない
    if (ev.target instanceof Element && ev.target.closest('input, textarea, dialog, [role="dialog"], [role="menu"], .menu-backdrop')) return;
    swipe = { x: ev.touches[0].clientX, y: ev.touches[0].clientY, target: ev.target, dir: null };
  }

  function swipeMove(ev: TouchEvent): void {
    // 一覧の長押しからのなぞり（範囲の選択）は、touchmove を止めている。それはスワイプにしない
    if (!swipe || ev.defaultPrevented || ev.touches.length !== 1) return;
    const dx = ev.touches[0].clientX - swipe.x;
    const dy = ev.touches[0].clientY - swipe.y;
    if (swipe.dir === null) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < NAV_SWIPE_START_PX) return;
      swipe.dir = Math.abs(dx) > Math.abs(dy) * 1.5 ? 'h' : 'v';
    }
    if (swipe.dir === 'v' || Math.abs(dx) < NAV_SWIPE_PX) return;
    if (dx > 0 && !navOpen && !scrollsBackLeft(swipe.target)) navOpen = true;
    else if (dx < 0 && navOpen) navOpen = false;
    swipe = null;
  }

  function swipeEnd(): void {
    swipe = null;
  }
</script>

<svelte:window onkeydown={onKey} onmouseup={onMouseUp} ontouchstart={swipeStart} ontouchmove={swipeMove} ontouchend={swipeEnd} ontouchcancel={swipeEnd} />

<div class="app" class:app-android={android}>
  {#if failed}
    <p class="status-line status-line-error start-error" role="alert">起動できませんでした: {failed}</p>
  {:else if current && explorer}
    <TabBar
      tabs={tabItems}
      {activeId}
      onselect={activate}
      onclose={closeTab}
      onadd={() => addTab()}
      onduplicate={duplicateTab}
      onmove={moveTab}
      oncloseothers={closeOthers}
      ondropfolders={openFoldersInTabs}
      ondetach={(id, at) => void detachTab(id, at)}
      {windowControls}
    />

    <div class="body">
      <!-- 設定の画面では、場所の欄（と、狭い画面の幕）は出さない（設定は、タブの 1 つ。場所を選ぶ必要がない）。
           デスクトップでは、設定の「ビュー」で場所の欄を「出さない」にできる。Android は、右スワイプで引き出す画面（この欄）を選ぶ（いまはこれだけ） -->
      {#if !activeSettings && (android ? settings.views.swipe === 'places' : viewShown(settings.views, 'places'))}
      <!-- 狭い画面: 場所の欄が開いているあいだ、残りを暗くする幕。押すと閉じる -->
      <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
      <div class="nav-scrim" class:nav-scrim-open={navOpen} onclick={() => (navOpen = false)}></div>
      <!-- 場所や「バージョン情報」を押したら、狭い画面では場所の欄を閉じる（押しは、各ボタンの処理のあとでここへ届く） -->
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
      <nav class="places scroll" class:places-open={navOpen} aria-label="場所" style:width="{placesWidth}px" onclick={() => (navOpen = false)}>
        <PlacesNav
          bookmarks={bookmarkEntries}
          drives={driveEntries}
          canWindow={windowControls}
          canAddBookmark={canAddBookmark}
          onaddbookmark={addBookmarkHere}
          onaddnetwork={() => void openDialog()}
          ondropdirs={(paths) => addBookmarks(paths)}
          onmovebookmark={moveBookmark}
          onmoveinto={moveIntoBookmark}
        />
        <!-- 版と、アプリの更新（新しい版があるときは点）。押すと「設定」のタブ -->
        <button class="about-row" type="button" onclick={openSettings}>
          <Settings size={14} />
          <span class="about-name">fixplor{updater.supported && updater.version ? ` v${updater.version}` : ''}</span>
          {#if updater.supported && showUpdateBadge(updater.state)}<span class="update-dot" role="img" aria-label={UPDATE_BADGE_LABEL}></span>{/if}
        </button>
      </nav>
      <!-- 場所の欄の幅を変えるつまみ（ドラッグ・左右の矢印キー。Home で元の幅）。フォーカスできる separator は、操作できる部品 -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
      <div
        class="places-resizer"
        class:places-resizer-active={resizing}
        role="separator"
        aria-orientation="vertical"
        aria-label="場所の欄の幅"
        aria-valuemin={PLACES_MIN}
        aria-valuemax={PLACES_MAX}
        aria-valuenow={placesWidth}
        tabindex="0"
        onpointerdown={startResize}
        onkeydown={resizeKey}
      ></div>
      {/if}
      <!-- 親フォルダのビュー（デスクトップだけ。場所の欄と一覧のあいだ） -->
      {#if sideViews && explorer && viewShown(settings.views, 'parents')}
        <SidePane label="親フォルダ" storageKey="fixplor.parentsWidth" side="left" min={140} max={480} initial={200}>
          {#key explorer}<ParentView {explorer} entryStyle={(e) => entryStyleOf(e, settings.rules)} />{/key}
        </SidePane>
      {/if}
      <main class="main" class:main-side={sideViews}>
        <!-- 設定のタブがあるあいだは、他のタブを見ていても作ったままにする（戻ったとき、ホットキーの画面・開いた節・検索の文字が続きから見える） -->
        {#if hasSettingsTab}
          <div class="settings-host" style:display={activeSettings ? 'flex' : 'none'}>
            <SettingsView {updater} active={activeSettings} addBack={(run) => host.addBack(run)} />
          </div>
        {/if}
        {#if !activeSettings}
        {#if needAllFiles}
          <p class="status-line status-line-error auth-banner" role="alert">
            <span>この端末のファイルを見るには、「すべてのファイルへのアクセス」の許可が要ります。</span>
            <Button onclick={() => void openAllFilesSettings().catch((e) => host.toast(failureText(e), 'error'))}>許可する</Button>
          </p>
        {/if}
        {#if certIssue[current.id] && saved.get(current.id)}
          {@const place = saved.get(current.id)!}
          <p class="status-line status-line-error auth-banner cert-banner" role="alert">
            <span>{certIssue[current.id] === 'cert_changed' ? '証明書が、前に信頼したものと変わりました。' : 'このサーバーの証明書を確認できません。'}</span>
            <span class="banner-actions">
              {#if certIssue[current.id] === 'cert_changed'}<Button onclick={() => void unpin(place)}>信頼を解除</Button>{/if}
              <Button onclick={() => void openCert(place)}>{certIssue[current.id] === 'cert_changed' ? '新しい証明書を確認する' : '証明書を確認する'}</Button>
            </span>
          </p>
        {/if}
        {#if authFailed[current.id] && saved.get(current.id)}
          {@const place = saved.get(current.id)!}
          <p class="status-line status-line-error auth-banner" role="alert">
            <span>認証できませんでした。ユーザー名とパスワードを確かめてください。</span>
            <Button onclick={() => void openDialog(place, true)}>認証情報を入れ直す</Button>
          </p>
        {/if}
        {#key current}
          <FileExplorer {explorer} keymap={hotkeys.keymap} columnWidths={settings.columns} oncolumnwidths={(w) => (settings.columns = w)} menuLayout={settings.menus} entryStyle={(e) => entryStyleOf(e, settings.rules)} oncursor={(e) => (cursorEntry = e)}>
            {#snippet headerItem(id)}
              {#if id === 'back'}
                <IconButton label="戻る" title="戻る" disabled={!host.canBack} onclick={() => host.back()}><ArrowLeft size={16} /></IconButton>
              {:else if id === 'forward'}
                <IconButton label="進む" title="進む" disabled={explorer.nav.future.length === 0} onclick={() => explorer?.nav.forward()}><ArrowRight size={16} /></IconButton>
              {:else if id === 'up'}
                <IconButton label="上のフォルダへ" title="上のフォルダへ" disabled={explorer.nav.dir === ''} onclick={() => explorer?.nav.up()}><ArrowUp size={16} /></IconButton>
              {:else if id === 'hidden'}
                <IconButton label="隠しファイルを表示" title="隠しファイルを表示" active={settings.showHidden} aria-pressed={settings.showHidden} onclick={() => toggleHidden()}><Eye size={18} /></IconButton>
              {/if}
            {/snippet}
            {#snippet entryMenu(e, close)}
              {#if e.kind === 'dir' && !e.trash}
                {@const mark = bookmarks.find(current?.id ?? '', e.path)}
                {#if mark}
                  <MenuItem icon={BookmarkX} onclick={() => { close(); bookmarks.remove(mark.id); }}>ブックマークから削除</MenuItem>
                {:else}
                  <MenuItem icon={BookmarkIcon} onclick={() => { close(); addBookmarks([e.path]); }}>ブックマークに追加</MenuItem>
                {/if}
              {/if}
            {/snippet}
            {#snippet menu(close)}
              <MenuItem icon={Eye} onclick={() => { close(); toggleHidden(); }}>隠しファイルを表示{#if settings.showHidden}<Check size={14} />{/if}</MenuItem>
            {/snippet}
          </FileExplorer>
        {/key}
        {/if}
      </main>
      <!-- プレビューのビュー（デスクトップだけ。一覧の右）。カーソルのある項目の中身 -->
      {#if sideViews && explorer && viewShown(settings.views, 'preview')}
        <SidePane label="プレビュー" storageKey="fixplor.previewWidth" side="right" min={200} max={900} initial={320}>
          {#key explorer}<PreviewPane {explorer} entry={cursorEntry} entryStyle={(e) => entryStyleOf(e, settings.rules)} />{/key}
        </SidePane>
      {/if}
    </div>
  {/if}
</div>

<Toasts toasts={host.shell.toasts} dismiss={(id) => host.dismiss(id)} />
<ConfirmDialog request={host.shell.confirmReq} />
<Lightbox {host} open={(req) => current?.open(req) ?? Promise.resolve()} />
{#if dialog}
  <PlaceDialog place={dialog.place} saved={dialog.cred} savedError={dialog.credError} focusPassword={dialog.focusPassword} pin={dialog.pin} onunpin={dialog.place ? () => void unpin(dialog!.place!) : undefined} onsave={saveDialog} onremove={dialog.place ? () => void removeDialog() : undefined} onclose={() => (dialog = null)} />
{/if}

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg);
    color: var(--text);
    /* 画面の上端（Android のステータスバー）の安全域は、ここ（いちばん上）で 1 回だけ取る */
    padding-top: env(safe-area-inset-top);
    box-sizing: border-box;
  }
  /* 共有の部品の上端のバーは、単独で使うときのために、自分で安全域を取る。ここでは外枠が取っているので、足さない */
  .app :global(.file-explorer-bar.top-bar) {
    padding-top: var(--space-4);
  }
  .start-error {
    padding: var(--space-6);
  }
  .body {
    display: flex;
    flex: 1;
    min-height: 0;
  }
  .places {
    display: flex;
    flex-direction: column;
    flex: none;
    padding: var(--space-3);
    overflow-y: auto;
  }
  /* 場所の欄の幅を変えるつまみ（細い線。ドラッグの間は強調する） */
  .places-resizer {
    flex: none;
    width: 5px;
    margin-inline: -2px;
    cursor: col-resize;
    background: linear-gradient(var(--border), var(--border)) center / 1px 100% no-repeat;
    touch-action: none;
    z-index: 1;
  }
  .places-resizer:hover,
  .places-resizer:focus-visible,
  .places-resizer-active {
    background: linear-gradient(var(--accent), var(--accent)) center / 2px 100% no-repeat;
    outline: none;
  }
  .places > :global(*) {
    flex: none;
  }
  .about-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    margin-top: auto;
    padding: var(--space-2) var(--space-3);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    font-size: var(--fs-sm, 0.85em);
    text-align: left;
  }
  .update-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
  }
  .auth-banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin: 0;
    padding: var(--space-3) var(--space-4);
  }
  .banner-actions {
    display: flex;
    gap: var(--space-2);
  }
  .main {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
  }
  /* 横のビュー（親フォルダ・プレビュー）を出しているときは、一覧の幅の下限を残す（横のビューのほうが先に縮む） */
  .main-side {
    min-width: 300px;
  }
  .nav-scrim {
    display: none;
  }
  .settings-host {
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
  }
  .about-name {
    flex: 1;
    text-align: left;
  }
  /* Android の狭い画面: 場所の欄は、左から出す引き出し。開いているあいだはこれがいちばん上で、残りは幕で暗くする。
     デスクトップは、どんなに狭くても、場所の欄はいつも見える */
  @media (max-width: 767px) {
    .app-android .places-resizer {
      display: none;
    }
    .app-android .places {
      position: fixed;
      inset-block: 0;
      inset-inline-start: 0;
      z-index: var(--z-drawer, 50);
      /* 幅を変えるつまみは無いので、決まった幅。画面の左の端と上下の安全域は、自分で取る */
      width: min(280px, 85vw) !important;
      box-sizing: border-box;
      padding-top: calc(env(safe-area-inset-top) + var(--space-3));
      padding-bottom: calc(env(safe-area-inset-bottom) + var(--space-3));
      padding-left: calc(env(safe-area-inset-left) + var(--space-3));
      background: var(--bg);
      border-right: 1px solid var(--border);
      transform: translateX(-100%);
      visibility: hidden;
      transition: transform 0.2s ease, visibility 0s linear 0.2s;
    }
    .app-android .places-open {
      transform: none;
      visibility: visible;
      transition: transform 0.2s ease, visibility 0s;
    }
    .app-android .nav-scrim {
      display: block;
      position: fixed;
      inset: 0;
      z-index: calc(var(--z-drawer, 50) - 1);
      background: rgb(0 0 0 / 0.5);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
    }
    .app-android .nav-scrim-open {
      opacity: 1;
      pointer-events: auto;
    }
  }
  @media (max-width: 767px) and (prefers-reduced-motion: reduce) {
    .app-android .places,
    .app-android .nav-scrim {
      transition: none;
    }
  }
</style>
{#if bookmarkSearchOpen}
  <BookmarkSearch entries={bookmarkEntries} canWindow={windowControls} onclose={() => (bookmarkSearchOpen = false)} />
{/if}
{#if certDialog}
  <CertDialog place={certDialog.place} previous={certDialog.previous} probe={(base) => pins.probe(base)} ontrust={(fp) => trustCert(certDialog!.place, fp)} onclose={() => (certDialog = null)} />
{/if}
