/* ==========================================================
   Veresiya – ДОБАВЕНА логика към бутона „Запази“, без промяна на UI.
   1) PNG снимка на платното
   2) Запис в IndexedDB: { id, name, amount, createdAt, imageBlob }
   3) Нов празен лист (чист canvas) + зануляване на полетата
   ----------------------------------------------------------
   Заб.: Ако имаш вече код за рисуване – оставяме го. Тук само
   добавяме липсващата логика за „Запази“. Ако части съвпадат,
   тази версия е самодостатъчна и няма нужда от други файлове.
   ========================================================== */

/* === СЕЛЕКТОРИ (ако ID-тата при теб са други, смени ги тук) === */
const canvas     = document.getElementById('pageCanvas');
const btnSave    = document.getElementById('btnSave');
const nameInput  = document.getElementById('nameInput');
const amountInput= document.getElementById('amountInput');
const statusText = document.getElementById('statusText') || null;

/* === ПРИЛОЖИМО: ако вече имаш рисуване – остави го си. ===
   Ако НЯМАШ, следният блок осигурява елементарно рисуване САМО с писалка.
   Ако вече имаш твой код за рисуване, можеш да изтриеш този блок. */
(function ensureBasicDrawing(){
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { willReadFrequently:false });

  // запазваме текущата скала; не променяме твоя layout. Само се грижим за DPI.
  function fitCanvasToCSS(){
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const needW = Math.max(1, Math.floor(rect.width * dpr));
    const needH = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== needW || canvas.height !== needH){
      // пазим снимка при resize
      const temp = document.createElement('canvas');
      temp.width = canvas.width; temp.height = canvas.height;
      temp.getContext('2d').drawImage(canvas, 0, 0);
      canvas.width = needW; canvas.height = needH;
      ctx.setTransform(1,0,0,1,0,0);
      ctx.drawImage(temp, 0, 0);
    }
    // стил на четката – минимален
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 2.5;
    // връщаме логически координати към CSS пиксели
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  fitCanvasToCSS();
  window.addEventListener('resize', fitCanvasToCSS);

  let drawing = false;
  let lastX = 0, lastY = 0;

  function toCanvasXY(e){
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function down(e){
    if (e.pointerType !== 'pen') return; // само писалка
    e.preventDefault();
    const p = toCanvasXY(e);
    drawing = true; lastX = p.x; lastY = p.y;
  }
  function move(e){
    if (!drawing || e.pointerType !== 'pen') return;
    e.preventDefault();
    const p = toCanvasXY(e);
    const ctx2 = canvas.getContext('2d');
    ctx2.beginPath();
    ctx2.moveTo(lastX, lastY);
    ctx2.lineTo(p.x, p.y);
    ctx2.stroke();
    lastX = p.x; lastY = p.y;
  }
  function up(){ drawing = false; }

  canvas.addEventListener('pointerdown', down, {passive:false});
  window.addEventListener('pointermove', move, {passive:false});
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
})();

/* === ПОМОЩНИ ФУНКЦИИ === */
function setStatus(msg){
  if (statusText) statusText.textContent = msg;
}

function clearCanvas(){
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  // чистим без да чупим размера/скалата
  const w = canvas.width, h = canvas.height;
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,w,h);
  // възстановяваме скалата спрямо DPR (както в ensureBasicDrawing)
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  ctx.setTransform(dpr,0,0,dpr,0,0);
}

function canvasToBlob(type='image/png', quality=0.92){
  return new Promise(resolve=>{
    // в някои стари webview toBlob може да липсва → fallback
    if (canvas.toBlob) {
      canvas.toBlob(b => resolve(b), type, quality);
    } else {
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

/* === IndexedDB setup (лек, без външни библиотеки) === */
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

/* === ЛОГИКА ЗА „ЗАПАЗИ“ === */
async function onSave(){
  try{
    const name = (nameInput && nameInput.value || '').trim();
    const amtStr = (amountInput && amountInput.value || '').trim().replace(',', '.');

    if (!name){
      setStatus('Въведи име.');
      if (nameInput) nameInput.focus();
      return;
    }
    const amount = Number(amtStr);
    if (!amtStr || Number.isNaN(amount)){
      setStatus('Въведи валидна сума (напр. 12.40).');
      if (amountInput) amountInput.focus();
      return;
    }

    setStatus('Записвам...');

    // 1) PNG снимка на текущия лист
    const pngBlob = await canvasToBlob('image/png', 0.92);

    // 2) Запис в IndexedDB
    const entry = {
      id: Date.now().toString(),          // прост уникален ключ
      name,
      amount: Number(amount.toFixed(2)),  // 2 знака след запетая
      createdAt: new Date().toISOString(),
      imageBlob: pngBlob                  // съхраняваме снимката локално
    };
    await putEntry(entry);

    // 3) Нов лист + нулиране на полетата
    clearCanvas();
    if (nameInput) nameInput.value = '';
    if (amountInput) amountInput.value = '';

    setStatus('Записано. Нов лист е готов.');
  } catch(err){
    console.error(err);
    setStatus('Грешка при запис.');
  }
}

/* === ВРЪЗКА С БУТОНА „Запази“ === */
if (btnSave){
  btnSave.addEventListener('click', onSave);
} else {
  console.warn('[veresiya] Не е намерен #btnSave – няма да закача логика за запис.');
}

/* === КРАЙ === */
