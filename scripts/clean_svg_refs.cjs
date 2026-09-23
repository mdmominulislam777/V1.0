const fs = require("fs");
const path = require("path");

function updateFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, "utf8");
  
  // replace local SVG paths with PNG
  content = content.replace(/(['"](?:\.\/|\/)assets\/[^'"]+?)\.svg(['"])/g, '$1.png$2');
  content = content.replace(/highfy_logo_official\.svg/g, 'highfy_logo_official.png');
  content = content.replace(/highfy_logo\.svg/g, 'highfy_logo.png');
  content = content.replace(/image\/svg\+xml/g, 'image/png');
  
  fs.writeFileSync(filePath, content, "utf8");
  console.log("Cleaned SVG references in:", filePath);
}

["channels.json", "categories.json", "index.html", "script.js", "wwe.js", "sports.js", "server.ts", "config.js"].forEach(updateFile);
