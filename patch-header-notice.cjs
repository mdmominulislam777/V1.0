const fs = require('fs');
let html = fs.readFileSync('/app/applet/index.html', 'utf-8');

// 1. Remove drawer notice
const drawerNoticeRegex = /<div class="drawer-item" id="drawer-notice">[\s\S]*?<\/div>\s*<\/div>/;
html = html.replace(drawerNoticeRegex, '');

// 2. Add header button
const headerActionsStart = '<div class="header-actions">';
const newHeaderBtn = `
        <button id="btn-header-notice" class="btn-header-icon relative" title="Notifications">
          <i class="fa-solid fa-bell"></i>
          <span id="header-notif-badge" class="absolute top-[6px] right-[6px] w-[14px] h-[14px] rounded-full bg-rose-600 text-[8px] font-bold text-white flex items-center justify-center hidden border border-[#0f172a]" style="display: none;">0</span>
        </button>`;
html = html.replace(headerActionsStart, headerActionsStart + newHeaderBtn);

fs.writeFileSync('/app/applet/index.html', html, 'utf-8');
console.log("Updated index.html");
