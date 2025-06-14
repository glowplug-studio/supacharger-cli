const fs = require('fs').promises;
const path = require('path');

async function inserts(pluginName) {
  let hadErrors = false;
  let insertsApplied = 0;

  try {
    const installFilePath = path.resolve(
      process.cwd(),
      'src',
      'app',
      '(supacharger)',
      '(plugins)',
      pluginName,
      '_config',
      'install.js'
    );

    // Check if install.js exists
    try {
      await fs.access(installFilePath);
    } catch {
      console.error(`Error: No install.js found for plugin "${pluginName}" at ${installFilePath}`);
      return;
    }

    const installModules = require(installFilePath);

    if (!Array.isArray(installModules)) {
      console.error(`Error: Invalid install.js format in plugin "${pluginName}". Expected an array.`);
      return;
    }

    for (const installModule of installModules) {
      if (!installModule.targetFile || !installModule.inserts) {
        console.error(`Error: Invalid install instruction. Missing targetFile or inserts.`);
        hadErrors = true;
        continue;
      }

      const targetFilePath = path.resolve(process.cwd(), installModule.targetFile);

      // Read target file content
      let targetContent;
      try {
        targetContent = await fs.readFile(targetFilePath, 'utf8');
      } catch (err) {
        console.error(`Error: Failed to read target file ${targetFilePath}: ${err.message}`);
        hadErrors = true;
        continue;
      }

      const lines = targetContent.split('\n');
      let fileChanged = false;

      for (const [marker, codeToInsert] of Object.entries(installModule.inserts)) {
        // Match [MARKER] anywhere on the line, allowing spaces inside brackets
        const markerRegex = new RegExp(`\\[\\s*${marker}\\s*\\]`);
        const markerIndex = lines.findIndex(line => markerRegex.test(line));

        if (markerIndex === -1) {
          console.warn(`Warning: Marker [${marker}] not found in target file ${targetFilePath}`);
          hadErrors = true;
          continue;
        }

        // Check if the code is already present somewhere in the file to avoid duplicate insertions
        if (targetContent.includes(codeToInsert.trim())) {
          // Already inserted, skip
          continue;
        }

        // Insert blank line, code, blank line after marker line
        lines.splice(markerIndex + 1, 0, '', codeToInsert, '');
        fileChanged = true;
        insertsApplied++;
      }

      if (fileChanged) {
        const updatedContent = lines.join('\n');
        try {
          await fs.writeFile(targetFilePath, updatedContent, 'utf8');
          console.log(`Updated target file: ${targetFilePath}`);
        } catch (err) {
          console.error(`Error: Failed to write target file ${targetFilePath}: ${err.message}`);
          hadErrors = true;
        }
      }
    }

    if (!hadErrors) {
      console.log(`🎉 All inserts applied successfully for plugin "${pluginName}". Total inserts: ${insertsApplied}`);
    } else {
      console.log(`⚠️ Completed with some warnings or errors. Please review the messages above.`);
    }

  } catch (err) {
    console.error('Unexpected error in inserts function:', err);
  }
}

module.exports = inserts;
