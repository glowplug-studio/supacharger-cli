const { exec } = require('child_process');

/**
 * Runs ESLint with simple-import-sort autofix on the specified file.
 * Assumes ESLint and eslint-plugin-simple-import-sort are installed and configured in the target project.
 * 
 * @param {string} filePath - The path to the file to be sorted.
 * @returns {Promise<string>} - Resolves with the command output on success.
 */
function runImportSortFix(filePath) {
  return new Promise((resolve, reject) => {
    const cmd = `npx eslint --fix "${filePath}"`;
    exec(cmd, (error, stdout, stderr) => {  
      if (error) {
        reject(stderr || error.message);
        return;
      }
      console.log('Imports sorted')
      resolve(stdout);
    });
  });
}

module.exports = runImportSortFix;
