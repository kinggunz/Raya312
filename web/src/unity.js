// Pembaca/penulis Unity AssetBundle (UnityFS) - tanpa dependensi
import COMMON from './common_strings.json';
import { decodeBlock } from './astc.js';

const utf8 = (b) => new TextDecoder().decode(b);
const enc = new TextEncoder();

export class R {
  constructor(u8, le = false) {
    this.u8 = u8; this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); this.pos = 0; this.le = le;
  }
  u8_() { return this.u8[this.pos++]; }
  i8() { const v = this.dv.getInt8(this.pos); this.pos += 1; return v; }
  u16() { const v = this.dv.getUint16(this.pos, this.le); this.pos += 2; return v; }
  i16() { const v = this.dv.getInt16(this.pos, this.le); this.pos += 2; return v; }
  u32() { const v = this.dv.getUint32(this.pos, this.le); this.pos += 4; return v; }
  i32() { const v = this.dv.getInt32(this.pos, this.le); this.pos += 4; return v; }
  f32() { const v = this.dv.getFloat32(this.pos, this.le); this.pos += 4; return v; }
  f64() { const v = this.dv.getFloat64(this.pos, this.le); this.pos += 8; return v; }
  i64() { const v = this.dv.getBigInt64(this.pos, this.le); this.pos += 8; return v; }
  u64() { const v = this.dv.getBigUint64(this.pos, this.le); this.pos += 8; return v; }
  bytes(n) { const b = this.u8.subarray(this.pos, this.pos + n); this.pos += n; return b; }
  cstr() {
    let e = this.pos; while (this.u8[e] !== 0) e++;
    const s = utf8(this.u8.subarray(this.pos, e)); this.pos = e + 1; return s;
  }
  align(n) { this.pos = Math.ceil(this.pos / n) * n; }
}

/* ---------------- Dekompresi ---------------- */
export function lz4(src, ip, end, outSize) {
  const out = new Uint8Array(outSize); let op = 0;
  while (ip < end) {
    const tok = src[ip++]; let lit = tok >> 4;
    if (lit === 15) { let s; do { s = src[ip++]; lit += s; } while (s === 255); }
    out.set(src.subarray(ip, ip + lit), op); ip += lit; op += lit;
    if (ip >= end) break;
    const off = src[ip] | (src[ip + 1] << 8); ip += 2;
    let ml = tok & 15;
    if (ml === 15) { let s; do { s = src[ip++]; ml += s; } while (s === 255); }
    ml += 4;
    let mp = op - off;
    for (let i = 0; i < ml; i++) out[op++] = out[mp++];
  }
  return out;
}

export function lzma(src, off, outSize) {
  const props = src[off]; let d = props;
  const lc = d % 9; d = (d / 9) | 0; const lp = d % 5; const pb = (d / 5) | 0;
  let pos = off + 6; let range = 0xFFFFFFFF, code = 0;
  for (let i = 0; i < 4; i++) code = ((code << 8) | src[pos++]) >>> 0;
  const out = new Uint8Array(outSize);
  const P = (n) => new Uint16Array(n).fill(1024);
  const isMatch = P(12 << 4), isRep = P(12), isRepG0 = P(12), isRepG1 = P(12), isRepG2 = P(12), isRep0Long = P(12 << 4);
  const posSlot = P(4 * 64), posDec = P(115), align = P(17), lit = P(0x300 << (lc + lp));
  const mkLen = () => ({ c: P(2), low: P(16 << 3), mid: P(16 << 3), high: P(256) });
  const lenC = mkLen(), repC = mkLen();
  function bit(p, i) {
    const pr = p[i]; const bound = (range >>> 11) * pr; let r;
    if (code < bound) { range = bound; p[i] = pr + ((2048 - pr) >> 5); r = 0; }
    else { range -= bound; code -= bound; p[i] = pr - (pr >> 5); r = 1; }
    if (range < 16777216) { range = (range << 8) >>> 0; code = ((code << 8) | src[pos++]) >>> 0; }
    return r;
  }
  function tree(p, base, n) { let m = 1; for (let i = 0; i < n; i++) m = (m << 1) | bit(p, base + m); return m - (1 << n); }
  function rev(p, base, n) { let m = 1, s = 0; for (let i = 0; i < n; i++) { const b = bit(p, base + m); m = (m << 1) | b; s |= b << i; } return s; }
  function direct(n) {
    let res = 0;
    for (let i = 0; i < n; i++) {
      range = range >>> 1; let b = 0;
      if (code >= range) { code -= range; b = 1; }
      res = ((res << 1) | b) >>> 0;
      if (range < 16777216) { range = (range << 8) >>> 0; code = ((code << 8) | src[pos++]) >>> 0; }
    }
    return res;
  }
  function len(c, ps) {
    if (!bit(c.c, 0)) return tree(c.low, ps << 3, 3);
    if (!bit(c.c, 1)) return 8 + tree(c.mid, ps << 3, 3);
    return 16 + tree(c.high, 0, 8);
  }
  let state = 0, r0 = 0, r1 = 0, r2 = 0, r3 = 0, op = 0;
  const pbMask = (1 << pb) - 1, lpMask = (1 << lp) - 1;
  while (op < outSize) {
    const ps = op & pbMask;
    if (!bit(isMatch, (state << 4) + ps)) {
      const prev = op ? out[op - 1] : 0;
      const base = 0x300 * (((op & lpMask) << lc) + (prev >> (8 - lc)));
      let sym = 1;
      if (state >= 7) {
        let mb = out[op - r0 - 1];
        do {
          const mbit = (mb >> 7) & 1; mb <<= 1;
          const b = bit(lit, base + ((1 + mbit) << 8) + sym);
          sym = (sym << 1) | b; if (mbit !== b) break;
        } while (sym < 0x100);
      }
      while (sym < 0x100) sym = (sym << 1) | bit(lit, base + sym);
      out[op++] = sym & 255;
      state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
      continue;
    }
    let l;
    if (bit(isRep, state)) {
      if (!bit(isRepG0, state)) {
        if (!bit(isRep0Long, (state << 4) + ps)) { state = state < 7 ? 9 : 11; out[op] = out[op - r0 - 1]; op++; continue; }
      } else {
        let dist;
        if (!bit(isRepG1, state)) dist = r1;
        else { if (!bit(isRepG2, state)) dist = r2; else { dist = r3; r3 = r2; } r2 = r1; }
        r1 = r0; r0 = dist;
      }
      l = len(repC, ps); state = state < 7 ? 8 : 11;
    } else {
      r3 = r2; r2 = r1; r1 = r0;
      l = len(lenC, ps); state = state < 7 ? 7 : 10;
      const slot = tree(posSlot, (l < 4 ? l : 3) * 64, 6);
      if (slot < 4) r0 = slot;
      else {
        const nd = (slot >> 1) - 1;
        r0 = ((2 | (slot & 1)) << nd) >>> 0;
        if (slot < 14) r0 = (r0 + rev(posDec, r0 - slot, nd)) >>> 0;
        else { r0 = (r0 + (direct(nd - 4) << 4)) >>> 0; r0 = (r0 + rev(align, 0, 4)) >>> 0; }
      }
      if (r0 === 0xFFFFFFFF) break;
    }
    l += 2;
    for (let i = 0; i < l && op < outSize; i++) { out[op] = out[op - r0 - 1]; op++; }
  }
  return out;
}

function decompress(type, src, off, csize, usize) {
  if (type === 0) return src.subarray(off, off + usize);
  if (type === 1) return lzma(src, off, usize);
  if (type === 2 || type === 3) return lz4(src, off, off + csize, usize);
  throw new Error('Kompresi tidak dikenal: ' + type);
}

/* ---------------- UnityFS ---------------- */
export function isUnityFS(u8) {
  return u8.length > 8 && utf8(u8.subarray(0, 7)) === 'UnityFS';
}
export function readBundle(u8) {
  const r = new R(u8, false);
  const sig = r.cstr();
  if (sig !== 'UnityFS') throw new Error('Bukan UnityFS (' + sig + ')');
  const version = r.u32(), unityVersion = r.cstr(), unityRevision = r.cstr();
  const size = Number(r.i64()); const cbi = r.u32(), ubi = r.u32(), flags = r.u32();
  if (version >= 7) r.align(16);
  let infoPos = r.pos;
  if (flags & 0x80) infoPos = u8.length - cbi;
  const info = decompress(flags & 0x3F, u8, infoPos, cbi, ubi);
  const ir = new R(info, false);
  ir.pos = 16;
  const bc = ir.i32(); const blocks = [];
  for (let i = 0; i < bc; i++) blocks.push({ usize: ir.u32(), csize: ir.u32(), flags: ir.u16() });
  const nc = ir.i32(); const nodes = [];
  for (let i = 0; i < nc; i++) {
    const offset = Number(ir.i64()), sz = Number(ir.i64()), nf = ir.u32(), path = ir.cstr();
    nodes.push({ offset, size: sz, flags: nf, path });
  }
  let dpos = (flags & 0x80) ? infoPos - 0 : infoPos + cbi;
  if (flags & 0x80) dpos = r.pos;
  const total = blocks.reduce((a, b) => a + b.usize, 0);
  const all = new Uint8Array(total); let o = 0;
  for (const b of blocks) {
    all.set(decompress(b.flags & 0x3F, u8, dpos, b.csize, b.usize), o);
    o += b.usize; dpos += b.csize;
  }
  nodes.forEach((n) => { n.data = all.subarray(n.offset, n.offset + n.size); });
  return { version, unityVersion, unityRevision, flags, nodes };
}

function concat(parts) {
  const n = parts.reduce((a, b) => a + b.length, 0); const out = new Uint8Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export function writeBundle(b) {
  // simpan tanpa kompresi, satu blok
  const total = b.nodes.reduce((a, n) => a + n.data.length, 0);
  const info = []; const push = (...x) => info.push(...x);
  const be32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const be64 = (v) => [0, 0, 0, 0, ...be32(v)];
  push(...new Array(16).fill(0), ...be32(1), ...be32(total), ...be32(total), 0, 0, ...be32(b.nodes.length));
  let off = 0;
  for (const n of b.nodes) {
    push(...be64(off), ...be64(n.data.length), ...be32(n.flags), ...enc.encode(n.path), 0);
    off += n.data.length;
  }
  const infoU8 = Uint8Array.from(info);
  const flags = (b.flags & ~0x3F & ~0x80 & ~0x200) | 0x40;
  const head = [...enc.encode('UnityFS'), 0, ...be32(b.version), ...enc.encode(b.unityVersion), 0, ...enc.encode(b.unityRevision), 0];
  const hlen0 = head.length + 8 + 12;
  const pad = b.version >= 7 ? (16 - (hlen0 % 16)) % 16 : 0;
  const fileSize = hlen0 + pad + infoU8.length + total;
  const h = Uint8Array.from([...head, ...be64(fileSize), ...be32(infoU8.length), ...be32(infoU8.length), ...be32(flags), ...new Array(pad).fill(0)]);
  return concat([h, infoU8, ...b.nodes.map((n) => n.data)]);
}

/* ---------------- SerializedFile ---------------- */
function readTree(r, version) {
  const nc = r.i32(), sc = r.i32(); const raw = [];
  for (let i = 0; i < nc; i++) {
    const n = { version: r.u16(), level: r.u8_(), isArray: r.u8_(), typeOff: r.u32(), nameOff: r.u32(), byteSize: r.i32(), index: r.i32(), metaFlag: r.u32() };
    if (version >= 19) r.pos += 8;
    raw.push(n);
  }
  const sb = r.bytes(sc);
  const str = (o) => {
    if (o & 0x80000000) return COMMON[o & 0x7FFFFFFF] || String(o & 0x7FFFFFFF);
    let e = o; while (sb[e] !== 0) e++; return utf8(sb.subarray(o, e));
  };
  const root = { children: [], level: -1 }; const stack = [root];
  for (const n of raw) {
    const node = { type: str(n.typeOff), name: str(n.nameOff), level: n.level, metaFlag: n.metaFlag, children: [] };
    while (stack[stack.length - 1].level >= node.level) stack.pop();
    stack[stack.length - 1].children.push(node); stack.push(node);
  }
  return root.children[0];
}

export function parseVersion(s) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(s || ''); return m ? [+m[1], +m[2], +m[3]] : [2018, 4, 0];
}

export function parseSerialized(u8) {
  const r = new R(u8, false);
  let metaSize = r.u32(), fileSize = r.u32(); const version = r.u32(); let dataOffset = r.u32();
  if (version < 16 || version > 22) throw new Error('Versi SerializedFile ' + version + ' belum didukung (16-22)');
  const endian = r.u8_(); r.pos += 3;
  let wide = false;
  if (version >= 22) { metaSize = r.u32(); fileSize = Number(r.i64()); dataOffset = Number(r.i64()); r.pos += 8; wide = true; }
  r.le = endian === 0;
  const unityVersion = r.cstr(); const platform = r.i32(); const hasTree = r.u8_() !== 0;
  const tc = r.i32(); const types = [];
  for (let i = 0; i < tc; i++) {
    const t = { classId: r.i32() };
    r.pos += 1; r.pos += 2; // stripped, scriptTypeIndex
    if (t.classId === 114) r.pos += 16;
    r.pos += 16;
    if (hasTree) { t.tree = readTree(r, version); if (version >= 21) { const n = r.i32(); r.pos += 4 * n; } }
    types.push(t);
  }
  const oc = r.i32(); const objects = [];
  for (let i = 0; i < oc; i++) {
    r.align(4);
    const pathId = r.i64(); const startOff = r.pos; const byteStart = wide ? Number(r.i64()) : r.u32(); const byteSize = r.u32();
    const typeId = r.i32();
    objects.push({ pathId: String(pathId), startOff, sizeOff: startOff + (wide ? 8 : 4), byteStart, byteSize, typeId, classId: types[typeId].classId });
  }
  return { u8, version, wide, dataOffset, le: r.le, unityVersion, uv: parseVersion(unityVersion), platform, hasTree, types, objects };
}

export function rebuildSerialized(sf, repl) {
  const head = sf.u8.slice(0, sf.dataOffset); const hv = new DataView(head.buffer);
  const parts = []; let pos = 0;
  for (const o of sf.objects) {
    const bytes = repl.get(o.pathId) || sf.u8.subarray(sf.dataOffset + o.byteStart, sf.dataOffset + o.byteStart + o.byteSize);
    const start = Math.ceil(pos / 8) * 8;
    if (start > pos) parts.push(new Uint8Array(start - pos));
    if (sf.wide) hv.setBigUint64(o.startOff, BigInt(start), sf.le); else hv.setUint32(o.startOff, start, sf.le);
    hv.setUint32(o.sizeOff, bytes.length, sf.le);
    parts.push(bytes); pos = start + bytes.length;
  }
  if (sf.wide) hv.setBigInt64(24, BigInt(sf.dataOffset + pos), false); else hv.setUint32(4, sf.dataOffset + pos, false);
  return concat([head, ...parts]);
}

/* ---------------- Pembaca objek (type tree) ---------------- */
const ALIGN = 0x4000;
function readVal(r, n) {
  let v; const t = n.type; let align = (n.metaFlag & ALIGN) !== 0;
  switch (t) {
    case 'SInt8': v = r.i8(); break;
    case 'UInt8': case 'char': v = r.u8_(); break;
    case 'SInt16': case 'short': v = r.i16(); break;
    case 'UInt16': case 'unsigned short': v = r.u16(); break;
    case 'SInt32': case 'int': v = r.i32(); break;
    case 'UInt32': case 'unsigned int': case 'Type*': v = r.u32(); break;
    case 'SInt64': case 'long long': v = r.i64(); break;
    case 'UInt64': case 'unsigned long long': case 'FileSize': v = r.u64(); break;
    case 'float': v = r.f32(); break;
    case 'double': v = r.f64(); break;
    case 'bool': v = r.u8_() !== 0; break;
    case 'string': { const l = r.i32(); v = utf8(r.bytes(l)); align = true; break; }
    case 'TypelessData': { const l = r.i32(); v = r.bytes(l); break; }
    default:
      if (n.children.length === 1 && n.children[0].type === 'Array') {
        const a = n.children[0]; const size = r.i32(); const el = a.children[1];
        if (['UInt8', 'SInt8', 'char'].includes(el.type)) v = r.bytes(size);
        else { v = []; for (let i = 0; i < size; i++) v.push(readVal(r, el)); }
        if (a.metaFlag & ALIGN) align = true;
      } else if (t === 'Array') {
        const size = r.i32(); v = []; for (let i = 0; i < size; i++) v.push(readVal(r, n.children[1]));
      } else { v = {}; for (const c of n.children) v[c.name] = readVal(r, c); }
  }
  if (align) r.align(4);
  return v;
}
function readTop(r, root) {
  const f = {};
  for (const c of root.children) {
    const off = r.pos; const value = readVal(r, c);
    f[c.name] = { off, end: r.pos, value };
    if (c.name === 'm_StreamData' && c.children.length) {
      // posisi anak m_StreamData untuk penambalan
      const rr = new R(r.u8, r.le); rr.pos = off; const sub = {};
      for (const cc of c.children) { const o2 = rr.pos; readVal(rr, cc); sub[cc.name] = { off: o2, end: rr.pos, type: cc.type }; }
      f[c.name].sub = sub;
    }
  }
  return f;
}
// Texture2D tanpa type tree (tata letak Unity 2017-2022)
function readTexLegacy(r, uv) {
  const f = {}; const mark = (k, fn) => { const off = r.pos; const value = fn(); f[k] = { off, end: r.pos, value }; };
  const ge = (a, b) => uv[0] > a || (uv[0] === a && uv[1] >= b);
  mark('m_Name', () => { const l = r.i32(); const s = utf8(r.bytes(l)); r.align(4); return s; });
  if (ge(2017, 3)) { r.pos += 4; r.pos += 1; if (ge(2020, 2)) r.pos += 1; r.align(4); }
  mark('m_Width', () => r.i32()); mark('m_Height', () => r.i32()); mark('m_CompleteImageSize', () => r.i32());
  if (uv[0] >= 2020) r.pos += 4;
  mark('m_TextureFormat', () => r.i32());
  mark('m_MipCount', () => r.i32());
  if (ge(2018, 2)) r.pos += 1; else r.pos += 1; // m_IsReadable
  if (uv[0] >= 2020) r.pos += 1;
  if (ge(2019, 3)) r.pos += 1;
  if (uv[0] === 5 && uv[1] <= 4) r.pos += 1;
  if (ge(2018, 2)) mark('m_StreamingMipmaps', () => r.u8_());
  r.align(4);
  if (ge(2018, 2)) r.pos += 4;
  r.pos += 8; // imageCount, dimension
  r.pos += 8; r.pos += 4; r.pos += uv[0] >= 2017 ? 12 : 4; // filter, aniso, bias, wrap
  r.pos += 4; r.pos += 4; // lightmap, colorspace
  if (ge(2020, 2)) { const n = r.i32(); r.pos += n; r.align(4); }
  mark('image data', () => { const l = r.i32(); const b = r.bytes(l); r.align(4); return b; });
  if (r.pos + 12 <= r.u8.length) {
    const start = r.pos; const wide = uv[0] >= 2020; const sub = {};
    const o1 = r.pos; const offset = wide ? Number(r.u64()) : r.u32();
    sub.offset = { off: o1, end: r.pos, type: wide ? 'UInt64' : 'UInt32' };
    const o2 = r.pos; const size = r.u32(); sub.size = { off: o2, end: r.pos, type: 'UInt32' };
    const l = r.i32(); const path = utf8(r.bytes(l)); r.align(4);
    f.m_StreamData = { off: start, end: r.pos, value: { offset, size, path }, sub };
  }
  return f;
}

export function readObject(sf, obj) {
  const sub = sf.u8.subarray(sf.dataOffset + obj.byteStart, sf.dataOffset + obj.byteStart + obj.byteSize);
  const r = new R(sub, sf.le); const t = sf.types[obj.typeId];
  let fields;
  if (t.tree) fields = readTop(r, t.tree);
  else if (obj.classId === 28) fields = readTexLegacy(r, sf.uv);
  else throw new Error('Bundle tanpa type tree: hanya Texture2D yang bisa dibaca');
  return { bytes: sub, fields, get: (k) => fields[k] && fields[k].value };
}
export function objectName(sf, obj) {
  try { const o = readObject(sf, obj); return o.get('m_Name') || ''; } catch (e) { return ''; }
}

/* ---------------- Texture2D ---------------- */
export const TEX_FORMATS = { 48: 'ASTC 4x4', 49: 'ASTC 5x5', 50: 'ASTC 6x6', 51: 'ASTC 8x8', 52: 'ASTC 10x10', 53: 'ASTC 12x12', 54: 'ASTC RGBA 4x4', 55: 'ASTC RGBA 5x5', 56: 'ASTC RGBA 6x6', 57: 'ASTC RGBA 8x8', 58: 'ASTC RGBA 10x10', 59: 'ASTC RGBA 12x12', 1: 'Alpha8', 2: 'ARGB4444', 3: 'RGB24', 4: 'RGBA32', 5: 'ARGB32', 7: 'RGB565', 10: 'DXT1', 12: 'DXT5', 13: 'RGBA4444', 14: 'BGRA32', 34: 'ETC_RGB4', 45: 'ETC2_RGB', 46: 'ETC2_RGBA1', 47: 'ETC2_RGBA8', 28: 'DXT1 Crunched', 29: 'DXT5 Crunched', 64: 'ETC_RGB4 Crunched', 65: 'ETC2_RGBA8 Crunched' };
export function getTexture(sf, obj, nodes) {
  const o = readObject(sf, obj);
  const w = o.get('m_Width'), h = o.get('m_Height'), fmt = o.get('m_TextureFormat');
  let data = o.get('image data');
  const sd = o.get('m_StreamData');
  if ((!data || data.length === 0) && sd && sd.size > 0) {
    const base = String(sd.path).split('/').pop();
    const nd = nodes.find((n) => n.path.split('/').pop() === base);
    if (!nd) throw new Error('File stream ' + base + ' tidak ditemukan di bundle');
    data = nd.data.subarray(Number(sd.offset), Number(sd.offset) + sd.size);
  }
  return { name: o.get('m_Name'), width: w, height: h, format: fmt, formatName: TEX_FORMATS[fmt] || ('format ' + fmt), data, o };
}

function dxtColors(c0, c1, four) {
  const e = (c) => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];
  const a = e(c0), b = e(c1); const out = [[...a, 255], [...b, 255]];
  if (four) { out.push([...a.map((v, i) => (2 * v + b[i]) / 3), 255], [...a.map((v, i) => (v + 2 * b[i]) / 3), 255]); }
  else { out.push([...a.map((v, i) => (v + b[i]) / 2), 255], [0, 0, 0, 0]); }
  return out;
}
const ETC_MOD = [[2, 8], [5, 17], [9, 29], [13, 42], [18, 60], [24, 80], [33, 106], [47, 183]];
const ETC_DIST = [3, 6, 11, 16, 23, 32, 41, 64];
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const x4 = (v) => (v << 4) | v, x5 = (v) => (v << 3) | (v >> 2), x6 = (v) => (v << 2) | (v >> 4), x7 = (v) => (v << 1) | (v >> 6);

function etcBlock(b, o, put, alphaOnly1) {
  // b: data, o: offset of the 8-byte color block; put(x,y,r,g,b,a)
  const b0 = b[o], b1 = b[o + 1], b2 = b[o + 2], b3 = b[o + 3];
  const msb = (b[o + 4] << 8) | b[o + 5], lsb = (b[o + 6] << 8) | b[o + 7];
  const diff = (b3 >> 1) & 1, flip = b3 & 1;
  const idx = (x, y) => { const p = x * 4 + y; return (((msb >> p) & 1) << 1) | ((lsb >> p) & 1); };
  const opaque = alphaOnly1 ? diff : 1; // ETC2_RGBA1: diff bit = opaque
  let mode = 'etc1', c1, c2;
  if (diff) {
    let r1 = b0 >> 3, g1 = b1 >> 3, bl1 = b2 >> 3;
    const dr = (b0 & 7) - ((b0 & 4) << 1), dg = (b1 & 7) - ((b1 & 4) << 1), db = (b2 & 7) - ((b2 & 4) << 1);
    const r2 = r1 + dr, g2 = g1 + dg, b2c = bl1 + db;
    if (r2 < 0 || r2 > 31) mode = 'T'; else if (g2 < 0 || g2 > 31) mode = 'H'; else if (b2c < 0 || b2c > 31) mode = 'P';
    c1 = [x5(r1), x5(g1), x5(bl1)]; c2 = [x5(r2 & 31), x5(g2 & 31), x5(b2c & 31)];
  } else { c1 = [x4(b0 >> 4), x4(b1 >> 4), x4(b2 >> 4)]; c2 = [x4(b0 & 15), x4(b1 & 15), x4(b2 & 15)]; }
  if (alphaOnly1 && !diff) { /* A1 non-opaque mode uses etc1 colors w/ punch-through */ }
  if (mode === 'etc1') {
    const t1 = ETC_MOD[(b3 >> 5) & 7], t2 = ETC_MOD[(b3 >> 2) & 7];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const second = flip ? y >= 2 : x >= 2; const c = second ? c2 : c1; const t = second ? t2 : t1;
      const i = idx(x, y); let m = i & 1 ? t[1] : t[0]; if (i & 2) m = -m;
      if (alphaOnly1 && !opaque && i === 2) { put(x, y, 0, 0, 0, 0); continue; }
      if (alphaOnly1 && !opaque) { m = i === 3 ? -t[1] : (i & 1 ? t[1] : t[0]); if (i === 2) m = 0; }
      put(x, y, clamp(c[0] + m), clamp(c[1] + m), clamp(c[2] + m), 255);
    }
    return;
  }
  if (mode === 'T' || mode === 'H') {
    let pc;
    if (mode === 'T') {
      const R1 = x4(((b0 >> 1) & 12) | (b0 & 3)), G1 = x4(b1 >> 4), B1 = x4(b1 & 15);
      const R2 = x4(b2 >> 4), G2 = x4(b2 & 15), B2 = x4(b3 >> 4);
      const d = ETC_DIST[(((b3 >> 2) & 3) << 1) | (b3 & 1)];
      pc = [[R1, G1, B1], [R2 + d, G2 + d, B2 + d], [R2, G2, B2], [R2 - d, G2 - d, B2 - d]];
    } else {
      const r1 = (b0 >> 3) & 15, g1 = ((b0 & 7) << 1) | ((b1 >> 4) & 1), bb1 = (b1 & 8) | ((b1 & 3) << 1) | (b2 >> 7);
      const r2 = (b2 >> 3) & 15, g2 = ((b2 & 7) << 1) | (b3 >> 7), bb2 = (b3 >> 3) & 15;
      const ods = ((r1 << 8) | (g1 << 4) | bb1) >= ((r2 << 8) | (g2 << 4) | bb2) ? 1 : 0;
      const d = ETC_DIST[(b3 & 4) | ((b3 & 1) << 1) | ods];
      const A = [x4(r1), x4(g1), x4(bb1)], B = [x4(r2), x4(g2), x4(bb2)];
      pc = [A.map((v) => v + d), A.map((v) => v - d), B.map((v) => v + d), B.map((v) => v - d)];
    }
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const c = pc[idx(x, y)];
      if (alphaOnly1 && !opaque && idx(x, y) === 2) { put(x, y, 0, 0, 0, 0); continue; }
      put(x, y, clamp(c[0]), clamp(c[1]), clamp(c[2]), 255);
    }
    return;
  }
  // planar
  const Ro = x6((b0 >> 1) & 63), Go = x7(((b0 & 1) << 6) | ((b1 >> 1) & 63));
  const Bo = x6(((b1 & 1) << 5) | (b2 & 0x18) | ((b2 & 3) << 1) | (b3 >> 7));
  const Rh = x6(((b3 >> 1) & 0x3E) | (b3 & 1)), Gh = x7(b4(b, o)), Bh = x6(((b[o + 4] & 1) << 5) | (b[o + 5] >> 3));
  const Rv = x6(((b[o + 5] & 7) << 3) | (b[o + 6] >> 5)), Gv = x7(((b[o + 6] & 31) << 2) | (b[o + 7] >> 6)), Bv = x6(b[o + 7] & 63);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    put(x, y, clamp((x * (Rh - Ro) + y * (Rv - Ro) + 4 * Ro + 2) >> 2), clamp((x * (Gh - Go) + y * (Gv - Go) + 4 * Go + 2) >> 2), clamp((x * (Bh - Bo) + y * (Bv - Bo) + 4 * Bo + 2) >> 2), 255);
  }
}
const b4 = (b, o) => b[o + 4] >> 1;
function etcAlpha(b, o, put) {
  const base = b[o], mul = b[o + 1] >> 4, tbl = b[o + 1] & 15;
  const T = [[-3, -6, -9, -15, 2, 5, 8, 14], [-3, -7, -10, -13, 2, 6, 9, 12], [-2, -5, -8, -13, 1, 4, 7, 12], [-2, -4, -6, -13, 1, 3, 5, 12], [-3, -6, -8, -12, 2, 5, 7, 11], [-3, -7, -9, -11, 2, 6, 8, 10], [-4, -7, -8, -11, 3, 6, 7, 10], [-3, -5, -8, -11, 2, 4, 7, 10], [-2, -6, -8, -10, 1, 5, 7, 9], [-2, -5, -8, -10, 1, 4, 7, 9], [-2, -4, -8, -10, 1, 3, 7, 9], [-2, -5, -7, -10, 1, 4, 6, 9], [-3, -4, -7, -10, 2, 3, 6, 9], [-1, -2, -3, -10, 0, 1, 2, 9], [-4, -6, -8, -9, 3, 5, 7, 8], [-3, -5, -7, -9, 2, 4, 6, 8]];
  let bits = 0n; for (let i = 2; i < 8; i++) bits = (bits << 8n) | BigInt(b[o + i]);
  for (let p = 0; p < 16; p++) {
    const s = Number((bits >> BigInt(45 - p * 3)) & 7n); const x = (p / 4) | 0, y = p % 4;
    put(x, y, clamp(base + T[tbl][s] * mul));
  }
}

// kembalikan RGBA top-down (Uint8ClampedArray) atau lempar error bila format belum didukung
export function decodeTexture(t) {
  const { width: w, height: h, format: f, data: d } = t;
  const out = new Uint8ClampedArray(w * h * 4);
  const setBU = (x, y, r, g, b, a) => { const i = ((h - 1 - y) * w + x) * 4; out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a; };
  const need = (n) => { if (d.length < n) throw new Error('Data tekstur kurang (' + d.length + ' < ' + n + ')'); };
  const px = (fn, bpp) => { need(w * h * bpp); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) fn(setBU, x, y, (y * w + x) * bpp); };
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  switch (f) {
    case 1: px((s, x, y, i) => s(x, y, 255, 255, 255, d[i]), 1); break;
    case 3: px((s, x, y, i) => s(x, y, d[i], d[i + 1], d[i + 2], 255), 3); break;
    case 4: px((s, x, y, i) => s(x, y, d[i], d[i + 1], d[i + 2], d[i + 3]), 4); break;
    case 5: px((s, x, y, i) => s(x, y, d[i + 1], d[i + 2], d[i + 3], d[i]), 4); break;
    case 14: px((s, x, y, i) => s(x, y, d[i + 2], d[i + 1], d[i], d[i + 3]), 4); break;
    case 7: px((s, x, y, i) => { const v = dv.getUint16(i, true); s(x, y, x5((v >> 11) & 31), x6((v >> 5) & 63), x5(v & 31), 255); }, 2); break;
    case 13: px((s, x, y, i) => { const v = dv.getUint16(i, true); s(x, y, x4((v >> 12) & 15), x4((v >> 8) & 15), x4((v >> 4) & 15), x4(v & 15)); }, 2); break;
    case 2: px((s, x, y, i) => { const v = dv.getUint16(i, true); s(x, y, x4((v >> 8) & 15), x4((v >> 4) & 15), x4(v & 15), x4((v >> 12) & 15)); }, 2); break;
    case 10: case 12: {
      const bw = Math.ceil(w / 4), bh = Math.ceil(h / 4), bs = f === 10 ? 8 : 16; need(bw * bh * bs);
      for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
        const o = (by * bw + bx) * bs; const co = o + (bs - 8);
        const c0 = dv.getUint16(co, true), c1 = dv.getUint16(co + 2, true), bits = dv.getUint32(co + 4, true);
        const cols = dxtColors(c0, c1, f === 12 ? true : c0 > c1);
        let al = null;
        if (f === 12) {
          const a0 = d[o], a1 = d[o + 1]; const A = [a0, a1];
          if (a0 > a1) for (let i = 1; i < 7; i++) A.push(((7 - i) * a0 + i * a1) / 7); else { for (let i = 1; i < 5; i++) A.push(((5 - i) * a0 + i * a1) / 5); A.push(0, 255); }
          let ab = 0n; for (let i = 7; i >= 2; i--) ab = (ab << 8n) | BigInt(d[o + i]);
          al = (p) => A[Number((ab >> BigInt(p * 3)) & 7n)];
        }
        for (let p = 0; p < 16; p++) {
          const x = bx * 4 + (p & 3), y = by * 4 + (p >> 2); if (x >= w || y >= h) continue;
          const c = cols[(bits >> (p * 2)) & 3];
          setBU(x, y, c[0], c[1], c[2], al ? al(p) : c[3]);
        }
      }
      break;
    }
    case 34: case 45: case 46: case 47: {
      const bw = Math.ceil(w / 4), bh = Math.ceil(h / 4), bs = f === 47 ? 16 : 8; need(bw * bh * bs);
      for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
        const o = (by * bw + bx) * bs;
        const put = (x, y, r, g, b, a) => { const X = bx * 4 + x, Y = by * 4 + y; if (X < w && Y < h) setBU(X, Y, r, g, b, a); };
        etcBlock(d, o + (f === 47 ? 8 : 0), put, f === 46);
        if (f === 47) etcAlpha(d, o, (x, y, a) => { const X = bx * 4 + x, Y = by * 4 + y; if (X < w && Y < h) out[((h - 1 - Y) * w + X) * 4 + 3] = a; });
      }
      break;
    }
    case 48: case 49: case 50: case 51: case 52: case 53: case 54: case 55: case 56: case 57: case 58: case 59: {
      const bs = [4, 5, 6, 8, 10, 12][(f - 48) % 6]; const bw = Math.ceil(w / bs), bh = Math.ceil(h / bs); need(bw * bh * 16);
      const blk = new Uint8Array(bs * bs * 4);
      for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
        decodeBlock(d.subarray((by * bw + bx) * 16, (by * bw + bx) * 16 + 16), bs, bs, blk);
        for (let y = 0; y < bs; y++) { const Y = by * bs + y; if (Y >= h) break; for (let x = 0; x < bs; x++) { const X = bx * bs + x; if (X >= w) break; const q = (y * bs + x) * 4; setBU(X, Y, blk[q], blk[q + 1], blk[q + 2], blk[q + 3]); } }
      }
      break;
    }
    default: throw new Error('Format tekstur ' + (TEX_FORMATS[f] || f) + ' belum bisa ditampilkan (bisa tetap diganti)');
  }
  return out;
}

// Ganti isi tekstur dengan RGBA top-down (w x h harus sama dengan tekstur asli); hasil: bytes objek baru
export function replaceTexture(obj, tex, rgba) {
  const w = tex.width, h = tex.height; const f = tex.o.fields;
  const img = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) img.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), (h - 1 - y) * w * 4);
  const src = tex.o.bytes; const edits = [];
  const i32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v, true); return b; };
  const set32 = (k, v) => { if (f[k]) edits.push({ off: f[k].off, end: f[k].off + 4, b: i32(v) }); };
  set32('m_CompleteImageSize', img.length); set32('m_TextureFormat', 4); set32('m_MipCount', 1);
  if (f.m_StreamingMipmaps) edits.push({ off: f.m_StreamingMipmaps.off, end: f.m_StreamingMipmaps.off + 1, b: Uint8Array.of(0) });
  const pad = (4 - (img.length % 4)) % 4;
  edits.push({ off: f['image data'].off, end: f['image data'].end, b: concat([i32(img.length), img, new Uint8Array(pad)]) });
  const sd = f.m_StreamData;
  if (sd && sd.sub) for (const k of ['offset', 'size']) edits.push({ off: sd.sub[k].off, end: sd.sub[k].end, b: new Uint8Array(sd.sub[k].end - sd.sub[k].off) });
  edits.sort((a, b) => a.off - b.off);
  const parts = []; let p = 0;
  for (const e of edits) { parts.push(src.subarray(p, e.off), e.b); p = e.end; }
  parts.push(src.subarray(p));
  return concat(parts);
}

/* ---------------- Mesh ---------------- */
const FSZ = [4, 2, 1, 1, 2, 2, 1, 1, 2, 2, 4, 4];
function f16(v) { const s = (v & 0x8000) ? -1 : 1, e = (v >> 10) & 31, m = v & 1023; return e === 0 ? s * 5.960464477539063e-8 * m : e === 31 ? (m ? NaN : s * Infinity) : s * Math.pow(2, e - 15) * (1 + m / 1024); }
function readComp(dv, o, fmt) {
  switch (fmt) {
    case 0: return dv.getFloat32(o, true);
    case 1: return f16(dv.getUint16(o, true));
    case 2: return dv.getUint8(o) / 255;
    case 3: return Math.max(dv.getInt8(o) / 127, -1);
    case 4: return dv.getUint16(o, true) / 65535;
    case 5: return Math.max(dv.getInt16(o, true) / 32767, -1);
    case 6: return dv.getUint8(o); case 7: return dv.getInt8(o);
    case 8: return dv.getUint16(o, true); case 9: return dv.getInt16(o, true);
    case 10: return dv.getUint32(o, true); default: return dv.getInt32(o, true);
  }
}
function normFmt(fmt, uv) {
  if (uv[0] < 2017) return [0, 1, 2, 6, 10][fmt] ?? 0;
  if (uv[0] < 2018) return [0, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11][fmt] ?? 0;
  return fmt;
}
function unpackInts(pv) {
  const n = pv.m_NumItems, bits = pv.m_BitSize, data = pv.m_Data; const out = new Int32Array(n);
  if (!bits) return out;
  let ip = 0, bp = 0;
  for (let i = 0; i < n; i++) {
    let b = 0, v = 0;
    while (b < bits) { v |= (data[ip] >> bp) << b; const num = Math.min(bits - b, 8 - bp); bp += num; b += num; if (bp === 8) { ip++; bp = 0; } }
    out[i] = bits >= 31 ? v : v & ((1 << bits) - 1);
  }
  return out;
}
function unpackFloats(pv, per, strideBytes, start = 0, numChunks = -1) {
  const bits = pv.m_BitSize; let bitPos = bits * start; let ip = Math.floor(bitPos / 8); bitPos %= 8;
  if (numChunks < 0) numChunks = Math.floor(pv.m_NumItems / per);
  const out = new Float32Array(numChunks * per); let o = 0;
  const maxv = Math.pow(2, bits) - 1;
  for (let c = 0; c < numChunks; c++) for (let i = 0; i < per; i++) {
    let x = 0, b = 0;
    while (b < bits) { x += ((pv.m_Data[ip] >> bitPos) & ((1 << Math.min(8 - bitPos, bits - b)) - 1)) * Math.pow(2, b); const num = Math.min(bits - b, 8 - bitPos); bitPos += num; b += num; if (bitPos === 8) { ip++; bitPos = 0; } }
    out[o++] = maxv ? (x * pv.m_Range) / maxv + pv.m_Start : pv.m_Start;
  }
  return out;
}
function readCompressed(o) {
  const cm = o.get('m_CompressedMesh'); const vc = Math.floor(cm.m_Vertices.m_NumItems / 3);
  const pos = unpackFloats(cm.m_Vertices, 3, 12);
  let uvs = null;
  if (cm.m_UV.m_NumItems > 0) {
    const info = cm.m_UVInfo >>> 0;
    if (info) { let src = 0; for (let uv = 0; uv < 8; uv++) { const tb = (info >>> (uv * 4)) & 15; if (tb & 4) { const dim = 1 + (tb & 3); if (uv === 0 && dim >= 2) { const raw = unpackFloats(cm.m_UV, dim, dim * 4, src, vc); uvs = new Float32Array(vc * 2); for (let i = 0; i < vc; i++) { uvs[i * 2] = raw[i * dim]; uvs[i * 2 + 1] = raw[i * dim + 1]; } } src += dim * vc; } } }
    else uvs = unpackFloats(cm.m_UV, 2, 8, 0, vc);
  }
  let nrm = null;
  if (cm.m_Normals.m_NumItems > 0) {
    const nd = unpackFloats(cm.m_Normals, 2, 8); const sg = unpackInts(cm.m_NormalSigns); nrm = new Float32Array(vc * 3);
    for (let i = 0; i < vc; i++) {
      let x = nd[i * 2], y = nd[i * 2 + 1]; const zz = 1 - x * x - y * y; let z;
      if (zz >= 0) z = Math.sqrt(zz); else { z = 0; const l = Math.hypot(x, y) || 1; x /= l; y /= l; }
      if (sg[i] === 0) z = -z; nrm[i * 3] = x; nrm[i * 3 + 1] = y; nrm[i * 3 + 2] = z;
    }
  }
  return { vc, pos, nrm, uvs, tri: unpackInts(cm.m_Triangles) };
}
export function readMesh(sf, obj) {
  const o = readObject(sf, obj); const uv = sf.uv;
  const vd = o.get('m_VertexData'); if (!vd) throw new Error('Mesh tanpa m_VertexData');
  let vc = vd.m_VertexCount, pos, nrm, uvs, tri = null;
  if (!vc && o.get('m_CompressedMesh')) {
    const c = readCompressed(o); vc = c.vc; pos = c.pos; nrm = c.nrm; uvs = c.uvs; tri = c.tri;
    if (!vc) throw new Error('Mesh kosong');
  } else {
    if (!vc) throw new Error('Mesh kosong');
    const data = vd.m_DataSize; const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const chans = vd.m_Channels;
    const sem = uv[0] >= 2018 ? { pos: 0, nrm: 1, col: 3, uv0: 4 } : { pos: 0, nrm: 1, col: 2, uv0: 3 };
    const maxStream = Math.max(...chans.map((c) => c.stream));
    const stride = new Array(maxStream + 1).fill(0), sOff = [];
    chans.forEach((c) => { const dim = c.dimension & 15; if (dim) stride[c.stream] += dim * FSZ[normFmt(c.format, uv)]; });
    let acc = 0; for (let s = 0; s <= maxStream; s++) { sOff[s] = acc; acc += vc * stride[s]; acc = (acc + 15) & ~15; }
    const read = (ci, ncomp) => {
      const c = chans[ci]; const dim = c.dimension & 15; if (!dim) return null;
      const fmt = normFmt(c.format, uv); const out = new Float32Array(vc * ncomp);
      for (let i = 0; i < vc; i++) for (let k = 0; k < ncomp; k++) out[i * ncomp + k] = k < dim ? readComp(dv, sOff[c.stream] + i * stride[c.stream] + c.offset + k * FSZ[fmt], fmt) : (k === 3 ? 1 : 0);
      return out;
    };
    pos = read(sem.pos, 3); if (!pos) throw new Error('Mesh tanpa posisi');
    nrm = read(sem.nrm, 3); uvs = read(sem.uv0, 2);
  }
  const tris = [];
  if (tri) {
    for (const sm of o.get('m_SubMeshes')) {
      const first = sm.firstByte / 2, n = sm.indexCount, base = sm.baseVertex || 0;
      for (let i = 0; i + 2 < n; i += 3) tris.push(tri[first + i] + base, tri[first + i + 2] + base, tri[first + i + 1] + base);
    }
  } else {
    const ib = o.get('m_IndexBuffer'); const is32 = o.get('m_IndexFormat') !== undefined ? o.get('m_IndexFormat') === 1 : !o.get('m_Use16BitIndices');
    const idv = new DataView(ib.buffer, ib.byteOffset, ib.byteLength); const isz = is32 ? 4 : 2;
    for (const sm of o.get('m_SubMeshes')) {
      const first = sm.firstByte / isz; const n = sm.indexCount; const base = sm.baseVertex || 0;
      const get = (i) => (is32 ? idv.getUint32((first + i) * 4, true) : idv.getUint16((first + i) * 2, true)) + base;
      if (sm.topology === 0 || sm.topology === undefined) for (let i = 0; i + 2 < n; i += 3) tris.push(get(i), get(i + 2), get(i + 1));
      else if (sm.topology === 1) for (let i = 0; i + 2 < n; i++) i % 2 ? tris.push(get(i), get(i + 1), get(i + 2)) : tris.push(get(i), get(i + 2), get(i + 1));
    }
  }
  for (let i = 0; i < vc; i++) { pos[i * 3] = -pos[i * 3]; if (nrm) nrm[i * 3] = -nrm[i * 3]; }
  return { name: o.get('m_Name'), positions: pos, normals: nrm, uvs, indices: Uint32Array.from(tris) };
}
