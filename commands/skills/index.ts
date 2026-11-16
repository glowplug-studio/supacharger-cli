import type { Command } from 'commander';
import { runSkills, message } from './installer.cjs';
function registerSkills(program: Command) {
  const skills = program.command('skills').description(message('CommandDescription'));
  for (const operation of ['install', 'update']) {
    skills.command(`${operation} [ids...]`)
      .description(operation === 'install' ? message('InstallDescription') : message('UpdateDescription'))
      .option('--ref <tag-or-commit>', message('RefDescription'), 'main')
      .option('--source <path>', message('SourceDescription'))
      .action(async (ids: string[], options: Parameters<typeof runSkills>[1]) => { await runSkills(ids, { ...options, update: operation === 'update' }); });
  }
};

export = registerSkills;
