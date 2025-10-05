// ===== Конфиг =====
const USE_FIREBASE_DEFAULT = false;

// ===== Помощни =====
const $ = (s,p=document)=>p.querySelector(s);
const fmt = (n)=> (Number(String(n).replace(',', '.'))||0).toFixed(2);

const els = {
  canvas: $('#pad'),
  badge:  $('#modeBadge'),
  penOnly: $('#penOnly'),
  errBox: $('#errBox'),
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

function showErr(msg){
  console.error(msg);
  els.errBox.textContent = "⚠️ " + String(msg);
  els.errBox.classList.remove('hidden');
  clearTimeout(showErr._t);
  showErr._t = setTimeout(()=> els.errBox.classList.add('hidden'), 6000);
}

// ===== Canvas / рисуване (оптимизирано) =====
let ctx, dpr = 1;
let drawing = false;
let activePointerId = null;
let stroke = [];        // текущ щрих
let history = [];       // масив от щрихи
let needsRedraw = false;

function isPen(e){ return e.pointerType === 'pen'; }

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
  ctx.lineWidth = 2.0 * dpr;
  requestRedraw();
}
window.addEventListener('resize', resizeCanvas, {passive:true});
document.addEventListener("visibilitychange", ()=>{ if(!document.hidden) resizeCanvas(); });
setTimeout(resizeCanvas, 0);

function requestRedraw(){
  if (needsRedraw) return;
  needsRedraw = true;
  requestAnimationFrame(drawAll);
}

function drawAll(){
  needsRedraw = false;
  const c = els.canvas, g = ctx;
  g.clearRect(0,0,c.width,c.height);

  for (const s of history) drawStroke(g, s);
  if (stroke.length > 1) drawStroke(g, stroke);
}

function drawStroke(g, s) {
  if (s.length < 2) return;
  g.beginPath();
  let lastW = widthForPressure(s[0].p);
  g.moveTo(s[0].x * dpr, s[0].y * dpr);
  for (let i=1; i<s.length; i++){
    const p0 = s[i-1], p1 = s[i];
    const midX = (p0.x + p1.x) * 0.5 * dpr;
    const midY = (p0.y + p1.y) * 0.5 * dpr;
    const w = lerp(lastW, widthForPressure(p1.p), 0.3);
    g.lineWidth = w;
    g.quadraticCurveTo(p0.x * dpr, p0.y * dpr, midX, midY);
    lastW = w;
  }
  g.stroke();
}

function widthForPressure(p = 0.5){
  const base = 1.8 * dpr;
  const add  = 2.4 * (p || 0.5) * dpr;
  return base + add;
}
function lerp(a,b,t){ return a + (b-a)*t; }
function normPressure(p){ return (p==null||p===0) ? 0.35 : Math.max(0.1, Math.min(1, p)); }

// блокиране на скрол и жестове върху платното
['touchstart','touchmove','wheel'].forEach(ev=>{
  els.canvas.addEventListener(ev, e=> e.preventDefault(), {passive:false});
});

els.canvas.addEventListener('pointerdown', (e)=>{
  if (!isPen(e)) {
    els.penOnly.classList.remove('hidden');
    return;
  }
  els.penOnly.classList.add('hidden');
  e.preventDefault();

  document.body.classList.add('no-scroll'); // заключи скрол

  drawing = true;
  activePointerId = e.pointerId;
  els.canvas.setPointerCapture(activePointerId);

  stroke = [{ x: e.offsetX, y: e.offsetY, p: normPressure(e.pressure) }];
  requestRedraw();
});

els.canvas.addEventListener('pointermove', (e)=>{
  if (!drawing || e.pointerId !== activePointerId) return;
  if (!isPen(e)) return;
  e.preventDefault();

  const pt = { x: e.offsetX, y: e.offsetY, p: normPressure(e.pressure) };
  // downsample: ако е почти същата точка, не добавяме
  if (stroke.length){
    const last = stroke[stroke.length-1];
    if (Math.hypot(pt.x-last.x, pt.y-last.y) < 0.5) return;
  }
  stroke.push(pt);
  requestRedraw();
});

function finishStroke(){
  if (stroke.length > 1) history.push(stroke);
  stroke = [];
  drawing = false;
  if (activePointerId != null) {
    try { els.canvas.releasePointerCapture(activePointerId); } catch {}
  }
  activePointerId = null;
  document.body.classList.remove('no-scroll'); // отключи скрол
  requestRedraw();
}

['pointerup','pointercancel','pointerout','pointerleave'].forEach(ev=>{
  els.canvas.addEventListener(ev, (e)=>{
    if (e.pointerId === activePointerId) { e.preventDefault(); finishStroke(); }
  }, {passive:false});
});

// бутони за платното
els.btnClear.onclick = ()=>{ history=[]; stroke=[]; requestRedraw(); };
els.btnUndo.onclick  = ()=>{ if (stroke.length) stroke=[]; else history.pop(); requestRedraw(); };

// ===== Локален storage =====
const DB_KEY = 'veresia-local-v1';
const localAll = async()=> JSON.parse(localStorage.getItem(DB_KEY)||'[]');
const localSave = async(rec)=>{ const a=await localAll(); a.push(rec); localStorage.setItem(DB_KEY, JSON.stringify(a)); };
const localQueryByName = async(name)=>{
  const n=(name||'').trim().toLowerCase();
  const a=await localAll();
  return a.filter(r=>(r.nameLower||'')===n);
};
function dataURLtoBlob(dataURL){
  const [meta,b64]=dataURL.split(',');
  const mime=(meta.match(/data:(.*?);/)||[])[1]||'image/png';
  const bin=atob(b64); const arr=new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
  return new Blob([arr],{type:mime});
}

// ===== Firebase (по желание) =====
let FB={ app:null, fs:null, st:null, enabled: USE_FIREBASE_DEFAULT, api:null };
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
  els.badge.style.color = FB.enabled ? '#9be7b6' : '#9ab0d1';
}

async function ensureFirebase(){
  if (FB.app) return;
  const cfg={
    apiKey: els.fb.apiKey.value.trim(),
    authDomain: els.fb.authDomain.value.trim(),
    projectId: els.fb.projectId.value.trim(),
    storageBucket: els.fb.storageBucket.value.trim(),
    appId: els.fb.appId.value.trim(),
  };
  if (!cfg.apiKey || !cfg.projectId || !cfg.storageBucket){
    showErr('Firebase не е конфигуриран (apiKey/projectId/storageBucket). Оставаме в локален режим.');
    FB.enabled=false; els.chkUseFirebase.checked=false; updateModeBadge(); return;
  }
  try{
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
    const { getFirestore, collection, addDoc, getDocs, query, where, orderBy } =
      await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const { getStorage, ref, uploadBytes, getDownloadURL } =
      await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js');

    FB.app = initializeApp(cfg);
    FB.fs  = getFirestore(FB.app);
    FB.st  = getStorage(FB.app);
    FB.api = { collection, addDoc, getDocs, query, where, orderBy, ref, uploadBytes, getDownloadURL };
  }catch(err){ showErr('Firebase init error: '+(err?.message||err)); FB.enabled=false; updateModeBadge(); }
}

// ===== Запази =====
els.btnSave.onclick = async ()=>{
  try{
    els.errBox.classList.add('hidden');

    const name = els.inpName.value.trim();
    const amount = Number(String(els.inpAmount.value).replace(',', '.'));
    if (!name) return showErr('Въведи име.');
    if (!Number.isFinite(amount)) return showErr('Въведи валидна сума (например 12.50).');
    if (history.length === 0) return showErr('Няма написано съдържание на листа.');

    const dataURL = els.canvas.toDataURL('image/png');
    const ts = Date.now();

    if (FB.enabled){
      await ensureFirebase(); if (!FB.app) return;

      const p = `images/${ts}-${name.replace(/\s+/g,'_')}.png`;
      const sref = FB.api.ref(FB.st, p);
      await FB.api.uploadBytes(sref, dataURLtoBlob(dataURL));
      const url = await FB.api.getDownloadURL(sref);

      const doc = { name, nameLower:name.toLowerCase(), amount:Number(amount), ts, imagePath:p, imageURL:url };
      await FB.api.addDoc(FB.api.collection(FB.fs,'records'), doc);
      alert('✅ Записано в облака.');
    } else {
      const rec = { id: crypto.randomUUID(), name, nameLower:name.toLowerCase(), amount:Number(amount), ts, imageData:dataURL };
      await localSave(rec);
      alert('✅ Записано локално.');
    }
  }catch(err){ showErr('Грешка при запис: '+(err?.message||err)); }
};

// ===== Търсене =====
els.btnSearch.onclick = doSearch;
els.inpSearch.addEventListener('keydown', e=>{ if(e.key==='Enter') doSearch(); });

async function doSearch(){
  try{
    els.errBox.classList.add('hidden');

    const qname = els.inpSearch.value.trim().toLowerCase();
    if (!qname) return;

    let rows=[];
    if (FB.enabled){
      await ensureFirebase(); if (!FB.app) return;
      const { getDocs, query, where, orderBy, collection } = FB.api;
      const q=query(collection(FB.fs,'records'), where('nameLower','==',qname), orderBy('ts','desc'));
      const snap=await getDocs(q);
      rows=snap.docs.map(d=>d.data());
    } else {
      rows=await localQueryByName(qname);
      rows.sort((a,b)=>b.ts-a.ts);
    }

    els.results.innerHTML='';
    let sum = 0;
    for (const r of rows){
      const amt = Number(r.amount)||0;
      sum += amt;
      const url = r.imageURL || r.imageData || '';
      const div=document.createElement('div');
      div.className='result';
      div.innerHTML=`
        <img class="thumb" src="${url}" alt="снимка"/>
        <div>
          <div><strong>${r.name||''}</strong></div>
          <div class="meta">${new Date(r.ts||0).toLocaleString()}</div>
        </div>
        <div class="amount">${fmt(amt)} лв</div>
      `;
      els.results.appendChild(div);
    }
    els.total.textContent = `Обща сума: ${fmt(sum)} лв`;
  }catch(err){ showErr('Грешка при търсене: '+(err?.message||err)); }
}

// ===== Експорт/Импорт (локален режим) =====
els.btnExport.onclick = async ()=>{
  try{
    const rows = await localAll();
    const blob = new Blob([JSON.stringify(rows,null,2)], {type:'application/json'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=`veresia-backup-${Date.now()}.json`;
    a.click(); URL.revokeObjectURL(a.href);
  }catch(err){ showErr('Грешка при експорт: '+(err?.message||err)); }
};
els.fileImport.onchange = async (e)=>{
  try{
    const f=e.target.files?.[0]; if(!f) return;
    const text=await f.text();
    JSON.parse(text);
    localStorage.setItem(DB_KEY, text);
    alert('Импортът е завършен.');
  }catch(err){ showErr('Невалиден JSON при импорт: '+(err?.message||err)); }
};
