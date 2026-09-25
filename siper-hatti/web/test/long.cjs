// Uzun süreli tek oyunculu test (oyuncuyu yapay zekâ sürer)
const start = require('./serve.cjs');
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const OUT = process.env.OUT || '/tmp/long';
require('fs').mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SECS = +(process.env.SECS || 60);
(async () => {
  const srv = await start(8182);
  const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message + '\n' + e.stack));
  const settings = { quality: 'low', name: 'Test', color: '#62763F', fps: true, soloCfg: { mode: process.env.MODE || 'coop', theme: process.env.THEME || 'meadow', diff: +(process.env.DIFF || 1), bots: 4, limit: 10, time: 6 } };
  await page.addInitScript(s => localStorage.setItem('siper_settings', s), JSON.stringify(settings));
  await page.goto('http://localhost:8182/index.html?autoplay=1');
  await sleep(1500);
  await page.click('#playBtn');
  await page.click('#soloStart');
  for (let t = 0; t < SECS; t += 10) {
    await sleep(10000);
    const s = await page.evaluate(() => {
      const g = window.app.game;
      if (!g) return { noGame: true, screen: window.app.ui.screen };
      const sc = [...g.scores.entries()].map(([id, s]) => `${(g.tanks.get(id) || {}).name}:${s.k}/${s.d}/${s.s}`).join(' ');
      return { t: g.time.toFixed(0), wave: g.wave, left: g.enemiesLeft, tanks: g.tanks.size, shells: g.shells.length, pk: g.pickups.size, me: `${g.me.hp.toFixed(0)}hp ${g.me.alive ? 'alive' : 'dead'}`, sc, over: g.over, fps: document.getElementById('fps').textContent, part: window.app.fx.add.n + window.app.fx.alpha.n, screen: window.app.ui.screen };
    });
    console.log(JSON.stringify(s));
    await page.screenshot({ path: `${OUT}/t${t + 10}.png` });
  }
  console.log('ERRORS:\n' + errors.slice(0, 20).join('\n'));
  await browser.close();
  srv.close();
})();
