#!/usr/bin/env node

const { Command } = require('commander');
const registerSkills = require('../commands/skills');
const { runCoreDevelopment } = require('../commands/coredev');
const initialiseCommand = require('../commands/initialise');
const coreupdateCommand = require('../commands/coreupdate');
const doctorCommand = require('../commands/doctor');
const { version } = require('../package.json');

const program = new Command();

program
  .name('supacharger')
  .description('Developer CLI for managing Supacharger locally.')
  .version(version);


registerSkills(program);

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
  .option('--plan', 'Show managed writes, removals, dependencies, migrations, and checks without changing the project')
  .option('--ref <tag-or-commit>', 'Core tag, branch, or commit to install', 'main')
  .option('--source <path>', 'Maintainer-only local Core checkout source')
  .action((options) => coreupdateCommand(options));

program
  .command('doctor')
  .description('Check Supabase Proxy, Auth Hook, claims migration, environment, and dependency alignment')
  .action(() => doctorCommand());

program
  .command('init [target]')
  .description('Clone the latest Supacharger starter into a target directory (use "." for current directory)')
  .option('--skip-skills', require('../messages/en.json').PublicSkillsCli.SkipDescription)
  .action((target, options) => initialiseCommand(target ?? '.', options));

program.parseAsync(process.argv).catch(error => { console.error(error.message); process.exitCode = 1; });

if (!process.argv.slice(2).length) {
  program.help();
}
