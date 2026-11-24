// テキストの色付け（highlight.js）。言語は、見るときに 1 つずつ読み込む（使わない言語は、読み込まない）。
// 結果は HTML（highlight.js が文字をエスケープする）。色は、呼ぶ側の CSS（.hljs-* のクラス）が決める。

import type { LanguageFn } from 'highlight.js';

type Loader = () => Promise<{ default: LanguageFn }>;

/** 言語 → 読み込み（import の文字は、バンドラーが見つけられるよう、そのまま書く） */
const LANGUAGES: Record<string, Loader> = {
  bash: () => import('highlight.js/lib/languages/bash'),
  c: () => import('highlight.js/lib/languages/c'),
  cpp: () => import('highlight.js/lib/languages/cpp'),
  csharp: () => import('highlight.js/lib/languages/csharp'),
  css: () => import('highlight.js/lib/languages/css'),
  diff: () => import('highlight.js/lib/languages/diff'),
  dockerfile: () => import('highlight.js/lib/languages/dockerfile'),
  go: () => import('highlight.js/lib/languages/go'),
  ini: () => import('highlight.js/lib/languages/ini'),
  java: () => import('highlight.js/lib/languages/java'),
  javascript: () => import('highlight.js/lib/languages/javascript'),
  json: () => import('highlight.js/lib/languages/json'),
  kotlin: () => import('highlight.js/lib/languages/kotlin'),
  makefile: () => import('highlight.js/lib/languages/makefile'),
  markdown: () => import('highlight.js/lib/languages/markdown'),
  php: () => import('highlight.js/lib/languages/php'),
  powershell: () => import('highlight.js/lib/languages/powershell'),
  python: () => import('highlight.js/lib/languages/python'),
  ruby: () => import('highlight.js/lib/languages/ruby'),
  rust: () => import('highlight.js/lib/languages/rust'),
  scss: () => import('highlight.js/lib/languages/scss'),
  sql: () => import('highlight.js/lib/languages/sql'),
  swift: () => import('highlight.js/lib/languages/swift'),
  typescript: () => import('highlight.js/lib/languages/typescript'),
  xml: () => import('highlight.js/lib/languages/xml'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
};

/** 拡張子（小文字） → 言語 */
const BY_EXT: Record<string, string> = {
  sh: 'bash', bash: 'bash', zsh: 'bash', env: 'bash',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp',
  cs: 'csharp',
  css: 'css',
  diff: 'diff', patch: 'diff',
  go: 'go',
  ini: 'ini', toml: 'ini', conf: 'ini', cfg: 'ini', properties: 'ini',
  java: 'java',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  json: 'json', jsonc: 'json', json5: 'json', webmanifest: 'json',
  kt: 'kotlin', kts: 'kotlin',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown', rmd: 'markdown',
  php: 'php',
  ps1: 'powershell', psm1: 'powershell',
  py: 'python', pyi: 'python', pyx: 'python', pxd: 'python',
  rb: 'ruby',
  rs: 'rust',
  scss: 'scss', sass: 'scss',
  sql: 'sql',
  swift: 'swift',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml', svelte: 'xml', xhtml: 'xml', plist: 'xml', csproj: 'xml',
  yml: 'yaml', yaml: 'yaml',
};

/** ファイル名そのもので決まるもの（小文字） */
const BY_NAME: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  '.bashrc': 'bash',
  '.zshrc': 'bash',
  '.profile': 'bash',
  '.gitconfig': 'ini',
  '.editorconfig': 'ini',
};

/** 名前から、色付けの言語を決める（分からなければ null） */
export function languageOf(name: string): string | null {
  const lower = name.toLowerCase();
  if (BY_NAME[lower]) return BY_NAME[lower];
  if (lower.startsWith('dockerfile.')) return 'dockerfile';
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return null;
  return BY_EXT[lower.slice(dot + 1)] ?? null;
}

type Core = typeof import('highlight.js/lib/core').default;
let core: Promise<Core> | null = null;
const registered = new Set<string>();

/**
 * 色付けした HTML を返す。言語が分からない・失敗したときは null（呼ぶ側は、色なしの文字を出す）。
 * 文字は highlight.js がエスケープするので、そのまま HTML として使える
 */
export async function highlightCode(text: string, name: string): Promise<string | null> {
  const lang = languageOf(name);
  if (!lang || !LANGUAGES[lang]) return null;
  try {
    core ??= import('highlight.js/lib/core').then((m) => m.default);
    const hljs = await core;
    if (!registered.has(lang)) {
      hljs.registerLanguage(lang, (await LANGUAGES[lang]()).default);
      registered.add(lang);
    }
    return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
}
