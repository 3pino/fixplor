import { describe, expect, it } from 'vitest';
import { COMMANDS, addKey, effectiveKeys, explorerKeymap, findConflicts, overrideOf, parseOverrides, removeKey } from './hotkeys';

describe('ホットキーの設定', () => {
  it('変えていなければ既定。変えた操作だけが、保存した値になる', () => {
    expect(effectiveKeys('tab.new', {})).toEqual(['Ctrl+T']);
    expect(effectiveKeys('tab.new', { 'tab.new': ['Ctrl+Y'] })).toEqual(['Ctrl+Y']);
    expect(effectiveKeys('tab.new', { 'tab.new': [] })).toEqual([]);
  });

  it('既定と同じ一覧は、保存しない（既定が変わったとき、追従するため）', () => {
    expect(overrideOf('tab.next', ['Ctrl+Tab', 'Ctrl+PageDown'])).toBeNull();
    expect(overrideOf('tab.next', ['Ctrl+Tab'])).toEqual(['Ctrl+Tab']);
    expect(overrideOf('tab.next', [])).toEqual([]);
  });

  it('足す（重複なし・書き方をそろえる）・外す', () => {
    expect(addKey(['Ctrl+T'], 'ctrl+y')).toEqual(['Ctrl+T', 'Ctrl+Y']);
    expect(addKey(['Ctrl+T'], 'ctrl+t')).toEqual(['Ctrl+T']);
    expect(addKey(['Ctrl+T'], 'Hyper+Q')).toEqual(['Ctrl+T']);
    expect(removeKey(['Ctrl+T', 'Ctrl+Y'], 'Ctrl+T')).toEqual(['Ctrl+Y']);
  });

  it('保存した値の読み込み: 壊れた値・知らない操作・読めないキーは捨てる', () => {
    expect(parseOverrides(null)).toEqual({});
    expect(parseOverrides('{')).toEqual({});
    expect(parseOverrides('[]')).toEqual({});
    expect(parseOverrides('{"nope":["Ctrl+Y"],"tab.new":"x"}')).toEqual({});
    expect(parseOverrides('{"tab.new":["ctrl+y","Ctrl+Y",3,"Hyper+X"],"rename":[]}')).toEqual({ 'tab.new': ['Ctrl+Y'], rename: [] });
  });

  it('同じキーを持つ操作を見つける（既定の中には、重なりが無い）', () => {
    expect([...findConflicts({})]).toEqual([]);
    const c = findConflicts({ 'tab.prev': ['Ctrl+T'] });
    expect([...c.keys()]).toEqual(['Ctrl+T']);
    expect(c.get('Ctrl+T')).toEqual(['tab.new', 'tab.prev']);
  });

  it('一覧の操作のホットキーを、部品に渡す形にする', () => {
    const map = explorerKeymap({ rename: ['F3'] });
    expect(map.rename).toEqual(['F3']);
    expect(map.search).toEqual(['Ctrl+F']);
    expect(map.undo).toEqual(['Ctrl+Z']);
    expect(map.redo).toEqual(['Ctrl+Y', 'Ctrl+Shift+Z']);
    expect(COMMANDS.map((c) => c.id)).toContain('view.reload');
  });
});
