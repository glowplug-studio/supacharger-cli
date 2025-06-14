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
  .action((pluginName) => {
    installCommand.run(pluginName);
  });

program
  .command('dis <moduleName>')
  .description('Disable plugin by setting PLUGIN_ENABLED to false in config.js and clear plugin registry file')
  .action(async (moduleName) => {
    try {
      // Base plugins directory
      const pluginsBaseDir = path.resolve(process.cwd(), 'src', 'app', 'supacharger', 'plugins');

      // Check if plugins base directory exists
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

      // Module directory path
      const moduleDir = path.join(pluginsBaseDir, moduleName);

      // Check if module directory exists
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

      // Path to config.js inside module directory
      const configPath = path.join(moduleDir, 'config.js');

      // Read config.js
      let configContent;
      try {
        configContent = await fs.readFile(configPath, 'utf8');
      } catch {
        console.error(`Error: config.js not found in module directory "${moduleName}".`);
        process.exit(1);
      }

      // Replace PLUGIN_ENABLED to false
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

      // Path to plugin registry file to clear
      const pluginRegistryPath = path.resolve(
        process.cwd(),
        'src',
        'app',
        'supacharger',
        'plugins',
        '_registry',
        'plugin-registry.ts'
      );

      // Check if plugin registry file exists
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

      // Clear the plugin registry file by writing empty string
      await fs.writeFile(pluginRegistryPath, '', 'utf8');
      console.log(`Plugin registry file cleared at ${pluginRegistryPath}.`);

    } catch (err) {
      console.error('Unexpected error:', err);
      process.exit(1);
    }
  });

program.parse(process.argv);

// Show help if no arguments
if (!process.argv.slice(2).length) {
  program.help();
}
