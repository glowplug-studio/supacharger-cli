#!/usr/bin/env node

const { Command } = require('commander');
const registerSkills = require('../commands/skills');
const registerExtensions = require('../commands/extensions');
const { runCoreDevelopment } = require('../commands/coredev');
const initialiseCommand = require('../commands/initialise');
const coreupdateCommand = require('../commands/coreupdate');
const doctorCommand = require('../commands/doctor');
const { printCoreVersion } = require('../commands/version');
const { version } = require('../package.json');

const program = new Command();

program
  .name('supacharger')
  .description('Developer CLI for managing Supacharger locally.')
  .version(version);


registerSkills(program);
registerExtensions(program);

program
  .command('version')
  .description(require('../messages/en.json').VersionCli.Description)
  .action(() => printCoreVersion());

const coredev = program
  .command('coredev')
  .description(require('../messages/en.json').CoreDevelopmentCli.CommandDescription);

coredev.command('install')
  .description(require('../messages/en.json').CoreDevelopmentCli.InstallDescription)
  .action(() => runCoreDevelopment('install'));

coredev.command('update')
  .description(require('../messages/en.json').CoreDevelopmentCli.UpdateDescription)
  .action(() => runCoreDevelopment('update'));

program
  .command('coreupdate')
  .description('Update from an immutable Supacharger Core ref and check for local conflicts')
  .option('--plan', 'Show managed writes, removals, dependencies and migrations without changing the project')
  .option('--ref <tag-or-commit>', 'Core tag, branch, or commit to install', 'main')
  .option('--source <path>', 'Maintainer-only local Core checkout source')
  .action((options) => coreupdateCommand(options));

program
  .command('doctor')
  .description('Compare local managed files and configuration with installed and incoming Core')
  .option('--ref <tag-or-commit>', 'Core tag, branch, or commit to inspect', 'main')
  .option('--source <path>', 'Maintainer-only local Core checkout source')
  .action((options) => doctorCommand(options));

program
  .command('init [target]')
  .description('Install the registered Supacharger Core release into a target directory (use "." for current directory)')
  .option('--skip-skills', require('../messages/en.json').PublicSkillsCli.SkipDescription)
  .option('--registry <location>', require('../messages/en.json').ExtensionsCli.Registry)
  .action((target, options) => initialiseCommand(target ?? '.', options));

program.parseAsync(process.argv).catch(error => { console.error(error.message); process.exitCode = 1; });

if (!process.argv.slice(2).length) {
  program.help();
}
