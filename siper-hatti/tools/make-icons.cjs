// Uygulama ikonlarını SVG'den PNG'ye çevirir (Playwright + Chromium).
// Kullanım: node tools/make-icons.cjs
const path = require('path');
const fs = require('fs');
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = path.resolve(__dirname, '..');
const RES = path.join(ROOT, 'android', 'res');

// 108x108 birimlik tuval; güvenli alan ortadaki 66 birim.
const tank = `
  <g transform="translate(54 58)">
    <ellipse cx="0" cy="17" rx="34" ry="4.5" fill="#000" opacity=".35"/>
    <rect x="-31" y="5" width="60" height="13" rx="6.5" fill="#1C2012"/>
    <g fill="#7F6F3E">${[-23, -13.5, -4, 5.5, 15, 23].map(x => `<circle cx="${x}" cy="11.5" r="4.2"/>`).join('')}</g>
    <g fill="#23271B">${[-23, -13.5, -4, 5.5, 15, 23].map(x => `<circle cx="${x}" cy="11.5" r="1.6"/>`).join('')}</g>
    <path d="M-33 5 L-28 -4 L22 -4 L33 5 Z" fill="#D9C88A"/>
    <path d="M-33 5 L-28 -4 L22 -4 L33 5 Z" fill="none" stroke="#7F6F3E" stroke-width="1.2"/>
    <rect x="-26" y="-1.2" width="46" height="2" fill="#C2AF6E"/>
    <path d="M-17 -4 L-14 -15 Q-12 -18 -8 -18 L10 -18 Q14 -18 15 -14 L17 -4 Z" fill="#C2AF6E"/>
    <rect x="15" y="-13.3" width="30" height="3.6" rx="1" fill="#7F6F3E"/>
    <rect x="41" y="-14.6" width="6" height="6.2" rx="1" fill="#5d5230"/>
    <rect x="-6" y="-21" width="9" height="3.4" rx="1.2" fill="#7F6F3E"/>
    <line x1="-13" y1="-17" x2="-18" y2="-33" stroke="#1C2012" stroke-width="1"/>
  </g>
  <g transform="translate(101 44.5)">
    <path d="M-1 0 L4 -5 L5 -1.6 L10 -2.5 L7 0 L10 2.5 L5 1.6 L4 5 Z" fill="#F2B33D"/>
  </g>`;

const fgSvg = s => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 108 108">
  <g transform="translate(54 54) scale(.72) translate(-54 -54)">${tank}</g></svg>`;

const legacySvg = s => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 108 108">
  <defs><radialGradient id="bg" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="#4B5530"/><stop offset="1" stop-color="#1F2412"/></radialGradient></defs>
  <rect x="4" y="4" width="100" height="100" rx="22" fill="url(#bg)"/>
  <g transform="translate(54 56) scale(.9) translate(-54 -54)">${tank}</g></svg>`;

const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

(async () => {
  const exe = fs.existsSync('/opt/pw-browsers/chromium') ? undefined : undefined;
  const browser = await pw.chromium.launch(exe ? { executablePath: exe } : {});
  const page = await browser.newPage();
  async function shot(svg, size, file) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await page.locator('svg').screenshot({ path: file, omitBackground: true });
  }
  for (const [d, k] of Object.entries(DENS)) {
    await shot(legacySvg(Math.round(48 * k)), Math.round(48 * k), path.join(RES, `mipmap-${d}`, 'ic_launcher.png'));
    await shot(fgSvg(Math.round(108 * k)), Math.round(108 * k), path.join(RES, `mipmap-${d}`, 'ic_launcher_fg.png'));
  }
  // web için
  const webIcons = path.join(ROOT, 'web', 'public');
  await shot(legacySvg(192), 192, path.join(webIcons, 'icon-192.png'));
  await shot(legacySvg(512), 512, path.join(webIcons, 'icon-512.png'));
  await browser.close();
  console.log('ikonlar hazir');
})();
