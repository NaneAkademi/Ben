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
  const sizes = process.env.ONLY === 'land' ? [[800, 360, 'land']] : [[800, 360, 'land'], [360, 740, 'port']];
  for (const [w, h, tag] of sizes) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(tag + ' ' + e.message));
    page.on('console', m => m.type() === 'error' && errors.push(tag + ' ' + m.text()));
    await page.addInitScript(s => localStorage.setItem('siper_settings', s), JSON.stringify({ quality: 'low', name: 'Mert', color: '#557596', xp: 900, soloCfg: { mode: 'dm', theme: 'desert', diff: 1, bots: 2, limit: 5, time: 6 } }));
    await page.goto('http://localhost:8184/index.html?peer=127.0.0.1:9000');
    await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 30000 });
    await sleep(500);
    await page.screenshot({ path: `${OUT}/${tag}-menu.png` });
    await page.click('#tankNext');
    await sleep(400);
    await page.screenshot({ path: `${OUT}/${tag}-menu-heavy.png` });
    await page.click('#playBtn');
    await sleep(400);
    await page.screenshot({ path: `${OUT}/${tag}-solo.png` });
    await page.click('#scrSolo [data-back]');
    await page.click('[data-go=settings]');
    await sleep(300);
    await page.screenshot({ path: `${OUT}/${tag}-settings.png` });
    await page.click('#scrSettings [data-back]');
    await page.click('#profileBtn');
    await sleep(300);
    await page.screenshot({ path: `${OUT}/${tag}-profile.png` });
    await page.click('#scrProfile [data-back]');
    await page.click('#btnHost');
    await page.waitForFunction(() => /^[A-Z0-9]{4}$/.test(document.getElementById('roomCode').textContent), null, { timeout: 15000 });
    await sleep(400);
    await page.screenshot({ path: `${OUT}/${tag}-lobby.png` });
    await page.click('#scrLobby [data-back]');
    await sleep(300);
    await page.click('#playBtn');
    await page.click('#soloStart');
    await page.waitForFunction(() => window.app.game, null, { timeout: 20000 });
    await sleep(2500);
    // dokunmatik: sol yarıda joystick, sağ yarıda kamera kaydırma, ateş
    const r = await page.evaluate(async () => {
      const L = document.getElementById('touch');
      const mk = (type, x, y, id) => L.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true }));
      const yaw0 = window.app.game.cam.yaw;
      mk('pointerdown', 120, innerHeight - 110, 1);
      mk('pointermove', 125, innerHeight - 170, 1);
      mk('pointerdown', innerWidth * 0.7, innerHeight * 0.4, 3);
      mk('pointermove', innerWidth * 0.7 + 80, innerHeight * 0.4, 3);
      await new Promise(r => setTimeout(r, 200));
      const s1 = window.app.input.state();
      const yaw1 = window.app.game.cam.yaw;
      mk('pointerup', 0, 0, 3);
      const f = document.getElementById('btnFire');
      const fr = f.getBoundingClientRect();
      f.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: fr.x + 20, clientY: fr.y + 20, bubbles: true }));
      const s2 = window.app.input.state();
      return { throttle: s1.throttle, yawChange: +(yaw1 - yaw0).toFixed(3), fire: s2.fire };
    });
    console.log(tag, 'dokunmatik', JSON.stringify(r));
    await sleep(2500);
    await page.screenshot({ path: `${OUT}/${tag}-game.png` });
    await page.evaluate(() => {
      document.getElementById('touch').dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'touch', bubbles: true }));
      document.getElementById('btnFire').dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, pointerType: 'touch', bubbles: true }));
      document.getElementById('btnZoom').dispatchEvent(new PointerEvent('pointerdown', { pointerId: 5, pointerType: 'touch', bubbles: true }));
    });
    await sleep(1200);
    await page.screenshot({ path: `${OUT}/${tag}-zoom.png` });
    await page.evaluate(() => document.getElementById('btnZoom').dispatchEvent(new PointerEvent('pointerdown', { pointerId: 6, pointerType: 'touch', bubbles: true })));
    const handled = await page.evaluate(() => window.onAndroidBack());
    await sleep(300);
    await page.screenshot({ path: `${OUT}/${tag}-pause.png` });
    console.log(tag, 'geri tuşu', handled, await page.evaluate(() => window.app.ui.screen));
    await page.evaluate(() => window.onAndroidBack());
    await page.evaluate(() => {
      const g = window.app.game;
      g.scores.get(g.myId).k = 4;
      g.stats.kills = 4;
      g.stats.dmg = 180;
      g.stats.shots = 9;
      g.stats.hits = 6;
      const bot = [...g.tanks.values()].find(t => t.kind === 'bot' && t.alive);
      bot.protT = 0;
      g.damageBot(bot, 999, g.myId);
    });
    await sleep(3500);
    await page.screenshot({ path: `${OUT}/${tag}-results.png` });
    console.log(tag, 'ekran', await page.evaluate(() => [window.app.ui.screen, window.app.settings.xp]));
    await ctx.close();
  }
  console.log('ERRORS:\n' + errors.join('\n'));
  await browser.close();
  srv.close();
})();
