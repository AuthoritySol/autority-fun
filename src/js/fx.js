// Motion + interaction helpers. Every animated path checks `reduced()` and lands instantly instead.
const mq = matchMedia('(prefers-reduced-motion: reduce)');
export const reduced = () => mq.matches;

// ---- spring easing -------------------------------------------------------------------------
// Integrate a damped spring and hand the samples to WAAPI as a linear() easing, so the
// entrance runs on real spring physics (overshoot, settle) rather than a bezier.
export function springEasing(stiffness = 170, damping = 19, mass = 1) {
  const dt = 1 / 60;
  let x = 0, v = 0, t = 0;
  const pts = [0];
  while (t < 3) {
    const a = (-stiffness * (x - 1) - damping * v) / mass;
    v += a * dt; x += v * dt; t += dt;
    pts.push(x);
    if (Math.abs(x - 1) < 0.0008 && Math.abs(v) < 0.01) break;
  }
  pts.push(1);
  return { duration: Math.round(t * 1000), easing: `linear(${pts.map((p) => p.toFixed(4)).join(', ')})` };
}
const SPRING = springEasing();
export const STAGGER = 70;

// ---- scroll reveal -------------------------------------------------------------------------
export function initReveal() {
  const els = [...document.querySelectorAll('[data-reveal]')];
  const show = (el) => { el.dataset.revealed = ''; };
  if (reduced() || !('IntersectionObserver' in window) || !el0().animate) { els.forEach(show); return; }
  let batch = [];
  let timer = 0;
  const flush = () => {
    timer = 0;
    batch.forEach((el, i) => {
      const dy = el.classList.contains('tile') ? 20 : 30;
      el.animate(
        [{ opacity: 0, transform: `translateY(${dy}px) scale(.97)` }, { opacity: 1, transform: 'none' }],
        { duration: SPRING.duration, easing: SPRING.easing, delay: i * STAGGER, fill: 'backwards' }
      );
      // opacity eases out quicker than the spring settles
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 380, easing: 'ease-out', delay: i * STAGGER, fill: 'backwards' });
      show(el);
    });
    batch = [];
  };
  const io = new IntersectionObserver((entries) => {
    entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left)
      .forEach((e) => { batch.push(e.target); io.unobserve(e.target); });
    if (batch.length && !timer) timer = setTimeout(flush, 30);
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  els.forEach((el) => io.observe(el));
}
const el0 = () => document.documentElement;

// ---- progress bar --------------------------------------------------------------------------
export function initProgress() {
  const bar = document.getElementById('progress');
  let queued = false;
  const paint = () => {
    queued = false;
    const h = document.documentElement.scrollHeight - innerHeight;
    bar.style.setProperty('--p', h > 0 ? Math.min(1, Math.max(0, scrollY / h)).toFixed(4) : 0);
  };
  const ask = () => { if (!queued) { queued = true; requestAnimationFrame(paint); } };
  addEventListener('scroll', ask, { passive: true });
  addEventListener('resize', ask);
  paint();
}

// ---- parallax ------------------------------------------------------------------------------
export function initParallax() {
  const hero = document.getElementById('hero');
  const layers = [...hero.querySelectorAll('.px[data-depth]')];
  let px = 0, py = 0, tx = 0, ty = 0, raf = 0, visible = true;
  const loop = () => {
    raf = 0;
    if (reduced()) { layers.forEach((l) => { l.style.transform = ''; }); return; }
    px += (tx - px) * 0.08; py += (ty - py) * 0.08;
    const sy = Math.min(scrollY, hero.offsetHeight);
    for (const l of layers) {
      const d = parseFloat(l.dataset.depth);
      l.style.transform = `translate3d(${(px * d * 60).toFixed(2)}px, ${(py * d * 60 - sy * d * 1.4).toFixed(2)}px, 0)`;
    }
    if (visible && (Math.abs(tx - px) > 0.001 || Math.abs(ty - py) > 0.001)) raf = requestAnimationFrame(loop);
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
  hero.addEventListener('pointermove', (e) => {
    const r = hero.getBoundingClientRect();
    tx = (e.clientX - r.left) / r.width - 0.5; ty = (e.clientY - r.top) / r.height - 0.5; kick();
  });
  hero.addEventListener('pointerleave', () => { tx = 0; ty = 0; kick(); });
  addEventListener('scroll', kick, { passive: true });
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) kick(); }).observe(hero);
  kick();
}

// ---- spotlight ------------------------------------------------------------------------------
export function initSpotlight() {
  document.addEventListener('pointermove', (e) => {
    const t = e.target instanceof Element ? e.target.closest('.spot') : null;
    if (!t) return;
    const r = t.getBoundingClientRect();
    t.style.setProperty('--mx', `${e.clientX - r.left}px`);
    t.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, { passive: true });
}

// ---- toast + copy ---------------------------------------------------------------------------
let toastTimer = 0;
export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2400);
}

async function writeClipboard(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch { return false; }
}

export function initCopy() {
  document.addEventListener('click', async (e) => {
    const b = e.target instanceof Element ? e.target.closest('[data-copy]') : null;
    if (!b) return;
    const v = b.getAttribute('data-copy');
    if (!v) return; // inert: nothing stated, nothing to copy
    const ok = await writeClipboard(v);
    if (ok) {
      b.classList.add('copied');
      setTimeout(() => b.classList.remove('copied'), 1300);
      toast(b.getAttribute('data-copy-msg') || 'Address copied');
    } else toast('Copy blocked by the browser. Select the text instead.');
  });
}

// ---- number tween + flash -----------------------------------------------------------------
export function flash(el) {
  if (reduced()) return;
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

export function tween(from, to, ms, onFrame) {
  if (reduced() || from === to) { onFrame(to); return () => {}; }
  const t0 = performance.now();
  let raf = 0;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    onFrame(from + (to - from) * e);
    if (k < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}
