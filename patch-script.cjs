const fs = require('fs');
let script = fs.readFileSync('/app/applet/script.js', 'utf-8');

const targetStr = `    // Secret Tap on App Version (3 taps in 3 seconds unlocks Admin PIN modal)
    let secretTapCount = 0;
    let secretTapTimer = null;

    function handleSecretVersionTap(e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      secretTapCount++;
      clearTimeout(secretTapTimer);

      if (secretTapCount >= 3) {
        secretTapCount = 0;
        closeDrawer();
        closeModal('modal-about');
        openAdminPinModal();
        showToast('🔐 Admin PIN Verification Required');
      } else {
        const remaining = 3 - secretTapCount;
        if (remaining === 1) {
          showToast(\`🔒 আর \${remaining} বার ক্লিক করুন (Admin Mode)\`);
        }
        secretTapTimer = setTimeout(() => {
          secretTapCount = 0;
        }, 3000);
      }
    }`;

const replaceStr = `    // Secret Tap on App Version (7 taps in 3 seconds unlocks Admin PIN modal)
    let secretTapCount = 0;
    let secretTapTimer = null;

    function handleSecretVersionTap(e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      secretTapCount++;
      clearTimeout(secretTapTimer);

      if (secretTapCount >= 7) {
        secretTapCount = 0;
        closeDrawer();
        closeModal('modal-about');
        openAdminPinModal();
        showToast('🔐 Admin PIN Verification Required');
      } else {
        const remaining = 7 - secretTapCount;
        if (remaining <= 3) {
          showToast(\`🔒 আর \${remaining} বার ক্লিক করুন (Admin Mode)\`);
        }
        secretTapTimer = setTimeout(() => {
          secretTapCount = 0;
        }, 3000);
      }
    }`;

if (script.includes('// Secret Tap on App Version (3 taps in 3 seconds unlocks Admin PIN modal)')) {
  script = script.replace(targetStr, replaceStr);
  fs.writeFileSync('/app/applet/script.js', script, 'utf-8');
  console.log("Updated tap count from 3 to 7.");
} else {
  console.log("Target string not found in script.js.");
}
