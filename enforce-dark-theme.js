const fs = require('fs');
let css = fs.readFileSync('style.css', 'utf-8');
// Find the dark theme block
const darkBlockRegex = /body\.dark-theme,\s*\[data-theme="dark"\]\s*\{([\s\S]*?)\}/;
const match = css.match(darkBlockRegex);
if (match) {
  const darkVars = match[1];
  // Replace :root { ... } with :root { ... (dark vars) }
  css = css.replace(/:root\s*\{([\s\S]*?)\}/, ':root {\n' + darkVars + '\n}');
  
  // Now replace all body.dark-theme prefixes with just body or remove them if they're redundant
  css = css.replace(/body\.dark-theme/g, 'body');
  
  fs.writeFileSync('style.css', css, 'utf-8');
}
