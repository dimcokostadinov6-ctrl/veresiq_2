/* ==========================================================
   Veresiq – canvas само за ПИСАЛКА + IndexedDB запис
   Бутон „Запази“: 1) PNG на листа, 2) име+сума в БД, 3) нов лист
   Нищо друго не пипаме като поведение.
   ========================================================== */

(() => {
  const canvas = document.getElementById('pageCanvas');
  const wrap = document.getElementById('canvasWrap');
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  const nameInput = document.getElementById('nameInput');
  const amountInput = document.getElementById('amountInput');
  const btnSave = document.getElementById('btnSave');
  const hintNonPen = document.getElementById('hintNonPen');
  const statusText = document.getElementById('statusText');

  // ---------- Resize canvas to device pixels ----------
  function fitCanvas() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const { clientWidth, clientHeight } = wrap;
    canvas.width = Math.floor(clientWidth * dpr);
    canvas.height = Math.floor(clientHeight * dpr);
    canvas.style.width = clientWidth + 'px';
    canvas.style.height = clientHeight + 'px';
    ctx.scale(dpr, dpr);
    // Няма да рисуваме фон – CSS има „линии“. Само настройваме четката.
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 2.5;
  }

  window.addEventListener('resize', () => {
    // За да не губим вече нарисуваното при resize, правим snapshot и го връщаме
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = canvas.width, h = canvas.height;
    const temp = document.createElement('canvas');
    temp.width = w; temp.height = h;
    temp.getContext('2d').drawImage(canvas, 0, 0);
    fitCanvas();
    ctx.drawImage(temp, 0, 0, w, h, 0, 0, canvas.clientWidth * dpr, canvas.clientHeight * dpr);
  });

  fitCanvas();

  // ---------- Pen-only drawing ----------
  let drawing = false;
  let last = { x: 0, y: 0 };

  function toCanvasXY(e){
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left);
    const y = (e.clientY - rect.top);
    return { x, y };
  }

  function startDraw(e){
    if (e.pointerType !== 'pen') {
      // скриваме/показваме подсказка за 2 сек.
      hintNonPen.style.display = 'block';
      clearTimeout(startDraw._t);
      startDraw._t = setTimeout(()=> hintNonPen.style.display='none', 1800);
      return;
    }
    drawing = true;
    last = toCanvasXY(e);
  }

  function moveDraw(e){
    if (!drawing || e.pointerType !== 'pen') return;
    const p = toCanvasXY(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
  }

  function endDraw(){
    drawing = false;
  }

  canvas.addEventListener('pointerdown', (e)=>{
    e.preventDefault(); startDraw(e);
  }, {passive:false});

  canvas.addEventListener('pointermove', (e)=>{
    e.preventDefault(); moveDraw(e);
  }, {passive:false});

  window.addEventListener('pointerup', endDraw);
  window.addEventListener('pointercancel', endDraw);
  window.addEventListener('gesturestart', e=>e.preventDefault());

  // ---------- IndexedDB (локална база) ----------
  const DB_NAME = 'veresiyaDB';
  const DB_VER = 1;
  const STORE = 'entries';

  let dbPromise = null;

  function openDB(){
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject)=>{
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = (ev)=>{
        const db = ev.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('byName', 'name', { unique: false });
          store.createIndex('byCreated', 'createdAt', { unique: false });
        }
      };
      req.onsuccess = ()=> resolve(req.result);
      req.onerror = ()=> reject(req.error);
    });
    return dbPromise;
  }

  async function putEntry(entry){
    const db = await openDB();
    return new Promise((resolve, reject)=>{
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = ()=> resolve(true);
      tx.onerror = ()=> reject(tx.error);
      tx.objectStore(STORE).put(entry);
    });
  }

  // ---------- Utility: canvas -> Blob ----------
  function canvasToBlob(type='image/png', quality=0.92){
    return new Promise((resolve)=>{
      canvas.toBlob((blob)=> resolve(blob), type, quality);
    });
  }

  function setStatus(text){
    statusText.textContent = text;
  }

  function clearSheet(){
    // Чистим платното – без да чупим размери/скалиране
    const { width, height } = canvas;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,width,height);
    fitCanvas();
  }

  // ---------- SAVE: 1) PNG, 2) Име+Сума, 3) Нов лист ----------
  btnSave.addEventListener('click', async ()=>{
    try{
      const name = (nameInput.value || '').trim();
      const amtRaw = (amountInput.value || '').trim();
      const amount = amtRaw === '' ? null : Number(amtRaw.replace(',', '.'));

      if (!name) {
        nameInput.focus();
        setStatus('Въведи име преди запис.');
        return;
      }
      if (amount === null || Number.isNaN(amount)) {
        amountInput.focus();
        setStatus('Въведи валидна сума (напр. 12.40).');
        return;
      }

      setStatus('Записвам...');

      // 1) PNG снимка на листа
      const pngBlob = await canvasToBlob('image/png', 0.92);

      // 2) Запис в IndexedDB
      const entry = {
        id: Date.now().toString(),
        name,
        amount: Number(amount.toFixed(2)),
        createdAt: new Date().toISOString(),
        imageBlob: pngBlob  // пазим изображението локално
      };
      await putEntry(entry);

      // 3) Нов лист
      clearSheet();
      nameInput.value = '';
      amountInput.value = '';
      setStatus('Записано. Нов лист е готов.');
    } catch (err){
      console.error(err);
      setStatus('Грешка при запис.');
    }
  });

  // Първоначален статус
  setStatus('Готово.');
})();
