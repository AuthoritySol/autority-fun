import { initReveal, initProgress, initParallax, initSpotlight, initCopy } from './fx.js';
import { startChain, startMarket } from './live.js';

const reg = JSON.parse(document.getElementById('register').textContent).records;

initCopy();
initSpotlight();
initProgress();
initReveal();
initParallax();

// tabs: arrow keys move focus, Home/End jump, panels swap without layout jumps
const tabs = [...document.querySelectorAll('[role="tab"]')];
function select(tab, focus) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
  }
  if (focus) tab.focus();
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => select(t, false));
  t.addEventListener('keydown', (e) => {
    const k = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (k === undefined) return;
    e.preventDefault(); select(tabs[(k + tabs.length) % tabs.length], true);
  });
});

startChain(reg);
startMarket(reg, reg.ca.state === 'stated' ? reg.ca.value : null);
