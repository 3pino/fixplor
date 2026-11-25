import { describe, expect, it } from 'vitest';
import { bulkInstallCommand, DEPENDENCIES, desktopOs, installCommand, type Dependency } from './dependencies';

const dep = (id: string, install: Dependency['install']): Dependency => ({ id, name: id, description: '', commands: [id], install, github: `https://github.com/x/${id}` });

describe('依存の一覧', () => {
  it('fd が入っている（fd・fdfind の両方で確かめる）。どの依存にも配布元がある', () => {
    const fd = DEPENDENCIES.find((d) => d.id === 'fd')!;
    expect(fd.commands).toEqual(['fd', 'fdfind']);
    for (const d of DEPENDENCIES) expect(d.github).toMatch(/^https:\/\/github\.com\//);
  });
  it('入れるコマンドは、OS ごと。その OS 向けが無ければ null', () => {
    expect(installCommand(DEPENDENCIES[0], 'windows')).toBe('winget install sharkdp.fd');
    expect(installCommand(dep('a', { linux: 'x' }), 'windows')).toBeNull();
  });
  it('一括のコマンドは、Windows は ; で、ほかは && でつなぐ。この OS 向けの無いものは含めない。無ければ null', () => {
    const a = dep('a', { windows: 'winget install a', linux: 'sudo apt install a' });
    const b = dep('b', { windows: 'winget install b' });
    expect(bulkInstallCommand([a, b], 'windows')).toBe('winget install a; winget install b');
    expect(bulkInstallCommand([a, b], 'linux')).toBe('sudo apt install a');
    expect(bulkInstallCommand([b], 'linux')).toBeNull();
    expect(bulkInstallCommand([], 'windows')).toBeNull();
  });
  it('デスクトップの OS だけ受ける', () => {
    expect([desktopOs('windows'), desktopOs('linux'), desktopOs('android'), desktopOs('')]).toEqual(['windows', 'linux', null, null]);
  });
});
