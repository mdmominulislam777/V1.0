const fs = require('fs');
let html = fs.readFileSync('/app/applet/index.html', 'utf-8');

const settingsItem = `
      <div class="drawer-item btn-open-settings-modal" id="drawer-settings">
        <div class="drawer-item-left">
          <i class="fa-solid fa-gear text-sky-400"></i>
          <span>App Settings</span>
        </div>
        <i class="fa-solid fa-chevron-right drawer-item-arrow"></i>
      </div>
      <div class="drawer-item" id="drawer-admin-panel" onclick="document.getElementById('modal-admin-pin').classList.add('active'); document.getElementById('input-admin-pin').focus();">
        <div class="drawer-item-left">
          <i class="fa-solid fa-user-shield text-amber-400"></i>
          <span>Admin Panel</span>
        </div>
        <i class="fa-solid fa-chevron-right drawer-item-arrow"></i>
      </div>
`;

if (!html.includes('id="drawer-settings"')) {
  html = html.replace('      <div class="drawer-item" id="drawer-clear-data">', settingsItem + '      <div class="drawer-item" id="drawer-clear-data">');
  fs.writeFileSync('/app/applet/index.html', html, 'utf-8');
  console.log("Added Settings and Admin Panel to drawer.");
}
