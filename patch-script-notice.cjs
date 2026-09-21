const fs = require('fs');
let script = fs.readFileSync('/app/applet/script.js', 'utf-8');

// Replace 'drawer-notice' id with 'btn-header-notice'
script = script.replace(/const drawerNotice = document\.getElementById\('drawer-notice'\);/g, "const drawerNotice = document.getElementById('btn-header-notice');");
script = script.replace(/const drawerNoticeBtn = document\.getElementById\('drawer-notice'\);/g, "const drawerNoticeBtn = document.getElementById('btn-header-notice');");

// Replace 'drawer-notif-badge' with 'header-notif-badge'
script = script.replace(/drawer-notif-badge/g, 'header-notif-badge');

// Since we have a tiny dot, maybe we shouldn't show "X New", just "X"
script = script.replace(/drawerBadge\.textContent = \`\$\{unreadCount\} New\`;/g, 'drawerBadge.textContent = unreadCount;');
// Let's also ensure drawerBadge is displayed properly flex or inline-flex instead of inline-block, though inline-block or flex might not matter if flex was applied via tailwind. Wait, we used `style="display: none;"` initially. We can let script.js use 'flex' instead of 'inline-block'.
script = script.replace(/drawerBadge\.style\.display = 'inline-block';/g, "drawerBadge.style.display = 'flex';");

fs.writeFileSync('/app/applet/script.js', script, 'utf-8');
console.log("Updated script.js");
