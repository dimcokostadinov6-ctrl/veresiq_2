/* ==========================================================
   Veresiya – „тетрадка“: черно платно със сини линии, писане само с писалка.
   „Запази“: 1) PNG снимка, 2) запис {name, amount, createdAt, imageBlob} в IndexedDB,
             3) нов празен лист.
   Нищо извън това НЕ се променя.
   ========================================================== */
const canvas      = document.getElementById('pageCanvas');
const ctx         = canvas.getContext('2d', { willReadFrequently:false });
const nameInput   = document.getElementById('nameInput');
const amountInput = document.getElementById('amountInput');
const btnSave     = document.getElementById('btnSave');
const statusText  = document.getElementById('statusText');

/* ---------- Размер/скала без да чупим изгледа ---------- */
function fitCanvas() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  const targetW = Math.max(1, Math.floor(rect.width * dpr));
  const targetH = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== targetW || canvas.height !== targetH) {
    const temp = document.createElement('canvas');
    temp.width = canvas.width; temp.height = canvas.height;
    temp.getContext('2d').drawImage(canvas, 0, 0);
    canvas.width = targetW; canvas.height = targetH;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.drawImage(temp, 0, 0);
  }
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.lineCap   = 'round';
  ctx.lineJoin  = 'round';
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#f5f5f5';
  ctx.lineWidth = 2.6;
}
fitCanvas();
window.addEventListener('resize', fitCanvas);

/* ---------- Рисуване: САМО с писалка ---------- */
let drawing = false, lastX = 0, lastY = 0;

function toXY(e){
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function down(e){
  if (e.pointerType !== 'pen') return;   // само pen
  e.preventDefault();
  const p = toXY(e); drawing = true; lastX = p.x; lastY = p.y;
}
function move(e){
  if (!drawing || e.pointerType !== 'pen') return;
  e.preventDefault();
  const p = toXY(e);
  ctx.beginPath(); ctx.moveTo(lastX,lastY); ctx.lineTo(p.x,p.y); ctx.stroke();
  lastX = p.x; lastY = p.y;
}
function up(){ drawing = false; }

canvas.addEventListener('pointerdown', down, {passive:false});
window.addEventListener('pointermove',  move, {passive:false});
window.addEventListener('pointerup',    up);
window.addEventListener('pointercancel',up);

/* ---------- Помощни ---------- */
function setStatus(t){ if (statusText) statusText.textContent = t; }

function clearSheet(){
  const w = canvas.width, h = canvas.height;
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,w,h);
  fitCanvas(); // връща правилната скала и четка
}

function canvasToBlob(type='image/png', quality=0.92){
  return new Promise(resolve=>{
    if (canvas.toBlob) canvas.toBlob(b => resolve(b), type, quality);
    else {
      const dataURL = canvas.toDataURL(type, quality);
      const byteString = atob(dataURL.split(',')[1]);
      const mimeString = dataURL.split(',')[0].split(':')[1].split(';')[0];
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i=0;i<byteString.length;i++) ia[i]=byteString.charCodeAt(i);
      resolve(new Blob([ab], {type: mimeString}));
    }
  });
}

/* ---------- IndexedDB ---------- */
const DB_NAME = 'veresiyaDB';
const DB_VER  = 1;
const STORE   = 'entries';

let _dbPromise = null;
function openDB(){
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (ev)=>{
      const db = ev.target.result;
      if (!db.objectStoreNames.contains(STORE)){
        const st = db.createObjectStore(STORE, { keyPath:'id' });
        st.createIndex('byName','name',{unique:false});
        st.createIndex('byCreated','createdAt',{unique:false});
      }
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
  return _dbPromise;
}
async function putEntry(entry){
  const db = await openDB();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE,'readwrite');
    tx.oncomplete = ()=>resolve(true);
    tx.onerror    = ()=>reject(tx.error);
    tx.objectStore(STORE).put(entry);
  });
}

/* ---------- „Запази“: PNG + БД + нов лист ---------- */
async function onSave(){
  try{
    const name   = (nameInput?.value || '').trim();
    const amtStr = (amountInput?.value || '').trim().replace(',', '.');

    if (!name){ setStatus('Въведи име.'); nameInput?.focus(); return; }
    const amount = Number(amtStr);
    if (!amtStr || Number.isNaN(amount)){ setStatus('Въведи валидна сума (напр. 12.40).'); amountInput?.focus(); return; }

    setStatus('Записвам...');

    const pngBlob = await canvasToBlob('image/png', .92);

    const entry = {
      id: Date.now().toString(),
      name,
      amount: Number(amount.toFixed(2)),
      createdAt: new Date().toISOString(),
      imageBlob: pngBlob
    };
    await putEntry(entry);

    clearSheet();
    if (nameInput) nameInput.value = '';
    if (amountInput) amountInput.value = '';
    setStatus('Записано. Нов лист е готов.');
  } catch(err){
    console.error(err);
    setStatus('Грешка при запис.');
  }
}
btnSave?.addEventListener('click', onSave);

setStatus('Готово.');
