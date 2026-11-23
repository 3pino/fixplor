import type { Entry } from '@3pino/explorer-kit';

// 見た目のルール: 条件に合うファイル・フォルダに、アイコン・色・不透明度を与える（設定の「見た目のルール」）。画面に依らない。
// 条件は、すべてに合うとき（AND）に、そのルールが当たる。ルールは上のものほど優先（見た目の項目ごとに、最初に当たったルールの値を使う）。

export type RuleField = 'kind' | 'basename' | 'stem' | 'ext' | 'path';
export type RuleOp = 'is' | 'contains' | 'startsWith' | 'endsWith' | 'regex';

export type RuleCondition = {
  field: RuleField;
  op: RuleOp;
  value: string;
  /** 条件を逆にする（「でない」） */
  not?: boolean;
};

export type RuleLook = {
  /** アイコンの名前（ruleIcons.ts の一覧。`logo` はアプリのロゴ） */
  icon?: string;
  /** 色相（0〜360）。アプリの色と同じ明るさ・濃さで、この色相の色にする */
  hue?: number;
  /** 色（CSS の色。hue より優先） */
  color?: string;
  /** 行の不透明度（0.1〜1） */
  opacity?: number;
};

export type AppearanceRule = {
  id: string;
  name: string;
  enabled: boolean;
  conditions: RuleCondition[];
  look: RuleLook;
};

export const FIELD_LABEL: Record<RuleField, string> = { kind: '種類', basename: '名前（拡張子を含む）', stem: '名前（拡張子を除く）', ext: '拡張子', path: 'パス' };
export const OP_LABEL: Record<RuleOp, string> = { is: 'と等しい', contains: 'を含む', startsWith: 'で始まる', endsWith: 'で終わる', regex: '正規表現に合う' };
/** 種類の値 */
export const KIND_LABEL = { dir: 'フォルダ', file: 'ファイル' } as const;

/** 項目から、条件で比べる値を取り出す（拡張子は、ドットなし。ドットで始まるだけの名前（.env）は、拡張子なし） */
export function fieldValue(e: Pick<Entry, 'name' | 'path' | 'kind'>, field: RuleField): string {
  switch (field) {
    case 'kind':
      return e.kind === 'dir' ? 'dir' : 'file';
    case 'basename':
      return e.name;
    case 'path':
      return e.path;
    case 'stem':
    case 'ext': {
      // フォルダは、拡張子なし（`my.folder` の `folder` は拡張子ではない）
      const dot = e.kind === 'dir' ? -1 : e.name.lastIndexOf('.');
      if (dot <= 0) return field === 'stem' ? e.name : '';
      return field === 'stem' ? e.name.slice(0, dot) : e.name.slice(dot + 1);
    }
  }
}

const regexes = new Map<string, RegExp | null>();
function regexOf(source: string): RegExp | null {
  if (regexes.has(source)) return regexes.get(source)!;
  let re: RegExp | null = null;
  try {
    re = new RegExp(source, 'i');
  } catch {
    re = null;
  }
  if (regexes.size > 200) regexes.clear();
  regexes.set(source, re);
  return re;
}

/** 条件 1 つが、項目に合うか（正規表現が壊れていれば、合わない。「でない」を付けても、壊れていれば合わない） */
export function matchesCondition(e: Pick<Entry, 'name' | 'path' | 'kind'>, c: RuleCondition): boolean {
  const v = fieldValue(e, c.field);
  let hit: boolean;
  if (c.op === 'regex') {
    const re = regexOf(c.value);
    if (!re) return false;
    hit = re.test(v);
  } else {
    const a = v.toLowerCase();
    const b = c.value.toLowerCase();
    hit = c.op === 'is' ? a === b : c.op === 'contains' ? a.includes(b) : c.op === 'startsWith' ? a.startsWith(b) : a.endsWith(b);
  }
  return c.not ? !hit : hit;
}

/** ルールが、項目に当たるか（使っていない・条件が空のルールは、当たらない） */
export function matchesRule(e: Pick<Entry, 'name' | 'path' | 'kind'>, rule: AppearanceRule): boolean {
  return rule.enabled && rule.conditions.length > 0 && rule.conditions.every((c) => matchesCondition(e, c));
}

/** 項目に当たるルールの見た目を、上から重ねる（見た目の項目ごとに、最初に決まったものを使う）。何も当たらなければ null */
export function lookOf(e: Pick<Entry, 'name' | 'path' | 'kind'>, rules: readonly AppearanceRule[]): RuleLook | null {
  let out: RuleLook | null = null;
  for (const r of rules) {
    if (!matchesRule(e, r)) continue;
    out ??= {};
    const l = r.look;
    if (out.icon === undefined && l.icon) out.icon = l.icon;
    if (out.color === undefined && out.hue === undefined) {
      if (l.color) out.color = l.color;
      else if (l.hue !== undefined) out.hue = l.hue;
    }
    if (out.opacity === undefined && l.opacity !== undefined) out.opacity = l.opacity;
  }
  return out;
}

/** 色相から作る色。明るさは、アプリの色（app.css の --rule-l）に合わせる */
export const hueColor = (hue: number): string => `oklch(var(--rule-l, 0.6) 0.13 ${Math.round(hue)})`;

// ---- 保存した値を読む（壊れた項目は捨てる） ----

const FIELDS: readonly RuleField[] = ['kind', 'basename', 'stem', 'ext', 'path'];
const OPS: readonly RuleOp[] = ['is', 'contains', 'startsWith', 'endsWith', 'regex'];

function readCondition(x: unknown): RuleCondition | null {
  const o = x as Partial<RuleCondition> | null;
  if (!o || typeof o !== 'object' || !FIELDS.includes(o.field as RuleField) || !OPS.includes(o.op as RuleOp) || typeof o.value !== 'string') return null;
  return { field: o.field as RuleField, op: o.op as RuleOp, value: o.value, ...(o.not ? { not: true } : {}) };
}

function readLook(x: unknown): RuleLook {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const look: RuleLook = {};
  if (typeof o.icon === 'string' && o.icon !== '') look.icon = o.icon;
  if (typeof o.hue === 'number' && Number.isFinite(o.hue)) look.hue = Math.max(0, Math.min(360, o.hue));
  if (typeof o.color === 'string' && o.color.trim() !== '') look.color = o.color.trim();
  if (typeof o.opacity === 'number' && Number.isFinite(o.opacity)) look.opacity = Math.max(0.1, Math.min(1, o.opacity));
  return look;
}

export function parseRules(raw: string | null): AppearanceRule[] {
  if (raw === null) return [];
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.flatMap((x): AppearanceRule[] => {
      const o = x as Partial<AppearanceRule> | null;
      if (!o || typeof o !== 'object' || typeof o.id !== 'string' || !Array.isArray(o.conditions)) return [];
      const conditions = o.conditions.map(readCondition).filter((c): c is RuleCondition => c !== null);
      return [{ id: o.id, name: typeof o.name === 'string' ? o.name : '', enabled: o.enabled !== false, conditions, look: readLook(o.look) }];
    });
  } catch {
    return [];
  }
}

/**
 * 初めから入っているルール（「デフォルトに戻す」でこの状態になる）。上のものほど優先:
 * よくあるフォルダ・.git・.github のアイコン → 隠しファイルを薄く → フォルダ全般（folder、色相 104） → ファイルの種類（名前で決まるもの → 拡張子で決まるもの） → 画像・PDF・そのほかのファイル（表示はこの設定に任せる）。
 * 見た目の項目ごとに最初に当たったものを使うので、Desktop は「monitor で、色相 104」になる
 */
export function defaultRules(): AppearanceRule[] {
  const dir = (stem: string): RuleCondition[] => [
    { field: 'kind', op: 'is', value: 'dir' },
    { field: 'stem', op: 'is', value: stem },
  ];
  const named = (name: string, stem: string, icon: string): AppearanceRule => ({ id: `default-${stem}`, name, enabled: true, conditions: dir(stem), look: { icon } });
  /** 名前（拡張子を含む）が、一覧のどれかで終わる（`.bashrc`・`foo.yml`。ドットは文字のドットとして扱う） */
  const endsWith = (list: string[]): RuleCondition[] => [{ field: 'basename', op: 'regex', value: `(^|\\.)(${list.map((s) => s.replace(/\./g, '\\.')).join('|')})$` }];
  /** 拡張子が、一覧のどれか */
  const ext = (list: string[]): RuleCondition[] => [{ field: 'ext', op: 'regex', value: `^(${list.join('|')})$` }];
  /** 名前（拡張子を含む）が、一覧のどれかと完全に一致 */
  const exactly = (list: string[]): RuleCondition[] => [{ field: 'basename', op: 'regex', value: `^(${list.map((s) => s.replace(/\./g, '\\.')).join('|')})$` }];
  const kind = (id: string, name: string, conditions: RuleCondition[], look: RuleLook): AppearanceRule => ({ id: `default-${id}`, name, enabled: true, conditions, look });
  return [
    named('Desktop', 'desktop', 'monitor'),
    named('Downloads', 'downloads', 'download'),
    named('Documents', 'documents', 'file-text'),
    named('Pictures', 'pictures', 'image'),
    named('Music', 'music', 'headphones'),
    named('Videos', 'videos', 'video'),
    named('Library', 'library', 'book'),
    named('Public', 'public', 'building'),
    kind('git-dir', '.git', dir('.git'), { icon: 'brand-git' }),
    kind('github-dir', '.github', dir('.github'), { icon: 'brand-github' }),
    { id: 'default-hidden', name: '隠しファイル', enabled: true, conditions: [{ field: 'basename', op: 'startsWith', value: '.' }], look: { opacity: 0.55 } },
    // フォルダ全般（色相 104 は、アプリの色）。下のファイルのルールより前にあるので、フォルダはどれも folder になる
    kind('folder', 'フォルダ', [{ field: 'kind', op: 'is', value: 'dir' }], { icon: 'folder', hue: 104 }),
    // ファイルの種類。名前で決まるもの（AI の指示・Playwright）を、拡張子で決まるものより前におく
    kind('agents', 'AGENTS.md', exactly(['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'copilot-instructions.md', 'QWEN.md', 'CONVENTIONS.md']), { icon: 'bot' }),
    kind('playwright', 'Playwright', [{ field: 'basename', op: 'startsWith', value: 'playwright.config.' }], { icon: 'brand-playwright', hue: 143 }),
    kind('markdown', 'Markdown', ext(['md', 'mdx', 'markdown', 'rmd']), { icon: 'brand-markdown', color: 'var(--text)' }),
    kind('python', 'Python', endsWith(['py.typed', 'py', 'pyc', 'pyd', 'pyi', 'pyo', 'pyw', 'pyx', 'pxi', 'pxd']), { icon: 'brand-python', hue: 82 }),
    kind('docker', 'Docker', endsWith(['dockerfile', 'dockerignore']), { icon: 'brand-docker', hue: 254 }),
    kind(
      'settings',
      '設定ファイル',
      endsWith(['bash_profile', 'bashrc', 'clang-format', 'clang-tidy', 'ds_store', 'gitconfig', 'luacheckrc', 'luaurc', 'pylintrc', 'zprofile', 'zshenv', 'zshrc', 'config', 'Directory.Build.props', 'Directory.Build.targets', 'Directory.Packages.props', 'bat', 'cfg', 'conf', 'ini', 'yaml', 'yml']),
      { icon: 'settings' },
    ),
    kind('video', '動画', ext(['3gp', 'cast', 'm4v', 'mkv', 'mov', 'mp4', 'ogv', 'ogx', 'webm', 'wmv']), { icon: 'film', hue: 62 }),
    kind('audio', '音声', ext(['aac', 'aif', 'aiff', 'ape', 'flac', 'm4a', 'mp3', 'oga', 'ogg', 'opus', 'pcm', 'spx', 'wav', 'wma', 'wv', 'wvc']), { icon: 'eighth-notes', hue: 240 }),
    kind('archive', 'アーカイブ', ext(['7z', 'bz', 'bz2', 'bz3', 'gz', 'rar', 'tgz', 'txz', 'xz', 'zip', 'zst']), { icon: 'folder-archive', hue: 76 }),
    kind('database', 'データベース', ext(['sql', 'sqlite', 'sqlite3']), { icon: 'database' }),
    kind('spreadsheet', '表計算', ext(['xls', 'xlsx', 'xlsm', 'xlsb', 'xltx', 'xltm', 'xlt', 'ods', 'fods']), { icon: 'file-spreadsheet', hue: 155 }),
    kind('table', 'CSV, TSV', ext(['csv', 'tsv']), { icon: 'table', hue: 145 }),
    kind('document', 'ワードプロセッサ', ext(['doc', 'docx', 'docm', 'dotx', 'dotm', 'dot', 'odt', 'fodt']), {icon: 'file-text', hue: 260}),
    kind('presentation', 'プレゼンテーション', ext(['ppt', 'pptx', 'pptm', 'potx', 'potm', 'pot', 'ppsx', 'ppsm', 'pps', 'odp', 'fodp']), {icon: 'file-chart-pie', hue: 227}),
    kind('json', 'JSON', ext(['cson', 'json', 'jsonc', 'jsonl']), { icon: 'braces', hue: 109 }),
    kind('ebook', '電子書籍', ext(['ebook', 'epub', 'mobi']), { icon: 'book-open', hue: 70 }),
    kind('sha', 'sha', ext(['sha1', 'sha224', 'sha256', 'sha384', 'sha512']), {icon: 'shield-check'}),
    { id: 'default-image', name: '画像', enabled: true, conditions: ext(['png', 'jpe?g', 'gif', 'webp', 'svgz?', 'bmp', 'avif', 'ico']), look: { icon: 'image' } },
    { id: 'default-pdf', name: 'PDF', enabled: true, conditions: [{ field: 'ext', op: 'is', value: 'pdf' }], look: { icon: 'file-text' } },
    { id: 'default-file', name: 'ファイル', enabled: true, conditions: [{ field: 'kind', op: 'is', value: 'file' }], look: { icon: 'file' } },
  ];
}

/** 新しいルール（フォルダ・名前が一致するだけの、空の見た目） */
export function newRule(id: string): AppearanceRule {
  return { id, name: '', enabled: true, conditions: [{ field: 'kind', op: 'is', value: 'dir' }], look: {} };
}
