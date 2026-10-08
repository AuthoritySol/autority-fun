// Static build: src/ -> dist/. No bundler; dist/ is what gets dragged to Cloudflare Pages.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { palette, tokensCss } from '../src/tokens.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATES = ['stated', 'absent', 'unconfirmed'];
const SOCIAL_HOSTS = { x: ['x.com', 'twitter.com'], github: ['github.com'] };

// ---- register ------------------------------------------------------------------------------
export function loadRegister(file) {
  const reg = JSON.parse(fs.readFileSync(file, 'utf8')).records;
  for (const [id, r] of Object.entries(reg)) {
    if (!STATES.includes(r.state)) throw new Error(`register.${id}: bad state ${r.state}`);
    if (r.state !== 'stated' && (r.value !== null || r.url !== null)) throw new Error(`register.${id}: inert record carries a value or url`);
  }
  return reg;
}

// link rule: the URL is stored, the handle is derived from it
export function handleOf(url) {
  try { return new URL(url).pathname.split('/').filter(Boolean)[0] || null; } catch { return null; }
}
export function hostOk(id, url) {
  try { const h = new URL(url).hostname.replace(/^www\./, ''); return (SOCIAL_HOSTS[id] || [h]).includes(h) && new URL(url).protocol === 'https:'; } catch { return false; }
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ICON = {
  // official X mark
  x: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>',
  // official GitHub Octicon mark-github (16px grid)
  github: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/></svg>',
};
const NAME = { x: 'X', github: 'GitHub' };

function socialHtml(id, r) {
  if (r.state === 'stated' && r.url) {
    const h = handleOf(r.url);
    const label = `Autority on ${NAME[id]}${h ? ` (@${h})` : ''}`;
    return `<a class="icon-btn" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(label)}" title="${esc(label)}" data-social="${id}">${ICON[id]}</a>`;
  }
  const label = `${NAME[id]}: not announced yet`;
  return `<span class="icon-btn is-inert" role="img" aria-disabled="true" aria-label="${label}" title="${label}" data-social="${id}">${ICON[id]}</span>`;
}

function caHtml(r) {
  if (r.state === 'stated' && r.value) {
    return `<button class="ca" type="button" id="ca" data-copy="${esc(r.value)}" data-copy-msg="Contract address copied" aria-label="Copy contract address ${esc(r.value)}"><span class="ca-label">CA</span><span class="ca-val">${esc(r.value)}</span><span class="ca-act">${ICON.copy}</span></button>`;
  }
  return `<div class="ca is-inert" id="ca" aria-disabled="true"><span class="ca-label">CA</span><span class="ca-val">Contract address: not announced yet</span><span class="ca-act" aria-hidden="true">${ICON.copy}</span></div>`;
}

function rowHtml(id, r) {
  let shown = null;
  if (r.state === 'stated') {
    if (id === 'x' || id === 'github') shown = handleOf(r.url) ? '@' + handleOf(r.url) : r.value;
    else if (r.kind === 'endpoint') shown = r.url ? new URL(r.url).host : r.value;
    else shown = r.value;
  }
  const v = shown === null ? '<span class="v none">Not stated yet</span>' : `<span class="v">${esc(shown)}</span>`;
  return `<li data-record="${id}" data-state="${r.state}"><b>${esc(r.label)}</b>${v}<span class="st ${r.state}">${r.state}</span></li>`;
}

// ---- images ----------------------------------------------------------------------------------
// The transparent logo holds millions of pure-black alpha-0 pixels and dark matte on its partial-alpha
// edge. Colour is therefore reset to the sampled ink on every visible pixel, then resized with
// premultiplied alpha so no black bleeds into the stroke edge.
async function logoAlpha() {
  const file = path.join(ROOT, 'brand', 'LOGO AUTORITY PNG...png');
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const ink = [1, 3, 5].map((i) => parseInt(palette.ink.hex.slice(i, i + 2), 16));
  for (let i = 0; i < data.length; i += 4) { if (data[i + 3] > 0) { data[i] = ink[0]; data[i + 1] = ink[1]; data[i + 2] = ink[2]; } }
  return { data, info };
}
const sq = (cx, cy, side) => ({ left: Math.round(cx - side / 2), top: Math.round(cy - side / 2), width: side, height: side });
const MARK_CENTER = [1000, 996]; // centre of the mark's bounding box (574,618)-(1426,1375), measured from alpha

async function writeImages(out) {
  const { data, info } = await logoAlpha();
  const src = () => sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
  const crop = (side) => src().extract(sq(MARK_CENTER[0], MARK_CENTER[1], side));
  const ink = [1, 3, 5].map((i) => parseInt(palette.ink.hex.slice(i, i + 2), 16));
  // resize on premultiplied alpha, then restore the single ink colour on every pixel so rounding at tiny alpha cannot leave a dark edge
  const markPng = async (n) => {
    const { data: px, info: pi } = await crop(1000).resize(n, n, { kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < px.length; i += 4) { px[i] = ink[0]; px[i + 1] = ink[1]; px[i + 2] = ink[2]; }
    return sharp(px, { raw: { width: pi.width, height: pi.height, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
  };
  const logo = async (n) => fs.writeFileSync(path.join(out, `logo-${n}.png`), await markPng(n));
  await Promise.all([logo(512), logo(192)]);

  const groundRgb = [1, 3, 5].map((i) => parseInt(palette.ground.hex.slice(i, i + 2), 16));
  const bg = { r: groundRgb[0], g: groundRgb[1], b: groundRgb[2], alpha: 1 };
  await sharp({ create: { width: 180, height: 180, channels: 4, background: bg } })
    .composite([{ input: await markPng(132), gravity: 'centre' }]).png().toFile(path.join(out, 'apple-touch-icon.png'));
  await sharp({ create: { width: 1200, height: 630, channels: 3, background: bg } })
    .composite([{ input: await markPng(470), gravity: 'centre' }]).jpeg({ quality: 88 }).toFile(path.join(out, 'og.jpg'));

  // favicon: 32x32 coverage grid read from the logo's own pixels, merged into runs per opacity level
  const g = await crop(960).resize(32, 32, { kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer();
  const LEVELS = 8;
  const byLevel = new Map();
  for (let y = 0; y < 32; y++) {
    let x = 0;
    while (x < 32) {
      const lv = Math.round((g[(y * 32 + x) * 4 + 3] / 255) * LEVELS);
      let x2 = x;
      while (x2 < 32 && Math.round((g[(y * 32 + x2) * 4 + 3] / 255) * LEVELS) === lv) x2++;
      if (lv > 0) { if (!byLevel.has(lv)) byLevel.set(lv, []); byLevel.get(lv).push(`M${x} ${y}h${x2 - x}v1h-${x2 - x}z`); }
      x = x2;
    }
  }
  const paths = [...byLevel.entries()].sort((a, b) => a[0] - b[0])
    .map(([lv, d]) => `<path fill="${palette.ink.hex}"${lv === LEVELS ? '' : ` fill-opacity="${(lv / LEVELS).toFixed(3)}"`} d="${d.join('')}"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" shape-rendering="crispEdges"><rect width="32" height="32" rx="7" fill="${palette.ground.hex}"/>${paths}</svg>\n`;
  fs.writeFileSync(path.join(out, 'favicon.svg'), svg);
}

// ---- build -----------------------------------------------------------------------------------
export async function build({ registerFile = path.join(ROOT, 'src', 'register.json'), out = path.join(ROOT, 'dist') } = {}) {
  const reg = loadRegister(registerFile);
  for (const id of ['x', 'github']) if (reg[id].state === 'stated' && !hostOk(id, reg[id].url)) throw new Error(`register.${id}: url is not an https ${NAME[id]} url`);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'js'), { recursive: true });

  fs.writeFileSync(path.join(out, 'tokens.css'), tokensCss());
  fs.copyFileSync(path.join(ROOT, 'src', 'styles.css'), path.join(out, 'styles.css'));
  for (const f of fs.readdirSync(path.join(ROOT, 'src', 'js'))) fs.copyFileSync(path.join(ROOT, 'src', 'js', f), path.join(out, 'js', f));

  const domainUrl = reg.domain.url;
  const json = JSON.stringify({ records: reg }).replace(/</g, '\\u003c');
  const html = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8')
    .replaceAll('{{GROUND}}', palette.ground.hex)
    .replaceAll('{{DOMAIN_URL}}', domainUrl)
    .replaceAll('{{DOMAIN}}', esc(reg.domain.value))
    .replace('{{REGISTER_JSON}}', () => json)
    .replace('{{SOCIALS}}', () => ['x', 'github'].map((id) => socialHtml(id, reg[id])).join('\n      '))
    .replace('{{CA_SLOT}}', () => caHtml(reg.ca))
    .replace('{{REGISTER_ROWS}}', () => Object.entries(reg).map(([id, r]) => rowHtml(id, r)).join('\n          '));
  fs.writeFileSync(path.join(out, 'index.html'), html);

  fs.writeFileSync(path.join(out, '_headers'), [
    '/*', '  X-Content-Type-Options: nosniff', '  Referrer-Policy: strict-origin-when-cross-origin', '',
    '/js/*', '  Cache-Control: public, max-age=300', '',
  ].join('\n'));
  await writeImages(out);
  return { out, reg };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2);
  const opt = (k) => { const i = a.indexOf(k); return i >= 0 ? path.resolve(a[i + 1]) : undefined; };
  const { out } = await build({ registerFile: opt('--register'), out: opt('--out') });
  console.log(`built -> ${path.relative(ROOT, out) || '.'}`);
}
