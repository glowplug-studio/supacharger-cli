#!/usr/bin/env node

import { Command } from 'commander';
import english from '../messages/en.json';
import { reportExtensionDoctor } from '../commands/extensions/update.cjs';
import registerSkills = require('../commands/skills');
import registerExtensions = require('../commands/extensions');
import { runCoreDevelopment } from '../commands/coredev';
import initialiseCommand = require('../commands/initialise');
import coreupdateCommand = require('../commands/coreupdate');
import doctorCommand = require('../commands/doctor');
import { printSelectedVersion } from '../commands/version';
import { version } from '../package.json';
import { runNuke } from '../commands/nuke';

import { checkCommandCompatibility } from '../commands/common/core-compatibility';
const program = new Command();
program.hook('preAction', async (_program, command) => checkCommandCompatibility(command));

program
  .name('supacharger')
  .description('Developer CLI for managing Supacharger locally.')
  .version(version);


registerSkills(program);
registerExtensions(program);

program
  .command('nuke')
  .description(english.NukeCli.Description)
  .requiredOption('-u, --user <uuid>', english.NukeCli.UserOption)
  .option('--url <origin>', english.NukeCli.UrlOption)
  .option('--confirm <uuid>', english.NukeCli.ConfirmOption)
  .action(async (options: Parameters<typeof runNuke>[0]) => { await runNuke(options); });

program
  .command('which')
  .description(english.WhichCli.Description)
  .option('-c, --core', english.WhichCli.Core)
  .option('-e, --extension <name>', english.WhichCli.Extension)
  .option('--registry <location>', english.ExtensionsCli.Registry)
  .action(async (options: Parameters<typeof printSelectedVersion>[0]) => { await printSelectedVersion(options); });

const coredev = program
  .command('coredev')
  .description(english.CoreDevelopmentCli.CommandDescription);

coredev.command('install')
  .description(english.CoreDevelopmentCli.InstallDescription)
  .action(async () => { await runCoreDevelopment('install'); });

coredev.command('update')
  .description(english.CoreDevelopmentCli.UpdateDescription)
  .action(async () => { await runCoreDevelopment('update'); });

program
  .command('coreupdate')
  .description('Update from an immutable Supacharger Core ref and check for local conflicts')
  .option('--plan', 'Show managed writes, removals, dependencies and migrations without changing the project')
  .option('--ref <tag-or-commit>', 'Registered Core version, tag or commit to install')
  .option('--source <path>', 'Maintainer-only local Core checkout source')
  .action((options: Parameters<typeof coreupdateCommand>[0]) => coreupdateCommand(options));

program
  .command('doctor')
  .description('Compare local managed files and configuration with installed and incoming Core')
  .option('--ref <tag-or-commit>', 'Registered Core version, tag or commit to inspect')
  .option('--source <path>', 'Local Core checkout or installable extension source')
  .option('--extension <name>', english.ExtensionsCli.DoctorOption)
  .option('--registry <location>', english.ExtensionsCli.Registry)
  .option('--root <path>', english.ExtensionsCli.Root)
  .action(async (options: Parameters<typeof doctorCommand>[0] & { extension?: string; registry?: string; root?: string }) => {
    if (options.extension) {
      if (options.ref) throw new Error(english.ExtensionsCli.DoctorRefUnsupported);
      await reportExtensionDoctor(options.extension, options);
      return;
    }
    await doctorCommand(options);
  });

program
  .command('init [target]')
  .description('Install the registered Supacharger Core release into a target directory (use "." for current directory)')
  .option('--namespace <code>', english.InitialiseCli.NamespaceOption)
  .option('--skip-skills', english.PublicSkillsCli.SkipDescription)
  .option('--registry <location>', english.ExtensionsCli.Registry)
  .action((target: string | undefined, options: Parameters<typeof initialiseCommand>[1]) => initialiseCommand(target ?? '.', options));

program.parseAsync(process.argv).catch(error => {
  if (error?.name === 'ExitPromptError' || error?.code === 'ABORT_ERR' || error?.code === 'USER_CANCELLED') {
    console.log(english.InitialiseCli.CancelledBeforeInstall);
    process.exitCode = 130;
    return;
  }
  console.error(typeof error?.message === 'string' && error.message.trim() ? error.message : english.InitialiseCli.UnexpectedFailure);
  process.exitCode = 1;
});

if (!process.argv.slice(2).length) {
  program.help();
}
