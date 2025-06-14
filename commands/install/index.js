const clone = require('./clone');
const inserts = require('./inserts');
const https = require('https');

async function fetchModuleInfo(pluginName) {
  const url = 'https://raw.githubusercontent.com/glowplug-studio/supacharger-cli-module-register/refs/heads/main/manifest.js';

  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to fetch manifest: Status code ${res.statusCode}`));
        res.resume();
        return;
      }

      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const modules = json.modules || [];
          for (const module of modules) {
            if (module.name === pluginName) {
              return resolve(module.github_repo_url || null);
            }
          }
          resolve(null);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

/**
 * Run the install process for a plugin.
 * 
 * @param {string} pluginName - The name of the plugin to install.
 * @param {object} [options] - Optional options object.
 * @param {boolean} [options.force=false] - Whether to force cloning (remove existing submodule if present).
 */
async function run(pluginName, options = {}) {
  if (!pluginName) {
    console.error('Error: No plugin name provided.');
    process.exit(1);
  }

  const force = options.force === true;

  try {
    const githubRepoUrl = await fetchModuleInfo(pluginName);
    if (!githubRepoUrl) {
      console.error(`Error: Module "${pluginName}" not found in registry.`);
      process.exit(1);
    }
    console.log(`Found module "${pluginName}" with repo: ${githubRepoUrl}`);

    // Clone the repo as a submodule into the plugins directory, passing force flag
    await clone(pluginName, githubRepoUrl, force).catch(err => {
      console.error('Error during cloning:', err.message);
      process.exit(1);
    });

    // Run inserts only if clone succeeded
    await inserts(pluginName).catch(err => {
      console.error('Error during inserts:', err.message);
      process.exit(1);
    });

  } catch (err) {
    console.error('Error running install command:', err);
    process.exit(1);
  }
}

module.exports = {
  inserts,
  run,
};
