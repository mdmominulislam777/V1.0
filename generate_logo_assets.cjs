const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function run() {
  const transparentSource = 'src/assets/images/highfy_tv_logo_transparent.png';
  const cleanSource = 'src/assets/images/highfy_tv_logo_clean.png';

  if (!fs.existsSync(transparentSource) || !fs.existsSync(cleanSource)) {
    console.error('Source logos not found!');
    return;
  }

  console.log('[Logo Generator] Generating official high-res assets...');

  // 1. Transparent PNG (1024x1024)
  const transparent1024 = await sharp(transparentSource)
    .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ quality: 100 })
    .toBuffer();

  // 2. Dark Background App Icon (1024x1024)
  const appIcon1024 = await sharp(cleanSource)
    .resize(1024, 1024, { fit: 'contain', background: { r: 9, g: 13, b: 22, alpha: 1 } })
    .png({ quality: 100 })
    .toBuffer();

  // 3. Transparent Targets (Splash screen, drawer menu, brand logos)
  const transparentTargets = [
    'assets/splash-screen-logo/splash_logo.png',
    'public/assets/splash-screen-logo/splash_logo.png',
    'src/assets/splash-screen-logo/splash_logo.png',
    'assets/drawer-menu-logo/drawer_logo.png',
    'public/assets/drawer-menu-logo/drawer_logo.png',
    'src/assets/drawer-menu-logo/drawer_logo.png',
    'public/highfy_logo.png',
    'public/highfy_logo1.png',
    'public/highfy_logo_official.png',
    'public/highfy_logo_transparent.png',
    'public/assets/images/highfy_logo.png',
    'public/assets/images/highfy_logo1.png',
    'public/assets/images/highfy_logo_transparent.png',
    'src/assets/images/highfy_logo.png',
    'src/assets/images/highfy_logo1.png',
    'src/assets/images/highfy_logo_transparent.png',
    'highfy_logo1.png',
    'highfy_logo_official.png',
    'android/app/src/main/assets/highfy_logo1.png',
    'android/app/src/main/assets/highfy_logo.png',
    'android/app/src/main/assets/highfy_logo_official.png',
    'android/app/src/main/assets/highfy_logo_transparent.png',
    'android/app/src/main/assets/assets/splash-screen-logo/splash_logo.png',
    'android/app/src/main/assets/assets/drawer-menu-logo/drawer_logo.png'
  ];

  for (const target of transparentTargets) {
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(target, transparent1024);
    console.log('✓ Updated transparent target:', target);
  }

  // 4. App Icon Targets (App Icon & Favicons)
  const appIconTargets = [
    'assets/app-icon/app_icon.png',
    'public/assets/app-icon/app_icon.png',
    'src/assets/app-icon/app_icon.png',
    'android/app/src/main/assets/assets/app-icon/app_icon.png'
  ];

  for (const target of appIconTargets) {
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(target, appIcon1024);
    console.log('✓ Updated app icon target:', target);
  }

  // 5. Android Mipmap Launcher Icons
  const mipmapSizes = [
    { dir: 'android/app/src/main/res/mipmap-mdpi', size: 48 },
    { dir: 'android/app/src/main/res/mipmap-hdpi', size: 72 },
    { dir: 'android/app/src/main/res/mipmap-xhdpi', size: 96 },
    { dir: 'android/app/src/main/res/mipmap-xxhdpi', size: 144 },
    { dir: 'android/app/src/main/res/mipmap-xxxhdpi', size: 192 }
  ];

  for (const m of mipmapSizes) {
    if (!fs.existsSync(m.dir)) fs.mkdirSync(m.dir, { recursive: true });

    await sharp(cleanSource)
      .resize(m.size, m.size, { fit: 'contain', background: { r: 9, g: 13, b: 22, alpha: 1 } })
      .png()
      .toFile(m.dir + '/ic_launcher.png');

    await sharp(cleanSource)
      .resize(m.size, m.size, { fit: 'contain', background: { r: 9, g: 13, b: 22, alpha: 1 } })
      .png()
      .toFile(m.dir + '/ic_launcher_round.png');

    console.log(`✓ Generated Android launcher icon (${m.size}x${m.size}): ${m.dir}`);
  }

  // 6. Android TV Leanback Banner (320x180)
  const bannerDir = 'android/app/src/main/res/drawable';
  if (!fs.existsSync(bannerDir)) fs.mkdirSync(bannerDir, { recursive: true });

  const logoBanner = await sharp(cleanSource)
    .resize(140, 140, { fit: 'contain', background: { r: 9, g: 13, b: 22, alpha: 1 } })
    .toBuffer();

  await sharp({
    create: {
      width: 320,
      height: 180,
      channels: 4,
      background: { r: 9, g: 13, b: 22, alpha: 1 }
    }
  })
  .composite([{ input: logoBanner, gravity: 'center' }])
  .png()
  .toFile(bannerDir + '/banner.png');

  console.log('✓ Generated Android TV banner: ' + bannerDir + '/banner.png');
  console.log('✨ All HighFy TV logo assets synchronized successfully!');
}

run().catch(console.error);
