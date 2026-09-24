const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

const jsonFiles = {
  CATEGORIES_DATA: 'categories.json',
  CHANNELS_DATA: 'channels.json',
  NOTIFICATIONS_DATA: 'notifications.json',
  EVENTS_DATA: 'events.json'
};

let output = `/**
 * HIGHFY TV - Bundled Local Data Assets (Auto-generated)
 * Generated at: ${new Date().toISOString()}
 */

(() => {
  'use strict';
`;

for (const [key, fileName] of Object.entries(jsonFiles)) {
  const filePath = path.join(rootDir, fileName);
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      // Validate JSON
      const parsed = JSON.parse(content);
      output += `\n  window.${key} = ${JSON.stringify(parsed, null, 2)};\n`;
      console.log(`[Bundling] Successfully bundled ${fileName} as window.${key}`);
    } catch (e) {
      console.error(`[Bundling] Error parsing ${fileName}:`, e.message);
      output += `\n  window.${key} = [];\n`;
    }
  } else {
    console.warn(`[Bundling] Warning: ${fileName} does not exist, defaulting to empty array.`);
    output += `\n  window.${key} = [];\n`;
  }
}

output += `\n})();\n`;

const targetFile = path.join(rootDir, 'bundled_data.js');
fs.writeFileSync(targetFile, output, 'utf8');
console.log(`[Bundling] Generated ${targetFile} successfully.`);
