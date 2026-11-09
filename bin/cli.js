#!/usr/bin/env node

const { Command } = require('commander');
const registerSkills = require('../commands/skills');
const registerExtensions = require('../commands/extensions');
const { runCoreDevelopment } = require('../commands/coredev');
const initialiseCommand = require('../commands/initialise');
const coreupdateCommand = require('../commands/coreupdate');
const doctorCommand = require('../commands/doctor');
const { printSelectedVersion } = require('../commands/version');
const { version } = require('../package.json');

const { checkCommandCompatibility } = require('../commands/common/core-compatibility');
const program = new Command();
program.hook('preAction', async (_program, command) => checkCommandCompatibility(command));

program
  .name('supacharger')
  .description('Developer CLI for managing Supacharger locally.')
  .version(version);


registerSkills(program);
registerExtensions(program);

program
  .command('which')
  .description(require('../messages/en.json').WhichCli.Description)
  .option('-c, --core', require('../messages/en.json').WhichCli.Core)
  .option('-e, --extension <name>', require('../messages/en.json').WhichCli.Extension)
  .option('--registry <location>', require('../messages/en.json').ExtensionsCli.Registry)
  .action(options => printSelectedVersion(options));

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
  .option('--ref <tag-or-commit>', 'Registered Core version, tag or commit to install')
  .option('--source <path>', 'Maintainer-only local Core checkout source')
  .action((options) => coreupdateCommand(options));

program
  .command('doctor')
  .description('Compare local managed files and configuration with installed and incoming Core')
  .option('--ref <tag-or-commit>', 'Registered Core version, tag or commit to inspect')
  .option('--source <path>', 'Local Core checkout or installable extension source')
  .option('--extension <name>', require('../messages/en.json').ExtensionsCli.DoctorOption)
  .option('--registry <location>', require('../messages/en.json').ExtensionsCli.Registry)
  .option('--root <path>', require('../messages/en.json').ExtensionsCli.Root)
  .action((options) => {
    if (options.extension) {
      if (options.ref) throw new Error(require('../messages/en.json').ExtensionsCli.DoctorRefUnsupported);
      return require('../commands/extensions/update.cjs').reportExtensionDoctor(options.extension, options);
    }
    return doctorCommand(options);
  });

program
  .command('init [target]')
  .description('Install the registered Supacharger Core release into a target directory (use "." for current directory)')
  .option('--namespace <code>', require('../messages/en.json').InitialiseCli.NamespaceOption)
  .option('--skip-skills', require('../messages/en.json').PublicSkillsCli.SkipDescription)
  .option('--registry <location>', require('../messages/en.json').ExtensionsCli.Registry)
  .action((target, options) => initialiseCommand(target ?? '.', options));

program.parseAsync(process.argv).catch(error => {
  if (error?.name === 'ExitPromptError' || error?.code === 'ABORT_ERR' || error?.code === 'USER_CANCELLED') {
    console.log(require('../messages/en.json').InitialiseCli.CancelledBeforeInstall);
    process.exitCode = 130;
    return;
  }
  console.error(typeof error?.message === 'string' && error.message.trim() ? error.message : require('../messages/en.json').InitialiseCli.UnexpectedFailure);
  process.exitCode = 1;
});

if (!process.argv.slice(2).length) {
  program.help();
}
