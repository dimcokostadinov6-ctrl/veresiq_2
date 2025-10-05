// ===== Конфиг =====
const USE_FIREBASE_DEFAULT = false;

// ===== Помощни =====
const $ = (s,p=document)=>p.querySelector(s);
const fmt = (n)=> (Number(String(n).replace(',', '.'))||0).toFixed(2);
const uuid = ()=> (crypto.randomUUID ? crypto.randomUUID() :
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{
    const r=Math.random()*16|0,v=c==='x'?r:(r&0x3|0x8); return v.toString(16);
  })
);

const els = {
  canvas: $('#pad'),
  badge:  $('#modeBadge'),
  penOnly: $('#penOnly'),
  errBox: $('#errBox'),
  hint: $('#strikeHint'),
  btnClear: $('#btnClear'),
  btnUndo: $('#btnUndo'),
  btnSave: $('#btnSave'),
  btnStrike: $('#btnStrike'),
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

function info(msg){
  els.errBox.textContent = "ℹ️ " + String(msg);
  els.errBox.classList.remove('hidden');
  clearTimeout(info._t);
  info._t = setTimeout(()=> els.errBox.classList.add('hidden'), 4000);
}

// ===== Canvas / рисуване (оптимизирано) =====
let ctx, dpr = 1;
let drawing = false, strikeMode = false;
let activePointerId = null, stroke = [], history = [], needsRedraw = false;

function isPen(e){ return e.pointerType === 'pen'; }
function normPressure(p){ return (p==null||p===0) ? 0.35 : Math.max(0.1, Math.min(1, p)); }

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

function requestRedraw(){ if(!needsRedraw){ needsRedraw=true; requestAnimationFrame(drawAll); } }
function drawAll(){
  needsRedraw=false;
  const c=els.canvas,g=ctx;
  g.clearRect(0,0,c.width,c.height);
  for(const s of history) drawStroke(g,s);
  if(stroke.length>1) drawStroke(g,stroke);
}

function drawStroke(g,s){
  if(s.length<2) return;
  g.beginPath();
  let lastW = widthForPressure(s[0].p);
  g.moveTo(s[0].x*dpr, s[0].y*dpr);
  for(let i=1;i<s.length;i++){
    const p0=s[i-1], p1=s[i];
    const midX=(p0.x+p1.x)*0.5*dpr, midY=(p0.y+p1.y)*0.5*dpr;
    const w=lerp(lastW,widthForPressure(p1.p),0.3);
    g.lineWidth=w;
    g.quadraticCurveTo(p0.x*dpr,p0.y*dpr,midX,midY);
    lastW=w;
  }
  g.stroke();
}
function widthForPressure(p=0.5){ const base=1.8*dpr, add=2.4*(p||0.5)*dpr; return base+add; }
function lerp(a,b,t){ return a+(b-a)*t; }

// блокиране на скрол и жестове върху платното
['touchstart','touchmove','wheel'].forEach(ev=>{
  els.canvas.addEventListener(ev, e=> e.preventDefault(), {passive:false});
});

els.canvas.addEventListener('pointerdown', (e)=>{
  if (!isPen(e)) { els.penOnly.classList.remove('hidden'); return; }
  els.penOnly.classList.add('hidden');
  e.preventDefault();

  document.body.classList.add('no-scroll');
  drawing=true; activePointerId=e.pointerId;
  els.canvas.setPointerCapture(activePointerId);

  stroke=[{x:e.offsetX,y:e.offsetY,p:normPressure(e.pressure)}];
  requestRedraw();
});
els.canvas.addEventListener('pointermove', (e)=>{
  if (!drawing || e.pointerId!==activePointerId) return;
  if (!isPen(e)) return;
  e.preventDefault();

  const pt={x:e.offsetX,y:e.offsetY,p:normPressure(e.pressure)};
  if (stroke.length){
    const last=stroke[stroke.length-1];
    if (Math.hypot(pt.x-last.x,pt.y-last.y)<0.5) return;
  }
  stroke.push(pt);
  requestRedraw();
});
['pointerup','pointercancel','pointerout','pointerleave'].forEach(ev=>{
  els.canvas.addEventListener(ev,(e)=>{
    if (e.pointerId!==activePointerId) return;
    e.preventDefault();
    finishStroke();
  },{passive:false});
});

function finishStroke(){
  // анализ за зачертаване
  if (strikeMode && isHorizontalStrike(stroke)){
    // ако имаме избран резултат → изтриваме
    if (selectedRid){
      deleteByRid(selectedRid).then(()=> info('Записът е изтрит.'));
    }else{
      showErr('Първо избери запис от резултатите (щракни върху него).');
    }
  }else{
    if (stroke.length>1) history.push(stroke);
  }
  stroke=[]; drawing=false;
  if (activePointerId!=null){ try{ els.canvas.releasePointerCapture(activePointerId); }catch{} }
  activePointerId=null;
  document.body.classList.remove('no-scroll');
  requestRedraw();
}

// детектор: една дълга хоризонтална линия
function isHorizontalStrike(s){
  if (!s || s.length<2) return false;
  const xs = s.map(p=>p.x), ys=s.map(p=>p.y);
  const minX=Math.min(...xs), maxX=Math.max(...xs);
  const minY=Math.min(...ys), maxY=Math.max(...ys);
  const w=maxX-minX, h=maxY-minY;
  const c=els.canvas; const W=c.getBoundingClientRect().width;
  const longEnough = w >= W*0.45;   // поне ~45% от ширината
  const flatEnough = h <= 10;       // почти права по Y (10px)
  return longEnough && flatEnough;
}

// ===== Локален storage =====
const DB_KEY = 'veresia-local-v1';
const localAll = async()=> JSON.parse(localStorage.getItem(DB_KEY)||'[]');
const localSave = async rec => { const a=await localAll(); a.push(rec); localStorage.setItem(DB_KEY, JSON.stringify(a)); };
const localDeleteByRid = async rid => {
  const a=await localAll();
  const b=a.filter(r=> (r.rid||'')!==rid);
  localStorage.setItem(DB_KEY, JSON.stringify(b));
};
const localQueryByName = async name => {
  const n=(name||'').trim().toLowerCase();
  const a=await localAll();
  return a.filter(r=> (r.nameLower||'')===n);
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
    const { getFirestore, collection, addDoc, getDocs, query, where, orderBy, deleteDoc } =
      await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const { getStorage, ref, uploadBytes, getDownloadURL } =
      await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js');

    FB.app = initializeApp(cfg);
    FB.fs  = getFirestore(FB.app);
    FB.st  = getStorage(FB.app);
    FB.api = { collection, addDoc, getDocs, query, where, orderBy, deleteDoc, ref, uploadBytes, getDownloadURL };
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
    const rid = uuid();

    if (FB.enabled){
      await ensureFirebase(); if (!FB.app) return;

      const p = `images/${ts}-${name.replace(/\s+/g,'_')}.png`;
      const sref = FB.api.ref(FB.st, p);
      await FB.api.uploadBytes(sref, dataURLtoBlob(dataURL));
      const url = await FB.api.getDownloadURL(sref);

      const doc = { rid, name, nameLower:name.toLowerCase(), amount:Number(amount), ts, imagePath:p, imageURL:url };
      await FB.api.addDoc(FB.api.collection(FB.fs,'records'), doc);
      alert('✅ Записано в облака.');
    } else {
      const rec = { rid, id: rid, name, nameLower:name.toLowerCase(), amount:Number(amount), ts, imageData:dataURL };
      await localSave(rec);
      alert('✅ Записано локално.');
    }

    // изчистване и бързо опресняване
    els.inpName.value = '';
    els.inpAmount.value = '';
    history=[]; stroke=[]; requestRedraw();

  }catch(err){ showErr('Грешка при запис: '+(err?.message||err)); }
};

// ===== Търсене + избор =====
let selectedRid = null;

els.btnSearch.onclick = doSearch;
els.inpSearch.addEventListener('keydown', e=>{ if(e.key==='Enter') doSearch(); });

async function doSearch(){
  try{
    els.errBox.classList.add('hidden');
    selectedRid = null;

    const qname = els.inpSearch.value.trim().toLowerCase();
    if (!qname) return;

    let rows=[];
    if (FB.enabled){
      await ensureFirebase(); if (!FB.app) return;
      const { getDocs, query, where, orderBy, collection } = FB.api;
      const q=query(collection(FB.fs,'records'), where('nameLower','==',qname), orderBy('ts','desc'));
      const snap=await getDocs(q);
      rows=snap.docs.map(d=>({ ...d.data(), __docId: d.id }));
    } else {
      rows=await localQueryByName(qname);
      rows.sort((a,b)=>b.ts-a.ts);
    }

    renderResults(rows);
  }catch(err){ showErr('Грешка при търсене: '+(err?.message||err)); }
}

function renderResults(rows){
  els.results.innerHTML='';
  let sum=0;
  for (const r of rows){
    const amt=Number(r.amount)||0; sum+=amt;
    const url = r.imageURL || r.imageData || '';
    const div=document.createElement('div');
    div.className='result';
    div.dataset.rid = r.rid || r.id || `${r.name}-${r.ts}`;
    if (r.__docId) div.dataset.docId = r.__docId; // firebase doc id (за бързо триене)
    div.innerHTML=`
      <img class="thumb" src="${url}" alt="снимка"/>
      <div>
        <div><strong>${r.name||''}</strong></div>
        <div class="meta">${new Date(r.ts||0).toLocaleString()}</div>
      </div>
      <div class="amount">${fmt(amt)} лв</div>
    `;
    div.onclick = ()=>{
      $$('.result').forEach(x=>x.classList.remove('selected'));
      div.classList.add('selected');
      selectedRid = div.dataset.rid;
      info('Избран запис. Включи „Режим зачертаване“ и начертай една хоризонтална линия.');
    };
    els.results.appendChild(div);
  }
  els.total.textContent = `Обща сума: ${fmt(sum)} лв`;
}

// ===== Зачертаване (режим) =====
els.btnStrike.onclick = ()=>{
  strikeMode = !strikeMode;
  els.btnStrike.classList.toggle('active', strikeMode);
  els.hint.classList.toggle('hidden', !strikeMode);
  if (strikeMode && !selectedRid) {
    info('Избери запис (щракни върху него) и начертай една хоризонтална линия върху платното.');
  }
};

// изтриване по rid
async function deleteByRid(rid){
  if (!rid) return;
  if (FB.enabled){
    await ensureFirebase(); if (!FB.app) return;
    // опит 1: ако имаме docId от рендеринга — трием директно (по-бързо)
    const selected = [...$$('.result')].find(x=> x.classList.contains('selected'));
    const docId = selected?.dataset.docId;

    const { collection, query, where, getDocs, deleteDoc } = FB.api;
    if (docId){
      // имаме документ ID
      const doc = (await getDocs(query(collection(FB.fs,'records'), where('rid','==',rid)))).docs[0];
      if (doc) await deleteDoc(doc.ref);
    } else {
      // fallback: намираме по rid
      const snap = await getDocs(query(collection(FB.fs,'records'), where('rid','==',rid)));
      const batch = snap.docs;
      if (batch.length===0){ showErr('Не намерих записа в облака.'); return; }
      for (const d of batch) await FB.api.deleteDoc(d.ref);
    }
    // обнови списъка
    doSearch().catch(()=>{});
  } else {
    await localDeleteByRid(rid);
    // обнови списъка
    doSearch().catch(()=>{});
  }
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
