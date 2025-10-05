// ===== Настройки =====
const USE_FIREBASE_DEFAULT = false;  // включи/изключи облака по подразбиране

// ===== Помощни =====
const $ = (sel, p = document) => p.querySelector(sel);
const $$ = (sel, p = document) => [...p.querySelectorAll(sel)];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fmt = (n) => (Number(n||0)).toFixed(2);

const els = {
  canvas: $('#pad'),
  badge:  $('#modeBadge'),
  penOnly: $('#penOnly'),
  btnClear: $('#btnClear'),
  btnUndo: $('#btnUndo'),
  btnSave: $('#btnSave'),
  inpName: $('#inpName'),
  inpAmount: $('#inpAmount'),
  chkUseFirebase: $('#chkUseFirebase'),
  fb: {
    apiKey: $('#fbApiKey'),
    authDomain: $('#fbAuthDomain'),
    projectId: $('#fbProjectId'),
    storageBucket: $('#fbStorageBucket'),
    appId: $('#fbAppId'),
  },
  btnSearch: $('#btnSearch'),
  inpSearch: $('#inpSearch'),
  results: $('#results'),
  total: $('#total'),
  btnExport: $('#btnExport'),
  fileImport: $('#fileImport')
};

let ctx, dpr, drawing = false, last = null, strokes = [], history = [];

// ===== Canvas setup =====
function resizeCanvas() {
  const c = els.canvas;
  const rect = c.getBoundingClientRect();
  dpr = Math.max(1, window.devicePixelRatio || 1);
  c.width = Math.round(rect.width * dpr);
  c.height = Math.round(rect.height * dpr);
  ctx = c.getContext('2d');
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#f1f5ff';
  ctx.lineWidth = 2.2 * dpr;
  redraw();
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function redraw() {
  const c = els.canvas, g = ctx;
  g.clearRect(0,0,c.width,c.height);
  for (const s of history) drawStroke(g, s);
  if (strokes.length) drawStroke(g, strokes);
}
function drawStroke(g, s) {
  g.beginPath();
  for (let i=0;i<s.length;i++){
    const p = s[i];
    const x = p.x * dpr, y = p.y * dpr;
    g.lineWidth = (1.6 + (p.p || .5) * 2.2) * dpr;
    if (i===0) g.moveTo(x,y); else g.lineTo(x,y);
  }
  g.stroke();
}

// само писалка
function isPen(e){ return e.pointerType === 'pen'; }

els.canvas.addEventListener('pointerdown', (e)=>{
  if (!isPen(e)){ els.penOnly.classList.remove('hidden'); return; }
  els.penOnly.classList.add('hidden');
  drawing = true; strokes = []; last = {x:e.offsetX, y:e.offsetY, p:e.pressure};
  strokes.push(last);
});
els.canvas.addEventListener('pointermove', (e)=>{
  if (!drawing || !isPen(e)) return;
  strokes.push({x:e.offsetX, y:e.offsetY, p:e.pressure});
  redraw();
});
window.addEventListener('pointerup', (e)=>{
  if (!drawing) return;
  drawing = false;
  if (strokes.length>1) history.push(strokes);
  strokes = []; last = null; redraw();
});

// бутони
els.btnClear.onclick = ()=>{ history = []; redraw(); };
els.btnUndo.onclick = ()=>{ history.pop(); redraw(); };

// ===== Локална база (IndexedDB) =====
const DB_KEY = 'veresia-local-v1';
async function localAll() {
  const raw = localStorage.getItem(DB_KEY);
  return raw ? JSON.parse(raw) : [];
}
async function localSave(rec){
  const all = await localAll();
  all.push(rec);
  localStorage.setItem(DB_KEY, JSON.stringify(all));
}
async function localQueryByName(name){
  const n = (name||'').trim().toLowerCase();
  const all = await localAll();
  return all.filter(r => (r.nameLower||'')===n);
}
function dataURLtoBlob(dataURL){
  const [meta, b64] = dataURL.split(',');
  const mime = (meta.match(/data:(.*?);/)||[])[1] || 'image/png';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], {type:mime});
}

// ===== Firebase (по желание) =====
let FB = { app:null, fs:null, st:null, enabled: USE_FIREBASE_DEFAULT };
els.chkUseFirebase.checked = FB.enabled;
updateModeBadge();

els.chkUseFirebase.addEventListener('change', async ()=>{
  FB.enabled = els.chkUseFirebase.checked;
  if (FB.enabled) await ensureFirebase();
  updateModeBadge();
});

function updateModeBadge(){
  els.badge.textContent = FB.enabled ? 'Firebase (облак)' : 'Локален режим';
  els.badge.style.borderColor = FB.enabled ? '#2b6f43' : 'var(--border)';
  els.badge.style.color = FB.enabled ? '#9be7b6' : 'var(--muted)';
}

async function ensureFirebase(){
  if (FB.app) return;
  // валидираме конфиг
  const cfg = {
    apiKey: els.fb.apiKey.value.trim(),
    authDomain: els.fb.authDomain.value.trim(),
    projectId: els.fb.projectId.value.trim(),
    storageBucket: els.fb.storageBucket.value.trim(),
    appId: els.fb.appId.value.trim()
  };
  if (!cfg.apiKey || !cfg.projectId || !cfg.storageBucket){
    alert('Попълни Firebase настройките (apiKey, projectId, storageBucket). Засега оставаме в локален режим.');
    FB.enabled = false; els.chkUseFirebase.checked = false; updateModeBadge();
    return;
  }
  // динамично зареждаме модулите
  const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
  const { getFirestore, collection, addDoc, getDocs, query, where, orderBy } =
    await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
  const { getStorage, ref, uploadBytes, getDownloadURL } =
    await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js');

  FB.app = initializeApp(cfg);
  FB.fs = getFirestore(FB.app);
  FB.st = getStorage(FB.app);
  FB.api = { collection, addDoc, getDocs, query, where, orderBy, ref, uploadBytes, getDownloadURL };
}

// ===== Запис =====
els.btnSave.onclick = async ()=>{
  try{
    const name = els.inpName.value.trim();
    const amount = parseFloat(els.inpAmount.value);
    if (!name) return alert('Въведи име.');
    if (isNaN(amount)) return alert('Въведи валидна сума.');

    // снимка на листа
    const dataURL = els.canvas.toDataURL('image/png');
    const ts = Date.now();

    if (FB.enabled){
      await ensureFirebase();
      if (!FB.app) return; // режимът е паднал към локален

      // 1) качваме снимката
      const p = `images/${ts}-${name.replace(/\s+/g,'_')}.png`;
      const sref = FB.api.ref(FB.st, p);
      await FB.api.uploadBytes(sref, dataURLtoBlob(dataURL));

      // 2) взимаме URL
      const url = await FB.api.getDownloadURL(sref);

      // 3) запис в Firestore
      const doc = {
        name, nameLower: name.toLowerCase(),
        amount: Number(amount),
        ts, imagePath: p, imageURL: url
      };
      await FB.api.addDoc(FB.api.collection(FB.fs, 'records'), doc);
      alert('✅ Записано в облака.');
    } else {
      // локален запис
      const rec = {
        id: crypto.randomUUID(),
        name, nameLower: name.toLowerCase(),
        amount: Number(amount),
        ts,
        imageData: dataURL
      };
      await localSave(rec);
      alert('✅ Записано локално (в този браузър).');
    }
  }catch(err){
    console.error(err);
    alert('❌ Грешка при запис. Виж конзолата.');
  }
};

// ===== Търсене =====
els.btnSearch.onclick = doSearch;
els.inpSearch.addEventListener('keydown', e => { if (e.key==='Enter') doSearch(); });

async function doSearch(){
  const qname = els.inpSearch.value.trim().toLowerCase();
  if (!qname) return;

  let rows = [];
  if (FB.enabled){
    await ensureFirebase();
    if (!FB.app) return;
    const { getDocs, query, where, orderBy, collection } = FB.api;
    const q = query(
      collection(FB.fs, 'records'),
      where('nameLower','==', qname),
      orderBy('ts','desc')
    );
    const snap = await getDocs(q);
    rows = snap.docs.map(d => d.data());
  } else {
    rows = await localQueryByName(qname);
    rows.sort((a,b)=>b.ts-a.ts);
  }

  els.results.innerHTML = '';
  let sum = 0;
  for (const r of rows){
    sum += Number(r.amount || 0);
    const url = r.imageURL || r.imageData || '';
    const el = document.createElement('div');
    el.className = 'result';
    el.innerHTML = `
      <img class="thumb" src="${url}" alt="снимка" />
      <div>
        <div><strong>${r.name}</strong></div>
        <div class="meta">${new Date(r.ts).toLocaleString()}</div>
      </div>
      <div class="amount">${fmt(r.amount)} лв</div>
    `;
    els.results.appendChild(el);
  }
  els.total.textContent = `Обща сума: ${fmt(sum)} лв`;
}

// ===== Експорт/Импорт (за локален режим) =====
els.btnExport.onclick = async ()=>{
  const rows = await localAll();
  const blob = new Blob([JSON.stringify(rows,null,2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `veresia-backup-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};
els.fileImport.onchange = async (e)=>{
  const file = e.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  localStorage.setItem(DB_KEY, text);
  alert('Импортът е завършен.');
};
