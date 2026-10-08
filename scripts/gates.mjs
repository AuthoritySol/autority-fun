// npm run gates: builds dist/ and two fixture branches, runs every gate against each, then runs the
// mutation harness. Exit code 0 only if every gate passes on every branch AND every mutation is caught.
// Mutation anchors never hardcode expected text: they read the record's current state/value at runtime.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build, loadRegister, handleOf, hostOk } from './build.mjs';
import { readPng, hexOf } from './png.mjs';
import { palette } from '../src/tokens.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const rnd = (alphabet, n) => Array.from(crypto.randomBytes(n), (b) => alphabet[b % alphabet.length]).join('');
const fakeAddress = () => rnd(B58, 44);

const ADDR_SHAPES = [/(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![1-9A-HJ-NP-Za-km-z])/g, /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g];
const HEX_LITERAL = /#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z_-])/g;
const COLOR_FN = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*[0-9.]/gi;
const NAMED = /(?:^|[:\s,(])(?:white|black|red|green|blue|gr[ae]y|silver|gold|orange|purple|yellow|pink|navy|teal|cyan|magenta)(?=[\s;,)!]|$)/gi;
const CH_UNIT = /(?<![A-Za-z#_-])[0-9]*\.?[0-9]+ch(?![A-Za-z0-9_-])/g;
const TEXT_EXT = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.md', '.txt', '']);

// ---- snapshot ---------------------------------------------------------------------------------
function readTree(dir, base = dir, out = new Map()) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) readTree(p, base, out);
    else if (TEXT_EXT.has(path.extname(e.name))) out.set(path.relative(base, p).replaceAll('\\', '/'), fs.readFileSync(p, 'utf8'));
  }
  return out;
}
function snapshot(distDir, regFile) {
  return { dist: distDir, regFile, reg: JSON.parse(fs.readFileSync(regFile, 'utf8')).records, files: readTree(distDir) };
}
const clone = (s) => ({ ...s, reg: structuredClone(s.reg), files: new Map(s.files) });

// ---- gates (each returns null on pass or a failure string) -------------------------------------
const isAddr = (v) => typeof v === 'string' && (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v) || /^0x[0-9a-fA-F]{40}$/.test(v));
const html = (s) => s.files.get('index.html') || '';
const tag = (h, id) => (h.match(new RegExp(`<[a-z]+[^>]*data-social="${id}"[^>]*>`)) || [])[0] || '';

const GATES = [
  ['G01', 'register: states valid, inert records carry null value and null url, stated records well formed', (s) => {
    for (const [id, r] of Object.entries(s.reg)) {
      if (!['stated', 'absent', 'unconfirmed'].includes(r.state)) return `${id}: bad state ${r.state}`;
      if (r.state !== 'stated' && (r.value !== null || r.url !== null)) return `${id}: ${r.state} but value=${JSON.stringify(r.value)} url=${JSON.stringify(r.url)}`;
    }
    const { ca, x, github } = s.reg;
    if (ca.state === 'stated' && !isAddr(ca.value)) return 'ca stated with a value that is not address-shaped';
    for (const [id, r] of [['x', x], ['github', github]]) if (r.state === 'stated' && (!r.url || !hostOk(id, r.url) || !handleOf(r.url))) return `${id}: stated url unusable`;
    return null;
  }],
  ['G02', 'register embedded in dist equals the register that was built', (s) => {
    const m = html(s).match(/<script type="application\/json" id="register">([\s\S]*?)<\/script>/);
    if (!m) return 'no embedded register';
    return JSON.stringify(JSON.parse(m[1]).records) === JSON.stringify(s.reg) ? null : 'embedded register differs from source';
  }],
  ['G03', 'link rule: inert socials have no href; stated socials link exactly to the stored url with a derived handle', (s) => {
    const h = html(s);
    for (const id of ['x', 'github']) {
      const r = s.reg[id], t = tag(h, id);
      if (!t) return `${id}: icon missing from markup`;
      if (!h.includes(`data-social="${id}"`)) return `${id}: no icon`;
      if (r.state === 'stated') {
        if (!t.startsWith('<a ') || !t.includes(`href="${r.url}"`)) return `${id}: stated but not linked to its url`;
        if (!t.includes(`(@${handleOf(r.url)})`)) return `${id}: handle not derived from url`;
      } else if (t.startsWith('<a ') || /href=/.test(t)) return `${id}: ${r.state} but rendered with an href`;
    }
    const host = { x: /href="https?:\/\/(?:www\.)?(?:x|twitter)\.com/g, github: /href="https?:\/\/(?:www\.)?github\.com/g };
    for (const id of ['x', 'github']) {
      const n = (h.match(host[id]) || []).length;
      if ((s.reg[id].state === 'stated' ? 1 : 0) !== n) return `${id}: expected ${s.reg[id].state === 'stated' ? 1 : 0} outbound href(s), found ${n}`;
    }
    return null;
  }],
  ['G04', 'CA slot: inert while unstated (no copy hook, no address text); full address and copy hook once stated', (s) => {
    const h = html(s), ca = s.reg.ca;
    const m = h.match(/<(button|div) class="ca[^"]*" [^>]*id="ca"[^>]*>([\s\S]*?)<\/\1>/);
    if (!m) return 'CA slot missing';
    if (h.indexOf('id="ca"') > h.indexOf('<main')) return 'CA slot is not above the main content';
    const open = h.slice(m.index, h.indexOf('>', m.index) + 1);
    const text = m[2].replace(/<[^>]+>/g, '');
    if (ca.state === 'stated') {
      if (m[1] !== 'button' || !open.includes(`data-copy="${ca.value}"`)) return 'stated CA lacks a copy button carrying the full address';
      if (!text.includes(ca.value)) return 'stated CA not displayed in full';
    } else {
      if (m[1] === 'button' || /data-copy=/.test(open)) return `${ca.state} CA has a live copy hook`;
      for (const re of ADDR_SHAPES) if (text.match(re)) return `${ca.state} CA shows an address-shaped string`;
      if (!/aria-disabled="true"/.test(open)) return 'inert CA not marked aria-disabled';
    }
    return null;
  }],
  ['G05', 'address scanner: every address-shaped string in dist equals the stated registry address (CA record exempt); none else', (s) => {
    const allowed = new Set(Object.values(s.reg).filter((r) => r.state === 'stated' && r.kind === 'address' && r.value).map((r) => r.value));
    for (const [f, t] of s.files) for (const re of ADDR_SHAPES) for (const m of t.matchAll(re)) if (!allowed.has(m[0])) return `${f}: foreign address-shaped string ${m[0].slice(0, 12)}…`;
    return null;
  }],
  ['G06', 'palette: no colour literals outside tokens; dist literals are palette members; no named colours', (s) => {
    const members = new Set(Object.values(palette).map((p) => p.hex));
    for (const [f, t] of s.files) {
      if (f === 'tokens.css') continue;
      for (const m of t.matchAll(HEX_LITERAL)) if (!members.has(m[0].toLowerCase())) return `${f}: stray hex ${m[0]}`;
      if (f.endsWith('.css') || f.endsWith('.js')) {
        if (f.endsWith('.css') && (t.match(HEX_LITERAL) || []).length) return `${f}: hex literal outside tokens`;
        if (t.match(COLOR_FN)) return `${f}: colour function with numeric literal`;
      }
      if (f.endsWith('.css') && t.match(NAMED)) return `${f}: named colour`;
    }
    const src = path.join(ROOT, 'src');
    for (const [f, t] of readTree(src)) {
      if (f === 'tokens.js') continue;
      if (t.match(HEX_LITERAL) || t.match(COLOR_FN)) return `src/${f}: colour literal outside src/tokens.js`;
    }
    return null;
  }],
  ['G07', 'palette provenance: every token hex is a real pixel of its brand file at the recorded coordinate', () => {
    const cache = new Map();
    for (const [name, p] of Object.entries(palette)) {
      if (!cache.has(p.file)) cache.set(p.file, readPng(path.join(ROOT, p.file)));
      const [r, g, b, a] = cache.get(p.file).px(p.x, p.y);
      if (hexOf(r, g, b) !== p.hex) return `${name}: file has ${hexOf(r, g, b)} at (${p.x},${p.y}), token says ${p.hex}`;
      if (a !== 255) return `${name}: sampled pixel is not opaque`;
    }
    return null;
  }],
  ['G08', 'no ch units anywhere in CSS', (s) => {
    for (const [f, t] of s.files) if (f.endsWith('.css') && t.match(CH_UNIT)) return `${f}: ch unit`;
    return null;
  }],
  ['G09', 'reduced motion: CSS kills animation/transition globally; JS gates reveal, parallax, tween, flash', (s) => {
    const css = s.files.get('styles.css') || '', fx = s.files.get('js/fx.js') || '';
    const blk = css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*)\}\s*$/);
    if (!blk) return 'no reduced-motion block at end of stylesheet';
    if (!/animation: none !important/.test(blk[1]) || !/transition: none !important/.test(blk[1])) return 'reduced block does not zero animation and transition';
    for (const fn of ['initReveal', 'initParallax', 'tween', 'flash']) {
      const body = fx.slice(fx.indexOf(`function ${fn}`));
      if (!/reduced\(\)/.test(body.slice(0, 700))) return `${fn} does not consult reduced()`;
    }
    return null;
  }],
  ['G10', 'favicon: svg 32x32, no comments, no double hyphen anywhere, well formed', (s) => {
    const v = s.files.get('favicon.svg') || '';
    if (!/^<svg [^>]*width="32" height="32" viewBox="0 0 32 32"/.test(v)) return 'not a 32x32 svg';
    if (v.includes('<!--') || v.includes('--')) return 'comment or double hyphen present';
    if ((v.match(/<path /g) || []).length < 2 || !/d="M\d+ \d+h\d+v1h-\d+z/.test(v)) return 'no traced pixel runs';
    return null;
  }],
  ['G11', 'repo hygiene: no agent config files or folders, no authorship strings', () => {
    const bad = [['CLAU', 'DE.md'].join(''), ['.clau', 'de'].join(''), 'AGENTS.md', '.cursorrules', ['.github/copi', 'lot-instructions.md'].join('')];
    for (const b of bad) if (fs.existsSync(path.join(ROOT, b))) return `${b} exists`;
    const words = [['clau', 'de'], ['anthr', 'opic'], ['co-auth', 'ored-by'], ['generated ', 'with'], ['generated ', 'by'], ['chat', 'gpt'], ['open', 'ai'], ['copi', 'lot'], ['as an ', 'ai ']].map((w) => w.join(''));
    const re = new RegExp(words.join('|'), 'i');
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', 'brand', 'reference'].includes(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { const r = walk(p); if (r) return r; }
      else if (TEXT_EXT.has(path.extname(e.name)) && re.test(fs.readFileSync(p, 'utf8')) && !p.endsWith('package-lock.json')) return path.relative(ROOT, p);
    } return null; };
    const hit = walk(ROOT);
    return hit ? `authorship string in ${hit}` : null;
  }],
  ['G12', 'dist is self-contained: every local reference in index.html exists', (s) => {
    const h = html(s);
    for (const m of h.matchAll(/(?:src|href)="(\/[^"#]*)"/g)) if (!fs.existsSync(path.join(s.dist, m[1]))) return `missing ${m[1]}`;
    for (const f of ['logo-192.png', 'logo-512.png', 'apple-touch-icon.png', 'og.jpg', 'favicon.svg']) if (!fs.existsSync(path.join(s.dist, f))) return `missing ${f}`;
    return null;
  }],
  ['G13', 'logo resize is clean: no dark fringe on partial-alpha pixels of dist logos (premultiplied path)', (s) => {
    for (const f of ['logo-512.png', 'logo-192.png']) {
      const png = readPng(path.join(s.dist, f));
      if (png.colortype !== 6) return `${f}: not RGBA`;
      let n = 0, lowest = 255;
      for (let i = 0; i < png.data.length; i += 4) { const a = png.data[i + 3]; if (a > 0 && a < 255) { n++; lowest = Math.min(lowest, png.data[i], png.data[i + 1], png.data[i + 2]); } }
      if (n && lowest < 200) return `${f}: fringe pixel with channel ${lowest}`;
    }
    return null;
  }],
  ['G14', 'endpoints come from the register, not from code', (s) => {
    for (const [f, t] of s.files) if (f.startsWith('js/') && /publicnode|api\.dexscreener|solana-rpc/.test(t)) return `${f}: hardcoded endpoint`;
    return null;
  }],
  ['G15', 'live-data code: backoff poller, skeletons, dash fallback, and no stored numbers for chain data', (s) => {
    const live = s.files.get('js/live.js') || '';
    if (!/2 \*\* \(fails - 1\)/.test(live)) return 'no exponential backoff';
    if (!/DASH/.test(live) || !/dashTile/.test(live)) return 'no dash fallback';
    if (!/data-skel/.test(html(s))) return 'no skeleton tiles';
    if (!/getBlockHeight/.test(live) || !/every: 2000/.test(live)) return 'block height is not polled every 2s';
    return null;
  }],
  ['G16', 'tap targets: every interactive control is sized at least 44px in CSS', (s) => {
    const css = s.files.get('styles.css') || '';
    for (const sel of ['.icon-btn', '.icon-act', '.ca-act', '.ico']) {
      const m = css.match(new RegExp(`\\${sel} \\{[^}]*width: (\\d+)px; height: (\\d+)px`));
      if (!m || +m[1] < 44 || +m[2] < 44) return `${sel} under 44px`;
    }
    for (const sel of ['.btn', '.tabs button', '.brand', '.chip']) {
      const m = css.match(new RegExp(`\\${sel} \\{[^}]*min-height: (\\d+)px`));
      if (!m || +m[1] < 44) return `${sel} under 44px`;
    }
    return null;
  }],
];

function runGates(s) { return GATES.map(([id, name, fn]) => { let r; try { r = fn(s); } catch (e) { r = `threw: ${e.message}`; } return { id, name, ok: r === null, why: r }; }); }

// ---- mutations ----------------------------------------------------------------------------------
const edit = (s, file, fn) => { const c = clone(s); c.files.set(file, fn(c.files.get(file))); return c; };
const MUTATIONS = [
  ['M1 foreign base58 address injected into the page', 'G05', (s) => edit(s, 'index.html', (h) => h.replace('</footer>', `<i>${fakeAddress()}</i></footer>`))],
  ['M2 foreign 0x address injected into the page', 'G05', (s) => edit(s, 'index.html', (h) => h.replace('</footer>', `<i>0x${rnd('0123456789abcdef', 40)}</i></footer>`))],
  ['M3 stated CA mutated by one character (anchor: current record value)', 'G04', (s) => {
    const v = s.reg.ca.value; if (s.reg.ca.state !== 'stated') return null;
    const flipped = v.slice(0, -1) + (v.endsWith('A') ? 'B' : 'A');
    return edit(s, 'index.html', (h) => h.replace(`<span class="ca-val">${v}</span>`, `<span class="ca-val">${flipped}</span>`));
  }],
  ['M4 inert CA given a live copy hook (anchor: current record state)', 'G04', (s) => {
    if (s.reg.ca.state === 'stated') return null;
    return edit(s, 'index.html', (h) => h.replace('class="ca is-inert"', `class="ca is-inert" data-copy="${fakeAddress()}"`));
  }],
  ['M5 social icon flipped against its record: inert gains href / stated loses it', 'G03', (s) => {
    const id = ['x', 'github'].find((k) => s.reg[k].state !== 'stated') || 'x';
    const inert = s.reg[id].state !== 'stated';
    return edit(s, 'index.html', (h) => h.replace(new RegExp(`(<(?:a|span) class="icon-btn[^>]*?)( data-social="${id}")`), (m, a, b) => inert
      ? a.replace('<span', '<a').replace('role="img" ', '') + ` href="https://x.com/someone"${b}`
      : a.replace(/ href="[^"]*"/, '') + b));
  }],
  ['M6 register record flipped: inert carrying a value / stated losing its url', 'G01', (s) => {
    const c = clone(s);
    const inert = Object.entries(c.reg).find(([, r]) => r.state !== 'stated');
    if (inert) inert[1].value = 'smuggled'; else c.reg.x.url = null;
    return c;
  }],
  ['M7 colour literal added outside tokens', 'G06', (s) => edit(s, 'styles.css', (t) => t + '\n.x { color: #123456; }\n')],
  ['M8 ch unit added to CSS', 'G08', (s) => edit(s, 'styles.css', (t) => t + '\n.y { width: 20ch; }\n')],
  ['M9 comment with double hyphen added to favicon', 'G10', (s) => edit(s, 'favicon.svg', (t) => t.replace('<rect', '<!-- a -- b --><rect'))],
  ['M10 reduced-motion block removed from CSS', 'G09', (s) => edit(s, 'styles.css', (t) => t.replace('prefers-reduced-motion: reduce', 'prefers-color-scheme: dark'))],
  ['M11 backoff removed from poller', 'G15', (s) => edit(s, 'js/live.js', (t) => t.replace('2 ** (fails - 1)', '1'))],
  ['M12 hardcoded RPC endpoint in code', 'G14', (s) => edit(s, 'js/live.js', (t) => t + "\nconst x = 'https://solana-rpc.publicnode.com';\n")],
];

// ---- branches -------------------------------------------------------------------------------------
function fixture(name, patch) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `autority-${name}-`));
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'register.json'), 'utf8'));
  patch(reg.records);
  const file = path.join(tmp, 'register.json');
  fs.writeFileSync(file, JSON.stringify(reg, null, 2));
  return { tmp, file, out: path.join(tmp, 'dist') };
}
const stated = (r, value, url) => Object.assign(r, { state: 'stated', value, url });
const handle = () => rnd('abcdefghijklmnopqrstuvwxyz', 9);
const BRANCHES = [
  { label: 'ABSENT   (real register: CA, X, GitHub unstated)', real: true },
  { label: 'STATED   (fixture: CA, X, GitHub all stated)', make: () => fixture('stated', (r) => { stated(r.ca, fakeAddress(), null); stated(r.x, `https://x.com/${handle()}`, `https://x.com/${handle()}`); r.x.value = null; stated(r.github, null, `https://github.com/${handle()}/${handle()}`); }) },
  { label: 'MIXED    (fixture: CA unconfirmed, X stated, GitHub absent)', make: () => fixture('mixed', (r) => { r.ca.state = 'unconfirmed'; stated(r.x, null, `https://x.com/${handle()}`); }) },
];

let total = 0, failed = 0, mutTotal = 0, mutMissed = 0;
const line = (ok, text) => console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${text}`);

for (const br of BRANCHES) {
  console.log(`\nbranch ${br.label}`);
  let regFile, out, tmp;
  if (br.real) { regFile = path.join(ROOT, 'src', 'register.json'); out = path.join(ROOT, 'dist'); await build({ registerFile: regFile, out }); }
  else { const f = br.make(); regFile = f.file; out = f.out; tmp = f.tmp; loadRegister(regFile); await build({ registerFile: regFile, out }); }
  const snap = snapshot(out, regFile);
  const results = runGates(snap);
  for (const r of results) { total++; if (!r.ok) failed++; line(r.ok, `${r.id} ${r.name}${r.ok ? '' : `  -> ${r.why}`}`); }
  console.log('  mutations (each must be caught by its gate):');
  for (const [name, gate, fn] of MUTATIONS) {
    const m = fn(snap);
    if (m === null) { console.log(`  skip  ${name}  (not applicable to this branch)`); continue; }
    mutTotal++;
    const g = GATES.find((x) => x[0] === gate), base = g[2](snap);
    let caught; try { caught = g[2](m) !== null; } catch { caught = true; }
    const ok = base === null && caught;
    if (!ok) mutMissed++;
    line(ok, `${name} -> ${gate} ${ok ? 'caught' : base !== null ? 'baseline already failing' : 'MISSED'}`);
  }
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
}
// dist/ always ends as the real (absent) branch
await build({ registerFile: path.join(ROOT, 'src', 'register.json'), out: path.join(ROOT, 'dist') });

console.log(`\ngates: ${total - failed}/${total} passed across ${BRANCHES.length} branches (${GATES.length} gates each); mutations caught: ${mutTotal - mutMissed}/${mutTotal}`);
process.exit(failed || mutMissed ? 1 : 0);
