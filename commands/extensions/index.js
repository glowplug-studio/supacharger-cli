const { doctor } = require('./installer.cjs');
const { runExtension, normaliseId } = require('./update.cjs');
const copy = require('../../messages/en.json').ExtensionsCli;
async function askReview() {
  const readline = require('node:readline/promises').createInterface({ input: process.stdin, output: process.stdout });
  try { return /^y(es)?$/i.test((await readline.question(copy.ReviewQuestion)).trim()); }
  finally { readline.close(); }
}
module.exports = function registerExtensions(program) {
  const extension = program.command('extension').description(copy.Description + '. ' + copy.Downloads);
  for (const action of ['install', 'update']) {
    extension.command(`${action} <name>`).description(copy[action === 'install' ? 'Install' : 'Update'])
      .option('--source <path>', copy.Source).option('--baseline-source <path>', copy.BaselineSource)
      .option('--registry <path>', copy.Registry).option('--baseline-registry <path>', copy.BaselineRegistry)
      .option('--root <path>', copy.Root).option('--plan', copy.Plan)
      .action(async (name, options) => {
        if (process.stdin.isTTY && process.stdout.isTTY) options.askReview = askReview;
        const result = await runExtension(action, name, options);
        console.log(JSON.stringify(result, null, 2));
        if (result.reviewRequired) process.exitCode = 1;
      });
  }
  extension.command('doctor <name>').description(copy.Doctor).option('--root <path>', copy.Root)
    .action(async (name, options) => {
      const result = await doctor(normaliseId(name), options);
      console.log(JSON.stringify(result, null, 2));
      if (!result.healthy) process.exitCode = 1;
    });
};
