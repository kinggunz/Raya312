import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import * as U from './unity.js';

const $ = (id) => document.getElementById(id);
const on = (id, ev, fn) => $(id).addEventListener(ev, fn);
const hasAndroid = typeof Android !== 'undefined';

function show(id) {
  ['splash', 'menu', 'viewer'].forEach((x) => $(x).classList.toggle('hidden', x !== id));
}
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 2600);
}

/* ---------- Loading 1-100 ---------- */
let pct = 0;
const timer = setInterval(() => {
  pct = Math.min(100, pct + 1 + Math.floor(Math.random() * 3));
  $('fill').style.width = pct + '%';
  $('pct').textContent = pct + '%';
  if (pct >= 100) { clearInterval(timer); setTimeout(() => show('menu'), 350); }
}, 40);

/* ---------- Viewer ---------- */
let renderer, scene, camera, controls, grid, dirLight, hemi, boxHelper, tc, gizmoOn = false, primCount = 0;
let root = null, sel = null, meshes = [], modelSize = 1, origBuf = null, origName = 'model.glb';
let curTab = 't1';

function initViewer() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b1d22);
  camera = new THREE.PerspectiveCamera(50, 1, 0.01, 10000);
  scene.add(camera);
  hemi = new THREE.HemisphereLight(0xffffff, 0x444455, 1.2);
  scene.add(hemi);
  dirLight = new THREE.DirectionalLight(0xffffff, 2.2);
  dirLight.position.set(2, 3, 4);
  camera.add(dirLight);
  grid = new THREE.GridHelper(10, 20, 0x666666, 0x333333);
  scene.add(grid);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.screenSpacePanning = true;
  controls.zoomSpeed = 1.4;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  tc = new TransformControls(camera, renderer.domElement);
  scene.add(tc.getHelper());
  tc.addEventListener('dragging-changed', (e) => { controls.enabled = !e.value; });
  tc.addEventListener('objectChange', () => { if (sel) { delete sel.userData.b; delete sel.userData.ui; } });
  renderer.setAnimationLoop(() => {
    controls.update();
    if (boxHelper && sel) boxHelper.update();
    renderer.render(scene, camera);
  });
  new ResizeObserver(resize).observe($('stage'));
  resize();

  // ketuk untuk memilih bagian
  const cv = renderer.domElement;
  let down = null;
  cv.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
  cv.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (moved < 7 && Date.now() - down.t < 450 && !tc.axis && !tc.dragging) pick(e);
    down = null;
  });
}
function resize() {
  const s = $('stage'); const w = s.clientWidth, h = s.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
const ray = new THREE.Raycaster();
function pick(e) {
  if (!root) return;
  const r = renderer.domElement.getBoundingClientRect();
  const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(v, camera);
  const hit = ray.intersectObjects(meshes.filter((m) => m.visible), false)[0];
  setSel(hit ? hit.object : null);
}

/* ---------- Muat file ---------- */
function detect(buf, name) {
  const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(256, buf.byteLength)));
  if (/^Unity(FS|Web|Raw)/.test(head)) return 'unity';
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['glb', 'gltf', 'obj', 'stl', 'ply', 'fbx'].includes(ext)) return ext;
  if (head.startsWith('glTF')) return 'glb';
  if (head.trim().startsWith('{')) return 'gltf';
  if (head.startsWith('Kaydara FBX')) return 'fbx';
  if (head.startsWith('ply')) return 'ply';
  if (/^\s*(#|v |o |g |mtllib)/.test(head)) return 'obj';
  if (head.startsWith('solid')) return 'stl';
  return null;
}
function toStd(m) {
  if (m.isMeshStandardMaterial) return m;
  const n = new THREE.MeshStandardMaterial({
    color: m.color ? m.color.clone() : 0xcccccc, map: m.map || null,
    opacity: m.opacity ?? 1, transparent: !!m.transparent, side: m.side,
    vertexColors: !!m.vertexColors, roughness: 0.7, metalness: 0.1,
  });
  n.name = m.name; return n;
}
async function parse(buf, type) {
  const dec = () => new TextDecoder().decode(buf);
  if (type === 'glb') return (await new GLTFLoader().parseAsync(buf, '')).scene;
  if (type === 'gltf') return (await new GLTFLoader().parseAsync(dec(), '')).scene;
  if (type === 'obj') return new OBJLoader().parse(dec());
  if (type === 'fbx') return new FBXLoader().parse(buf, '');
  const g = type === 'stl' ? new STLLoader().parse(buf) : new PLYLoader().parse(buf);
  if (!g.attributes.normal) g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({
    color: 0xb8bcc6, roughness: 0.6, metalness: 0.1, vertexColors: !!g.attributes.color,
  }));
}
async function openBuffer(buf, name) {
  const type = detect(buf, name);
  if (type === 'unity') return openUnity(buf, name);
  if (!type) { alert('Format file tidak dikenali.\nDidukung: GLB, GLTF, OBJ, FBX, STL, PLY.'); return; }
  let obj;
  try { obj = await parse(buf, type); } catch (err) { alert('Gagal membaca model: ' + (err.message || err)); return; }
  installRoot(obj, name, type);
}
function installRoot(obj, name, type) {
  initViewer();
  if (root) scene.remove(root);
  setSel(null);
  root = obj; scene.add(root);
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map(toStd) : toStd(o.material);
  });
  const box = new THREE.Box3().setFromObject(root);
  const size = box.isEmpty() ? new THREE.Vector3(4, 0, 4) : box.getSize(new THREE.Vector3());
  if (!box.isEmpty()) root.position.sub(box.getCenter(new THREE.Vector3()));
  modelSize = Math.max(size.x, size.y, size.z) || 1;
  gizmoOn = type === 'new';
  $('tabC').classList.toggle('hidden', type !== 'new');
  grid.position.y = -size.y / 2; grid.scale.setScalar(modelSize / 5);
  camera.near = modelSize / 1000; camera.far = modelSize * 1000; camera.updateProjectionMatrix();
  controls.minDistance = modelSize * 0.02; controls.maxDistance = modelSize * 60;
  resetCam();
  refreshList();
  origName = name;
  $('title').textContent = name;
  $('fmt').value = ['glb', 'obj', 'stl'].includes(type) ? type : 'glb';
  if (type === 'new') primCount = 0;
  show('viewer'); resize();
  if (type !== 'unity') { $('tabU').classList.add('hidden'); toast(type === 'new' ? 'Proyek 3D baru' : 'Model dimuat (' + type.toUpperCase() + ')'); }
}
function resetCam() {
  camera.position.set(0, modelSize * 0.3, modelSize * 1.8);
  controls.target.set(0, 0, 0); controls.update();
}
async function onFile(f) {
  if (!f) return;
  origBuf = await f.arrayBuffer();
  await openBuffer(origBuf, f.name);
}
on('file', 'change', async (e) => { const f = e.target.files[0]; e.target.value = ''; await onFile(f); });
on('bOpenMenu', 'click', () => $('file').click());
on('bOpen', 'click', () => $('file').click());


/* ---------- Unity AssetBundle ---------- */
let ub = null;
async function openUnity(buf, name) {
  let b;
  try { b = U.readBundle(new Uint8Array(buf)); }
  catch (e) { alert('Gagal membaca bundle Unity: ' + e.message + '\n\nBundle mungkin dienkripsi/dimodifikasi oleh game, atau memakai format yang belum didukung.'); return; }
  const files = [];
  for (const node of b.nodes) { try { files.push({ node, sf: U.parseSerialized(node.data) }); } catch (e) { /* bukan serialized file */ } }
  if (!files.length) { alert('Tidak ada aset Unity yang bisa dibaca di bundle ini (' + b.unityVersion + ').'); return; }
  ub = { b, files, name, tex: [], mesh: [] };
  origBuf = buf; origName = name;
  collectUnity();
  ub.mesh.sort((a, c) => c.size - a.size);
  if (!ub.tex.length && !ub.mesh.length) { alert('Bundle ini tidak berisi Texture2D atau Mesh.\nIsi: ' + files.map((f) => f.sf.objects.length + ' objek').join(', ')); return; }
  initViewer();
  $('tabU').classList.remove('hidden');
  const fill = (id, arr, fmt) => { $(id).innerHTML = ''; arr.forEach((e, i) => { const o = document.createElement('option'); o.value = i; o.textContent = fmt(e, i); $(id).appendChild(o); }); };
  fill('uMesh', ub.mesh, (e, i) => (i + 1) + '. ' + e.name);
  fill('uTex', ub.tex, (e, i) => (i + 1) + '. ' + e.name);
  $('uInfo').textContent = 'Unity ' + b.unityVersion + ' • ' + ub.mesh.length + ' mesh • ' + ub.tex.length + ' tekstur';
  document.querySelector('#tabs button[data-t="t6"]').click();
  uShowMesh();
  document.body.classList.remove('nopanel');
  await uPreview(true);
}
function collectUnity() {
  ub.tex = []; ub.mesh = [];
  for (const f of ub.files) for (const o of f.sf.objects) {
    if (o.classId === 28) ub.tex.push({ f, id: o.pathId, name: U.objectName(f.sf, o) || 'Texture' });
    else if (o.classId === 43) ub.mesh.push({ f, id: o.pathId, size: o.byteSize, name: U.objectName(f.sf, o) || 'Mesh' });
  }
}
const uObj = (e) => e.f.sf.objects.find((o) => o.pathId === e.id);
const curTex = () => ub.tex[+$('uTex').value];
function meshToThree(m) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  if (m.uvs) g.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  if (m.normals) g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3)); else g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xd0d4dc, roughness: 0.6, metalness: 0.1, side: THREE.DoubleSide }));
  mesh.name = m.name; return mesh;
}
async function decodedTexture(e) {
  const t = U.getTexture(e.f.sf, uObj(e), ub.b.nodes);
  const px = U.decodeTexture(t);
  return { t, px };
}
function uShowMesh() {
  const grp = new THREE.Group(); let n = 0;
  if (ub.mesh.length) {
    const e = ub.mesh[+$('uMesh').value];
    try { grp.add(meshToThree(U.readMesh(e.f.sf, uObj(e)))); n++; }
    catch (err) { toast('Mesh: ' + err.message); }
  }
  if (!n) { // tidak ada mesh yang bisa ditampilkan: bidang polos untuk pratinjau tekstur
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    pl.name = 'Bidang pratinjau'; grp.add(pl);
  }
  installRoot(grp, ub.name, 'unity');
  if (ub.mesh.length) { // pilih tekstur yang namanya cocok dengan mesh (mis. 'headphone')
    const mn = ub.mesh[+$('uMesh').value].name.toLowerCase();
    const i = ub.tex.findIndex((t) => mn.length > 2 && t.name.toLowerCase().includes(mn));
    if (i >= 0) { $('uTex').value = i; uPreview(true); }
  }
  uApplyTex(true);
}
async function uApplyTex(silent) {
  if (!ub.tex.length || !root) return;
  try {
    const { t, px } = await decodedTexture(curTex());
    const cv = document.createElement('canvas'); cv.width = t.width; cv.height = t.height;
    cv.getContext('2d').putImageData(new ImageData(px, t.width, t.height), 0, 0);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    meshes.forEach((m) => (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => { x.map = tex; x.color.set(0xffffff); x.needsUpdate = true; }));
    if (!silent) toast('Tekstur dipasang ke model');
  } catch (e) { if (!silent) toast(e.message); }
}
async function uPreview(silent) {
  const cv = $('uPrev'); const e = curTex(); if (!e) return;
  try {
    const { t, px } = await decodedTexture(e);
    cv.width = t.width; cv.height = t.height;
    cv.getContext('2d').putImageData(new ImageData(px, t.width, t.height), 0, 0);
    $('uTexInfo').textContent = t.name + ' • ' + t.width + '×' + t.height + ' • ' + t.formatName;
  } catch (er) {
    cv.width = 4; cv.height = 4; cv.getContext('2d').clearRect(0, 0, 4, 4);
    const t = U.getTexture(e.f.sf, uObj(e), ub.b.nodes);
    $('uTexInfo').textContent = t.name + ' • ' + t.width + '×' + t.height + ' • ' + t.formatName + ' (tidak bisa ditampilkan)';
    if (!silent) toast(er.message);
  }
}
on('uMesh', 'change', uShowMesh);
on('uTex', 'change', async () => { await uPreview(); await uApplyTex(true); });
on('bUApply', 'click', () => uApplyTex(false));
on('bURep', 'click', () => $('uImg').click());
on('uImg', 'change', async (ev) => {
  const f = ev.target.files[0]; ev.target.value = ''; if (!f || !ub) return;
  const e = curTex(); const obj = uObj(e);
  try {
    const t = U.getTexture(e.f.sf, obj, ub.b.nodes);
    const bmp = await createImageBitmap(f);
    const cv = document.createElement('canvas'); cv.width = t.width; cv.height = t.height;
    const ctx = cv.getContext('2d'); ctx.drawImage(bmp, 0, 0, t.width, t.height);
    const rgba = ctx.getImageData(0, 0, t.width, t.height).data;
    const nb = U.replaceTexture(obj, t, rgba);
    e.f.node.data = U.rebuildSerialized(e.f.sf, new Map([[e.id, nb]]));
    e.f.sf = U.parseSerialized(e.f.node.data);
    await uPreview(); await uApplyTex(true);
    toast('Tekstur diganti → RGBA32 ' + t.width + '×' + t.height + '. Jangan lupa Simpan Bundle.');
  } catch (er) { toast('Gagal ganti tekstur: ' + er.message); }
});
on('bUPng', 'click', () => {
  $('uPrev').toBlob(async (bl) => { if (bl) saveBytes((curTex().name || 'tekstur') + '.png', new Uint8Array(await bl.arrayBuffer()), 'image/png'); });
});
on('bUSave', 'click', () => {
  if (!ub) return;
  try { saveBytes(ub.name, U.writeBundle(ub.b), 'application/octet-stream'); }
  catch (er) { toast('Gagal simpan bundle: ' + er.message); }
});


/* ---------- Buat Model 3D ---------- */
function openCreator() {
  ub = null; origBuf = null; origName = 'model_baru.glb';
  installRoot(new THREE.Group(), 'Model Baru', 'new');
  $('tabU').classList.add('hidden');
  document.querySelector('#tabs button[data-t="t7"]').click();
  document.body.classList.remove('nopanel');
  camera.position.set(2.5, 2.2, 4.5); controls.target.set(0, 0.5, 0); controls.update();
}
const PRIMS = {
  box: ['Kubus', (s) => new THREE.BoxGeometry(s, s, s)],
  sphere: ['Bola', (s) => new THREE.SphereGeometry(s / 2, 32, 20)],
  cyl: ['Silinder', (s) => new THREE.CylinderGeometry(s / 2, s / 2, s, 32)],
  cone: ['Kerucut', (s) => new THREE.ConeGeometry(s / 2, s, 32)],
  torus: ['Donat', (s) => new THREE.TorusGeometry(s / 2, s / 6, 16, 48)],
  capsule: ['Kapsul', (s) => new THREE.CapsuleGeometry(s / 4, s / 2, 8, 16)],
  ico: ['Poligon', (s) => new THREE.IcosahedronGeometry(s / 2, 1)],
  plane: ['Bidang', (s) => new THREE.PlaneGeometry(s, s)],
};
function addMesh(m) {
  m.userData.uniq = true; root.add(m); refreshList(); setSel(m);
}
document.querySelectorAll('[data-prim]').forEach((b) => b.addEventListener('click', () => {
  if (!root) return;
  const [label, mk] = PRIMS[b.dataset.prim]; const s = +$('nSize').value;
  const m = new THREE.Mesh(mk(s), new THREE.MeshStandardMaterial({ color: $('nColor').value, roughness: 0.5, metalness: 0.1, side: b.dataset.prim === 'plane' ? THREE.DoubleSide : THREE.FrontSide }));
  m.name = label + ' ' + (++primCount);
  m.position.set(((primCount - 1) % 5 - 2) * s * 1.4, b.dataset.prim === 'plane' ? 0.01 : s / 2, 0);
  addMesh(m);
}));
on('bDup', 'click', () => {
  if (!sel) return toast('Pilih objek dulu (ketuk objek)');
  const c = sel.clone(); c.material = Array.isArray(sel.material) ? sel.material.map((x) => x.clone()) : sel.material.clone();
  c.userData = {}; c.name = sel.name + ' salinan'; c.position.x += modelSize * 0.08; addMesh(c);
});
on('bDel2', 'click', () => $('bDel').click());
on('bClr', 'click', () => { if (confirm('Hapus semua objek dan mulai dari awal?')) openCreator(); });
on('bTM', 'click', () => tc.setMode('translate'));
on('bTR', 'click', () => tc.setMode('rotate'));
on('bTS', 'click', () => tc.setMode('scale'));
on('kSnap', 'change', (e) => {
  tc.setTranslationSnap(e.target.checked ? 0.25 : null);
  tc.setRotationSnap(e.target.checked ? THREE.MathUtils.degToRad(15) : null);
  tc.setScaleSnap(e.target.checked ? 0.1 : null);
});
on('bNew', 'click', () => { initViewer(); openCreator(); });

/* ---------- Daftar bagian & seleksi ---------- */
function refreshList() {
  meshes = [];
  root.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const s = $('meshSel'); s.innerHTML = '<option value="-1">Semua model</option>';
  meshes.forEach((m, i) => {
    const o = document.createElement('option'); o.value = i;
    o.textContent = (i + 1) + '. ' + (m.name || 'Mesh'); s.appendChild(o);
  });
  let v = 0, t = 0;
  meshes.forEach((m) => {
    const g = m.geometry; v += g.attributes.position.count;
    t += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  $('info').textContent = meshes.length + ' bagian • ' + v + ' titik • ' + Math.round(t) + ' segitiga';
}
on('meshSel', 'change', () => { const i = +$('meshSel').value; setSel(i < 0 ? null : meshes[i]); });
function setSel(m) {
  if (boxHelper) { scene.remove(boxHelper); boxHelper = null; }
  sel = m;
  if (tc) { if (m && gizmoOn) tc.attach(m); else tc.detach(); }
  if (m) {
    boxHelper = new THREE.BoxHelper(m, 0xffcc00); scene.add(boxHelper);
    uniq(m);
  }
  if ($('meshSel')) $('meshSel').value = m ? meshes.indexOf(m) : -1;
  syncUI();
}
function uniq(m) {
  if (m.userData.uniq) return;
  m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
  m.userData.uniq = true;
}
function targets() { return sel ? [sel] : meshes; }
function mats() {
  const out = [];
  targets().forEach((m) => { if (!sel) uniq(m); (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => out.push(x)); });
  return out;
}
function applyMat(fn) { mats().forEach((m) => { fn(m); m.needsUpdate = true; }); }

/* ---------- Panel: sinkronisasi ---------- */
function xf() { return sel || root; }
function ui(o) { return (o.userData.ui ||= { sc: 1, rx: 0, ry: 0, rz: 0, px: 0, py: 0, pz: 0 }); }
function base(o) { return (o.userData.b ||= { p: o.position.clone(), s: o.scale.clone(), r: o.rotation.clone() }); }
function syncUI() {
  const m = mats()[0]; if (!m) return;
  $('cCol').value = '#' + m.color.getHexString();
  $('cEmi').value = '#' + m.emissive.getHexString();
  $('sMet').value = m.metalness; $('sRou').value = m.roughness; $('sOpa').value = m.opacity;
  $('kWire').checked = !!m.wireframe; $('kSide').checked = m.side === THREE.DoubleSide;
  const u = ui(xf());
  ['sc', 'rx', 'ry', 'rz', 'px', 'py', 'pz'].forEach((k) => { $('x_' + k).value = u[k]; });
}
on('cCol', 'input', (e) => applyMat((m) => { m.color.set(e.target.value); m.vertexColors = false; }));
on('cEmi', 'input', (e) => applyMat((m) => m.emissive.set(e.target.value)));
on('sMet', 'input', (e) => applyMat((m) => { m.metalness = +e.target.value; }));
on('sRou', 'input', (e) => applyMat((m) => { m.roughness = +e.target.value; }));
on('sOpa', 'input', (e) => applyMat((m) => { m.opacity = +e.target.value; m.transparent = m.opacity < 1; }));
on('kWire', 'change', (e) => applyMat((m) => { m.wireframe = e.target.checked; }));
on('kSide', 'change', (e) => applyMat((m) => { m.side = e.target.checked ? THREE.DoubleSide : THREE.FrontSide; }));
on('bTex', 'click', () => $('texFile').click());
on('texFile', 'change', (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const url = URL.createObjectURL(f);
  new THREE.TextureLoader().load(url, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    applyMat((m) => { t.flipY = m.map ? m.map.flipY : true; m.map = t; m.vertexColors = false; m.color.set(0xffffff); });
    toast('Tekstur diganti');
  }, undefined, () => toast('Gagal membaca gambar'));
});
on('bNoTex', 'click', () => { applyMat((m) => { m.map = null; }); toast('Tekstur dihapus'); });

['sc', 'rx', 'ry', 'rz', 'px', 'py', 'pz'].forEach((k) => {
  on('x_' + k, 'input', (e) => {
    const o = xf(); if (!o) return;
    const b = base(o), u = ui(o); u[k] = +e.target.value;
    o.scale.set(b.s.x * u.sc * (u.mir ? -1 : 1), b.s.y * u.sc, b.s.z * u.sc);
    o.rotation.set(b.r.x + THREE.MathUtils.degToRad(u.rx), b.r.y + THREE.MathUtils.degToRad(u.ry), b.r.z + THREE.MathUtils.degToRad(u.rz));
    o.position.set(b.p.x + u.px * modelSize, b.p.y + u.py * modelSize, b.p.z + u.pz * modelSize);
  });
});
on('bMir', 'click', () => {
  const o = xf(); if (!o) return; const u = ui(o), b = base(o);
  u.mir = !u.mir; o.scale.x = b.s.x * u.sc * (u.mir ? -1 : 1);
});
on('bHide', 'click', () => { if (!sel) return toast('Pilih bagian dulu (ketuk model)'); sel.visible = !sel.visible; });
on('bDel', 'click', () => {
  if (!sel) return toast('Pilih bagian dulu (ketuk model)');
  if (!confirm('Hapus bagian ini dari model?')) return;
  const m = sel; setSel(null); m.parent.remove(m); m.geometry.dispose(); refreshList();
});
on('bReset', 'click', async () => { if (origBuf && confirm('Kembalikan model ke kondisi awal?')) await openBuffer(origBuf, origName); });

/* ---------- Tampilan ---------- */
on('cBg', 'input', (e) => scene.background.set(e.target.value));
on('kGrid', 'change', (e) => { grid.visible = e.target.checked; });
on('sLight', 'input', (e) => { const v = +e.target.value; dirLight.intensity = v * 2.2; hemi.intensity = v * 1.2; });
on('kRot', 'change', (e) => { controls.autoRotate = e.target.checked; controls.autoRotateSpeed = 2; });
on('bCam', 'click', resetCam);
on('kAllWire', 'change', (e) => { meshes.forEach((m) => (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => { x.wireframe = e.target.checked; })); });

/* ---------- Simpan / ekspor ---------- */
function toB64(u8) {
  let s = ''; const c = 0x8000;
  for (let i = 0; i < u8.length; i += c) s += String.fromCharCode.apply(null, u8.subarray(i, i + c));
  return btoa(s);
}
function saveBytes(name, u8, mime) {
  if (hasAndroid) { Android.save(name, toB64(u8), mime); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([u8], { type: mime })); a.download = name; a.click();
}
on('bSave', 'click', () => {
  if (!root) return;
  setSel(null);
  const fmt = $('fmt').value;
  const base0 = (origName.replace(/\.[^.]*$/, '') || 'model').replace(/[^\w\-]+/g, '_').slice(0, 40);
  const name = base0 + '_edit.' + fmt;
  try {
    if (fmt === 'glb') {
      new GLTFExporter().parse(root, (res) => saveBytes(name, new Uint8Array(res), 'model/gltf-binary'),
        (er) => toast('Gagal: ' + er), { binary: true });
    } else if (fmt === 'obj') {
      saveBytes(name, new TextEncoder().encode(new OBJExporter().parse(root)), 'text/plain');
    } else {
      const dv = new STLExporter().parse(root, { binary: true });
      saveBytes(name, new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength), 'model/stl');
    }
  } catch (er) { toast('Gagal simpan: ' + er.message); }
});

/* ---------- Navigasi & layar ---------- */
let rotMode = 0;
on('bRot', 'click', () => {
  rotMode = (rotMode + 1) % 3;
  if (hasAndroid) Android.setOrientation(rotMode);
  toast(['Layar: Otomatis', 'Layar: Landscape', 'Layar: Tegak'][rotMode]);
});
on('bPanel', 'click', () => { document.body.classList.toggle('nopanel'); setTimeout(resize, 60); });
function leave() {
  if (gizmoOn && meshes.length && !confirm('Keluar dari proyek? Model yang belum diekspor akan hilang.')) return;
  setSel(null); show('menu');
}
on('bBack', 'click', leave);
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('hidden', t.id !== b.dataset.t));
}));
window.handleBack = () => {
  if (!$('viewer').classList.contains('hidden')) { leave(); return true; }
  return false;
};
window.addEventListener('resize', () => renderer && resize());
