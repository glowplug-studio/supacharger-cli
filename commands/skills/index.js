const { runSkills, message } = require('./installer.cjs');
module.exports = function registerSkills(program) {
  const skills = program.command('skills').description(message('CommandDescription'));
  for (const operation of ['install', 'update']) {
    skills.command(`${operation} [ids...]`)
      .description(operation === 'install' ? message('InstallDescription') : message('UpdateDescription'))
      .option('--ref <tag-or-commit>', message('RefDescription'), 'main')
      .option('--source <path>', message('SourceDescription'))
      .action((ids, options) => runSkills(ids, { ...options, update: operation === 'update' }));
  }
};
