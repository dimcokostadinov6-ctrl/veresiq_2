/* ==========================================================
   Veresiya — НЕ пипа интерфейса. Само добавя логика за „Запази“:
   1) PNG снимка на платното
   2) Запис в IndexedDB: { id, name, amount, createdAt, imageBlob }
   3) Нов празен лист (reset на canvas) + нулира полетата
   ========================================================== */

/* ---------- Намираме елементите без да зависим от конкретни ID ---------- */
function q(selList) {
  for (const sel of selList.split(',').map(s => s.trim())) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}
const canvas      = q('#pageCanvas, canvas');
const btnSave     = q('#btnSave, #saveBtn, button#save, button.save, button[data-action="save"], button[aria-label="Запази"], button[title="Запази"]');
const nameInput   = q('#nameInput, #name, input[name="name"], input[data-field="name"]');
const amountInput = q('#amountInput, #amount, input[name="amount"], input[data-field="amount"]');
const statusText  = q('#statusText, .status-text');

/* ---------- Помощни ---------- */
function setStatus(msg){
  if (statusText) statusText.textContent = msg;
}

function canvasToBlob(type='image/png', quality=0.92){
  return new Promise(resolve=>{
    if (canvas && canvas.toBlob) {
      canvas.toBlob(b => resolve(b), type, quality);
    } else if (canvas) {
      const dataURL = canvas.toDataURL(type, quality);
      const byteString = atob(dataURL.split(',')[1]);
      const mimeString = dataURL.split(',')[0].split(':')[1].split(';')[0];
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i=0;i<byteString.length;i++) ia[i]=byteString.charCodeAt(i);
      resolve(new Blob([ab], {type: mimeString}));
    } else {
      resolve(null);
    }
  });
}

function clearCanvas(){
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  // изчистваме, пазим текущия размер/скалиране
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,w,h);
  // възстановяваме DPR скейла (ако е ползван)
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  ctx.setTransform(dpr,0,0,dpr,0,0);
}

/* ---------- IndexedDB (минимална обвивка) ---------- */
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
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('byName', 'name', { unique:false });
        store.createIndex('byCreated', 'createdAt', { unique:false });
      }
    };
    req.onsuccess = ()=> resolve(req.result);
    req.onerror   = ()=> reject(req.error);
  });
  return _dbPromise;
}

async function putEntry(entry){
  const db = await openDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(STORE, 'readwrite');
    tx.oncomplete = ()=> resolve(true);
    tx.onerror    = ()=> reject(tx.error);
    tx.objectStore(STORE).put(entry);
  });
}

/* ---------- Основна логика за „Запази“ ---------- */
async function onSave(){
  try{
    const nameVal = (nameInput && nameInput.value || '').trim();
    const amtRaw  = (amountInput && amountInput.value || '').trim().replace(',', '.');

    if (!nameVal){
      setStatus('Въведи име.');
      if (nameInput) nameInput.focus();
      return;
    }
    const amount = Number(amtRaw);
    if (!amtRaw || Number.isNaN(amount)){
      setStatus('Въведи валидна сума (напр. 12.40).');
      if (amountInput) amountInput.focus();
      return;
    }

    setStatus('Записвам...');

    // 1) PNG снимка
    const pngBlob = await canvasToBlob('image/png', 0.92);

    // 2) Запис в IndexedDB
    const entry = {
      id: Date.now().toString(),
      name: nameVal,
      amount: Number(amount.toFixed(2)),
      createdAt: new Date().toISOString(),
      imageBlob: pngBlob || null
    };
    await putEntry(entry);

    // 3) Нов лист
    clearCanvas();
    if (nameInput) nameInput.value = '';
    if (amountInput) amountInput.value = '';

    setStatus('Записано. Нов лист е готов.');
  } catch (err){
    console.error(err);
    setStatus('Грешка при запис.');
  }
}

/* ---------- Закачане към бутона ---------- */
if (btnSave) {
  btnSave.addEventListener('click', onSave);
} else {
  console.warn('[veresiya] Не е намерен бутон „Запази“.');
}

/* КРАЙ — интерфейсът остава 1:1 както е в твоите HTML/CSS */
