const fs = require('fs');
let html = fs.readFileSync('/app/applet/index.html', 'utf-8');
if (!html.includes('id="btn-open-admin-pin-dialog"')) {
  const settingsBtnHtml = `
      <div class="flex items-center justify-between py-2 border-t border-slate-800">
        <div>
          <span class="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <i class="fa-solid fa-user-shield text-amber-400"></i> Admin Management Panel
          </span>
          <p class="text-[10px] text-slate-400">Manage channels, events, and custom images.</p>
        </div>
        <button id="btn-open-admin-pin-dialog" class="py-1 px-3 rounded-lg bg-amber-500/20 text-amber-400 text-[11px] font-bold border border-amber-500/30 hover:bg-amber-500 hover:text-slate-900 transition">
          Open Admin
        </button>
      </div>`;
  html = html.replace('<!-- ======================================================================\n       18. Scoreboard Modal', settingsBtnHtml + '\n  <!-- ======================================================================\n       18. Scoreboard Modal');
  fs.writeFileSync('/app/applet/index.html', html, 'utf-8');
  console.log('Admin button added to Settings Modal.');
} else {
  console.log('Admin button already exists.');
}
