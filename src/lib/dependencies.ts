// 依存（入れておくと便利な、外部のコマンド）。設定の「依存」に、入っているかのチェックリストと、入れ方を出す。
// 増えるときは、DEPENDENCIES に 1 つ足すだけ（画面・一括のコマンドは、この一覧から作る）。

export type OsName = 'windows' | 'linux';

export type Dependency = {
  id: string;
  /** 画面に出す名前 */
  name: string;
  /** 何のために使うか（無くても動くものは、そう書く） */
  description: string;
  /** コマンドの名前の候補（`--version` で確かめる。OS・配布によって名前が違うものは、並べる） */
  commands: readonly string[];
  /** 入れるコマンド（OS ごと） */
  install: Partial<Record<OsName, string>>;
  /** 入れ方の補足（OS ごと。省くと出さない） */
  note?: Partial<Record<OsName, string>>;
  /** 配布元 */
  github: string;
};

export const DEPENDENCIES: readonly Dependency[] = [
  {
    id: 'fd',
    name: 'fd',
    description: 'サブフォルダを探す検索を、速くします（無くても検索できます）。',
    commands: ['fd', 'fdfind'],
    install: { windows: 'winget install sharkdp.fd', linux: 'sudo apt install fd-find' },
    note: { linux: 'Debian・Ubuntu の例です。コマンド名は fdfind になります（どちらでも見つけます）。' },
    github: 'https://github.com/sharkdp/fd',
  },
];

/** 確かめた結果。found が null なら、入っていない */
export type DependencyStatus = { found: { command: string; version: string } | null } | 'checking' | 'error';

/** この OS で、この依存を入れるコマンド（この OS 向けが無ければ null） */
export function installCommand(dep: Dependency, os: OsName): string | null {
  return dep.install[os] ?? null;
}

/**
 * 入っていない依存を、まとめて入れるコマンド（1 行）。シェルの違い: Windows の PowerShell は `;` でつなぎ、ほかは `&&`。
 * この OS 向けのコマンドが無いものは、含めない。入れるものが無ければ null
 */
export function bulkInstallCommand(deps: readonly Dependency[], os: OsName): string | null {
  const cmds = deps.map((d) => installCommand(d, os)).filter((c): c is string => c !== null);
  return cmds.length === 0 ? null : cmds.join(os === 'windows' ? '; ' : ' && ');
}

/** OS の名前から、このアプリが知っている 2 つのどちらか（デスクトップ以外は null） */
export function desktopOs(name: string): OsName | null {
  return name === 'windows' || name === 'linux' ? name : null;
}

/** 入っているかを、Rust で確かめる */
export async function checkDependency(dep: Dependency): Promise<{ command: string; version: string } | null> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<{ command: string; version: string } | null>('fs_which', { candidates: [...dep.commands] });
}

/** 配布元のページを、既定のブラウザーで開く */
export async function openLink(url: string): Promise<void> {
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(url);
}
