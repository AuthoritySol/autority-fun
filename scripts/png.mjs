// Minimal PNG reader: 8-bit, non-interlaced, colourtype 2 (RGB) or 6 (RGBA). Enough to read pixels
// from the brand files and from the build output without trusting any image library.
import fs from 'node:fs';
import zlib from 'node:zlib';

export function readPng(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file}: not a PNG`);
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20), depth = b[24], ct = b[25], il = b[28];
  if (depth !== 8 || il !== 0 || (ct !== 6 && ct !== 2)) throw new Error(`${file}: unsupported PNG layout (depth ${depth}, colourtype ${ct}, interlace ${il})`);
  const bpp = ct === 6 ? 4 : 3;
  const idat = [];
  for (let p = 8; p < b.length;) {
    const len = b.readUInt32BE(p), type = b.toString('latin1', p + 4, p + 8);
    if (type === 'IDAT') idat.push(b.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const up = y ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += up;
      else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const p0 = a + up - c, pa = Math.abs(p0 - a), pb = Math.abs(p0 - up), pc = Math.abs(p0 - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      out[y * stride + x] = v & 255;
    }
  }
  const px = (x, y) => { const i = (y * w + x) * bpp; return [out[i], out[i + 1], out[i + 2], bpp === 4 ? out[i + 3] : 255]; };
  return { width: w, height: h, colortype: ct, data: out, bpp, px };
}

export const hexOf = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
