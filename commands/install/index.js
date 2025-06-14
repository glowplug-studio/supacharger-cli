const path = require('path');
const https = require('https');
const inserts = require('./inserts');

async function fetchModuleInfo(pluginName) {
  const url = 'https://get.supacharger.dev/wp-json/custom/v1/module-register';

  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const modules = json.modules || [];
          for (const module of modules) {
            if (pluginName in module) {
              // Found the plugin, get the github repo URL
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

async function run(pluginName) {
  if (!pluginName) {
    console.error('Error: No plugin name provided.');
    return;
  }

  let githubRepoUrl = null;

  try {
    githubRepoUrl = await fetchModuleInfo(pluginName);
    if (!githubRepoUrl) {
      console.error(`Error: Module "${pluginName}" not found in registry.`);
      return;
    }
    console.log(`Found module "${pluginName}" with repo: ${githubRepoUrl}`);
    // TODO: Use githubRepoUrl in the next function
    await inserts(pluginName);
  } catch (err) {
    console.error('Error running install command:', err);
  }
}

module.exports = {
  inserts,
  run,
};
