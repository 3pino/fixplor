<script lang="ts">
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Button from '@3pino/ui-kit-web/Button.svelte';
  import Section from '@3pino/ui-kit-web/Section.svelte';
  import SettingRow from '@3pino/ui-kit-web/SettingRow.svelte';
  import SortableList from '@3pino/ui-kit-web/SortableList.svelte';
  import StatusLine from '@3pino/ui-kit-web/StatusLine.svelte';
  import Toggle from '@3pino/ui-kit-web/Toggle.svelte';
  import { ENTRY_MENU_ITEMS, HEADER_ITEMS, headerLayout, menuOrder, reorderMenu, setMenuHidden, SPACE_MENU_ITEMS, type MenuItemDef, type MenuLayout, type MenuLayouts } from '@3pino/explorer-kit';
  import { settings } from '../lib/settings.svelte';

  // 設定の「メニュー」: 上端の行の部品と、項目の右クリック・空きの右クリックに出す項目を、並べ替え・出す／出さないの切り替えで決める。
  // 並べ替えは共通の SortableList（行をドラッグ。行にフォーカスして上下キー）。出す条件（選んだ数・書けるか など）は、ここで決めない（出す項目でも、使えないときは出ない）。

  type Which = 'header' | 'entry' | 'space';
  const MENUS: { which: Which; title: string; hint: string; items: readonly MenuItemDef[] }[] = [
    { which: 'header', title: '上端の行', hint: 'パス欄の左右に並べる部品（右端の ≡ は、いつも出ます）', items: HEADER_ITEMS },
    { which: 'entry', title: 'ファイル・フォルダを右クリック', hint: '選んだ項目のメニュー', items: ENTRY_MENU_ITEMS },
    { which: 'space', title: '空きを右クリック', hint: 'フォルダの何もないところのメニュー', items: SPACE_MENU_ITEMS },
  ];

  /** 上端の行は、決めていなければ、既定（出さない部品がある）。右クリックのメニューは、全部出す */
  const layoutOf = (which: Which): MenuLayout | undefined => (which === 'header' ? headerLayout(settings.menus.header) : settings.menus[which]);
  const defaultsOf = (items: readonly MenuItemDef[]): string[] => items.map((i) => i.id);
  /** 並べている項目（出さないものも含む）。表示の順 */
  function rows(which: Which, items: readonly MenuItemDef[]): { id: string; label: string; shown: boolean }[] {
    const hidden = new Set(layoutOf(which)?.hidden ?? []);
    return menuOrder(defaultsOf(items), layoutOf(which)).map((id) => ({ id, label: items.find((i) => i.id === id)?.label ?? id, shown: !hidden.has(id) }));
  }
  const save = (which: Which, layout: MenuLayout): void => {
    const next: MenuLayouts = { ...settings.menus, [which]: layout };
    settings.menus = next;
  };
  const move = (which: Which, items: readonly MenuItemDef[], id: string, to: number): void => save(which, reorderMenu(defaultsOf(items), layoutOf(which), id, to));
  const show = (which: Which, id: string, on: boolean): void => save(which, setMenuHidden(layoutOf(which), id, !on));
  const reset = (which: Which): void => {
    const { [which]: _gone, ...rest } = settings.menus;
    settings.menus = rest;
  };
  /** 全部を出さないと、右クリックしてもメニューが出ない */
  const allHidden = (which: Which, items: readonly MenuItemDef[]): boolean => rows(which, items).every((r) => !r.shown);
</script>

{#each MENUS as m (m.which)}
  <Section title={m.title} class={`menu-settings menu-settings-${m.which}`}>
    <p class="muted menu-settings-hint">{m.hint}に出す項目を、並べ替え・出す／出さないを切り替えられます。</p>
    <SortableList items={rows(m.which, m.items)} getId={(r) => r.id} getLabel={(r) => r.label} onmove={(id, to) => move(m.which, m.items, id, to)} class="menu-settings-list">
      {#snippet row(r)}
        <SettingRow name={r.label}>
          {#snippet control()}
            <Toggle checked={r.shown} label={`${r.label}を出す`} onchange={(on) => show(m.which, r.id, on)} />
          {/snippet}
        </SettingRow>
      {/snippet}
    </SortableList>
    {#if m.which !== 'header' && allHidden(m.which, m.items)}
      <StatusLine kind="warn">全部を出さないので、右クリックしてもメニューは出ません。</StatusLine>
    {/if}
    <div class="menu-settings-actions">
      <Button class="menu-settings-reset" icon={RotateCcw} onclick={() => reset(m.which)}>項目を既定に戻す</Button>
    </div>
  </Section>
{/each}

<style>
  .menu-settings-hint {
    margin: 0 0 var(--space-2);
    font-size: var(--fs-sm);
  }
  .menu-settings-actions {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }
</style>
