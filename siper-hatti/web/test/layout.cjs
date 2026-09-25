// Telefon ekran boyutlarında arayüz yerleşimi ve dokunmatik kontrol testi.
const start = require('./serve.cjs');
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const OUT = process.env.OUT || '/tmp/layout';
require('fs').mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const srv = await start(8184);
  const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  for (const [w, h, tag] of [[800, 360, 'land'], [360, 740, 'port']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(tag + ' ' + e.message));
    page.on('console', m => m.type() === 'error' && errors.push(tag + ' ' + m.text()));
    await page.addInitScript(s => localStorage.setItem('siper_settings', s), JSON.stringify({ quality: 'low', name: 'Mert', color: '#557596' }));
    await page.goto('http://localhost:8184/index.html?peer=127.0.0.1:9000');
    await sleep(1500);
    await page.screenshot({ path: `${OUT}/${tag}-menu.png` });
    await page.click('[data-go=solo]');
    await page.click('.mode-card:nth-child(2)');
    await sleep(200);
    await page.screenshot({ path: `${OUT}/${tag}-solo-dm.png` });
    await page.click('#scrSolo [data-back]');
    await page.click('[data-go=join]');
    await page.fill('#codeIn', 'k7qx');
    await page.screenshot({ path: `${OUT}/${tag}-join.png` });
    await page.click('#scrJoin [data-back]');
    await page.click('[data-go=help]');
    await page.screenshot({ path: `${OUT}/${tag}-help.png` });
    await page.click('#scrHelp [data-back]');
    await page.click('#btnHost');
    await page.waitForFunction(() => /^[A-Z0-9]{4}$/.test(document.getElementById('roomCode').textContent), null, { timeout: 15000 });
    await sleep(300);
    await page.screenshot({ path: `${OUT}/${tag}-lobby.png` });
    await page.click('#startBtn');
    await sleep(2500);
    // dokunmatik: sol yarıda sürükle (joystick), ateş tuşu
    const r = await page.evaluate(() => {
      const L = document.getElementById('touch');
      const mk = (type, x, y, id) => L.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: id === 1 }));
      mk('pointerdown', 120, innerHeight - 110, 1);
      mk('pointermove', 125, innerHeight - 170, 1);
      const s1 = window.app.input.state();
      const fire = document.getElementById('btnFire');
      const fr = fire.getBoundingClientRect();
      fire.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: fr.x + 10, clientY: fr.y + 10, bubbles: true }));
      const s2 = window.app.input.state();
      return { s1, s2 };
    });
    console.log(tag, 'dokunmatik', JSON.stringify(r));
    await sleep(2500);
    await page.screenshot({ path: `${OUT}/${tag}-game.png` });
    await page.evaluate(() => {
      const L = document.getElementById('touch');
      L.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'touch', bubbles: true }));
      document.getElementById('btnFire').dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, pointerType: 'touch', bubbles: true }));
    });
    const after = await page.evaluate(() => window.app.input.state());
    console.log(tag, 'bırakınca', JSON.stringify(after));
    // android geri tuşu -> duraklat menüsü
    const handled = await page.evaluate(() => window.onAndroidBack());
    await sleep(300);
    await page.screenshot({ path: `${OUT}/${tag}-pause.png` });
    console.log(tag, 'geri tuşu', handled, await page.evaluate(() => window.app.ui.screen));
    await page.evaluate(() => window.onAndroidBack());
    // sonuç ekranı
    await page.evaluate(() => window.app.game.checkEnd(true));
    await sleep(1800);
    await page.screenshot({ path: `${OUT}/${tag}-results.png` });
    console.log(tag, 'ekran', await page.evaluate(() => window.app.ui.screen));
    await ctx.close();
  }
  console.log('ERRORS:\n' + errors.join('\n'));
  await browser.close();
  srv.close();
})();
