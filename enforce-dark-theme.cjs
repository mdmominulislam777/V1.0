const fs = require('fs');
let css = fs.readFileSync('style.css', 'utf-8');
const darkBlockRegex = /body\.dark-theme,\s*\[data-theme="dark"\]\s*\{([\s\S]*?)\}/;
const match = css.match(darkBlockRegex);
if (match) {
  const darkVars = match[1];
  css = css.replace(/:root\s*\{([\s\S]*?)\}/, ':root {\n' + darkVars + '\n}');
  css = css.replace(/body\.dark-theme/g, 'body');
  fs.writeFileSync('style.css', css, 'utf-8');
  console.log("CSS updated!");
}
