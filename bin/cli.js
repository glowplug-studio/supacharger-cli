#!/usr/bin/env node

const { Command } = require('commander');
const registerExtensions = require('../commands/extensions');
const initialiseCommand = require('../commands/initialise');
const coreupdateCommand = require('../commands/coreupdate');
const doctorCommand = require('../commands/doctor');
const { version } = require('../package.json');

const program = new Command();

program
  .name('supacharger')
  .description('Developer CLI for managing Supacharger locally.')
  .version(version);

program
  .option('-s, --site <url>', 'Site URL')
  .action(() => {
    const options = program.opts();
    if (options.site) {
      console.log(`Hello world, your site is ${options.site}`);
    }
  });

registerExtensions(program);

program.command('install <id>').description('Retired legacy installer').action(() => {
  console.error('Use supacharger extension install <id> --source <bundle>. Legacy executable plugin installs are retired.');
  process.exitCode = 1;
});

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
  .action((target) => initialiseCommand(target ?? '.'));

program.parseAsync(process.argv).catch(error => { console.error(error.message); process.exitCode = 1; });

if (!process.argv.slice(2).length) {
  program.help();
}
