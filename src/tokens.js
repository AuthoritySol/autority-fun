// The only file in the project allowed to hold colour literals.
// Palette provenance: k-means (k=4, 25 iterations, subsampled every 7th pixel) over the visible
// pixels of brand/LOGO AUTORITY PNG.png (2000x2000, IHDR colourtype 6 RGBA, 8-bit, fully opaque).
// Each centroid is snapped to the nearest real pixel of that file; the coordinate is recorded and
// scripts/gates.mjs re-reads the pixel to prove it.
//   ground  97.11% of pixels   the field behind the mark
//   ink      2.55% of pixels   the stroke of the mark
//   silver   0.17% of pixels   anti-aliased stroke edge, light
//   steel    0.17% of pixels   anti-aliased stroke edge, dark
// The transparent logo (LOGO AUTORITY PNG...png, colourtype 6) holds 3,871,759 pure-black
// alpha-0 pixels, so every resize of it is done on premultiplied alpha.

export const palette = {
  ground: { hex: '#0f100d', file: 'brand/LOGO AUTORITY PNG.png', x: 0, y: 0 },
  ink: { hex: '#f1f0f0', file: 'brand/LOGO AUTORITY PNG.png', x: 1022, y: 623 },
  silver: { hex: '#a6a6a5', file: 'brand/LOGO AUTORITY PNG.png', x: 1213, y: 911 },
  steel: { hex: '#51514f', file: 'brand/LOGO AUTORITY PNG.png', x: 1400, y: 1190 },
};

export const motion = {
  ease: 'cubic-bezier(.2, .8, .2, 1)',
  easeOut: 'cubic-bezier(.3, .7, .25, 1)',
  fast: '.2s',
  mid: '.55s',
  slow: '.6s',
  pulse: '1.8s',
  stagger: 70,
};

const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(' ');

export function tokensCss() {
  const lines = [':root {'];
  for (const [name, p] of Object.entries(palette)) {
    lines.push(`  --${name}: ${p.hex};`);
    lines.push(`  --${name}-c: ${channels(p.hex)};`);
  }
  lines.push(`  --ease: ${motion.ease};`);
  lines.push(`  --ease-out: ${motion.easeOut};`);
  lines.push(`  --t-fast: ${motion.fast};`);
  lines.push(`  --t-mid: ${motion.mid};`);
  lines.push(`  --t-slow: ${motion.slow};`);
  lines.push(`  --t-pulse: ${motion.pulse};`);
  lines.push('}');
  return lines.join('\n') + '\n';
}
