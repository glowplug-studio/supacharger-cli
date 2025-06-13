#!/usr/bin/env node

const { Command } = require('commander');
const program = new Command();

program
  .name('supacharger')
  .description('A simple CLI that greets your site')
  .version('1.0.0');

program
  .option('-s, --site <url>', 'Site URL')
  .action(() => {
    const options = program.opts();
    if (options.site) {
      console.log(`Hello world, your site is ${options.site}`);
    } else {
      console.log('Please provide a site URL with -s or --site option.');
    }
  });

program.parse(process.argv);
