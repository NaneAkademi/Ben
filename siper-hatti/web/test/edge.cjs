// Hedefli testler: komutan dalgası, varil zinciri, bonuslar, ölüm maçı bitişi.
const start = require('./serve.cjs');
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const srv = await start(8185);
  const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  const open = async cfg => {
    const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
    page.on('pageerror', e => errors.push(e.message + '\n' + e.stack));
    page.on('console', m => m.type() === 'error' && errors.push(m.text()));
    await page.addInitScript(s => localStorage.setItem('siper_settings', s), JSON.stringify({ quality: 'low', name: 'T', color: '#62763F', soloCfg: cfg }));
    await page.goto('http://localhost:8185/index.html?autoplay=1');
    await sleep(1200);
    await page.click('[data-go=solo]');
    await page.click('#soloStart');
    await sleep(1500);
    return page;
  };

  let p;
  if (!process.env.ONLYDM) {
  // 1) komutan dalgası
  p = await open({ mode: 'coop', theme: 'snow', diff: 1, bots: 3, limit: 10, time: 6 });
  await p.evaluate(() => {
    const g = window.app.game;
    g.me.protT = 999; // test için ölümsüz
    g.wave = 4;
    g.waveState.active = false;
    g.waveState.breakT = 0;
  });
  await sleep(9000);
  console.log('dalga5', JSON.stringify(await p.evaluate(() => {
    const g = window.app.game;
    return { wave: g.wave, types: [...g.tanks.values()].map(t => t.type), queue: g.waveState.queue };
  })));
  // varil zinciri + bonus
  const r = await p.evaluate(() => {
    const g = window.app.game;
    const alive0 = g.world.barrels.filter(b => b.alive).length;
    const b = g.world.barrels[0];
    g.hostBarrel(b.bid, g.myId);
    g.spawnPickup(g.me.x + 30, g.me.z, 'shield');
    const pk = [...g.pickups.values()].find(q => q.type === 'shield');
    g.me.protT = 0;
    g.me.x = pk.x; g.me.z = pk.z;
    return { alive0, bid: b.bid };
  });
  await sleep(1500);
  console.log('varil/bonus', JSON.stringify(await p.evaluate(() => {
    const g = window.app.game;
    return { barrelsAlive: g.world.barrels.filter(b => b.alive).length, shieldT: +g.me.shieldT.toFixed(1), pickups: g.pickups.size };
  })), JSON.stringify(r));
  await p.screenshot({ path: '/tmp/edge-boss.png' });
  await p.close();
  }

  // 2) ölüm maçı bitişi
  p = await open({ mode: 'dm', theme: 'meadow', diff: 1, bots: 2, limit: 5, time: 6 });
  await p.evaluate(() => {
    const g = window.app.game;
    g.scores.get(g.myId).k = 4;
    const bot = [...g.tanks.values()].find(t => t.kind === 'bot' && t.alive);
    bot.protT = 0;
    g.damageBot(bot, 999, g.myId);
  });
  await sleep(3500);
  console.log('dm son', JSON.stringify(await p.evaluate(() => ({ over: window.app.game && window.app.game.over, screen: window.app.ui.screen, title: document.getElementById('resTitle').textContent, rows: document.getElementById('resBody').children.length }))));
  await p.screenshot({ path: '/tmp/edge-results.png' });
  await p.click('#againBtn');
  await sleep(2000);
  console.log('tekrar', JSON.stringify(await p.evaluate(() => ({ over: window.app.game.over, tanks: window.app.game.tanks.size, screen: window.app.ui.screen }))));
  await p.evaluate(() => window.onAndroidBack());
  await sleep(200);
  await p.click('#quitBtn');
  await sleep(1500);
  console.log('çıkış', JSON.stringify(await p.evaluate(() => ({ game: !!window.app.game, screen: window.app.ui.screen, back: window.onAndroidBack() }))));
  console.log('ERRORS:\n' + errors.join('\n'));
  await browser.close();
  srv.close();
})();
