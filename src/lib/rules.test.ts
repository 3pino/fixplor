import { describe, expect, it } from 'vitest';
import type { Entry } from '@3pino/explorer-kit';
import { type RuleLook, defaultRules, fieldValue, hueColor, lookOf, matchesCondition, matchesRule, newRule, parseRules, type AppearanceRule } from './rules';
import { loadLucide, lookupIcon } from '@3pino/ui-kit-web/icons';
import { defineBrandIcons } from '@3pino/ui-kit-web/brandIcons';
import { isLucideName, LUCIDE_NAMES, lucideAliases, lucideCanonical, searchLucide } from './lucideIcons';
import aliasTable from './lucideAliases.json';
import { entryStyleOf } from './ruleStyle';
import { iconOf, searchIcons } from './ruleIcons';

const e = (name: string, kind: 'file' | 'dir' = 'file', path = `home/me/${name}`): Entry => ({ name, path, kind, size: 1, modified: 0, mime: null }) as Entry;
const rule = (id: string, conditions: AppearanceRule['conditions'], look: AppearanceRule['look'], enabled = true): AppearanceRule => ({ id, name: id, enabled, conditions, look });

describe('条件で比べる値', () => {
  it('名前・拡張子（ドットなし）・拡張子を除いた名前・種類・パス。.env は拡張子なし。フォルダは拡張子なし', () => {
    expect(['basename', 'stem', 'ext', 'kind', 'path'].map((f) => fieldValue(e('a.tar.gz'), f as never))).toEqual(['a.tar.gz', 'a.tar', 'gz', 'file', 'home/me/a.tar.gz']);
    expect([fieldValue(e('.env'), 'stem'), fieldValue(e('.env'), 'ext')]).toEqual(['.env', '']);
    expect([fieldValue(e('noext'), 'stem'), fieldValue(e('noext'), 'ext')]).toEqual(['noext', '']);
    expect([fieldValue(e('my.folder', 'dir'), 'stem'), fieldValue(e('my.folder', 'dir'), 'ext'), fieldValue(e('my.folder', 'dir'), 'kind')]).toEqual(['my.folder', '', 'dir']);
  });
});

describe('条件・ルール', () => {
  it('等しい・含む・始まる・終わる（大文字小文字は区別しない）・正規表現。「でない」で逆。壊れた正規表現は、いつも合わない', () => {
    const c = (op: never, value: string, not = false) => matchesCondition(e('Report-2024.PDF'), { field: 'basename', op, value, not });
    expect([c('is' as never, 'report-2024.pdf'), c('contains' as never, 'PORT'), c('startsWith' as never, 'rep'), c('endsWith' as never, '.pdf'), c('regex' as never, '^report-\\d+')]).toEqual([true, true, true, true, true]);
    expect([c('is' as never, 'x'), c('contains' as never, 'x'), c('contains' as never, 'x', true)]).toEqual([false, false, true]);
    expect([c('regex' as never, '(['), c('regex' as never, '([', true)]).toEqual([false, false]);
  });
  it('ルールは、条件のすべてに合うとき当たる（AND）。使っていない・条件が空は当たらない', () => {
    const r = rule('d', [{ field: 'kind', op: 'is', value: 'dir' }, { field: 'stem', op: 'is', value: 'desktop' }], { icon: 'monitor' });
    expect([matchesRule(e('Desktop', 'dir'), r), matchesRule(e('Desktop', 'file'), r), matchesRule(e('Documents', 'dir'), r)]).toEqual([true, false, false]);
    expect(matchesRule(e('Desktop', 'dir'), { ...r, enabled: false })).toBe(false);
    expect(matchesRule(e('Desktop', 'dir'), { ...r, conditions: [] })).toBe(false);
  });
});

describe('見た目を重ねる', () => {
  it('上のルールが優先。見た目の項目ごとに、最初に決まったものを使う。色は、色があれば色相より優先', () => {
    const rules = [
      rule('a', [{ field: 'ext', op: 'is', value: 'md' }], { icon: 'book', hue: 30 }),
      rule('b', [{ field: 'ext', op: 'is', value: 'md' }], { icon: 'star', color: 'red', opacity: 0.5 }),
      rule('c', [{ field: 'kind', op: 'is', value: 'file' }], { opacity: 0.9 }),
    ];
    expect(lookOf(e('x.md'), rules)).toEqual({ icon: 'book', hue: 30, opacity: 0.5 });
    expect(lookOf(e('x.txt'), rules)).toEqual({ opacity: 0.9 });
    expect(lookOf(e('x', 'dir'), rules)).toBeNull();
    expect(lookOf(e('x.md'), [rule('z', [{ field: 'ext', op: 'is', value: 'md' }], { color: 'red', hue: 10 })])).toEqual({ color: 'red' });
  });
  it('一覧に渡す見た目: アイコンは名前から、色相は色に。何も無ければ null。ゴミ箱の項目には与えない。ロゴは共通の独自アイコン', async () => {
    const rules = [rule('a', [{ field: 'stem', op: 'is', value: 'desktop' }], { icon: 'monitor', hue: 200, opacity: 0.8 }), rule('l', [{ field: 'stem', op: 'is', value: 'app' }], { icon: 'fixplor-logo' }), rule('u', [{ field: 'stem', op: 'is', value: 'u' }], { icon: 'no-such-icon' })];
    const s = entryStyleOf(e('Desktop', 'dir'), rules)!;
    expect(s.icon).toEqual(iconOf('monitor'));
    expect(s.color).toBe(hueColor(200));
    expect(s.opacity).toBe(0.8);
    expect(entryStyleOf(e('app', 'dir'), rules)!.icon).toEqual({ iconName: 'fixplor-logo' });
    expect(entryStyleOf(e('u'), rules)).toBeNull(); // 知らないアイコンだけ: 見た目は変えない
    expect(entryStyleOf(e('zzz'), rules)).toBeNull();
    expect(entryStyleOf({ ...e('Desktop', 'dir'), trash: { kind: 'root' } } as Entry, rules)).toBeNull();
    expect(entryStyleOf(e('Desktop', 'dir'), [])).toBeNull();
  });
  it('lucide のアイコンは全部を名前で呼べ、別名も解ける。絞り込める（-はあってもなくても、前方一致を先に）。以前の名前も使える', async () => {
    expect(LUCIDE_NAMES.length).toBeGreaterThan(1500);
    expect(LUCIDE_NAMES).toContain('folder');
    expect(isLucideName('music')).toBe(true); // 別名
    expect(isLucideName('no-such-icon')).toBe(false);
    // 一覧の名前も別名も、共通の登録簿（ui-kit-web の Icon が引く）で、実際にアイコンとして引ける
    await loadLucide();
    for (const name of [...LUCIDE_NAMES, ...Object.keys(aliasTable)]) expect(lookupIcon(name), name).toMatchObject({ body: expect.any(String) });
    expect(searchLucide('arrow up').slice(0, 3)).toContain('arrow-up');
    expect(searchLucide('arrow up').every((n) => n.includes('arrow') && n.includes('up'))).toBe(true);
    expect(searchLucide('arrowup')).toContain('arrow-up');
    expect(searchLucide('folder')[0]).toBe('folder');
    // 別名でも見つかる（見つかるのは今の名前。eighth-notes の別名は music）
    expect(searchLucide('music')).toContain('eighth-notes');
    expect(searchLucide('alarm-check')).toContain('alarm-clock-check');
    expect(lucideAliases('eighth-notes')).toContain('music');
    expect(lucideCanonical('music')).toBe('eighth-notes');
    expect(lucideCanonical('folder')).toBe('folder');
    // 別名の行き先は、みんな実在する
    for (const [alias, canonical] of Object.entries(aliasTable)) {
      expect(LUCIDE_NAMES, alias).toContain(canonical);
    }
    // ロゴ（共通の独自アイコン）も、lucide のように、名前で探せる
    expect(searchIcons('fixplor')[0]).toBe('fixplor-logo');
    expect(searchIcons('fix')[0]).toBe('fixplor-logo');
    expect(searchIcons('disnans')[0]).toBe('disnans-logo');
    expect(searchIcons('folder')).not.toContain('fixplor-logo');
    expect(searchLucide('zzzzzz')).toEqual([]);
    expect(searchLucide('')).toHaveLength(LUCIDE_NAMES.length);
    // 保存した名前は、別名・以前のロゴの名前も、今の名前に直して引く
    expect(iconOf('folder')).toEqual({ iconName: 'folder' });
    expect(iconOf('music')).toEqual({ iconName: 'eighth-notes' });
    for (const name of ['folder-git', 'gamepad', 'trash']) expect(iconOf(name)).toEqual({ iconName: lucideCanonical(name) });
    expect(iconOf('no-such-icon')).toBeUndefined();
    for (const old of ['logo', 'fixplor', 'fixplor-logo']) expect(iconOf(old)).toEqual({ iconName: 'fixplor-logo' });
    // 独自アイコンの別名も、本来の名前に直して引く。探すときも、別名で見つかる（見つかるのは本来の名前）
    expect(iconOf('brand-js')).toEqual({ iconName: 'brand-javascript' });
    expect(iconOf('brand-node')).toEqual({ iconName: 'brand-nodejs' });
    expect(searchIcons('brand-ts')).toContain('brand-typescript');
    expect(searchIcons('brand-ts')).not.toContain('brand-ts');
    // 共通の独自アイコンは、登録簿の独自のアイコンとして引ける
    defineBrandIcons();
    expect(lookupIcon('fixplor-logo')).toMatchObject({ body: expect.stringContaining('<path') });
  });
  it('最初から入っているルール: よくあるフォルダ・フォルダ全般（色相 104）・隠しファイル・名前や拡張子で決まるファイルの種類。表示は設定に任せる', () => {
    const d = defaultRules();
    expect(new Set(d.map((r) => r.id)).size).toBe(d.length);
    expect(parseRules(JSON.stringify(d))).toEqual(d);
    // アイコンは、みんな引ける（lucide の名前か、共通の独自アイコン）
    for (const r of d) if (r.look.icon) expect(iconOf(r.look.icon), r.id).toBeDefined();
    const dirs: [string, RuleLook][] = [
      ['Desktop', { icon: 'monitor', hue: 104 }],
      ['Downloads', { icon: 'download', hue: 104 }],
      ['Documents', { icon: 'file-text', hue: 104 }],
      ['Pictures', { icon: 'image', hue: 104 }],
      ['Music', { icon: 'headphones', hue: 104 }],
      ['Videos', { icon: 'video', hue: 104 }],
      ['Library', { icon: 'book', hue: 104 }],
      ['Public', { icon: 'building', hue: 104 }],
      ['src', { icon: 'folder', hue: 104 }],
      ['my.zip', { icon: 'folder', hue: 104 }], // フォルダは、名前がファイルらしくても folder
      ['config', { icon: 'folder', hue: 104 }],
      ['.git', { icon: 'brand-git', hue: 104, opacity: 0.55 }],
      ['.github', { icon: 'brand-github', hue: 104, opacity: 0.55 }],
      ['.cache', { icon: 'folder', hue: 104, opacity: 0.55 }],
    ];
    for (const [name, look] of dirs) expect(lookOf(e(name, 'dir'), d), name).toEqual(look);
    const files: [string, RuleLook][] = [
      ['a.txt', { icon: 'file' }],
      ['.env', { icon: 'file', opacity: 0.55 }],
      ['Photo.PNG', { icon: 'image' }],
      ['x.pdf', { icon: 'file-text' }],
      // Markdown: 文字の色。AI の指示は、アイコンだけ bot
      ['README.md', { icon: 'brand-markdown', color: 'var(--text)' }],
      ['a.mdx', { icon: 'brand-markdown', color: 'var(--text)' }],
      ['CLAUDE.md', { icon: 'bot', color: 'var(--text)' }],
      ['AGENTS.md', { icon: 'bot', color: 'var(--text)' }],
      ['copilot-instructions.md', { icon: 'bot', color: 'var(--text)' }],
      ['QWEN.md', { icon: 'bot', color: 'var(--text)' }],
      ['playwright.config.ts', { icon: 'brand-playwright', hue: 143 }],
      ['playwright.config.js', { icon: 'brand-playwright', hue: 143 }],
      ['main.py', { icon: 'brand-python', hue: 82 }],
      ['py.typed', { icon: 'brand-python', hue: 82 }],
      ['a.pyi', { icon: 'brand-python', hue: 82 }],
      ['Dockerfile', { icon: 'brand-docker', hue: 254 }],
      ['.dockerignore', { icon: 'brand-docker', hue: 254, opacity: 0.55 }],
      ['x.dockerfile', { icon: 'brand-docker', hue: 254 }],
      ['clip.MP4', { icon: 'film', hue: 62 }],
      ['a.mkv', { icon: 'film', hue: 62 }],
      ['a.flac', { icon: 'eighth-notes', hue: 240 }],
      ['a.mp3', { icon: 'eighth-notes', hue: 240 }],
      ['a.zip', { icon: 'folder-archive', hue: 76 }],
      ['a.tgz', { icon: 'folder-archive', hue: 76 }],
      ['a.sqlite3', { icon: 'database' }],
      ['a.sql', { icon: 'database' }],
      ['a.xlsx', { icon: 'file-spreadsheet', hue: 155 }],
      ['a.csv', { icon: 'table', hue: 145 }],
      ['a.tsv', { icon: 'table', hue: 145 }],
      ['a.json', { icon: 'braces', hue: 109 }],
      ['a.jsonl', { icon: 'braces', hue: 109 }],
      ['a.epub', { icon: 'book-open', hue: 70 }],
      ['a.rmd', { icon: 'brand-markdown', color: 'var(--text)' }],
      ['a.markdown', { icon: 'brand-markdown', color: 'var(--text)' }],
      ['a.pxd', { icon: 'brand-python', hue: 82 }],
      ['a.ods', { icon: 'file-spreadsheet', hue: 155 }],
      ['a.xlsm', { icon: 'file-spreadsheet', hue: 155 }],
      ['a.docx', { icon: 'file-text', hue: 260 }],
      ['a.odt', { icon: 'file-text', hue: 260 }],
      ['a.pptx', { icon: 'file-chart-pie', hue: 227 }],
      ['a.odp', { icon: 'file-chart-pie', hue: 227 }],
      ['a.sha256', { icon: 'shield-check' }],
      ['a.sha512', { icon: 'shield-check' }],
      ['a.svgz', { icon: 'image' }],
      ['a.svg', { icon: 'image' }],
    ];
    for (const [name, look] of files) expect(lookOf(e(name), d), name).toEqual(look);
    // 設定ファイル（色は指定なし）: 名前が一覧のどれかで終わる（ドットファイルも）
    for (const name of ['.bashrc', '.zshrc', '.zprofile', '.zshenv', '.bash_profile', '.gitconfig', '.clang-format', '.clang-tidy', '.DS_Store', '.luacheckrc', '.luaurc', '.pylintrc', 'web.config', 'config', 'Directory.Build.props', 'Directory.Build.targets', 'Directory.Packages.props', 'a.bat', 'a.cfg', 'a.conf', 'a.ini', 'a.yaml', 'a.yml']) {
      const look = lookOf(e(name), d)!;
      expect(look.icon, name).toBe('settings');
      expect(look.hue, name).toBeUndefined();
      expect(look.color, name).toBeUndefined();
    }
    // 設定ファイルに見えるだけのものは当てない
    for (const name of ['myconfig.txt', 'bashrc.txt', 'a.yml.bak', 'tsconfig']) expect(lookOf(e(name), d)!.icon, name).not.toBe('settings');
    expect(lookOf(e('a.ymll'), d)!.icon).toBe('file');
  });
});

describe('保存した値を読む', () => {
  it('壊れた項目・条件は捨て、値は範囲に収める。新しいルールは、フォルダの条件だけ', () => {
    expect(parseRules(null)).toEqual([]);
    expect(parseRules('{ broken')).toEqual([]);
    expect(parseRules('{}')).toEqual([]);
    const list = parseRules(JSON.stringify([
      { id: 'a', name: 'n', enabled: false, conditions: [{ field: 'ext', op: 'is', value: 'md' }, { field: 'zzz', op: 'is', value: '' }], look: { icon: 'star', hue: 999, opacity: 5, color: ' red ' } },
      { id: 1 },
      'x',
    ]));
    expect(list).toEqual([{ id: 'a', name: 'n', enabled: false, conditions: [{ field: 'ext', op: 'is', value: 'md' }], look: { icon: 'star', hue: 360, opacity: 1, color: 'red' } }]);
    expect(newRule('n1')).toMatchObject({ id: 'n1', enabled: true, conditions: [{ field: 'kind', op: 'is', value: 'dir' }], look: {} });
  });
});
