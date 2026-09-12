const english = require('../../messages/en.json').GitHubCli;

function printGitHubDevelopmentWarning() {
  console.warn(`\x1b[33m${english.DevelopmentWarning}\x1b[0m`);
}

module.exports = { printGitHubDevelopmentWarning };
