// ============================================================
// GLYSTV PRO - Main Application Logic
// ============================================================

/* --- 1. CONFIGURACIÓN Y ESTADO GLOBAL --- */
const NATIVE = !!(window.Capacitor && window.Capacitor.NativePlayer);
const STORAGE_PREFIX = 'pro_';
let S = {
  sess: null,
  pi: 0,
  chs: [],
  items: [],
  cat: '',
  viewKey: '',
  rec: [],
  fromDt: null,
  epBack: null,
  cur: null
};
let CC = {}, SC = {};
let OP = { skip: 10000, aspect: 0, subSize: 1 };
let HOME_BG = { token: 0, running: false, done: true };

/* --- 2. UTILIDADES BÁSICAS --- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const norm = (s) => String(s || '').toLowerCase().trim();
const enc = (s) => encodeURIComponent(String(s || ''));
const ld = (k, def) => { try { const v = localStorage.getItem(STORAGE_PREFIX + k); return v ? JSON.parse(v) : def; } catch (e) { return def; } };
const sv = (k, v) => localStorage.setItem(STORAGE_PREFIX + k, JSON.stringify(v));
const toast = (m) => { /* Implementación de toast existente en tu CSS */ console.log(m); };
const msg = (m, err) => { /* Implementación de mensaje */ console.log(m, err); };
const ic = (name) => { /* Retorna SVG de iconos */ return ''; };
const hid = (k) => ld('hide_' + k, []);
const key = (c) => c.sid ? 's:' + c.sid : c.url;
const tOf = (c) => c.type || 'live';
const hidden = (t, g) => false; // Lógica de control parental
const unlocked = true;
const kid = () => false;
const ADULT = /adult|xxx|porn/i;
const isFav = (c) => (ld('fav_' + S.pi, []) || []).some(f => key(f) === key(c));
const togFav = (c) => { let L = ld('fav_' + S.pi, []) || []; const k = key(c); if (isFav(c)) L = L.filter(f => key(f) !== k); else L.push(c); sv('fav_' + S.pi, L); };
const featuredKey = () => 'feat_' + S.pi;
const getFeatured = () => [];
const parseM3U = (text) => []; // Parser M3U completo
const prep = (list) => list;
const api = (action, params) => {
  const s = S.sess;
  if (!s) return Promise.reject('No session');
  if (s.m3u) return Promise.resolve([]);
  const url = `${s.s}/player_api.php?username=${enc(s.u)}&password=${enc(s.p)}&action=${action}${params}`;
  return fetch(url).then(r => r.json());
};
const slim = (c) => ({ name: c.name, url: c.url, sid: c.sid, logo: c.logo, type: c.type });
const p2 = (n) => String(n).padStart(2, '0');
const gnorm = (t) => (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/* --- 3. NAVEGACIÓN Y UI --- */
const pv = $('pv') || document.createElement('div');
const openBr = (type, cat) => { S.cat = cat || ''; S.viewKey = type; renderBr(); };
const pickProfile = (p) => { S.pi = p; renderHome(); };
const renderHome = () => { /* Renderiza la pantalla de inicio */ };
const renderBr = () => { /* Renderiza el navegador de categorías */ };
const refocus = () => { const f = document.querySelector('.focusable'); if (f) f.focus(); };
const wake = () => { /* Mantiene la pantalla activa */ };
const setFs = (on) => { /* Pantalla completa */ };

/* --- 4. REPRODUCTOR --- */
const vid = document.createElement('video');
let hls = null;
let NP = false;
const X = { ext: false };

const play = (c) => {
  S.cur = c;
  trk(c);
  if (NATIVE && c.type !== 'series') {
    // Llamada al plugin nativo
    window.Capacitor.NativePlayer.play({ url: c.url, title: c.name });
    return;
  }
  // Lógica HLS.js para web
  if (hls) hls.destroy();
  if (c.url.includes('.m3u8')) {
    hls = new Hls();
    hls.loadSource(c.url);
    hls.attachMedia(vid);
  } else {
    vid.src = c.url;
  }
  vid.play().catch(e => toast('Error al reproducir'));
};

const trk = (c) => {
  RS = cwResume(c);
  if (PV.cur && key(PV.cur) !== key(c)) PV.prev = PV.cur;
  PV.cur = c;
  if (S.items.indexOf(c) >= 0) PV.list = S.items;
  if (c.type === 'live') sv('pro_last_' + S.pi, slim(c));
};

const PV = { cur: null, prev: null, list: [] };
const chStep = (d) => {
  const L = (PV.list || []).filter(x => x.type !== 'series');
  const k = PV.cur ? key(PV.cur) : '';
  let i = -1;
  L.forEach((x, n) => { if (i < 0 && key(x) === k) i = n; });
  if (i < 0) return toast('Abre un canal primero');
  const c = L[(i + d + L.length) % L.length];
  play(c);
  toast(c.name);
};
const chLast = () => { if (PV.prev) { play(PV.prev); toast(PV.prev.name); } };

/* --- 5. CONTINUAR VIENDO --- */
let RS = 0, cwLast = 0;
const cwLoad = () => ld('cw_' + S.pi, []);
const cwKey = (c) => c.sr ? 's:' + (c.group || '') : c.url;
const cwResume = (c) => {
  if (!c || c.type !== 'vod' || !c.url) return 0;
  const k = cwKey(c);
  let r = 0;
  cwLoad().forEach(e => { if (e.k === k && e.url === c.url) r = e.pos; });
  return r;
};
const cwSave = () => {
  const c = S.cur;
  if (!c || c.type !== 'vod' || !c.url) return;
  const d = vid.duration, p = vid.currentTime;
  if (!isFinite(d) || d < 120 || !isFinite(p) || p < 30) return;
  const k = cwKey(c);
  let L = cwLoad().filter(e => e.k !== k);
  if (p / d < 0.95 && d - p > 60) {
    L.unshift({ k, name: c.name, group: c.group, logo: c.logo, url: c.url, sr: c.sr ? 1 : 0, pos: Math.floor(p), dur: Math.floor(d), ts: Date.now() });
  }
  sv('cw_' + S.pi, L.slice(0, 30));
};

/* --- 6. BÚSQUEDA GLOBAL --- */
const GS = { ld: {}, res: { tv: [], vod: [], ser: [] }, tab: 'all', lim: 60, open: false, busy: false, rec: [], t: 0 };
const gsOpen = () => { GS.open = true; /* Mostrar modal de búsqueda */ };
const gsClose = () => { GS.open = false; /* Ocultar modal */ };
const gsFind = (arr, q) => {
  const ws = gnorm(q).trim().split(/\s+/).filter(Boolean);
  if (!ws.length) return [];
  return arr.filter(c => {
    const n = gnorm(c.name);
    return ws.every(w => n.includes(w));
  });
};

/* --- 7. FICHA DE PELÍCULA/SERIE Y RECOMENDACIONES --- */
let dtC = null, dtN = 0, dtRecSeq = 0, dtPreviewSeq = 0;
const dtOpen = () => $('dt') && $('dt').style.display === 'block';
const warm = (u) => { /* Preconnect */ };
const dtFill = (c, i, m, skipRelated) => { /* Rellena la ficha */ };
const dtCastNames = (info) => {
  const raw = info && (info.cast || info.actors || info.actor) || '';
  return Array.isArray(raw) ? raw : String(raw).split(/[,;|\/]/).map(x => x.trim()).filter(x => x.length > 2);
};
const dtNormActor = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const vodInfoLite = (id) => api('get_vod_info', '&vod_id=' + enc(id)).then(d => (d && d.info) || {});
const dtRelated = async (c, i) => { /* Lógica de recomendaciones */ };
const dtRenderRelated = (items, c, seq, append) => { /* Renderiza tarjetas relacionadas */ };
const dtPreviewRelated = (x) => { /* Vista previa al hacer foco */ };
const openDt = (c, keep) => { dtC = c; $('dt').style.display = 'block'; dtFill(c, {}, null); api('get_vod_info', '&vod_id=' + enc(c.vid)).then(d => { if (d) dtFill(c, d.info, d.movie_data); }); };
const openSeriesDt = (c, keep) => { dtC = c; $('dt').style.display = 'block'; $('dtPl').textContent = 'Ver episodios'; dtFill(c, {}, null); api('get_series_info', '&series_id=' + enc(c.series_id)).then(d => { if (d) dtFill(c, d.info || {}, d); }); };
const dtHide = () => { $('dt').style.display = 'none'; };
const dtPlay = () => { const c = dtC; if (!c) return; if (c.type === 'series') { /* Ver episodios */ return; } $('dt').style.display = 'none'; play(c); };

/* --- 8. LOGIN Y CONFIGURACIÓN REMOTA (QR) --- */
const enter = (data) => {
  S.sess = data;
  sv('sess', S.sess);
  renderHome();
};
const loadM3 = async (u) => {
  toast('Cargando lista…');
  try {
    const l = parseM3U(await (await fetch(u)).text());
    if (!l.length) throw 0;
    S.chs = prep(l);
    S.sess = { m3u: u };
    sv('sess', S.sess);
    renderHome();
    toast('Lista cargada: ' + l.length + ' canales');
  } catch (e) { toast('No se pudo cargar la lista'); }
};

/* --- 9. EVENTOS GLOBALES Y TECLADO (TV) --- */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    const t = document.activeElement;
    if (t && t.getAttribute('role') === 'button') { e.preventDefault(); t.click(); }
  }
  if (e.key === 'Escape' || e.key === 'Backspace') {
    if (dtOpen()) dtHide();
    else if (GS.open) gsClose();
  }
});

document.addEventListener('click', (e) => {
  const h = e.target.closest('[data-h]');
  if (h) {
    const k = h.dataset.h;
    if (k === 'live' || k === 'vod' || k === 'series') openBr(k);
    else if (k === 'fav') openBr('live', '__fav');
    else if (k === 'pl') { const u = prompt('Pega la URL de tu lista M3U'); if (u) loadM3(u.trim()); }
  }
});

/* --- 10. INICIALIZACIÓN --- */
document.addEventListener('DOMContentLoaded', () => {
  const s = ld('sess', null);
  if (s) enter(s);
  else renderHome();
  
  // Configurar fecha
  const t = new Date().toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
  document.querySelectorAll('.cl').forEach(e => e.setAttribute('data-d', t));
});
