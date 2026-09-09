const { install, doctor } = require('./installer.cjs');

module.exports = function registerExtensions(program) {
  const extension = program.command('extension').description('Install reviewed local extension bundles; token downloads are deferred');
  const run = action => async (id, options) => {
    try {
      const result = await action(id, options);
      console.log(JSON.stringify(result, null, 2));
      if (result.healthy === false) process.exitCode = 1;
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  };
  extension.command('install <id>')
    .requiredOption('--source <path>', 'Reviewed local bundle directory')
    .option('--plan', 'Validate and show writes without installing')
    .action(run(install));
  extension.command('doctor <id>').description('Check installed file hashes, not deployment or credentials').action(run(doctor));
};
