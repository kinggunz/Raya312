// Dekoder ASTC (LDR, 2D) - hasil RGBA8, satu blok per panggilan
const Q = [[2, 1, 0, 0], [3, 0, 1, 0], [4, 2, 0, 0], [5, 0, 0, 1], [6, 1, 1, 0], [8, 3, 0, 0], [10, 1, 0, 1], [12, 2, 1, 0], [16, 4, 0, 0], [20, 2, 0, 1], [24, 3, 1, 0], [32, 5, 0, 0], [40, 3, 0, 1], [48, 4, 1, 0], [64, 6, 0, 0], [80, 4, 0, 1], [96, 5, 1, 0], [128, 7, 0, 0], [160, 5, 0, 1], [192, 6, 1, 0], [256, 8, 0, 0]];
const iseBits = (q, n) => { const [, b, t, u] = Q[q]; return b * n + (t ? Math.ceil(8 * n / 5) : 0) + (u ? Math.ceil(7 * n / 3) : 0); };

function trits(T) {
  const b = (i) => (T >> i) & 1; let C, t4, t3;
  if (((T >> 2) & 7) === 7) { C = (((T >> 5) & 7) << 2) | (T & 3); t4 = 2; t3 = 2; }
  else { C = T & 31; if (((T >> 5) & 3) === 3) { t4 = 2; t3 = b(7); } else { t4 = b(7); t3 = (T >> 5) & 3; } }
  let t2, t1, t0;
  if ((C & 3) === 3) { t2 = 2; t1 = (C >> 4) & 1; const c3 = (C >> 3) & 1; t0 = (c3 << 1) | (((C >> 2) & 1) & (c3 ^ 1)); }
  else if (((C >> 2) & 3) === 3) { t2 = 2; t1 = 2; t0 = C & 3; }
  else { t2 = (C >> 4) & 1; t1 = (C >> 2) & 3; const c1 = (C >> 1) & 1; t0 = (c1 << 1) | ((C & 1) & (c1 ^ 1)); }
  return [t0, t1, t2, t3, t4];
}
function quints(Qv) {
  const g = (hi, lo) => (Qv >> lo) & ((1 << (hi - lo + 1)) - 1); let q0, q1, q2;
  if (g(2, 1) === 3 && g(6, 5) === 0) {
    const a = Qv & 1; q2 = (a << 2) | ((((Qv >> 4) & 1) & (a ^ 1)) << 1) | (((Qv >> 3) & 1) & (a ^ 1)); q1 = 4; q0 = 4;
  } else {
    let C;
    if (g(2, 1) === 3) { q2 = 4; C = (g(4, 3) << 3) | ((~g(6, 5) & 3) << 1) | (Qv & 1); } else { q2 = g(6, 5); C = g(4, 0); }
    if ((C & 7) === 5) { q1 = 4; q0 = (C >> 3) & 3; } else { q1 = (C >> 3) & 3; q0 = C & 7; }
  }
  return [q0, q1, q2];
}
function bitsAt(d, pos, n) { let v = 0; for (let i = 0; i < n; i++) { const p = pos + i; v |= ((d[p >> 3] >> (p & 7)) & 1) << i; } return v >>> 0; }

// Decode 'count' nilai ISE; kembalikan {m: bit rendah, d: trit/quint}
function iseDecode(d, pos, q, count) {
  const [, nb, tr, qu] = Q[q]; const m = new Array(count).fill(0), dd = new Array(count).fill(0);
  let p = pos;
  if (!tr && !qu) { for (let i = 0; i < count; i++) { m[i] = bitsAt(d, p, nb); p += nb; } return { m, d: dd }; }
  const gsz = tr ? 5 : 3; const chunks = tr ? [2, 2, 1, 2, 1] : [3, 2, 2];
  for (let g = 0; g * gsz < count; g++) {
    let T = 0, tp = 0;
    for (let i = 0; i < gsz; i++) {
      const idx = g * gsz + i; if (idx >= count) break;
      m[idx] = bitsAt(d, p, nb); p += nb;
      const c = chunks[i]; T |= bitsAt(d, p, c) << tp; tp += c; p += c;
    }
    const dec = tr ? trits(T) : quints(T);
    for (let i = 0; i < gsz && g * gsz + i < count; i++) dd[g * gsz + i] = dec[i];
  }
  return { m, d: dd };
}

const rep = (m, bits, to) => { let r = m << (to - bits); let sh = bits; while (sh < to) { r |= r >> sh; sh *= 2; } return r & ((1 << to) - 1); };
const TC = { 1: [204, () => 0], 2: [93, (m) => { const b = (m >> 1) & 1; return (b << 8) | (b << 4) | (b << 2) | (b << 1); }], 3: [44, (m) => { const c = (m >> 2) & 1, b = (m >> 1) & 1; return (c << 8) | (b << 7) | (c << 3) | (b << 2) | (c << 1) | b; }], 4: [22, (m) => { const d = (m >> 3) & 1, c = (m >> 2) & 1, b = (m >> 1) & 1; return (d << 8) | (c << 7) | (b << 6) | (d << 2) | (c << 1) | b; }], 5: [11, (m) => { const e = (m >> 4) & 1, d = (m >> 3) & 1, c = (m >> 2) & 1, b = (m >> 1) & 1; return (e << 8) | (d << 7) | (c << 6) | (b << 5) | (e << 1) | d; }], 6: [5, (m) => { const f = (m >> 5) & 1, e = (m >> 4) & 1, d = (m >> 3) & 1, c = (m >> 2) & 1, b = (m >> 1) & 1; return (f << 8) | (e << 7) | (d << 6) | (c << 5) | (b << 4) | f; }] };
const QC = { 1: [113, () => 0], 2: [54, (m) => { const b = (m >> 1) & 1; return (b << 8) | (b << 3) | (b << 2); }], 3: [26, (m) => { const c = (m >> 2) & 1, b = (m >> 1) & 1; return (c << 8) | (b << 7) | (c << 2) | (b << 1); }], 4: [13, (m) => { const d = (m >> 3) & 1, c = (m >> 2) & 1, b = (m >> 1) & 1; return (d << 8) | (c << 7) | (b << 6) | (d << 1) | c; }], 5: [6, (m) => { const e = (m >> 4) & 1, d = (m >> 3) & 1, c = (m >> 2) & 1, b = (m >> 1) & 1; return (e << 8) | (d << 7) | (c << 6) | (b << 5) | e; }] };
function unqColor(q, m, dv) {
  const [, nb, tr, qu] = Q[q];
  if (!tr && !qu) return rep(m, nb, 8);
  const [C, Bf] = (tr ? TC : QC)[nb]; const A = (m & 1) ? 0x1FF : 0; const B = Bf(m);
  let T = dv * C + B; T ^= A; T = (A & 0x80) | (T >> 2); return T & 255;
}
const TW = { 1: [50, () => 0], 2: [23, (m) => { const b = (m >> 1) & 1; return (b << 6) | (b << 2) | b; }], 3: [11, (m) => { const c = (m >> 2) & 1, b = (m >> 1) & 1; return (c << 6) | (b << 5) | (c << 1) | b; }] };
const QW = { 1: [28, () => 0], 2: [13, (m) => { const b = (m >> 1) & 1; return (b << 6) | (b << 1); }] };
function unqWeight(q, m, dv) {
  const [lv, nb, tr, qu] = Q[q]; let v;
  if (!tr && !qu) {
    if (nb === 1) v = m ? 63 : 0; else if (nb === 2) v = m * 21; else if (nb === 3) v = m * 9; else if (nb === 4) v = (m << 2) | (m >> 2); else v = (m << 1) | (m >> 4);
  } else if (nb === 0) v = tr ? [0, 32, 63][dv] : [0, 16, 32, 47, 63][dv];
  else {
    const [C, Bf] = (tr ? TW : QW)[nb]; const A = (m & 1) ? 0x7F : 0; let T = dv * C + Bf(m); T ^= A; v = (A & 0x20) | (T >> 2);
  }
  return v > 32 ? v + 1 : v;
}

function hash52(p) {
  p >>>= 0; p ^= p >>> 15; p = (p - (p << 17)) >>> 0; p = (p + (p << 7)) >>> 0; p = (p + (p << 4)) >>> 0;
  p ^= p >>> 5; p = (p + (p << 16)) >>> 0; p ^= p >>> 7; p ^= p >>> 3; p ^= (p << 6) >>> 0; p ^= p >>> 17; return p >>> 0;
}
function partition(seed, x, y, count, small) {
  if (small) { x <<= 1; y <<= 1; }
  seed += (count - 1) * 1024; const r = hash52(seed);
  let s = [r & 15, (r >>> 4) & 15, (r >>> 8) & 15, (r >>> 12) & 15, (r >>> 16) & 15, (r >>> 20) & 15, (r >>> 24) & 15, (r >>> 28) & 15, (r >>> 18) & 15, (r >>> 22) & 15, (r >>> 26) & 15, ((r >>> 30) | (r << 2)) & 15];
  s = s.map((v) => v * v);
  let sh1, sh2;
  if (seed & 1) { sh1 = seed & 2 ? 4 : 5; sh2 = count === 3 ? 6 : 5; } else { sh1 = count === 3 ? 6 : 5; sh2 = seed & 2 ? 4 : 5; }
  const sh3 = seed & 0x10 ? sh1 : sh2;
  const sh = [sh1, sh2, sh1, sh2, sh1, sh2, sh1, sh2, sh3, sh3, sh3, sh3];
  s = s.map((v, i) => v >> sh[i]);
  let a = (s[0] * x + s[1] * y + (r >>> 14)) & 63, b = (s[2] * x + s[3] * y + (r >>> 10)) & 63, c = (s[4] * x + s[5] * y + (r >>> 6)) & 63, d = (s[6] * x + s[7] * y + (r >>> 2)) & 63;
  if (count < 4) d = 0; if (count < 3) c = 0;
  if (a >= b && a >= c && a >= d) return 0; if (b >= c && b >= d) return 1; if (c >= d) return 2; return 3;
}

const cl = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const bc = (r, g, b, a) => [(r + b) >> 1, (g + b) >> 1, b, a];
function bts(a, b) { b = (b >> 1) | (a & 0x80); a = (a >> 1) & 0x3F; if (a & 0x20) a -= 0x40; return [a, b]; }
function endpoints(cem, v) {
  switch (cem) {
    case 0: return [[v[0], v[0], v[0], 255], [v[1], v[1], v[1], 255]];
    case 1: { const l0 = (v[0] >> 2) | (v[1] & 0xC0), l1 = Math.min(255, l0 + (v[1] & 0x3F)); return [[l0, l0, l0, 255], [l1, l1, l1, 255]]; }
    case 4: return [[v[0], v[0], v[0], v[2]], [v[1], v[1], v[1], v[3]]];
    case 5: { let [o0, b0] = bts(v[1], v[0]); let [o1, b1] = bts(v[3], v[2]); return [[b0, b0, b0, b1], [cl(b0 + o0), cl(b0 + o0), cl(b0 + o0), cl(b1 + o1)]]; }
    case 6: return [[(v[0] * v[3]) >> 8, (v[1] * v[3]) >> 8, (v[2] * v[3]) >> 8, 255], [v[0], v[1], v[2], 255]];
    case 10: return [[(v[0] * v[3]) >> 8, (v[1] * v[3]) >> 8, (v[2] * v[3]) >> 8, v[4]], [v[0], v[1], v[2], v[5]]];
    case 8: return v[1] + v[3] + v[5] >= v[0] + v[2] + v[4] ? [[v[0], v[2], v[4], 255], [v[1], v[3], v[5], 255]] : [bc(v[1], v[3], v[5], 255), bc(v[0], v[2], v[4], 255)];
    case 12: return v[1] + v[3] + v[5] >= v[0] + v[2] + v[4] ? [[v[0], v[2], v[4], v[6]], [v[1], v[3], v[5], v[7]]] : [bc(v[1], v[3], v[5], v[7]), bc(v[0], v[2], v[4], v[6])];
    case 9: case 13: {
      let [r1, r0] = bts(v[1], v[0]), [g1, g0] = bts(v[3], v[2]), [b1, b0] = bts(v[5], v[4]); let a0 = 255, a1 = 0;
      if (cem === 13) { [a1, a0] = bts(v[7], v[6]); } const sum = r1 + g1 + b1; r1 += r0; g1 += g0; b1 += b0; a1 = cem === 13 ? a1 + a0 : 255;
      const f = (a) => a.map(cl);
      return sum >= 0 ? [f([r0, g0, b0, a0]), f([r1, g1, b1, a1])] : [f(bc(r1, g1, b1, a1)), f(bc(r0, g0, b0, a0))];
    }
    default: return null;
  }
}

// blok 16 byte -> isi out (RGBA) ukuran bw x bh; kembalikan false bila blok tidak valid / HDR
export function decodeBlock(d, bw, bh, out) {
  const fill = (r, g, b, a) => { for (let i = 0; i < bw * bh; i++) { out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = a; } };
  const mode = bitsAt(d, 0, 11);
  if ((mode & 0x1FF) === 0x1FC) {
    if (mode & 0x200) { fill(255, 0, 255, 255); return false; }
    fill(bitsAt(d, 64, 16) >> 8, bitsAt(d, 80, 16) >> 8, bitsAt(d, 96, 16) >> 8, bitsAt(d, 112, 16) >> 8); return true;
  }
  const err = () => { fill(255, 0, 255, 255); return false; };
  let R0 = (mode >> 4) & 1; let H = (mode >> 9) & 1; let D = (mode >> 10) & 1; const A = (mode >> 5) & 3; let W, Hh;
  if ((mode & 3) !== 0) {
    R0 |= (mode & 3) << 1; let B = (mode >> 7) & 3;
    switch ((mode >> 2) & 3) {
      case 0: W = B + 4; Hh = A + 2; break; case 1: W = B + 8; Hh = A + 2; break; case 2: W = A + 2; Hh = B + 8; break;
      default: B &= 1; if (mode & 0x100) { W = B + 2; Hh = A + 2; } else { W = A + 2; Hh = B + 6; }
    }
  } else {
    R0 |= ((mode >> 2) & 3) << 1; if (((mode >> 2) & 3) === 0) return err();
    const B = (mode >> 9) & 3; let h = H;
    switch ((mode >> 7) & 3) {
      case 0: W = 12; Hh = A + 2; break; case 1: W = A + 2; Hh = 12; break;
      case 2: W = A + 6; Hh = B + 6; D = 0; h = 0; break;
      default: if (A === 0) { W = 6; Hh = 10; } else if (A === 1) { W = 10; Hh = 6; } else return err();
    }
    H = h;
  }
  const wq = R0 - 2 + 6 * H; if (R0 < 2 || wq > 11) return err();
  const wcount = W * Hh * (D + 1); if (wcount > 64) return err();
  const wbits = iseBits(wq, wcount); if (wbits < 24 || wbits > 96) return err();
  if (W > bw || Hh > bh) return err();
  const pc = ((mode >> 11) & 3) + 1; // salah: partisi di bit 11-12 (di luar 11 bit mode)
  return decodeRest(d, bw, bh, out, { W, Hh, D, wq, wcount, wbits, fill, err });
}
function decodeRest(d, bw, bh, out, c) {
  const { W, Hh, D, wq, wbits, wcount, fill, err } = c;
  const pc = bitsAt(d, 11, 2) + 1; if (D && pc === 4) return err();
  let cem = [], pi = 0, cfg, high = 0;
  if (pc === 1) { cem = [bitsAt(d, 13, 4)]; cfg = 17; }
  else {
    pi = bitsAt(d, 13, 10); high = 3 * pc - 4; const below = 128 - wbits - high;
    const et = bitsAt(d, 23, 6) | (bitsAt(d, below, high) << 6); let bcls = et & 3;
    if (bcls === 0) { for (let i = 0; i < pc; i++) cem.push((et >> 2) & 15); high = 0; }
    else { let bp = 2; bcls--; const cc = [], mm = []; for (let i = 0; i < pc; i++) { cc.push((et >> bp) & 1); bp++; } for (let i = 0; i < pc; i++) { mm.push((et >> bp) & 3); bp += 2; } for (let i = 0; i < pc; i++) cem.push((bcls + cc[i]) * 4 + mm[i]); }
    cfg = 29;
  }
  let ccs = 0, below2 = 128 - wbits - high;
  if (D) { ccs = bitsAt(d, below2 - 2, 2); }
  const avail = 128 - wbits - cfg - high - (D ? 2 : 0);
  let nv = 0; for (const e of cem) nv += ((e >> 2) + 1) * 2; if (nv > 18) return err();
  let cq = -1; for (let q = 20; q >= 4; q--) { if (iseBits(q, nv) <= avail) { cq = q; break; } } if (cq < 0) return err();
  const ev = iseDecode(d, cfg, cq, nv); const vals = ev.m.map((m, i) => unqColor(cq, m, ev.d[i]));
  // bit terbalik untuk bobot
  const rev = new Uint8Array(16); for (let i = 0; i < 16; i++) { let b = d[15 - i], r = 0; for (let k = 0; k < 8; k++) r |= ((b >> k) & 1) << (7 - k); rev[i] = r; }
  const wi = iseDecode(rev, 0, wq, wcount); const wts = wi.m.map((m, i) => unqWeight(wq, m, wi.d[i]));
  const eps = []; let vp = 0;
  for (const e of cem) { const n = ((e >> 2) + 1) * 2; const ep = endpoints(e, vals.slice(vp, vp + n)); vp += n; if (!ep) return err(); eps.push(ep); }
  const Ds = Math.floor((1024 + (bw >> 1)) / (bw - 1)), Dt = Math.floor((1024 + (bh >> 1)) / (bh - 1));
  const small = bw * bh < 31;
  const plane = (pl, x, y) => {
    const gs = (Ds * x * (W - 1) + 32) >> 6, gt = (Dt * y * (Hh - 1) + 32) >> 6;
    const js = gs >> 4, fs = gs & 15, jt = gt >> 4, ft = gt & 15;
    const w11 = (fs * ft + 8) >> 4, w10 = ft - w11, w01 = fs - w11, w00 = 16 - fs - ft + w11;
    const g = (xx, yy) => { if (xx >= W) xx = W - 1; if (yy >= Hh) yy = Hh - 1; return wts[(xx + yy * W) * (D + 1) + pl]; };
    return (g(js, jt) * w00 + g(js + 1, jt) * w01 + g(js, jt + 1) * w10 + g(js + 1, jt + 1) * w11 + 8) >> 4;
  };
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const p = pc > 1 ? partition(pi, x, y, pc, small) : 0; const [e0, e1] = eps[p];
    const w0 = plane(0, x, y), w1 = D ? plane(1, x, y) : w0; const o = (y * bw + x) * 4;
    for (let k = 0; k < 4; k++) {
      const w = D && k === ccs ? w1 : w0; const C = (e0[k] * 257 * (64 - w) + e1[k] * 257 * w + 32) >> 6; out[o + k] = C >> 8;
    }
  }
  return true;
}
