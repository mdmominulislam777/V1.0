const fs = require('fs');
let html = fs.readFileSync('/app/applet/index.html', 'utf-8');

const regex = /<div class="drawer-item" id="drawer-admin-panel"[\s\S]*?<\/div>\s*<\/div>/;

if (html.includes('id="drawer-admin-panel"')) {
  // It spans from <div ... id="drawer-admin-panel"> to the closing </div> of that item.
  const targetStr = `      <div class="drawer-item" id="drawer-admin-panel" onclick="document.getElementById('modal-admin-pin').classList.add('active'); document.getElementById('input-admin-pin').focus();">
        <div class="drawer-item-left">
          <i class="fa-solid fa-user-shield text-amber-400"></i>
          <span>Admin Panel</span>
        </div>
        <i class="fa-solid fa-chevron-right drawer-item-arrow"></i>
      </div>`;
  html = html.replace(targetStr, '');
  
  // Clean up any double blank lines
  html = html.replace(/\n\n\n/g, '\n\n');
  fs.writeFileSync('/app/applet/index.html', html, 'utf-8');
  console.log("Removed Admin Panel button from index.html.");
} else {
  console.log("Admin Panel button not found in index.html.");
}
