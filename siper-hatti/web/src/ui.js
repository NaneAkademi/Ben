// Menüler, garaj, lobi ve oyun içi arayüz (HTML katmanı).
import * as THREE from 'three';
import { PLAYER_COLORS, THEMES, TYPES, CLASS_LIST, AMMO, CONSUMABLES, ARENA, MAX_PLAYERS, VERSION, levelXp } from './config.js';
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

const ICONS = {
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  key: '<path d="M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  scope: '<circle cx="12" cy="12" r="8"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1"/>',
  smoke: '<path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9z"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8z"/>',
};
const icon = n => `<svg class="ic" viewBox="0 0 24 24">${ICONS[n] || ''}</svg>`;

const MAP_OPTS = [['random', 'Rastgele'], ['meadow', THEMES.meadow.name], ['desert', THEMES.desert.name], ['snow', THEMES.snow.name]];
const DIFF_OPTS = [[0, 'Kolay'], [1, 'Normal'], [2, 'Zor']];
const TIPS = [
  'İpucu: Dururken nişan halkası daralır, isabetin artar.',
  'İpucu: Tankların arkası en zayıf yeridir.',
  'İpucu: Açılı gelen mermi zırhtan seker. Tankını düşmana hafif açılı tut.',
  'İpucu: Alçak beton bariyerlerin arkasında gövdeni sakla, taretinle ateş et.',
  'İpucu: Yüksek patlayıcı (YP) mermi sekmez, alan hasarı verir.',
  'İpucu: Sis perdesi botların seni görmesini engeller.',
];

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
    this.keys = {};
    this.fpsAcc = 0;
    this.fpsN = 0;
    this.setTab = 'gfx';
    for (const i of document.querySelectorAll('i[data-ic]')) i.outerHTML = icon(i.dataset.ic);
    $('loadTip').textContent = TIPS[(Math.random() * TIPS.length) | 0];
    $('ver').textContent = 'Siper Hattı ' + VERSION;
    this._wire();
    this.renderGarage();
    this.renderProfile();
  }

  // ---------- ekran yönetimi ----------
  show(id, push = true) {
    if (push && this.screen && this.screen !== id) this.stack.push(this.screen);
    const modal = document.getElementById(id).classList.contains('modal');
    for (const s of document.querySelectorAll('.screen')) {
      // alttaki ana menü, modal açıkken görünür kalır
      s.hidden = !(s.id === id || (modal && s.id === 'scrMenu' && !this.app.game));
    }
    this.screen = id;
    if (id === 'scrSettings') this.renderSettings();
    if (id === 'scrProfile') this.renderProfileSheet();
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
    setTimeout(() => $('loading').remove(), 600);
  }

  _wire() {
    const A = this.app;
    document.addEventListener('pointerdown', () => sfx.unlock(), { capture: true });
    document.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (b && !b.closest('#ctrl')) sfx.click();
      const go = e.target.closest('[data-go]');
      if (go) {
        const map = { join: 'scrJoin', settings: 'scrSettings', help: 'scrHelp' };
        if (go.dataset.go === 'join') {
          $('joinMsg').textContent = '';
          setTimeout(() => $('codeIn').focus(), 60);
        }
        this.show(map[go.dataset.go]);
      }
      if (e.target.closest('[data-back]')) A.back();
    });
    $('profileBtn').onclick = () => this.show('scrProfile');
    const nameIn = $('nameIn');
    nameIn.value = A.settings.name || '';
    nameIn.addEventListener('input', () => {
      A.setProfile({ name: nameIn.value });
      this.renderProfile();
    });
    $('tankPrev').onclick = () => this.cycleTank(-1);
    $('tankNext').onclick = () => this.cycleTank(1);
    for (const b of $('modeTabs').children) {
      b.onclick = () => {
        A.soloCfg.mode = b.dataset.mode;
        A.saveSettings();
        this.renderGarage();
      };
    }
    $('playBtn').onclick = () => {
      this.renderSolo();
      this.show('scrSolo');
    };
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
    for (const b of $('setTabs').children) {
      b.onclick = () => {
        this.setTab = b.dataset.tab;
        this.renderSettings();
      };
    }
  }

  // ---------- garaj ----------
  cycleTank(d) {
    const A = this.app;
    const i = CLASS_LIST.indexOf(A.settings.tank);
    A.settings.tank = CLASS_LIST[(i + d + CLASS_LIST.length) % CLASS_LIST.length];
    A.saveSettings();
    A.garageTankChanged();
    this.renderGarage();
  }

  renderGarage() {
    const A = this.app, S = A.settings;
    const spec = TYPES[S.tank] || TYPES.medium;
    $('tankTitle').textContent = spec.name.toUpperCase();
    $('tankRole').textContent = spec.role;
    const st = spec.stats;
    const rows = [
      ['Ateş gücü', st.fire, spec.dmg],
      ['Zırh', st.armor, spec.hp],
      ['Hız', st.speed, Math.round(spec.speed * 3.6) + ''],
      ['Doldurma', st.reload, spec.reload.toFixed(1) + 's'],
    ];
    $('tankStats').innerHTML = rows.map(([n, v, t]) => `<div class="stat"><span>${n}</span><span class="bar"><i style="width:${Math.round(v * 100)}%"></i></span><b>${t}</b></div>`).join('');
    const sw = $('colors');
    sw.textContent = '';
    const lvl = A.level;
    for (const c of PLAYER_COLORS) {
      const b = el('button');
      b.style.background = c.hex;
      b.title = c.name;
      b.setAttribute('aria-label', c.name);
      if (c.lvl > lvl) {
        b.classList.add('locked');
        b.dataset.lvl = 'Sv' + c.lvl;
        b.onclick = () => this.toast(`${c.name} kamuflajı ${c.lvl}. seviyede açılır`);
      } else {
        b.onclick = () => {
          A.setProfile({ color: c.hex });
          this.renderGarage();
        };
      }
      if (c.hex === S.color) b.classList.add('sel');
      sw.appendChild(b);
    }
    for (const b of $('modeTabs').children) b.classList.toggle('on', b.dataset.mode === A.soloCfg.mode);
    const map = MAP_OPTS.find(m => m[0] === A.soloCfg.theme);
    $('playSub').textContent = `Tek oyuncu · ${map ? map[1] : 'Rastgele'} · ${DIFF_OPTS[A.soloCfg.diff][1]}`;
  }

  renderProfile() {
    const A = this.app;
    const lvl = A.level, xp = A.settings.xp || 0;
    const a = levelXp(lvl), b = levelXp(lvl + 1);
    $('lvlNum').textContent = lvl;
    $('pName').textContent = A.myName;
    $('xpFill').style.width = Math.round(((xp - a) / Math.max(1, b - a)) * 100) + '%';
    $('xpText').textContent = `${xp - a} / ${b - a} TP`;
  }

  renderProfileSheet() {
    const s = this.app.settings.stats || {};
    const items = [['Maç', s.matches || 0], ['Galibiyet', s.wins || 0], ['İmha', s.kills || 0], ['En iyi dalga', s.bestWave || 0]];
    $('profStats').innerHTML = items.map(([n, v]) => `<div><b>${v}</b><small>${n.toUpperCase()}</small></div>`).join('');
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
  slider(label, value, min, max, step, onInput, fmt = v => v) {
    const w = el('div', 'opt');
    const lab = el('span', null, `${esc(label)} · <b>${fmt(value)}</b>`);
    w.appendChild(lab);
    const r = el('input');
    r.type = 'range';
    r.min = min;
    r.max = max;
    r.step = step;
    r.value = value;
    r.oninput = () => {
      onInput(+r.value);
      lab.innerHTML = `${esc(label)} · <b>${fmt(+r.value)}</b>`;
    };
    w.appendChild(r);
    return w;
  }
  modeCards(value, onChange, locked) {
    const w = el('div', 'mode-cards');
    for (const [v, t, d] of [['coop', 'HAYATTA KAL', 'Düşman dalgalarına karşı birlikte'], ['dm', 'ÖLÜM MAÇI', 'Herkes birbirine karşı (botlarla)']]) {
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
    box.appendChild(this.seg('HARİTA', MAP_OPTS, cfg.theme, v => onChange({ theme: v }), locked));
    box.appendChild(this.seg('ZORLUK', DIFF_OPTS, cfg.diff, v => onChange({ diff: v }), locked));
    if (cfg.mode === 'dm') {
      const bo = [];
      for (let i = solo ? 1 : 0; i <= 6; i++) bo.push([i, String(i)]);
      box.appendChild(this.seg('BOT SAYISI', bo, cfg.bots, v => onChange({ bots: v }), locked));
      box.appendChild(this.seg('KAZANMAK İÇİN VURUŞ', [[5, '5'], [10, '10'], [15, '15'], [20, '20']], cfg.limit, v => onChange({ limit: v }), locked));
    }
  }

  renderSolo() {
    const A = this.app, cfg = A.soloCfg;
    this.matchOpts($('soloOpts'), cfg, ch => {
      Object.assign(cfg, ch);
      if (cfg.mode === 'dm' && cfg.bots < 1) cfg.bots = 3;
      A.saveSettings();
      this.renderSolo();
      this.renderGarage();
    }, false, true);
  }

  renderSettings() {
    const A = this.app, S = A.settings, box = $('setOpts');
    box.textContent = '';
    for (const b of $('setTabs').children) b.classList.toggle('on', b.dataset.tab === this.setTab);
    const inGame = !!A.game;
    const tg = (label, key, after) => box.appendChild(this.toggle(label, S[key], v => {
      S[key] = v;
      A.saveSettings();
      A.applySettings();
      if (after) after(v);
      this.renderSettings();
    }));
    if (this.setTab === 'gfx') {
      box.appendChild(this.seg('GRAFİK KALİTESİ', [['auto', 'Otomatik'], ['low', 'Düşük'], ['medium', 'Orta'], ['high', 'Yüksek']], S.quality, v => {
        if (inGame) return this.toast('Grafik kalitesini menüdeyken değiştirebilirsin.');
        S.quality = v;
        A.saveSettings();
        this.toast('Grafik ayarı uygulanıyor…');
        setTimeout(() => location.reload(), 500);
      }));
      box.appendChild(this.slider('PARLAKLIK', S.brightness, 0.7, 1.5, 0.05, v => {
        S.brightness = v;
        A.stage.setBrightness(v);
        A.saveSettings();
      }, v => Math.round(v * 100) + '%'));
      tg('FPS göster', 'fps');
      tg('Kamera sarsıntısı', 'shake');
    } else if (this.setTab === 'snd') {
      box.appendChild(this.slider('SES SEVİYESİ', S.volume, 0, 1, 0.05, v => {
        S.volume = v;
        sfx.setVolume(v);
        A.saveSettings();
      }, v => Math.round(v * 100) + '%'));
      tg('Titreşim', 'vibrate');
    } else {
      box.appendChild(this.slider('NİŞAN HASSASİYETİ', S.sens, 0.4, 2.2, 0.05, v => {
        S.sens = v;
        A.applySettings();
        A.saveSettings();
      }, v => v.toFixed(2) + 'x'));
      tg('Nişan yardımı', 'assist');
      tg('Dikey eksen ters', 'invertY');
    }
  }

  // ---------- lobi ----------
  renderLobby(session) {
    if (!session) return;
    const host = session.isHost;
    $('roomCode').textContent = session.code || '----';
    const list = $('plist');
    list.textContent = '';
    for (const p of session.players) {
      const li = el('li');
      const dot = el('span', 'dot');
      dot.style.background = p.color;
      li.appendChild(dot);
      const spec = TYPES[p.tank] || TYPES.medium;
      li.appendChild(el('span', 'pinfo', `<span>${esc(p.name)}${p.id === session.myId ? ' <small style="display:inline">(sen)</small>' : ''}</span><small>${spec.name} · ${spec.role}</small>`));
      li.appendChild(p.id === 1 ? el('span', 'tag host', 'ODA SAHİBİ') : el('span', 'tag' + (p.ready ? ' ok' : ''), p.ready ? 'HAZIR' : 'BEKLİYOR'));
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
    this.keys = {};
    this.app.input.setEnabled(true);
    $('fps').hidden = !this.app.settings.fps;
    $('tankName').textContent = game.me ? game.me.spec.name.toUpperCase() : '';
  }

  endHud() {
    $('hud').hidden = true;
    $('hud').classList.remove('zoom');
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

  replay(e, cls) {
    e.classList.remove(cls);
    void e.offsetWidth;
    e.classList.add(cls);
  }

  hitInfo(text, kind) {
    const h = $('hitInfo');
    h.textContent = text;
    h.className = kind || '';
    this.replay(h, 'show');
  }

  hitMarker(kill) {
    const c = $('crosshair');
    c.style.transform = 'scale(1.8)';
    setTimeout(() => (c.style.transform = ''), 90);
    if (kill) this.app.vibrate(30);
  }

  dmgNumber(x, y, z, v, crit) {
    V.set(x, y, z).project(this.app.stage.camera);
    if (V.z > 1) return;
    const d = el('div', crit ? 'crit' : '', '-' + v);
    d.style.transform = `translate(${((V.x + 1) / 2) * this.app.stage.w}px, ${((1 - V.y) / 2) * this.app.stage.h}px) translate(-50%,-100%)`;
    $('dmgNums').appendChild(d);
    setTimeout(() => d.remove(), 1150);
  }

  killNotice(name, pts) {
    const k = $('killNotice');
    k.innerHTML = `<b>İMHA EDİLDİ</b><span>${esc(name)} · +${pts}</span>`;
    this.replay(k, 'show');
  }

  damageDir(rel) {
    const d = el('div');
    d.style.transform = `rotate(${(rel * 180) / Math.PI}deg)`;
    $('dmgdir').appendChild(d);
    setTimeout(() => d.remove(), 1000);
  }

  flashDamage() {
    const v = $('vignette');
    v.classList.add('hit');
    clearTimeout(this.vigT);
    this.vigT = setTimeout(() => v.classList.remove('hit'), 140);
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

  set(key, id, prop, val) {
    if (this.keys[key] === val) return;
    this.keys[key] = val;
    const e = $(id);
    if (prop === 'text') e.textContent = val;
    else if (prop === 'html') e.innerHTML = val;
    else e.style[prop] = val;
  }

  hudTick(g, dt) {
    const m = g.me;
    if (!m) return;
    const cam = this.app.stage.camera, W = this.app.stage.w, H = this.app.stage.h;
    $('hud').classList.toggle('zoom', g.cam.zoom);
    // can
    const hp = Math.max(0, Math.round(m.hp)), frac = hp / m.maxHp;
    this.set('hp', 'hpText', 'text', String(hp));
    this.set('hpw', 'hpFill', 'width', Math.round(frac * 100) + '%');
    const hpc = frac < 0.3 ? 'hp-bar low' : frac < 0.6 ? 'hp-bar mid' : 'hp-bar';
    if (this.keys.hpc !== hpc) {
      this.keys.hpc = hpc;
      $('hpFill').parentElement.className = hpc;
      $('vignette').classList.toggle('low', frac < 0.3 && m.alive);
    }
    // doldurma
    const full = m.spec.reload * (m.ammo === 'he' ? AMMO.he.reloadMul : 1) * (m.rapidT > 0 ? 0.6 : 1);
    const rf = m.alive ? clamp(1 - Math.max(0, m.reload) / full, 0, 1) : 0;
    this.set('rl', 'reloadFill', 'width', Math.round(rf * 100) + '%');
    const rtxt = !m.alive ? '—' : rf >= 1 ? `${AMMO[m.ammo].short} · HAZIR` : `${AMMO[m.ammo].short} · ${Math.max(0, m.reload).toFixed(1)} s`;
    this.set('rt', 'reloadText', 'text', rtxt);
    const rl = $('reloadFill').parentElement;
    if (this.keys.rr !== (rf >= 1)) {
      this.keys.rr = rf >= 1;
      rl.classList.toggle('ready', rf >= 1);
    }
    this.ring($('btnFire'), rf);
    this.ring($('btnSmoke'), 1 - Math.max(0, m.smokeCd) / CONSUMABLES.smoke.cd);
    this.ring($('btnRepair'), 1 - Math.max(0, m.repairCd) / CONSUMABLES.repair.cd);
    if (this.keys.ammo !== m.ammo) {
      this.keys.ammo = m.ammo;
      $('btnAP').classList.toggle('on', m.ammo === 'ap');
      $('btnHE').classList.toggle('on', m.ammo === 'he');
    }
    // maç bilgisi
    let info;
    const my = g.scores.get(g.myId) || { k: 0, d: 0, s: 0 };
    if (g.mode === 'coop') {
      let total = 0;
      for (const [id, s] of g.scores) {
        const t = g.tanks.get(id);
        if (!t || t.kind === 'player') total += s.s;
      }
      info = `<span class="pill"><b>DALGA ${Math.max(1, g.wave)}</b>${g.enemiesLeft} düşman</span><span class="pill"><b>${total}</b>puan</span>`;
    } else {
      let lead = null, lk = -1;
      for (const [id, s] of g.scores) if (id !== g.myId && s.k > lk && g.tanks.get(id)) {
        lk = s.k;
        lead = g.tanks.get(id);
      }
      info = `<span class="pill"><b>${my.k}/${g.cfg.limit}</b>sen</span>${lead ? `<span class="pill"><b>${lk}</b>${esc(lead.name)}</span>` : ''}<span class="pill"><b>${fmtTime(g.timeLeft)}</b></span>`;
    }
    this.set('info', 'matchInfo', 'html', info);

    // nişan halkası ve nişangâh
    const gm = $('gunMarker');
    const mk = g.aim.marker;
    if (mk && m.alive) {
      V.set(mk.x, mk.y, mk.z).project(cam);
      if (V.z < 1) {
        const r = Math.max(9, (m.disp / Math.tan((cam.fov * Math.PI) / 360)) * (H / 2));
        gm.style.width = gm.style.height = r * 2 + 'px';
        gm.style.transform = `translate(${((V.x + 1) / 2) * W - r}px, ${((1 - V.y) / 2) * H - r}px)`;
        gm.className = 'on' + (g.aim.target ? ' enemy' : rf >= 1 ? ' ready' : '');
      } else gm.className = '';
    } else gm.className = '';
    $('crosshair').classList.toggle('enemy', !!g.aim.target);
    if (g.cam.zoom) this.set('rng', 'range', 'text', Math.round(g.aim.dist || 0) + ' m');

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
      this.mmT = 1 / 20;
      this.drawMinimap(g);
    }
    if (!$('scoreboard').hidden) this.renderScoreboard(g);
    if (this.app.settings.fps) {
      this.fpsAcc += dt;
      this.fpsN++;
      if (this.fpsAcc > 0.5) {
        $('fps').textContent = Math.round(this.fpsN / this.fpsAcc) + ' FPS · ' + this.app.stage.dpr.toFixed(2) + 'x' + (g.session.solo || g.isHost ? '' : ` · ${Math.round(this.app.net ? this.app.net.rtt : 0)} ms`);
        this.fpsAcc = this.fpsN = 0;
      }
    }
  }

  ring(btn, frac) {
    frac = clamp(frac, 0, 1);
    const c = btn.querySelector('circle');
    if (!c) return;
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
      if (d > (enemy ? 55 : 90)) continue;
      if (g.inSmoke(t.x, t.z)) continue;
      V.set(t.x, t.baseY + t.hh + 0.9, t.z).project(cam);
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
      const label = enemy ? t.name : t.name;
      if (L.name !== label) {
        L.name = label;
        L.b.textContent = label;
      }
      L.b.style.color = hostile ? '#ffb4a8' : t.color;
      L.el.style.color = hostile ? '#ff5a48' : '#52d86a';
      const hp = Math.round((100 * Math.max(0, t.hp)) / t.maxHp);
      if (hp !== L.hp) {
        L.hp = hp;
        L.u.style.width = hp + '%';
      }
      L.el.style.transform = `translate(${((V.x + 1) / 2) * W}px, ${((1 - V.y) / 2) * H}px) translate(-50%, -100%)`;
      L.el.style.opacity = d > 60 ? 0.7 : 1;
    }
    for (const [id, L] of this.labels) if (!seen.has(id)) {
      L.el.remove();
      this.labels.delete(id);
    }
  }

  drawMinimap(g) {
    const c = this.mm, S = 220, R = 110, m = g.me, yaw = g.cam.yaw;
    const k = R / 45;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, S, S);
    c.save();
    c.beginPath();
    c.roundRect ? c.roundRect(2, 2, S - 4, S - 4, 26) : c.rect(2, 2, S - 4, S - 4);
    c.clip();
    c.translate(R, R);
    c.rotate(-Math.PI / 2 - yaw);
    c.scale(k, k);
    c.translate(-m.x, -m.z);
    c.strokeStyle = 'rgba(255,178,63,0.6)';
    c.lineWidth = 2 / k;
    c.strokeRect(-ARENA, -ARENA, ARENA * 2, ARENA * 2);
    for (const r of g.world.roads) {
      c.strokeStyle = 'rgba(200,180,140,0.35)';
      c.lineWidth = 4;
      c.beginPath();
      r.pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
      c.stroke();
    }
    for (const p of g.world.ponds) {
      c.fillStyle = p.ice ? 'rgba(200,225,240,0.5)' : 'rgba(80,160,210,0.6)';
      c.beginPath();
      c.arc(p.x, p.z, p.r, 0, 7);
      c.fill();
    }
    for (const o of g.world.obstacles) {
      if (!o.alive || o.kind === 'pond' || Math.abs(o.x - m.x) > 70 || Math.abs(o.z - m.z) > 70) continue;
      c.fillStyle = o.kind === 'barrel' ? 'rgba(230,70,50,0.9)' : o.h > 2 ? 'rgba(225,225,215,0.8)' : 'rgba(170,165,150,0.65)';
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
    for (const s of g.smokes) {
      c.fillStyle = 'rgba(230,230,230,0.35)';
      c.beginPath();
      c.arc(s.x, s.z, s.r, 0, 7);
      c.fill();
    }
    for (const p of g.pickups.values()) {
      c.fillStyle = p.type === 'repair' ? '#57d163' : '#ffb13b';
      c.fillRect(p.x - 1.4, p.z - 1.4, 2.8, 2.8);
    }
    for (const t of g.tanks.values()) {
      if (t === m || !t.alive || !t.seen) continue;
      const hostile = t.team !== m.team;
      c.fillStyle = hostile ? '#ff5040' : t.color;
      c.save();
      c.translate(t.x, t.z);
      c.rotate(t.a);
      const s = t.type === 'boss' ? 1.6 : 1;
      c.beginPath();
      c.moveTo(2.6 * s, 0);
      c.lineTo(-1.8 * s, -1.6 * s);
      c.lineTo(-1.8 * s, 1.6 * s);
      c.closePath();
      c.fill();
      if (!hostile) {
        c.strokeStyle = '#fff';
        c.lineWidth = 0.4;
        c.stroke();
      }
      c.restore();
    }
    c.restore();
    // görüş konisi ve oyuncu
    c.save();
    c.translate(R, R);
    c.fillStyle = 'rgba(255,255,255,0.08)';
    c.beginPath();
    c.moveTo(0, 0);
    c.arc(0, 0, R, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
    c.fill();
    c.rotate(m.alive ? m.a - yaw : 0);
    c.fillStyle = m.alive ? '#ffffff' : '#888';
    c.beginPath();
    c.moveTo(0, -10);
    c.lineTo(7, 8);
    c.lineTo(0, 4);
    c.lineTo(-7, 8);
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

  showResults(r, g, xp) {
    this.app.input.setEnabled(false);
    $('hud').hidden = true;
    let title, sub, win = false;
    if (r.mode === 'coop') {
      title = 'OYUN BİTTİ';
      const total = r.rows.filter(x => !x[6]).reduce((a, x) => a + x[5], 0);
      sub = `${r.wave}. dalgaya kadar dayandınız · Takım puanı ${total}`;
    } else {
      const w = r.rows[0];
      win = !!(w && w[0] === g.myId);
      title = win ? 'ZAFER' : 'YENİLGİ';
      const myRank = r.rows.findIndex(x => x[0] === g.myId) + 1;
      sub = win ? `${w[3]} vuruşla birinci oldun` : `${w ? w[1] + ' kazandı' : ''}${myRank ? ` · Sen ${myRank}. oldun` : ''}${r.reason === 'time' ? ' · Süre doldu' : ''}`;
    }
    const h = $('resTitle');
    h.textContent = title;
    h.className = r.mode === 'coop' ? '' : win ? 'win' : 'lose';
    $('resSub').textContent = sub;
    const st = g.stats;
    const acc = st.shots ? Math.round((st.hits / st.shots) * 100) : 0;
    $('resStats').innerHTML = [['İMHA', st.kills], ['HASAR', st.dmg], ['İSABET', acc + '%'], ['ALINAN HASAR', st.taken]]
      .map(([n, v]) => `<div><b>${v}</b><small>${n}</small></div>`).join('');
    const body = $('resBody');
    body.textContent = '';
    r.rows.forEach((x, i) => {
      const tr = el('tr', x[0] === g.myId ? 'me' : '');
      tr.innerHTML = `<td>${i + 1}</td><td><span class="dot" style="background:${esc(x[2])}"></span>${esc(x[1])}${x[6] ? ' <small style="opacity:.6">(bot)</small>' : ''}</td><td>${x[3]}</td><td>${x[4]}</td><td>${x[5]}</td>`;
      body.appendChild(tr);
    });
    const xg = $('xpGain');
    if (xp) {
      const a = levelXp(xp.level), b = levelXp(xp.level + 1);
      const before = clamp(((xp.before - levelXp(xp.levelBefore)) / Math.max(1, levelXp(xp.levelBefore + 1) - levelXp(xp.levelBefore))) * 100, 0, 100);
      xg.innerHTML = `<div class="row"><span>${xp.parts.map(p => `${p[0]} +${p[1]}`).join(' · ')}</span><b>+${xp.gained} TP</b></div><div class="bar"><i style="width:${xp.level > xp.levelBefore ? 0 : before}%"></i></div>${xp.level > xp.levelBefore ? `<div class="lvlup">SEVİYE ${xp.level}!</div>` : ''}`;
      setTimeout(() => {
        const i = xg.querySelector('.bar i');
        if (i) i.style.width = Math.round(((xp.after - a) / Math.max(1, b - a)) * 100) + '%';
      }, 300);
      if (xp.level > xp.levelBefore) setTimeout(() => sfx.levelUp(), 500);
    } else xg.innerHTML = '';
    const host = g.session.isHost;
    $('againBtn').hidden = !host;
    $('resLobbyBtn').textContent = g.session.solo ? 'Ana Menü' : host ? 'Lobiye Dön' : 'Odadan Çık';
    if (!host) $('resSub').textContent = sub + ' · Oda sahibi yeni maçı başlatabilir';
    this.show('scrResults', false);
    this.stack = [];
  }
}
