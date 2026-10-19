const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');

if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

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

// Sync runtime JSON files to public/ so Vite automatically copies them to dist/
const filesToSyncToPublic = [
  'channels.json',
  'categories.json',
  'notifications.json',
  'events.json',
  'version.json'
];

filesToSyncToPublic.forEach(file => {
  const src = path.join(rootDir, file);
  const dest = path.join(publicDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`[Bundling] Mirrored ${file} to public/${file}`);
  }
});

// Recursively copy data/ directory to public/data/
const dataSrc = path.join(rootDir, 'data');
const dataDest = path.join(publicDir, 'data');

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

if (fs.existsSync(dataSrc)) {
  copyDirRecursive(dataSrc, dataDest);
  console.log(`[Bundling] Mirrored data/ to public/data/`);
}
