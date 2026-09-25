// Tek oyunculu duman testi: menü, maç başlatma, sürüş, ateş; ekran görüntüleri alır.
const start = require('./serve.cjs');
let pw; try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const OUT = process.env.OUT || '/tmp/shots';
const fs = require('fs'); fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const srv = await start(8181);
  const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: +(process.env.W || 960), height: +(process.env.H || 540) }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  const settings = { quality: process.env.Q || 'medium', name: 'Test', color: '#62763F', fps: true, soloCfg: { mode: process.env.MODE || 'coop', theme: process.env.THEME || 'meadow', diff: 1, bots: 3, limit: 10, time: 6 } };
  await page.addInitScript(s => localStorage.setItem('siper_settings', s), JSON.stringify(settings));
  await page.goto('http://localhost:8181/index.html');
  await sleep(2500);
  await page.screenshot({ path: OUT + '/1-menu.png' });
  await page.click('#playBtn');
  await sleep(300);
  await page.screenshot({ path: OUT + '/2-solo.png' });
  await page.click('#soloStart');
  await sleep(2500);
  await page.screenshot({ path: OUT + '/3-game-start.png' });
  await page.keyboard.down('KeyW');
  await page.keyboard.down('Space');
  await sleep(1500);
  await page.keyboard.down('KeyA');
  await sleep(800);
  await page.keyboard.up('KeyA');
  await page.keyboard.press('Digit2'); await page.evaluate(() => { window.app.input.lookDX += 0.6; });
  await sleep(4000);
  await page.screenshot({ path: OUT + '/4-game-play.png' });
  await page.keyboard.up('KeyW');
  await sleep(6000);
  await page.screenshot({ path: OUT + '/5-game-later.png' });
  const info = await page.evaluate(() => {
    const g = window.app.game;
    return g ? { tanks: g.tanks.size, shells: g.shells.length, wave: g.wave, me: { x: g.me.x.toFixed(1), z: g.me.z.toFixed(1), hp: g.me.hp, alive: g.me.alive }, left: g.enemiesLeft, fps: document.getElementById('fps').textContent, dpr: window.app.stage.dpr, calls: window.app.stage.renderer.info.render.calls, tris: window.app.stage.renderer.info.render.triangles } : null;
  });
  console.log(JSON.stringify(info));
  console.log('ERRORS:\n' + errors.slice(0, 30).join('\n'));
  await browser.close();
  srv.close();
})();
