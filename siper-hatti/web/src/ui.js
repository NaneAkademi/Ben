// Menüler, lobi ve oyun içi arayüz (HTML katmanı).
import * as THREE from 'three';
import { PLAYER_COLORS, THEMES, TYPES, ABILITY, ARENA, MAX_PLAYERS, VERSION } from './config.js';
import { fmtTime, clamp } from './util.js';
import { sfx } from './audio.js';

const $ = id => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const V = new THREE.Vector3();

export const MAP_OPTS = [['random', 'Rastgele'], ['meadow', THEMES.meadow.name], ['desert', THEMES.desert.name], ['snow', THEMES.snow.name]];
const DIFF_OPTS = [[0, 'Kolay'], [1, 'Normal'], [2, 'Zor']];

export class UI {
  constructor(app) {
    this.app = app;
    this.screen = 'scrMenu';
    this.stack = [];
    this.labels = new Map();
    this.feedItems = [];
    this.bannerT = 0;
    this.mmT = 0;
    this.mm = $('minimap').getContext('2d');
    this.hpKey = '';
    this.infoKey = '';
    this.fpsAcc = 0;
    this.fpsN = 0;
    this._wire();
    $('ver').textContent = 'Sürüm ' + VERSION;
  }

  // ---------- ekran yönetimi ----------
  show(id, push = true) {
    if (push && this.screen && this.screen !== id) this.stack.push(this.screen);
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
    this.screen = id;
    if (id === 'scrSettings') this.renderSettings();
  }
  hideScreens() {
    for (const s of document.querySelectorAll('.screen')) s.hidden = true;
    this.screen = null;
    this.stack = [];
  }
  back() {
    const prev = this.stack.pop();
    if (prev) this.show(prev, false);
    return !!prev;
  }
  toast(text, ms = 2600) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => t.classList.remove('show'), ms);
  }
  loaded() {
    $('loading').classList.add('off');
    setTimeout(() => $('loading').remove(), 500);
  }

  _wire() {
    const A = this.app;
    document.addEventListener('pointerdown', () => sfx.unlock(), { capture: true });
    document.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (b) sfx.click();
      const go = e.target.closest('[data-go]');
      if (go) {
        const map = { solo: 'scrSolo', join: 'scrJoin', settings: 'scrSettings', help: 'scrHelp' };
        if (go.dataset.go === 'solo') this.renderSolo();
        if (go.dataset.go === 'join') {
          $('joinMsg').textContent = '';
          setTimeout(() => $('codeIn').focus(), 50);
        }
        this.show(map[go.dataset.go]);
      }
      if (e.target.closest('[data-back]')) A.back();
    });
    // profil
    const nameIn = $('nameIn');
    nameIn.value = A.settings.name || '';
    nameIn.addEventListener('input', () => A.setProfile({ name: nameIn.value }));
    const sw = $('colors');
    PLAYER_COLORS.forEach((c, i) => {
      const b = el('button');
      b.style.background = c.hex;
      b.title = c.name;
      b.setAttribute('aria-label', c.name);
      b.onclick = () => {
        A.setProfile({ color: c.hex });
        this.markColor();
      };
      sw.appendChild(b);
    });
    this.markColor();
    $('btnHost').onclick = () => A.hostRoom();
    $('joinBtn').onclick = () => A.joinRoom($('codeIn').value);
    $('codeIn').addEventListener('input', e => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    });
    $('codeIn').addEventListener('keydown', e => {
      if (e.key === 'Enter') A.joinRoom($('codeIn').value);
    });
    $('soloStart').onclick = () => A.startSolo();
    $('shareBtn').onclick = () => A.shareCode();
    $('copyBtn').onclick = () => A.copyCode();
    $('readyBtn').onclick = () => A.toggleReady();
    $('startBtn').onclick = () => A.session && A.session.startMatch();
    $('pauseBtn').onclick = () => A.togglePause();
    $('resumeBtn').onclick = () => A.togglePause(false);
    $('quitBtn').onclick = () => A.quitMatch();
    $('againBtn').onclick = () => A.again();
    $('resLobbyBtn').onclick = () => A.resultsLeave();
  }

  markColor() {
    const c = this.app.settings.color;
    [...$('colors').children].forEach((b, i) => b.classList.toggle('sel', PLAYER_COLORS[i].hex === c));
  }

  // ---------- seçenek bileşenleri ----------
  seg(label, options, value, onChange, locked) {
    const w = el('div', 'opt');
    w.appendChild(el('span', null, esc(label)));
    const s = el('div', 'seg' + (locked ? ' locked' : ''));
    for (const [v, t] of options) {
      const b = el('button', v === value ? 'sel' : '', esc(t));
      b.onclick = () => onChange(v);
      s.appendChild(b);
    }
    w.appendChild(s);
    return w;
  }
  toggle(label, on, onChange) {
    const b = el('button', 'toggle' + (on ? ' on' : ''), `<span>${esc(label)}</span><i></i>`);
    b.onclick = () => onChange(!on);
    return b;
  }
  modeCards(value, onChange, locked) {
    const w = el('div', 'mode-cards');
    const items = [
      ['coop', 'Hayatta Kal', 'Düşman dalgalarına karşı birlikte savaş'],
      ['dm', 'Ölüm Maçı', 'Herkes birbirine karşı (botlarla)'],
    ];
    for (const [v, t, d] of items) {
      const b = el('button', 'mode-card' + (v === value ? ' sel' : ''), `<b>${t}</b><small>${d}</small>`);
      if (!locked) b.onclick = () => onChange(v);
      else b.style.pointerEvents = 'none';
      w.appendChild(b);
    }
    return w;
  }
  matchOpts(box, cfg, onChange, locked, solo) {
    box.textContent = '';
    box.appendChild(this.modeCards(cfg.mode, v => onChange({ mode: v }), locked));
    box.appendChild(this.seg('Harita', MAP_OPTS, cfg.theme, v => onChange({ theme: v }), locked));
    box.appendChild(this.seg('Zorluk', DIFF_OPTS, cfg.diff, v => onChange({ diff: v }), locked));
    if (cfg.mode === 'dm') {
      const maxB = solo ? 6 : 6;
      const bo = [];
      for (let i = solo ? 1 : 0; i <= maxB; i++) bo.push([i, String(i)]);
      box.appendChild(this.seg('Bot sayısı', bo, cfg.bots, v => onChange({ bots: v }), locked));
      box.appendChild(this.seg('Kazanmak için vuruş', [[5, '5'], [10, '10'], [15, '15'], [20, '20']], cfg.limit, v => onChange({ limit: v }), locked));
    }
  }

  renderSolo() {
    const A = this.app;
    const cfg = A.soloCfg;
    this.matchOpts($('soloOpts'), cfg, ch => {
      Object.assign(cfg, ch);
      if (cfg.mode === 'dm' && cfg.bots < 1) cfg.bots = 3;
      A.saveSettings();
      this.renderSolo();
    }, false, true);
  }

  renderSettings() {
    const A = this.app, S = A.settings, box = $('setOpts');
    box.textContent = '';
    const inGame = !!A.game;
    box.appendChild(this.seg('Grafik kalitesi', [['auto', 'Otomatik'], ['low', 'Düşük'], ['medium', 'Orta'], ['high', 'Yüksek']], S.quality, v => {
      if (inGame) return this.toast('Grafik ayarını menüdeyken değiştirebilirsin.');
      S.quality = v;
      A.saveSettings();
      this.toast('Grafik ayarı uygulanıyor…');
      setTimeout(() => location.reload(), 500);
    }, false));
    const vol = el('div', 'opt', '<span>Ses seviyesi</span>');
    const r = el('input');
    r.type = 'range';
    r.min = 0;
    r.max = 100;
    r.value = Math.round(S.volume * 100);
    r.oninput = () => {
      S.volume = r.value / 100;
      sfx.setVolume(S.volume);
      A.saveSettings();
    };
    vol.appendChild(r);
    box.appendChild(vol);
    const tg = (label, key) => box.appendChild(this.toggle(label, S[key], v => {
      S[key] = v;
      A.saveSettings();
      A.applySettings();
      this.renderSettings();
    }));
    tg('Titreşim', 'vibrate');
    tg('Kamera sarsıntısı', 'shake');
    tg('FPS göster', 'fps');
    if (inGame) box.appendChild(el('p', 'hint', 'Grafik kalitesi maç dışında değiştirilebilir.'));
  }

  // ---------- lobi ----------
  renderLobby(session) {
    if (!session) return;
    const A = this.app;
    const host = session.isHost;
    $('roomCode').textContent = session.code || '----';
    const list = $('plist');
    list.textContent = '';
    for (const p of session.players) {
      const li = el('li');
      const dot = el('span', 'dot');
      dot.style.background = p.color;
      li.appendChild(dot);
      li.appendChild(document.createTextNode(p.name));
      if (p.id === session.myId) li.appendChild(el('em', null, '&nbsp;(sen)'));
      const tag = p.id === 1 ? el('span', 'tag host', 'Oda sahibi') : el('span', 'tag' + (p.ready ? ' ok' : ''), p.ready ? 'Hazır' : 'Bekliyor');
      li.appendChild(tag);
      list.appendChild(li);
    }
    for (let i = session.players.length; i < MAX_PLAYERS; i++) list.appendChild(el('li', 'empty', 'Boş yer — oda kodunu paylaş'));
    this.matchOpts($('lobbyOpts'), session.cfg, ch => session.setCfg(ch), !host, false);
    const me = session.players.find(p => p.id === session.myId);
    $('readyBtn').hidden = host;
    $('readyBtn').classList.toggle('on', !!(me && me.ready));
    $('readyBtn').textContent = me && me.ready ? 'Hazır ✓' : 'Hazırım';
    $('startBtn').hidden = !host;
    const others = session.players.length - 1;
    const notReady = session.players.filter(p => p.id !== 1 && !p.ready).length;
    let msg;
    if (!session.myId) msg = 'Odaya bağlanılıyor…';
    else if (host) msg = others === 0 ? 'Oda hazır! Kodu arkadaşlarına gönder. İstersen tek başına ya da botlarla da başlatabilirsin.' :
      notReady ? `${notReady} oyuncu henüz hazır değil. Yine de başlatabilirsin.` : 'Herkes hazır. Maçı başlat!';
    else msg = 'Oda sahibi maçı başlatınca oyun açılacak.';
    $('lobbyMsg').textContent = msg;
  }

  // ---------- oyun içi ----------
  startHud(game) {
    $('hud').hidden = false;
    this.hideScreens();
    this.feedItems = [];
    $('feed').textContent = '';
    $('deadbox').hidden = true;
    for (const l of this.labels.values()) l.el.remove();
    this.labels.clear();
    this.hpKey = this.infoKey = '';
    this.app.input.setEnabled(true);
    $('fps').hidden = !this.app.settings.fps;
  }

  endHud() {
    $('hud').hidden = true;
    for (const l of this.labels.values()) l.el.remove();
    this.labels.clear();
    this.app.input.setEnabled(false);
    $('scoreboard').hidden = true;
  }

  banner(title, sub = '', dur = 1.6) {
    const b = $('banner');
    b.querySelector('h2').textContent = title;
    b.querySelector('p').textContent = sub || '';
    b.classList.add('show');
    this.bannerT = dur;
  }

  popup(text) {
    const p = $('popup');
    p.textContent = text;
    p.classList.remove('show');
    void p.offsetWidth;
    p.classList.add('show');
  }

  hitMarker() {
    const h = $('hitmarker');
    h.classList.remove('show');
    void h.offsetWidth;
    h.classList.add('show');
  }

  damageDir(rel) {
    const d = el('div');
    // rel: kameraya göre açı (0 = ileri). Ekranda ileri = yukarı
    d.style.transform = `rotate(${(rel * 180) / Math.PI}deg)`;
    $('dmgdir').appendChild(d);
    setTimeout(() => d.remove(), 900);
  }

  feed(k, v) {
    const f = $('feed');
    const d = el('div');
    const nm = t => `<span style="color:${esc(t.color)}">${esc(t.name)}</span>`;
    d.innerHTML = k && k !== v ? `${nm(k)}<i>▸</i>${nm(v)}` : `${nm(v)}<i>imha oldu</i>`;
    f.prepend(d);
    this.feedItems.push({ d, t: 5 });
    while (f.children.length > 5) f.lastChild.remove();
  }
  feedText(text) {
    const d = el('div');
    d.textContent = text;
    $('feed').prepend(d);
    this.feedItems.push({ d, t: 5 });
  }

  dead(show, count, text) {
    const b = $('deadbox');
    b.hidden = !show;
    if (!show) return;
    b.querySelector('p').textContent = text || (count != null ? `${Math.max(0, count)} saniye sonra yeniden doğacaksın` : '');
  }

  hudTick(g, dt) {
    const m = g.me;
    if (!m) return;
    // can
    const hp = Math.max(0, Math.round(m.hp));
    const key = hp + '/' + m.maxHp;
    if (key !== this.hpKey) {
      this.hpKey = key;
      $('hpFill').style.width = (100 * hp) / m.maxHp + '%';
      $('hpText').textContent = hp;
      $('hpFill').parentElement.classList.toggle('low', hp < m.maxHp * 0.3);
    }
    // durum
    const st = [];
    if (m.shieldT > 0) st.push(`<span style="color:var(--blue)">Kalkan ${Math.ceil(m.shieldT)}</span>`);
    if (m.rapidT > 0) st.push(`<span style="color:var(--signal)">Seri atış ${Math.ceil(m.rapidT)}</span>`);
    if (m.protT > 0 && m.alive) st.push(`<span style="color:#fff">Koruma</span>`);
    const sk = st.join('');
    if (sk !== this._st) {
      this._st = sk;
      $('status').innerHTML = sk;
    }
    // bilgi
    let info;
    const my = g.scores.get(g.myId) || { k: 0, d: 0, s: 0 };
    if (g.mode === 'coop') {
      let total = 0;
      for (const [id, s] of g.scores) {
        const t = g.tanks.get(id);
        if (!t || t.kind === 'player') total += s.s;
      }
      info = `<span class="big">DALGA ${Math.max(1, g.wave)}</span><small>Kalan düşman ${g.enemiesLeft} · Takım puanı ${total}</small>`;
    } else {
      let lead = null, lk = -1;
      for (const [id, s] of g.scores) if (id !== g.myId && s.k > lk && g.tanks.get(id)) {
        lk = s.k;
        lead = g.tanks.get(id);
      }
      info = `<span class="big">${my.k} / ${g.cfg.limit}</span><small>${lead ? `Lider rakip: ${esc(lead.name)} ${lk}` : ''} · ${fmtTime(g.timeLeft)}</small>`;
    }
    if (info !== this.infoKey) {
      this.infoKey = info;
      $('info').innerHTML = info;
    }
    // yetenek halkaları
    this.ring($('btnFire'), m.alive ? 1 - Math.max(0, m.reload) / (m.spec.reload * (m.rapidT > 0 ? 0.5 : 1)) : 0);
    this.ring($('btnHe'), 1 - Math.max(0, m.heCd) / ABILITY.heCooldown);
    this.ring($('btnBoost'), m.boostT > 0 ? 1 : 1 - Math.max(0, m.boostCd) / ABILITY.boostCooldown);

    // afiş
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) $('banner').classList.remove('show');
    }
    for (const f of this.feedItems) {
      f.t -= dt;
      if (f.t <= 0) f.d.remove();
    }
    this.feedItems = this.feedItems.filter(f => f.t > 0);

    this.updateLabels(g);
    this.mmT -= dt;
    if (this.mmT <= 0) {
      this.mmT = 1 / 24;
      this.drawMinimap(g);
    }
    if (!$('scoreboard').hidden) this.renderScoreboard(g);
    if (this.app.settings.fps) {
      this.fpsAcc += dt;
      this.fpsN++;
      if (this.fpsAcc > 0.5) {
        $('fps').textContent = Math.round(this.fpsN / this.fpsAcc) + ' FPS · ' + this.app.stage.dpr.toFixed(2) + 'x' + (g.session.solo ? '' : ` · ${Math.round(this.app.net ? this.app.net.rtt : 0)} ms`);
        this.fpsAcc = this.fpsN = 0;
      }
    }
  }

  ring(btn, frac) {
    frac = clamp(frac, 0, 1);
    const c = btn.querySelector('circle');
    const v = (100.5 * (1 - frac)).toFixed(1);
    if (c._v !== v) {
      c._v = v;
      c.style.strokeDashoffset = v;
      btn.classList.toggle('cd', frac < 1);
    }
  }

  updateLabels(g) {
    const cam = this.app.stage.camera, W = this.app.stage.w, H = this.app.stage.h;
    const seen = new Set();
    for (const t of g.tanks.values()) {
      if (t === g.me || !t.alive || !t.seen) continue;
      const enemy = t.kind === 'enemy';
      const d = Math.hypot(t.x - g.me.x, t.z - g.me.z);
      if (d > (enemy ? 40 : 70)) continue;
      if (enemy && t.hp >= t.maxHp && t.type !== 'boss') continue;
      V.set(t.x, g.world.height(t.x, t.z) + 2.9 * t.spec.scale, t.z).project(cam);
      if (V.z > 1 || V.x < -1.2 || V.x > 1.2 || V.y < -1.2 || V.y > 1.2) continue;
      seen.add(t.id);
      let L = this.labels.get(t.id);
      if (!L) {
        const e = el('div', 'tag3d' + (enemy ? ' enemy' : ''), `<b></b><i><u></u></i>`);
        $('labels').appendChild(e);
        L = { el: e, b: e.querySelector('b'), u: e.querySelector('u'), hp: -1, name: '' };
        this.labels.set(t.id, L);
      }
      const hostile = t.team !== g.me.team;
      const col = enemy ? '#ff6a4d' : t.color;
      if (L.name !== t.name) {
        L.name = t.name;
        L.b.textContent = t.name;
      }
      L.el.style.color = hostile && !enemy ? '#ffb199' : col;
      L.b.style.color = enemy ? '#ffb199' : t.color;
      const hp = Math.round((100 * Math.max(0, t.hp)) / t.maxHp);
      if (hp !== L.hp) {
        L.hp = hp;
        L.u.style.width = hp + '%';
      }
      L.el.style.transform = `translate(${((V.x + 1) / 2) * W}px, ${((1 - V.y) / 2) * H}px) translate(-50%, -100%)`;
      L.el.style.opacity = d > 50 ? 0.7 : 1;
    }
    for (const [id, L] of this.labels) if (!seen.has(id)) {
      L.el.remove();
      this.labels.delete(id);
    }
    // nişan kilidi
    const lock = $('lock');
    const tg = g.me.alive ? g.me.target : null;
    if (tg && tg.alive) {
      V.set(tg.x, g.world.height(tg.x, tg.z) + 1.2 * tg.spec.scale, tg.z).project(cam);
      if (V.z < 1) {
        lock.classList.add('on');
        lock.style.transform = `translate(${((V.x + 1) / 2) * W}px, ${((1 - V.y) / 2) * H}px)`;
      } else lock.classList.remove('on');
    } else lock.classList.remove('on');
  }

  drawMinimap(g) {
    const c = this.mm, S = 200, R = 100, m = g.me, yaw = g.cam.yaw;
    const k = R / 42;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, S, S);
    c.save();
    c.beginPath();
    c.arc(R, R, R - 2, 0, 7);
    c.clip();
    c.translate(R, R);
    c.rotate(-Math.PI / 2 - yaw);
    c.scale(k, k);
    c.translate(-m.x, -m.z);
    // arena sınırı
    c.strokeStyle = 'rgba(217,200,138,0.55)';
    c.lineWidth = 1 / k * 2;
    c.strokeRect(-ARENA, -ARENA, ARENA * 2, ARENA * 2);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    for (const o of g.world.obstacles) {
      if (!o.alive || Math.abs(o.x - m.x) > 60 || Math.abs(o.z - m.z) > 60) continue;
      c.fillStyle = o.kind === 'barrel' ? 'rgba(200,60,40,0.9)' : o.kind === 'wall' ? 'rgba(210,200,170,0.85)' : o.kind === 'sandbag' ? 'rgba(190,170,120,0.8)' : 'rgba(150,145,130,0.75)';
      if (o.shape === 'c') {
        c.beginPath();
        c.arc(o.x, o.z, Math.max(o.r, 0.6), 0, 7);
        c.fill();
      } else {
        c.save();
        c.translate(o.x, o.z);
        c.rotate(o.rot);
        c.fillRect(-o.hw, -o.hd, o.hw * 2, o.hd * 2);
        c.restore();
      }
    }
    for (const p of g.pickups.values()) {
      c.fillStyle = { repair: '#57d163', shield: '#5fb8ff', rapid: '#ffb13b' }[p.type];
      c.fillRect(p.x - 1.3, p.z - 1.3, 2.6, 2.6);
    }
    for (const t of g.tanks.values()) {
      if (t === m || !t.alive || !t.seen) continue;
      const hostile = t.team !== m.team;
      c.fillStyle = hostile ? (t.kind === 'enemy' ? '#ff5a3c' : '#ff8a6a') : t.color;
      c.beginPath();
      c.arc(t.x, t.z, t.type === 'boss' ? 2.6 : 1.7, 0, 7);
      c.fill();
      if (!hostile) {
        c.strokeStyle = '#fff';
        c.lineWidth = 0.4;
        c.stroke();
      }
    }
    c.restore();
    // oyuncu oku (hep yukarı bakar)
    c.save();
    c.translate(R, R);
    c.rotate(m.alive ? -Math.PI / 2 - yaw + m.a + Math.PI / 2 : 0);
    c.fillStyle = m.alive ? '#ffffff' : '#888';
    c.beginPath();
    c.moveTo(0, -9);
    c.lineTo(6.5, 7);
    c.lineTo(0, 3.5);
    c.lineTo(-6.5, 7);
    c.closePath();
    c.fill();
    c.restore();
  }

  toggleScoreboard(on, g) {
    $('scoreboard').hidden = !on;
    if (on && g) this.renderScoreboard(g);
  }

  renderScoreboard(g) {
    const rows = [...g.scores.entries()].map(([id, s]) => ({ id, s, t: g.tanks.get(id) })).filter(r => r.t && r.t.kind !== 'enemy');
    rows.sort((a, b) => (g.mode === 'dm' ? b.s.k - a.s.k || a.s.d - b.s.d : b.s.s - a.s.s));
    const html = `<table class="results"><thead><tr><th></th><th>Oyuncu</th><th>Vuruş</th><th>Ölüm</th><th>Puan</th></tr></thead><tbody>${rows.map((r, i) =>
      `<tr class="${r.id === g.myId ? 'me' : ''}"><td>${i + 1}</td><td><span class="dot" style="background:${esc(r.t.color)}"></span>${esc(r.t.name)}</td><td>${r.s.k}</td><td>${r.s.d}</td><td>${r.s.s}</td></tr>`).join('')}</tbody></table>`;
    if (html !== this._sb) {
      this._sb = html;
      $('scoreboard').innerHTML = html;
    }
  }

  showResults(r, g) {
    const A = this.app;
    this.app.input.setEnabled(false);
    $('hud').hidden = true;
    let title, sub;
    if (r.mode === 'coop') {
      title = 'Oyun Bitti';
      const total = r.rows.filter(x => !x[6] && x[0] < 1000).reduce((a, x) => a + x[5], 0);
      sub = `${r.wave}. dalgaya kadar dayandınız · Takım puanı ${total}`;
    } else {
      const w = r.rows[0];
      if (w && w[0] === g.myId) {
        title = 'ZAFER!';
        sub = `${w[3]} vuruşla birinci oldun`;
      } else {
        title = w ? `${w[1]} kazandı` : 'Maç bitti';
        const myRank = r.rows.findIndex(x => x[0] === g.myId) + 1;
        sub = r.reason === 'time' ? 'Süre doldu' : myRank ? `Sen ${myRank}. oldun` : '';
      }
    }
    $('resTitle').textContent = title;
    $('resSub').textContent = sub;
    const body = $('resBody');
    body.textContent = '';
    r.rows.forEach((x, i) => {
      const tr = el('tr', x[0] === g.myId ? 'me' : '');
      tr.innerHTML = `<td>${i + 1}</td><td><span class="dot" style="background:${esc(x[2])}"></span>${esc(x[1])}${x[6] ? ' <em style="opacity:.6;font-style:normal">(bot)</em>' : ''}</td><td>${x[3]}</td><td>${x[4]}</td><td>${x[5]}</td>`;
      body.appendChild(tr);
    });
    const host = g.session.isHost;
    $('againBtn').hidden = !host;
    $('resLobbyBtn').textContent = g.session.solo ? 'Ana Menü' : host ? 'Lobiye Dön' : 'Odadan Çık';
    if (!host) $('resSub').textContent = sub + ' · Oda sahibi yeni maçı başlatabilir';
    this.show('scrResults', false);
    this.stack = [];
  }
}
