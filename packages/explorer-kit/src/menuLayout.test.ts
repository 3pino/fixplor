import { describe, expect, it } from 'vitest';
import { applyMenuLayout, ENTRY_MENU_ITEMS, HEADER_DEFAULT_HIDDEN, HEADER_ITEMS, headerLayout, menuOrder, parseMenuLayouts, reorderMenu, setMenuHidden, SPACE_MENU_ITEMS } from './menuLayout';

const D = ['a', 'b', 'c', 'd'];

describe('右クリックのメニューの並びと表示', () => {
  it('何も決めていなければ、既定の順で全部出す', () => {
    expect(applyMenuLayout(D)).toEqual(D);
    expect(applyMenuLayout(D, {})).toEqual(D);
  });
  it('決めた順が先で、ない項目は既定の順で後ろに続く。知らない ID は捨てる。出さないものは除く', () => {
    expect(menuOrder(D, { order: ['c', 'zzz', 'a', 'c'] })).toEqual(['c', 'a', 'b', 'd']);
    expect(applyMenuLayout(D, { order: ['c', 'a'], hidden: ['b'] })).toEqual(['c', 'a', 'd']);
    expect(applyMenuLayout(D, { hidden: D })).toEqual([]);
  });
  it('動かす: 動かしたあとの位置へ。出す・出さないは、並びと別に覚える', () => {
    expect(menuOrder(D, reorderMenu(D, undefined, 'a', 2))).toEqual(['b', 'c', 'a', 'd']);
    expect(menuOrder(D, reorderMenu(D, undefined, 'd', 0))).toEqual(['d', 'a', 'b', 'c']);
    expect(menuOrder(D, reorderMenu(D, undefined, 'a', 99))).toEqual(['b', 'c', 'd', 'a']);
    const l = setMenuHidden(reorderMenu(D, undefined, 'a', 2), 'b', true);
    expect(l.hidden).toEqual(['b']);
    expect(applyMenuLayout(D, l)).toEqual(['c', 'a', 'd']);
    expect(setMenuHidden(l, 'b', false).hidden).toEqual([]);
  });
  it('保存した文字を読む。壊れていれば空', () => {
    expect(parseMenuLayouts(null)).toEqual({});
    expect(parseMenuLayouts('{ broken')).toEqual({});
    expect(parseMenuLayouts('{"entry":{"order":["x",1],"hidden":["y"]},"space":5}')).toEqual({ entry: { order: ['x'], hidden: ['y'] }, space: undefined });
  });
  it('項目の ID に重なりが無い', () => {
    for (const list of [ENTRY_MENU_ITEMS, SPACE_MENU_ITEMS, HEADER_ITEMS]) expect(new Set(list.map((i) => i.id)).size).toBe(list.length);
  });
});

describe('上端の行の部品の並びと表示', () => {
  const ids = HEADER_ITEMS.map((i) => i.id);
  it('決めていなければ、既定の部品だけ出す（隠しファイル・新しいファイル・新しいフォルダは、足したいときだけ）', () => {
    const shown = applyMenuLayout(ids, headerLayout());
    expect(shown).toEqual(ids.filter((id) => !HEADER_DEFAULT_HIDDEN.includes(id)));
    expect(shown.slice(0, 4)).toEqual(['back', 'forward', 'up', 'path']);
    expect(HEADER_DEFAULT_HIDDEN.every((id) => ids.includes(id))).toBe(true);
  });
  it('決めたら、その決めたとおり（出す・出さないは、既定に引きずられない）。並べ替えもできる', () => {
    const layout = { order: ['path', 'back'], hidden: ['copy'] };
    expect(applyMenuLayout(ids, headerLayout(layout)).slice(0, 3)).toEqual(['path', 'back', 'forward']);
    expect(applyMenuLayout(ids, headerLayout(layout))).toContain('newFile');
    expect(applyMenuLayout(ids, headerLayout(layout))).not.toContain('copy');
  });
  it('保存した文字から、header も読む', () => {
    expect(parseMenuLayouts('{"header":{"order":["path"],"hidden":["cut"]}}').header).toEqual({ order: ['path'], hidden: ['cut'] });
  });
});
