<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Keyboard from '@lucide/svelte/icons/keyboard';
  import Palette from '@lucide/svelte/icons/palette';
  import SquareMenu from '@lucide/svelte/icons/square-menu';
  import Package from '@lucide/svelte/icons/package';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Button from '@3pino/ui-kit-web/Button.svelte';
  import IconButton from '@3pino/ui-kit-web/IconButton.svelte';
  import PanelBar from '@3pino/ui-kit-web/PanelBar.svelte';
  import Section from '@3pino/ui-kit-web/Section.svelte';
  import SettingRow from '@3pino/ui-kit-web/SettingRow.svelte';
  import StatusLine from '@3pino/ui-kit-web/StatusLine.svelte';
  import type { UpdateState } from '@3pino/app-kit-web/updater';
  import Toggle from '@3pino/ui-kit-web/Toggle.svelte';
  import { isAndroid, isDesktopWindowsOrLinuxTauri, osName } from '@3pino/app-kit-web/core/platform';
  import { settings } from '../lib/settings.svelte';
  import { viewShown, VIEWS } from '../lib/views';
  import { desktopOs } from '../lib/dependencies';
  import DependencySettings from './DependencySettings.svelte';
  import MenuSettings from './MenuSettings.svelte';
  import RuleSettings from './RuleSettings.svelte';
  import HotkeySettings from './HotkeySettings.svelte';

  // 設定（タブの 1 つ）: 「操作」の「ホットキー」（押すと、操作ごとにキーを変えられる画面が開く）と、バージョン（いまの版と、アプリの更新の確認・入れ替え）。
  // 見た目は disnans の設定に合わせる（節 Section・行 SettingRow・スクロールの .scroll・サブページの戻る）。
  // 更新は、取得して入れ替えたあと、アプリを起動し直す。updater は土台の Updater（試験では偽物）。開いたときに版を読む。
  // 確認は、押したときだけ（裏の確認は updateWatch が行う）。
  let {
    updater,
    addBack,
    active = true,
  }: {
    /** いま設定のタブを見ているか（他のタブを見ているあいだも、この画面は作ったまま。そのあいだは「戻る」を受けない） */
    active?: boolean;
    /** 「戻る」の操作（Alt+←・マウスの戻る・Android の戻る）を受ける層を足す（外す関数を返す）。ホットキーの画面のあいだ、設定のいちばん上へ戻る */
    addBack?: (run: () => void) => () => void;
    updater: {
      supported: boolean;
      version: string | null;
      state: UpdateState;
      loadVersion(): Promise<void>;
      check(opts?: { quiet?: boolean }): Promise<void>;
      install(): Promise<void>;
      openReleasePage(): Promise<void>;
    };
  } = $props();

  const st = $derived(updater.state);
  const busy = $derived(st.kind === 'checking' || st.kind === 'downloading' || st.kind === 'installing');
  /** 開いているサブページ（無ければ、設定のいちばん上） */
  let sub = $state<'hotkeys' | 'menus' | 'rules' | 'dependencies' | null>(null);
  /** 外部のコマンドの「依存」は、デスクトップだけ（Android・ブラウザーでは、出さない） */
  const depOs = isDesktopWindowsOrLinuxTauri() ? desktopOs(osName()) : null;
  const mb = (n: number): string => (n / 1024 / 1024).toFixed(1);
  /** Android は、ビューを「出す・出さない」ではなく、右スワイプで引き出す画面を選ぶ */
  const android = isAndroid();
  const setViewShown = (id: string, on: boolean): void => {
    const hidden = settings.views.hidden.filter((x) => x !== id);
    settings.views = { ...settings.views, hidden: on ? hidden : [...hidden, id] };
  };

  onMount(() => void updater.loadVersion());
  // ホットキーの画面では、「戻る」の操作は、設定のいちばん上へ戻る
  $effect(() => {
    if (sub === null || !active || !addBack) return;
    // 層を足す処理は、状態を読み書きするので、この効果の依存にしない
    return untrack(() => addBack(() => (sub = null)));
  });
</script>

<div class="settings-view" role="region" aria-label="設定">
  <PanelBar class="settings-bar">
    {#if sub}
      <IconButton label="設定へ戻る" title="戻る" onclick={() => (sub = null)}><ArrowLeft size={18} /></IconButton>
    {/if}
    <span class="settings-title">{sub === 'hotkeys' ? 'ホットキー' : sub === 'menus' ? '上端の行・右クリックのメニュー' : sub === 'rules' ? '見た目のルール' : sub === 'dependencies' ? '依存' : '設定'}</span>
  </PanelBar>
  <div class="scroll settings-body">
    <div class="settings-content">
      {#if sub === 'hotkeys'}
        <HotkeySettings />
      {:else if sub === 'menus'}
        <MenuSettings />
      {:else if sub === 'rules'}
        <RuleSettings />
      {:else if sub === 'dependencies' && depOs}
        <DependencySettings os={depOs} />
      {:else}
        <Section title="操作" class="settings-operations">
          <SettingRow name="ホットキー" class="settings-operation-row settings-link-hotkeys" onclick={() => (sub = 'hotkeys')}>
            {#snippet control()}
              <span class="settings-operation-icon" aria-hidden="true"><Keyboard size={16} /><ChevronRight size={18} /></span>
            {/snippet}
          </SettingRow>
          <SettingRow name="上端の行・右クリックのメニュー" description="出す部品・項目と、その順番" class="settings-operation-row settings-link-menus" onclick={() => (sub = 'menus')}>
            {#snippet control()}
              <span class="settings-operation-icon" aria-hidden="true"><SquareMenu size={16} /><ChevronRight size={18} /></span>
            {/snippet}
          </SettingRow>
          <SettingRow name="見た目のルール" description="条件に合うファイル・フォルダのアイコンと色" class="settings-operation-row settings-link-rules" onclick={() => (sub = 'rules')}>
            {#snippet control()}
              <span class="settings-operation-icon" aria-hidden="true"><Palette size={16} /><ChevronRight size={18} /></span>
            {/snippet}
          </SettingRow>
          {#if depOs}
            <SettingRow name="依存" description="入れておくと便利な外部のコマンド（fd など）" class="settings-operation-row settings-link-dependencies" onclick={() => (sub = 'dependencies')}>
              {#snippet control()}
                <span class="settings-operation-icon" aria-hidden="true"><Package size={16} /><ChevronRight size={18} /></span>
              {/snippet}
            </SettingRow>
          {/if}
        </Section>

        <Section title="ビュー" class="settings-views">
          {#if android}
            <SettingRow name="右スワイプで出す画面" description="画面の左の端から右へスワイプしたときに出す画面" class="settings-swipe-view">
              {#snippet control()}
                <select class="select" aria-label="右スワイプで出す画面" value={settings.views.swipe} onchange={(ev) => (settings.views = { ...settings.views, swipe: ev.currentTarget.value })}>
                  {#each VIEWS as v (v.id)}<option value={v.id}>{v.label}</option>{/each}
                </select>
              {/snippet}
            </SettingRow>
          {:else}
            {#each VIEWS as v (v.id)}
              <SettingRow name={v.label} description="画面に出す" class="settings-view-row">
                {#snippet control()}
                  <Toggle checked={viewShown(settings.views, v.id)} label={`${v.label}を出す`} onchange={(on) => setViewShown(v.id, on)} />
                {/snippet}
              </SettingRow>
            {/each}
          {/if}
        </Section>

        <Section title="バージョン">
          <div class="about selectable">
            <SettingRow name="fixplor" class="settings-version-row">
              {#snippet control()}
                <span class="about-version">{updater.supported ? (updater.version ? `v${updater.version}` : '…') : '開発版'}</span>
                {#if updater.supported && st.kind !== 'available'}
                  <IconButton class="about-check" label="アップデートを確認" title="アップデートを確認" disabled={busy} onclick={() => void updater.check()}>
                    <RefreshCw size={18} class={st.kind === 'checking' ? 'spin' : ''} />
                  </IconButton>
                {/if}
              {/snippet}
            </SettingRow>
            {#if !updater.supported}
              <p class="about-note">この環境では、アプリの更新を確認できません。</p>
            {:else if st.kind === 'checking'}
              <StatusLine kind="muted" busy>確認しています…</StatusLine>
            {:else if st.kind === 'latest'}
              <StatusLine kind="ok">最新です</StatusLine>
            {:else if st.kind === 'available'}
              <StatusLine kind="accent">新しいバージョンがあります: v{st.version}</StatusLine>
              {#if st.notes}<pre class="about-notes">{st.notes}</pre>{/if}
            {:else if st.kind === 'downloading'}
              <StatusLine kind="muted" busy>
                ダウンロード中…
                {#if st.total}{Math.floor((st.downloaded / st.total) * 100)}%{:else}{mb(st.downloaded)} MB{/if}
              </StatusLine>
              <progress class="about-progress" max={st.total ?? undefined} value={st.total ? st.downloaded : undefined}></progress>
            {:else if st.kind === 'installing'}
              <StatusLine kind="muted" busy>アップデートしています…（このあと、アプリを起動し直します）</StatusLine>
            {:else if st.kind === 'error'}
              <StatusLine kind="error">エラー: {st.message}</StatusLine>
              <p class="about-note">うまくいかないときは、リリースページから直接ダウンロードできます。</p>
            {/if}
            <div class="about-actions">
              {#if st.kind === 'error'}<Button class="about-release" onclick={() => void updater.openReleasePage()}>リリースページを開く</Button>{/if}
              {#if updater.supported && st.kind === 'available'}
                <Button class="about-install" variant="primary" onclick={() => void updater.install()}>アップデート</Button>
              {/if}
            </div>
          </div>
        </Section>
      {/if}
    </div>
  </div>
</div>

<style>
  .settings-view {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
  }
  .settings-title {
    font-weight: var(--fw-semibold);
  }
  .settings-body {
    flex: 1;
    min-height: 0;
  }
  .settings-content {
    max-width: 640px;
    margin: 0 auto;
    padding: var(--space-4) var(--space-7) 32px;
  }
  /* 「操作」の行の右の飾りのアイコン */
  .settings-operation-icon {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-muted);
  }
  .about {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .about p {
    margin: 0;
  }
  .about-version {
    font-weight: var(--fw-semibold);
  }
  .about-note {
    color: var(--text-muted);
    font-size: var(--fs-base);
  }
  .about-notes {
    margin: 0;
    max-height: 200px;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-family: inherit;
    font-size: var(--fs-base);
    color: var(--text-muted);
  }
  .about-progress {
    width: 100%;
    /* ブラウザの既定の色（青・緑）にせず、アプリのアクセントの色（--hue）にする */
    accent-color: var(--accent);
  }
  .about-actions {
    display: flex;
    gap: var(--space-2);
  }
</style>
