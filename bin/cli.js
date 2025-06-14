#!/usr/bin/env node

const { Command } = require('commander');
const path = require('path');
const fs = require('fs').promises;
const installCommand = require('../commands/install');
const uninstallCommand = require('../commands/uninstall');
const enableCommand = require('../commands/enable');
const disableCommand = require('../commands/disable');
const initialiseCommand = require('../commands/initialise');
const coreupdateCommand = require('../commands/coreupdate');

const program = new Command();

async function isNextRoot(dir = process.cwd()) {
  try {
    const packageJsonPath = path.join(dir, 'package.json');
    const nextConfigPath = path.join(dir, 'next.config.js');

    // Check package.json exists
    await fs.access(packageJsonPath);

    // Read package.json and check for next dependency
    const packageJsonRaw = await fs.readFile(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageJsonRaw);
    const deps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };
    if (!deps || !deps.next) return false;

    // Check next.config.js exists
    await fs.access(nextConfigPath);

    return true;
  } catch {
    return false;
  }
}

async function checkNextRootOrExit() {
  const isRoot = await isNextRoot();
  if (!isRoot) {
    console.error('Error: This command must be run from the root of a Next.js project.');
    process.exit(1);
  }
}

program
  .name('supacharger')
  .description('Developer CLI for managing Supacharger locally.')
  .version('1.0.001');

program
  .option('-s, --site <url>', 'Site URL')
  .action(() => {
    const options = program.opts();
    if (options.site) {
      console.log(`Hello world, your site is ${options.site}`);
    }
  });

program
  .command('install <pluginName>')
  .description('Install a plugin by name')
  .option('-f, --force', 'Force reinstall by removing existing plugin directory')
  .action(async (pluginName, cmdObj) => {
    await checkNextRootOrExit();
    const force = cmdObj.force === true;
    await installCommand.run(pluginName, { force });
  });

program
  .command('dis <moduleName>')
  .description('Disable plugin by setting PLUGIN_ENABLED to false in config.js and clear plugin registry file')
  .action(async (moduleName) => {
    await checkNextRootOrExit();

    try {
      const pluginsBaseDir = path.resolve(process.cwd(), 'src', 'app', 'supacharger', 'plugins');

      try {
        const stat = await fs.stat(pluginsBaseDir);
        if (!stat.isDirectory()) {
          console.error(`Error: Expected plugins directory at ${pluginsBaseDir} is not a directory.`);
          console.error('Please run this command from the project root.');
          process.exit(1);
        }
      } catch {
        console.error(`Error: Plugins directory not found at ${pluginsBaseDir}.`);
        console.error('Please run this command from the project root.');
        process.exit(1);
      }

      const moduleDir = path.join(pluginsBaseDir, moduleName);

      try {
        const stat = await fs.stat(moduleDir);
        if (!stat.isDirectory()) {
          console.error(`Error: Module directory "${moduleName}" exists but is not a directory.`);
          process.exit(1);
        }
      } catch {
        console.error(`Error: Module directory "${moduleName}" not found at ${moduleDir}`);
        process.exit(1);
      }

      const configPath = path.join(moduleDir, 'config.js');

      let configContent;
      try {
        configContent = await fs.readFile(configPath, 'utf8');
      } catch {
        console.error(`Error: config.js not found in module directory "${moduleName}".`);
        process.exit(1);
      }

      const updatedConfig = configContent.replace(
        /PLUGIN_ENABLED\s*:\s*(true|false),?/,
        'PLUGIN_ENABLED: false,'
      );

      if (updatedConfig === configContent) {
        console.warn('Warning: PLUGIN_ENABLED property not found or already false.');
      } else {
        await fs.writeFile(configPath, updatedConfig, 'utf8');
        console.log(`Plugin "${moduleName}" disabled successfully.`);
      }

      const pluginRegistryPath = path.resolve(
        process.cwd(),
        'src',
        'app',
        'supacharger',
        'plugins',
        '_registry',
        'plugin-registry.ts'
      );

      try {
        const stat = await fs.stat(pluginRegistryPath);
        if (!stat.isFile()) {
          console.error(`Error: Plugin registry file found at ${pluginRegistryPath} but is not a file.`);
          process.exit(1);
        }
      } catch {
        console.error(`Error: Plugin registry file not found at ${pluginRegistryPath}.`);
        process.exit(1);
      }

      await fs.writeFile(pluginRegistryPath, '', 'utf8');
      console.log(`Plugin registry file cleared at ${pluginRegistryPath}.`);

    } catch (err) {
      console.error('Unexpected error:', err);
      process.exit(1);
    }
  });

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.help();
}
