// Çok oyunculu test: yerel PeerServer + iki (ya da üç) tarayıcı sekmesi.
// Önce: npx peerjs --port 9000 --path /
const start = require('./serve.cjs');
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const OUT = process.env.OUT || '/tmp/multi';
require('fs').mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MODE = process.env.MODE || 'coop';

async function mkPage(browser, name, color, errors) {
  const ctx = await browser.newContext({ viewport: { width: 480, height: 270 } });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push(name + ': ' + m.text()); });
  page.on('pageerror', e => errors.push(name + ' pageerror: ' + e.message + '\n' + e.stack));
  const settings = { quality: 'low', name, color, fps: true };
  await page.addInitScript(s => localStorage.setItem('siper_settings', s), JSON.stringify(settings));
  await page.goto('http://localhost:8183/index.html?autoplay=1&peer=127.0.0.1:9000');
  await sleep(1200);
  return page;
}

const state = page => page.evaluate(() => {
  const g = window.app.game, s = window.app.session;
  if (!g) return { noGame: true, screen: window.app.ui.screen, players: s && s.players.length, myId: s && s.myId };
  const tanks = [...g.tanks.values()].map(t => ({ id: t.id, kind: t.kind, name: t.name, x: +t.x.toFixed(1), z: +t.z.toFixed(1), hp: Math.round(t.hp), alive: t.alive }));
  const sc = [...g.scores.entries()].map(([id, s]) => [id, s.k, s.d, s.s]);
  return { myId: g.myId, t: +g.time.toFixed(1), wave: g.wave, left: g.enemiesLeft, tanks, sc, over: g.over, pk: g.pickups.size, shells: g.shells.length, rtt: Math.round(window.app.net.rtt || 0), fps: document.getElementById('fps').textContent };
});

(async () => {
  const srv = await start(8183);
  const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const errors = [];
  const host = await mkPage(browser, 'Ev', '#B9A56A', errors);
  const cli = await mkPage(browser, 'Misafir', '#557596', errors);

  await host.click('#btnHost');
  await host.waitForFunction(() => /^[A-Z0-9]{4}$/.test(document.getElementById('roomCode').textContent), null, { timeout: 20000 });
  const code = await host.textContent('#roomCode');
  console.log('oda kodu', code);
  await cli.click('[data-go=join]');
  await cli.fill('#codeIn', code);
  await cli.click('#joinBtn');
  await host.waitForFunction(() => window.app.session.players.length === 2, null, { timeout: 25000 });
  console.log('istemci katıldı');
  await sleep(800);
  await cli.click('#readyBtn');
  await sleep(500);
  if (MODE === 'dm') {
    await host.evaluate(() => window.app.session.setCfg({ mode: 'dm', bots: 2, limit: 5, theme: 'snow' }));
  } else await host.evaluate(() => window.app.session.setCfg({ mode: 'coop', theme: 'desert' }));
  await sleep(600);
  const lobbyCli = await cli.evaluate(() => ({ players: window.app.session.players.map(p => p.name + (p.ready ? '✓' : '')), cfg: window.app.session.cfg, myId: window.app.session.myId }));
  console.log('istemci lobi:', JSON.stringify(lobbyCli));
  await host.screenshot({ path: OUT + '/lobby-host.png' });
  await cli.screenshot({ path: OUT + '/lobby-cli.png' });
  await host.click('#startBtn');
  let third = null;
  for (let i = 1; i <= 6; i++) {
    await sleep(8000);
    const a = await state(host), b = await state(cli);
    console.log(`--- ${i * 8}s`);
    console.log('HOST', JSON.stringify({ t: a.t, wave: a.wave, left: a.left, sc: a.sc, n: a.tanks && a.tanks.length, over: a.over, pk: a.pk, fps: a.fps }));
    console.log('CLI ', JSON.stringify({ t: b.t, wave: b.wave, left: b.left, sc: b.sc, n: b.tanks && b.tanks.length, over: b.over, pk: b.pk, rtt: b.rtt, fps: b.fps }));
    if (a.tanks && b.tanks) {
      // aynı tankların iki ekrandaki konum farkı
      const diffs = [];
      for (const t of a.tanks) {
        const u = b.tanks.find(q => q.id === t.id);
        if (u) diffs.push(`${t.name}:${Math.hypot(t.x - u.x, t.z - u.z).toFixed(1)}m${t.alive === u.alive ? '' : ' ALIVE?'}`);
        else diffs.push(`${t.name}:YOK`);
      }
      console.log('fark', diffs.join(' '));
    }
    await host.screenshot({ path: `${OUT}/h${i}.png` });
    await cli.screenshot({ path: `${OUT}/c${i}.png` });
    if (i === 3 && process.env.THIRD) {
      third = await mkPage(browser, 'Geç', '#93403A', errors);
      await third.click('[data-go=join]');
      await third.fill('#codeIn', code);
      await third.click('#joinBtn');
    }
    if (i === 5 && third) {
      const c = await state(third);
      console.log('GEÇ ', JSON.stringify({ t: c.t, wave: c.wave, n: c.tanks && c.tanks.length, noGame: c.noGame, screen: c.screen }));
      await third.screenshot({ path: `${OUT}/late.png` });
      await third.close();
    }
  }
  // istemci çıkınca oda sahibi fark etmeli
  await cli.close();
  await sleep(4000);
  const a = await state(host);
  console.log('istemci çıktıktan sonra host oyuncu tankları:', a.tanks && a.tanks.filter(t => t.kind === 'player').map(t => t.name).join(','));
  console.log('ERRORS:\n' + errors.slice(0, 30).join('\n'));
  await browser.close();
  srv.close();
})();
