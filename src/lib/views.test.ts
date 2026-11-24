import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEWS, parseViews, viewShown, VIEWS } from './views';

describe('ビューの設定', () => {
  it('保存が無い・壊れているときは、既定（全部出す・スワイプは場所の欄）', () => {
    expect(parseViews(null)).toEqual(DEFAULT_VIEWS);
    expect(parseViews('{ broken')).toEqual(DEFAULT_VIEWS);
    expect(parseViews('5')).toEqual(DEFAULT_VIEWS);
    expect(DEFAULT_VIEWS.hidden).toEqual([]);
  });
  it('出さないビューとスワイプのビューを読む。知らないビューは捨てる', () => {
    expect(parseViews('{"hidden":["places","nope",1,"places"],"swipe":"places"}')).toEqual({ hidden: ['places'], swipe: 'places' });
    expect(parseViews('{"hidden":"places","swipe":"nope"}')).toEqual(DEFAULT_VIEWS);
  });
  it('出すかどうか', () => {
    expect(viewShown({ hidden: [], swipe: 'places' }, 'places')).toBe(true);
    expect(viewShown({ hidden: ['places'], swipe: 'places' }, 'places')).toBe(false);
  });
  it('ビューの ID に重なりが無い', () => {
    expect(new Set(VIEWS.map((v) => v.id)).size).toBe(VIEWS.length);
  });
});
