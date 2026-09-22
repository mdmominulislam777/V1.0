const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const assetsDir = path.join(rootDir, 'android', 'app', 'src', 'main', 'assets');

console.log('[SyncAndroidAssets] Target assets directory:', assetsDir);

if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

// 1. Copy dist output if exists
const distDir = path.join(rootDir, 'dist');
if (fs.existsSync(distDir)) {
  console.log('[SyncAndroidAssets] Copying dist/ files...');
  copyFolderRecursive(distDir, assetsDir);
}

// 2. Essential runtime data files
const jsonFiles = [
  'channels.json',
  'categories.json',
  'events.json',
  'notifications.json',
  'version.json'
];

jsonFiles.forEach(file => {
  const src = path.join(rootDir, file);
  const dest = path.join(assetsDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`[SyncAndroidAssets] Copied ${file}`);
  }
});

// 3. Essential runtime script and style files
const coreFiles = [
  'index.html',
  'script.js',
  'style.css',
  'sports.js',
  'cricket.js',
  'thesportsdb.js',
  'sofascore.js',
  'wwe.js',
  'tv-remote.js',
  'clear-cache.js',
  'security.js',
  'config.js',
  'highfy_logo_official.svg'
];

coreFiles.forEach(file => {
  const src = path.join(rootDir, file);
  const dest = path.join(assetsDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`[SyncAndroidAssets] Copied ${file}`);
  }
});

// 4. Copy sportsApi folder
const sportsApiSrc = path.join(rootDir, 'sportsApi');
const sportsApiDest = path.join(assetsDir, 'sportsApi');
if (fs.existsSync(sportsApiSrc)) {
  copyFolderRecursive(sportsApiSrc, sportsApiDest);
  console.log('[SyncAndroidAssets] Copied sportsApi directory');
}

// 5. Copy local assets folder (category-logos, channel-logos)
const localAssetsSrc = path.join(rootDir, 'assets');
const localAssetsDest = path.join(assetsDir, 'assets');
if (fs.existsSync(localAssetsSrc)) {
  copyFolderRecursive(localAssetsSrc, localAssetsDest);
  console.log('[SyncAndroidAssets] Copied assets directory (category-logos and channel-logos)');
}

// 6. Copy public folder assets
const publicDir = path.join(rootDir, 'public');
if (fs.existsSync(publicDir)) {
  copyFolderRecursive(publicDir, assetsDir);
  console.log('[SyncAndroidAssets] Copied public assets');
}

// 7. Copy src directory if exists
const srcDir = path.join(rootDir, 'src');
const srcDest = path.join(assetsDir, 'src');
if (fs.existsSync(srcDir)) {
  copyFolderRecursive(srcDir, srcDest);
  console.log('[SyncAndroidAssets] Copied src directory');
}

function copyFolderRecursive(source, target) {
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }

  const items = fs.readdirSync(source);
  for (const item of items) {
    if (item === 'server.cjs' || item === 'server.cjs.map') continue; // Skip node server bundle
    const srcPath = path.join(source, item);
    const destPath = path.join(target, item);
    const stat = fs.statSync(srcPath);

    if (stat.isDirectory()) {
      copyFolderRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

console.log('[SyncAndroidAssets] Asset synchronization complete!');
