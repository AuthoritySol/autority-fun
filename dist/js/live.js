// Live feeds: Solana RPC (batch, commitment "confirmed") and DexScreener pairs.
// Every endpoint comes from the register; every poller backs off exponentially on failure.
import { reduced, tween, flash } from './fx.js';

const $ = (id) => document.getElementById(id);
const DASH = '—';

// ---- poller with exponential backoff --------------------------------------------------------
export function poller({ run, every, retryBase, max, onOk, onFail }) {
  let fails = 0, timer = 0, stopped = false, nextAt = 0, first = true;
  const jitter = () => 0.85 + Math.random() * 0.3;
  const schedule = (ms) => { nextAt = Date.now() + ms; timer = setTimeout(tick, ms); };
  async function tick() {
    if (stopped) return;
    if (!first && document.visibilityState === 'hidden') { schedule(every); return; }
    first = false;
    try {
      const data = await run();
      fails = 0; onOk(data);
      schedule(every);
    } catch (err) {
      fails += 1;
      const wait = Math.min(max, retryBase * 2 ** (fails - 1)) * jitter();
      onFail(err, { fails, wait, nextAt: Date.now() + wait });
      schedule(wait);
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !stopped && nextAt - Date.now() > every) { clearTimeout(timer); tick(); }
  });
  tick();
  return { stop() { stopped = true; clearTimeout(timer); }, get fails() { return fails; } };
}

async function fetchJson(url, init = {}, ms = 8000) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(to); }
}

// ---- tiles ------------------------------------------------------------------------------------
const fmtInt = new Intl.NumberFormat('en-US');
const tiles = new Map();
function tile(id) {
  if (!tiles.has(id)) {
    const root = $(id);
    tiles.set(id, { root, val: root.querySelector('.val'), shown: null, stop: null });
  }
  return tiles.get(id);
}
function setTile(id, n, { animate = true, mark = true } = {}) {
  const t = tile(id);
  const first = t.shown === null;
  const prev = t.shown ?? 0;
  t.root.removeAttribute('data-err');
  if (t.stop) t.stop();
  const paint = (v) => { t.val.textContent = fmtInt.format(Math.round(v)); };
  if (animate && (first || n !== prev)) t.stop = tween(first ? Math.max(0, n - Math.min(n, 4000)) : prev, n, first ? 900 : 500, paint);
  else paint(n);
  t.root.setAttribute('data-ready', '');
  t.shown = n;
  if (mark && !first && n !== prev) flash(t.val);
}
function dashTile(id) {
  const t = tile(id);
  if (t.stop) t.stop();
  t.val.textContent = DASH; t.shown = null;
  t.root.removeAttribute('data-ready'); t.root.setAttribute('data-err', '');
}
const note = (id, text) => { $(id).textContent = text; };

// ---- network pill + tab details -------------------------------------------------------------
function pill(state, text) {
  const p = $('net-pill'); p.dataset.state = state; $('net-pill-txt').textContent = text;
}

// ---- Solana ---------------------------------------------------------------------------------
export function startChain(reg) {
  const rpc = reg.rpc.url, commitment = reg.rpc.value;
  const cfg = { commitment };
  const body = JSON.stringify([
    { jsonrpc: '2.0', id: 1, method: 'getBlockHeight', params: [cfg] },
    { jsonrpc: '2.0', id: 2, method: 'getSlot', params: [cfg] },
    { jsonrpc: '2.0', id: 3, method: 'getEpochInfo', params: [cfg] },
  ]);
  $('kv-rpc').textContent = new URL(rpc).host;
  $('kv-commit').textContent = commitment;

  // between polls the readout counts up at the measured pace; each reply snaps it back to truth
  const live = { height: null, slot: null, rate: { height: null, slot: null }, at: 0, lastReply: 0 };
  const advance = (key, id) => {
    const base = live[key]; if (base === null) return;
    const r = live.rate[key]; if (r === null) return;
    const dt = Math.min((performance.now() - live.at) / 1000, 6);
    const v = Math.floor(base + r * dt);
    const t = tile(id);
    if (v !== t.shown && t.root.hasAttribute('data-ready')) { t.val.textContent = fmtInt.format(v); t.shown = v; }
  };
  const ticker = setInterval(() => {
    if (document.visibilityState === 'hidden' || reduced()) return;
    advance('height', 't-height'); advance('slot', 't-slot');
  }, 100);

  const sinceEl = $('kv-last');
  setInterval(() => {
    if (!live.lastReply) return;
    const s = Math.max(0, Math.round((performance.now() - live.lastReply) / 1000));
    sinceEl.textContent = `${s}s ago`;
  }, 1000);

  return poller({
    every: 2000, retryBase: 2000, max: 60000,
    run: async () => {
      const out = await fetchJson(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      const by = new Map(out.map((o) => [o.id, o]));
      for (const id of [1, 2, 3]) { const o = by.get(id); if (!o || o.error || o.result == null) throw new Error(o?.error?.message || 'empty reply'); }
      return { height: by.get(1).result, slot: by.get(2).result, epoch: by.get(3).result };
    },
    onOk: (d) => {
      const now = performance.now();
      if (live.at && live.height !== null) {
        const dt = (now - live.at) / 1000;
        for (const k of ['height', 'slot']) {
          const inst = (d[k] - live[k]) / dt;
          if (inst >= 0 && Number.isFinite(inst)) live.rate[k] = live.rate[k] === null ? inst : live.rate[k] * 0.6 + inst * 0.4;
        }
      }
      live.height = d.height; live.slot = d.slot; live.at = now; live.lastReply = now;
      setTile('t-height', d.height); setTile('t-slot', d.slot);
      const e = d.epoch;
      setTile('t-epoch', e.epoch, { mark: true });
      const frac = e.slotIndex / e.slotsInEpoch;
      $('t-epoch-bar').parentElement.style.setProperty('--v', '1');
      $('t-epoch-bar').style.setProperty('--v', frac.toFixed(4));
      note('t-height-note', `${commitment} commitment`);
      note('t-slot-note', 'latest ' + commitment);
      note('t-epoch-note', `${(frac * 100).toFixed(1)}% through · ${fmtInt.format(e.slotsInEpoch - e.slotIndex)} slots left`);
      $('kv-tx').textContent = fmtInt.format(e.transactionCount);
      $('kv-slotidx').textContent = `${fmtInt.format(e.slotIndex)} / ${fmtInt.format(e.slotsInEpoch)}`;
      $('kv-health').textContent = 'healthy';
      $('net-msg').hidden = true;
      pill('live', 'Live · Solana');
    },
    onFail: (err, { fails, wait }) => {
      for (const id of ['t-height', 't-slot', 't-epoch']) dashTile(id);
      live.rate.height = live.rate.slot = null; live.height = live.slot = null;
      const secs = Math.round(wait / 1000);
      note('t-height-note', 'node unreachable'); note('t-slot-note', `retrying in ${secs}s`); note('t-epoch-note', DASH);
      $('t-epoch-bar').style.setProperty('--v', '0');
      for (const k of ['kv-tx', 'kv-slotidx']) $(k).textContent = DASH;
      $('kv-health').textContent = `failing · attempt ${fails}`;
      const m = $('net-msg'); m.hidden = false; m.textContent = '';
      const b = document.createElement('b'); b.textContent = DASH;
      m.append(b, `The node did not answer (${err.message}). Next try in about ${secs}s.`);
      pill('err', 'Node offline');
    },
  });
}

// ---- DexScreener ------------------------------------------------------------------------------
const usd = (s) => {
  const n = Number(s); if (!Number.isFinite(n)) return DASH;
  if (n >= 1) return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n === 0) return '$0';
  const digits = Math.min(12, Math.max(4, 3 - Math.floor(Math.log10(n))));
  return '$' + n.toFixed(digits);
};
const compact = (n) => (Number.isFinite(n) ? '$' + new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n) : DASH);
const pct = (n) => (Number.isFinite(n) ? `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}%` : DASH);

const COPY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/></svg>';
const safeImg = (u) => { try { const x = new URL(u); return x.protocol === 'https:' ? x.href : null; } catch { return null; } };
const safeDex = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && x.hostname === 'dexscreener.com' ? x.href : null; } catch { return null; } };

// token logo: DexScreener imageUrl, else logoURI, else two-letter initials on a palette tone picked from a hash of the symbol
const TONES = 4;
const toneOf = (sym) => { let h = 0; for (const ch of sym) h = (h * 31 + ch.codePointAt(0)) >>> 0; return h % TONES; };
function avatar(p, cls = 'coin') {
  const src = safeImg(p.info?.imageUrl) || safeImg(p.baseToken?.logoURI);
  const sym = (p.baseToken?.symbol || p.baseToken?.name || '?').trim() || '?';
  const blank = () => {
    const d = document.createElement('span');
    d.className = `${cls} blank tone-${toneOf(sym)}`;
    d.textContent = sym.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || '?';
    d.setAttribute('aria-hidden', 'true'); return d;
  };
  if (!src) return blank();
  const img = document.createElement('img');
  img.className = cls; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer'; img.src = src;
  img.addEventListener('error', () => img.replaceWith(blank()), { once: true });
  return img;
}

function pairRow(p, caValue) {
  const row = document.createElement('div'); row.className = 'row spot';
  const av = avatar(p); av.classList.add('av');
  const id = document.createElement('div'); id.className = 'id';
  const b = document.createElement('b');
  b.textContent = p.baseToken?.name || p.baseToken?.symbol || 'Unnamed';
  const addr = p.baseToken?.address || '';
  if (caValue && addr === caValue) { const m = document.createElement('span'); m.className = 'match'; m.textContent = 'matches CA'; b.append(m); }
  const sm = document.createElement('small');
  sm.textContent = `${p.baseToken?.symbol || '?'} / ${p.quoteToken?.symbol || '?'} · ${p.dexId || 'dex'}`;
  id.append(b, sm);
  const href = safeDex(p.url);
  const who = href ? Object.assign(document.createElement('a'), { href, target: '_blank', rel: 'noopener noreferrer' }) : document.createElement('span');
  who.className = 'who'; who.append(av, id);
  if (href) who.setAttribute('aria-label', `${p.baseToken?.name || p.baseToken?.symbol || 'Token'} on DexScreener`);
  const price = Object.assign(document.createElement('span'), { className: 'c px-c', textContent: usd(p.priceUsd) });
  const ch = Number(p.priceChange?.h24);
  const chg = document.createElement('span'); chg.className = 'c chg';
  chg.textContent = (Number.isFinite(ch) ? (ch > 0 ? '▲ ' : ch < 0 ? '▼ ' : '') : '') + pct(ch);
  chg.setAttribute('data-l', '24h');
  const vol = Object.assign(document.createElement('span'), { className: 'c vol', textContent: compact(Number(p.volume?.h24)) });
  vol.setAttribute('data-l', 'Vol');
  const cp = document.createElement('button');
  cp.type = 'button'; cp.className = 'icon-act cp'; cp.innerHTML = COPY_SVG;
  cp.setAttribute('aria-label', `Copy ${p.baseToken?.symbol || 'token'} address`);
  cp.setAttribute('data-copy', addr); cp.setAttribute('data-copy-msg', `${p.baseToken?.symbol || 'Token'} address copied`);
  if (!addr) cp.disabled = true;
  row.append(who, price, chg, vol, cp);
  return row;
}

const rankPairs = (pairs, n) => {
  const seen = new Set();
  return pairs
    .filter((p) => p && p.chainId === 'solana' && p.baseToken && p.baseToken.address)
    .sort((x, y) => (Number(y.volume?.h24) || 0) - (Number(x.volume?.h24) || 0))
    .filter((p) => { const k = p.baseToken.address; if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, n);
};

// Tier 1: pairs that match the project name. Tier 2 (only when tier 1 is empty): the tokens DexScreener
// is boosting on Solana right now, looked up by address. Tier 1 wins again on the next poll if it appears.
async function loadPairs(reg) {
  const j = await fetchJson(reg.dex.url);
  if (!j || !Array.isArray(j.pairs)) throw new Error('unexpected shape');
  const own = rankPairs(j.pairs, 10);
  if (own.length) return { mode: 'own', pairs: own };
  const boosts = await fetchJson(reg.dexTrending.url);
  if (!Array.isArray(boosts)) throw new Error('unexpected trending shape');
  const addrs = [...new Set(boosts.filter((x) => x && x.chainId === 'solana' && typeof x.tokenAddress === 'string').map((x) => x.tokenAddress))].slice(0, 30);
  if (!addrs.length) return { mode: 'none', pairs: [] };
  const list = await fetchJson(reg.dexTokens.url + addrs.join(','));
  if (!Array.isArray(list)) throw new Error('unexpected token shape');
  return { mode: 'trending', pairs: rankPairs(list, 10) };
}

export function startMarket(reg, caValue) {
  const rows = $('pairs-rows'), msg = $('pairs-msg'), track = $('marquee-track'), mq = $('marquee'), mmsg = $('marquee-msg'), label = $('board-label');

  const fail = (err, { wait }) => {
    dashTile('t-pairs');
    const secs = Math.round(wait / 1000);
    note('t-pairs-note', `source failed \u00b7 retry ${secs}s`);
    rows.replaceChildren(); rows.dataset.state = 'err'; label.hidden = true;
    msg.hidden = false; msg.textContent = '';
    const b = document.createElement('b'); b.textContent = DASH;
    msg.append(b, `DexScreener did not answer (${err.message}). Trying again in about ${secs}s.`);
    track.replaceChildren(); mq.dataset.state = 'err'; mmsg.textContent = `${DASH} Pair feed unavailable. Retrying in about ${secs}s.`;
  };

  return poller({
    every: 30000, retryBase: 5000, max: 300000,
    run: () => loadPairs(reg),
    onFail: fail,
    onOk: ({ mode, pairs }) => {
      setTile('t-pairs', mode === 'own' ? pairs.length : 0);
      note('t-pairs-note', mode === 'own' ? 'on Solana, via DexScreener' : 'none for Autority yet');
      rows.replaceChildren();
      rows.dataset.state = 'ok';
      if (!pairs.length) {
        label.hidden = true;
        msg.hidden = false; msg.textContent = '';
        const b = document.createElement('b'); b.textContent = DASH;
        msg.append(b, 'Nothing to show on Solana right now. This board fills in on its own.');
        track.replaceChildren(); mq.dataset.state = 'empty'; mmsg.textContent = `${DASH} Nothing listed yet. Tokens will scroll through here as pairs appear.`;
        return;
      }
      msg.hidden = true;
      label.hidden = false;
      label.textContent = mode === 'own' ? 'Autority pairs' : 'Trending on Solana';
      label.dataset.mode = mode;
      const head = document.createElement('div'); head.className = 'rowhead'; head.setAttribute('aria-hidden', 'true');
      for (const t of ['Pair', 'Price', '24h', 'Volume 24h', '']) head.append(Object.assign(document.createElement('span'), { textContent: t }));
      rows.append(head, ...pairs.map((p) => pairRow(p, caValue)));
      // marquee: two identical runs so the loop is seamless
      const run = (hidden) => pairs.map((p) => {
        const c = document.createElement('span'); c.className = 'chip';
        const sym = document.createElement('span'); sym.textContent = p.baseToken.symbol || p.baseToken.name || '?';
        const sm = document.createElement('small'); sm.textContent = usd(p.priceUsd);
        c.append(avatar(p, 'coin lg'), sym, sm); if (hidden) c.setAttribute('aria-hidden', 'true'); return c;
      });
      track.replaceChildren(...run(false), ...run(true));
      mq.dataset.state = 'ok';
    },
  });
}
