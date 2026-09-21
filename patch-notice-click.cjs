const fs = require('fs');
let script = fs.readFileSync('/app/applet/script.js', 'utf-8');

// Remove the duplicate block from setupDrawerAndModals (around line 5840)
const blockToRemove = `    const drawerNotice = document.getElementById('btn-header-notice');
    if (drawerNotice) {
      drawerNotice.addEventListener('click', () => {
        closeDrawer();
        openModal('modal-notice');
      });
    }`;
script = script.replace(blockToRemove, '');

// If it was already using 'drawer-notice' somehow, try to remove that just in case
const oldBlockToRemove = `    const drawerNotice = document.getElementById('drawer-notice');
    if (drawerNotice) {
      drawerNotice.addEventListener('click', () => {
        closeDrawer();
        openModal('modal-notice');
      });
    }`;
script = script.replace(oldBlockToRemove, '');

// In setupNotificationsUI, add a console.log and make it robust
const setupBlock = `    const drawerNoticeBtn = document.getElementById('btn-header-notice');
    if (drawerNoticeBtn) {
      drawerNoticeBtn.addEventListener('click', () => {
        const sideDrawer = document.getElementById('side-drawer');
        const drawerOverlay = document.getElementById('drawer-overlay');
        if (sideDrawer) sideDrawer.classList.remove('active');
        if (drawerOverlay) drawerOverlay.classList.remove('active');
        openModal('modal-notice');
      });
    }`;
const newSetupBlock = `    const drawerNoticeBtn = document.getElementById('btn-header-notice');
    if (drawerNoticeBtn) {
      drawerNoticeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log("Notice header button clicked");
        const sideDrawer = document.getElementById('side-drawer');
        const drawerOverlay = document.getElementById('drawer-overlay');
        if (sideDrawer) sideDrawer.classList.remove('active');
        if (drawerOverlay) drawerOverlay.classList.remove('active');
        openModal('modal-notice');
      });
    }`;
script = script.replace(setupBlock, newSetupBlock);

fs.writeFileSync('/app/applet/script.js', script, 'utf-8');
console.log("Patched click handlers.");
