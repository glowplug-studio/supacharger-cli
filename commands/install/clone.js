const fs = require("fs").promises;
const path = require("path");
const { exec } = require("child_process");

async function runCommand(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

async function clone(pluginName, githubUrl, force = false) {
  if (!pluginName || !githubUrl) {
    throw new Error("Both pluginName and githubUrl are required");
  }

  if (force) console.log("force install");

  const pluginsDir = path.resolve(
    process.cwd(),
    "src",
    "app",
    "(supacharger)",
    "(plugins)"
  );

  const pluginPath = path.join(pluginsDir, pluginName);

  // Convert absolute paths to relative paths from process.cwd()
  const relativePluginPath = path.relative(process.cwd(), pluginPath).replace(/\\/g, "/");
  const relativeGitModulesPath = path.relative(
    process.cwd(),
    path.resolve(
      process.cwd(),
      ".git",
      "modules",
      "src",
      "app",
      "(supacharger)",
      "(plugins)",
      pluginName
    )
  ).replace(/\\/g, "/");

  try {
    // Create plugins directory if it doesn't exist
    await fs.mkdir(pluginsDir, { recursive: true });

    // Check if plugin folder already exists
    let pluginExists = false;
    try {
      await fs.access(pluginPath);
      pluginExists = true;
    } catch {
      pluginExists = false;
    }

    if (pluginExists && force) {
      console.log(`Plugin directory exists, removing due to force option: ${relativePluginPath}`);

      // Deinit the module using relative path
      await runCommand(`git submodule deinit -f "${relativePluginPath}"`);
      console.log(`Deinitialized submodule`);

      // Remove submodule from git index recursively using relative path
      await runCommand(`git rm --cached -r "${relativePluginPath}"`);
      console.log(`Removed from git index`);

      // Remove the plugin directory from disk using relative path
      await runCommand(`rm -rf "${relativePluginPath}"`);
      console.log(`Removed plugin directory`);

      // Stage .gitmodules changes
      await runCommand(`git add .gitmodules`);
      console.log(`Staged .gitmodules`);

      // Remove the submodule git directory from .git/modules using relative path
      await runCommand(`rm -rf "${relativeGitModulesPath}"`);
      console.log(`Removed submodule git metadata`);

      console.log(`Existing submodule and git metadata removed: ${relativePluginPath}`);
    } else if (pluginExists && !force) {
      throw new Error(`Plugin directory already exists: ${relativePluginPath}`);
    }

    // Add submodule without -f flag (force handled by removal above)
    const forceFlag = force ? "--force" : "";

    const cmd = `git submodule add ${forceFlag} ${githubUrl} "${relativePluginPath}"`;
    await runCommand(cmd);

    console.log(
      `Successfully cloned ${pluginName} as a git submodule at ${relativePluginPath}`
    );
  } catch (err) {
    console.error(`Error cloning plugin: ${err.message}`);
    throw err;
  }
}

module.exports = clone;
