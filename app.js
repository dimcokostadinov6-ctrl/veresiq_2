/* ========== Настройки ========== */
const CANVAS_BG_LINE_GAP = 24;      // разстояние между сините линии
const PEN_COLOR = "#ffffff";
const PEN_WIDTH = 3.2;
const STRIKE_WIDTH = 6.0;           // по-дебела линия за зачертаване
const STRAIGHT_TOL = 2.2;           // допуск за „правa линия“ (px стандартно отклонение)
const MIN_STRIKE_LEN = 180;         // минимална дължина за жест „зачертаване“

/* IndexedDB: таблица entries */
const db = localforage.createInstance({ name: "veresia", storeName: "entries" });
/* форма на запис: { id, name, amount, imgName, ts } */

/* OCR (Tesseract) – ще заредим bul.traineddata */
const OCR = {
  worker: null,
  async ensure() {
    if (this.worker) return this.worker;
    this.worker = await Tesseract.createWorker({
      // langPath е CDN за езиковите модели
      langPath: "https://tessdata.projectnaptha.com/4.0.0",
      gzip: false,
    });
    await this.worker.loadLanguage("bul");
    await this.worker.initialize("bul");
    return this.worker;
  },
  async textFromCanvas(canvas) {
    await this.ensure();
    const res = await this.worker.recognize(canvas);
    return res.data.text || "";
  }
};

/* Помощни */
const $ = sel => document.querySelector(sel);
const toast = (m) => {
  const host = $("#toast");
  host.innerHTML = `<div class="msg">${m}</div>`;
  setTimeout(()=> host.innerHTML = "", 1800);
};

const pad = $("#pad");
const ctx = pad.getContext("2d", { willReadFrequently: true });
let drawing = false;
let isStrikeMode = false;
let path = [];        // текуща траектория
let undoStack = [];

/* Рисуване само с писалка (по желание) */
const penOnly = $("#penOnly");

/* ========== Размери и фон ========== */
function fitCanvas() {
  const rect = pad.getBoundingClientRect();
  pad.width  = Math.floor(rect.width  * devicePixelRatio);
  pad.height = Math.floor(rect.height * devicePixelRatio);
  ctx.scale(devicePixelRatio, devicePixelRatio);
  drawRuledPaper();
}
function drawRuledPaper(){
  // чистим към прозрачност и оставяме линиите от CSS (фонът е в контейнера).
  ctx.clearRect(0,0,pad.width, pad.height);
}
window.addEventListener("resize", fitCanvas);

/* ========== Инструменти ========== */
function beginStroke(x,y){
  drawing = true; path = [{x,y}];
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  ctx.strokeStyle = isStrikeMode ? "#ff6b6b" : PEN_COLOR;
  ctx.lineWidth   = isStrikeMode ? STRIKE_WIDTH : PEN_WIDTH;
  ctx.beginPath(); ctx.moveTo(x,y);
}
function moveStroke(x,y){
  if(!drawing) return;
  const p = path[path.length-1];
  ctx.lineTo(x,y); ctx.stroke();
  path.push({x,y});
}
function endStroke(){
  if(!drawing) return;
  drawing = false; ctx.closePath();
  // Снимаме за Undo
  undoStack.push(pad.toDataURL("image/png"));
  if (undoStack.length>20) undoStack.shift();

  // Ако е зачертаване – детекция на „една права линия“
  if (isStrikeMode) tryDeleteByStrike(path);
}

/* Прост детектор за правa линия */
function tryDeleteByStrike(pts){
  const len = Math.hypot(pts[pts.length-1].x-pts[0].x, pts[pts.length-1].y-pts[0].y);
  if (len < MIN_STRIKE_LEN) return;
  const meanY = pts.reduce((a,p)=>a+p.y,0)/pts.length;
  const variance = pts.reduce((a,p)=>a+(p.y-meanY)**2,0)/pts.length;
  const stdev = Math.sqrt(variance);
  if (stdev > STRAIGHT_TOL) return; // не е достатъчно „права“
  // считаме, че е хоризонтална линия около y=meanY
  deleteClosestNameNearY(meanY);
}

/* OCR + изтриване на най-близкия ред */
async function deleteClosestNameNearY(y){
  toast("Зачертаване… търся в записите");
  // OCR върху текущото платно и добив на линии
  const text = await OCR.textFromCanvas(pad);
  const lines = text.split(/\r?\n/).map((s)=>s.trim()).filter(Boolean);

  // Зареждаме всички записи и търсим последния записан, чиято „линия“ е най-близо до y.
  // Тъй като нямаме координати от OCR в този лек вариант, ще изтрием последния запис със съвпадащо име, което се вижда в текста.
  const all = await allEntries();
  if (!all.length){ toast("Няма записи в базата."); return; }

  // намираме име от последния ред, който прилича на „име - сума“
  let candidateName = null;
  for (let i=lines.length-1;i>=0;i--){
    const L = lines[i];
    // всичко преди първото число приемаме за име
    const m = L.match(/^(.+?)\s*[-–—:]?\s*([0-9]+[0-9\.,]*)/);
    if (m){
      candidateName = m[1].trim();
      break;
    }
  }
  if (!candidateName){ toast("Не разпознах име на линията."); return; }

  // търсим запис по име (последния по време)
  const hit = all.filter(r => (r.name||"").toLowerCase().includes(candidateName.toLowerCase()))
                 .sort((a,b)=>b.ts-a.ts)[0];
  if (!hit){ toast(`Няма запис за „${candidateName}“.`); return; }

  await db.removeItem(hit.id);
  toast(`Премахнат: ${hit.name} (${fmt(hit.amount)} лв.)`);
  // (по желание) може да презаредим резултатите в панела
  if ($("#drawer").classList.contains("open")) runSearch();
}

/* ========== Събития / Pointer ========== */
function clientPos(ev){
  if (ev.touches && ev.touches[0]) return { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
  return { x: ev.clientX, y: ev.clientY };
}
function toCanvas(x,y){
  const r = pad.getBoundingClientRect();
  return { x: x - r.left, y: y - r.top };
}
function allow(ev){
  // Ако е включено „Само писалка“, игнорираме мишка/пръст
  if (penOnly.checked && ev.pointerType && ev.pointerType !== "pen") return false;
  return true;
}

pad.addEventListener("pointerdown", (ev)=>{
  if (!allow(ev)) return;
  ev.preventDefault();
  pad.setPointerCapture(ev.pointerId);
  const {x,y} = toCanvas(ev.clientX, ev.clientY);
  beginStroke(x,y);
});
pad.addEventListener("pointermove", (ev)=>{
  if (!allow(ev)) return;
  if (!drawing) return;
  ev.preventDefault();
  const {x,y} = toCanvas(ev.clientX, ev.clientY);
  moveStroke(x,y);
});
const finish = ev => { if(drawing){ ev.preventDefault(); endStroke(); } };
pad.addEventListener("pointerup", finish);
pad.addEventListener("pointercancel", finish);
pad.addEventListener("pointerleave", finish);

/* Изключваме скрола докато рисуваме на iPad/таблет */
["touchstart","touchmove"].forEach(t=>{
  pad.addEventListener(t, e=> e.preventDefault(), { passive:false });
});

/* ========== Бутони ========== */
$("#btn-new").onclick = () => {
  drawRuledPaper();
  toast("Нова страница");
};
$("#btn-undo").onclick = () => {
  const last = undoStack.pop();
  if (!last) return;
  const img = new Image();
  img.onload = () => { ctx.clearRect(0,0,pad.width,pad.height); ctx.drawImage(img,0,0, pad.width/devicePixelRatio, pad.height/devicePixelRatio); };
  img.src = last;
};
$("#btn-clear").onclick = () => {
  undoStack = [];
  drawRuledPaper();
};
$("#btn-strike").onclick = (e) => {
  isStrikeMode = !isStrikeMode;
  e.currentTarget.classList.toggle("primary", isStrikeMode);
  toast(isStrikeMode ? "Режим: Зачертаване" : "Режим: Писалка");
};

$("#btn-save").onclick = async () => {
  // 1) сваляме PNG
  const png = pad.toDataURL("image/png");
  const fileName = `veresia-${new Date().toISOString().replace(/[:.]/g,"-")}.png`;
  downloadDataURL(png, fileName);

  // 2) OCR → извличане на име и сума и запис в „базата“
  toast("Разчитам текста (OCR)...");
  const text = await OCR.textFromCanvas(pad);
  const tuples = parseNameAmountLines(text); // [{name, amount}]
  if (!tuples.length){
    toast("Запазено изображение. Няма намерени имена/суми.");
    return;
  }
  const writes = tuples.map(t => saveEntry({ ...t, imgName:fileName }));
  await Promise.all(writes);
  toast(`Запазено: ${tuples.length} записа.`);
};

$("#btn-search").onclick = ()=>{
  $("#drawer").classList.add("open");
  $("#drawer").setAttribute("aria-hidden","false");
};
$("#drawer-close").onclick = ()=>{
  $("#drawer").classList.remove("open");
  $("#drawer").setAttribute("aria-hidden","true");
};
$("#q-run").onclick = runSearch;

/* ========== Локална „база“ ========== */
async function saveEntry({name, amount, imgName}){
  const id = `e_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
  const entry = { id, name: (name||"").trim(), amount: Number(amount)||0, imgName, ts: Date.now() };
  await db.setItem(id, entry);
  return entry;
}
async function allEntries(){
  const arr = [];
  await db.iterate((v)=> arr.push(v));
  return arr.sort((a,b)=> a.ts - b.ts);
}
function fmt(n){ return (Number(n)||0).toFixed(2); }

/* Търсене и резултати */
async function runSearch(){
  const q = ($("#q-name").value||"").trim().toLowerCase();
  const list = await allEntries();
  const hits = q ? list.filter(r => (r.name||"").toLowerCase().includes(q)) : list;
  const total = hits.reduce((a,b)=> a + (Number(b.amount)||0), 0);

  const host = $("#results");
  if (!hits.length){
    host.innerHTML = `<div class="result">Няма резултати.</div>`;
    return;
  }
  host.innerHTML = hits.map(r=>`
    <div class="result">
      <h4>${escapeHtml(r.name)}</h4>
      <div class="sum">Сума: <strong>${fmt(r.amount)} лв.</strong></div>
      <div class="meta">Файл: ${escapeHtml(r.imgName||"-")} • ${new Date(r.ts).toLocaleString()}</div>
    </div>
  `).join("") + `
    <div class="result"><h4>Обща сума</h4><div class="sum"><strong>${fmt(total)} лв.</strong></div></div>
  `;
}

/* ========== Парсване на „Име – Сума“ от OCR ========== */
function parseNameAmountLines(text){
  // приемаме редове като „Иван - 12,50“ или „Мария 7.20“
  const lines = (text||"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const out = [];
  for (const L of lines){
    const m = L.match(/^(.+?)\s*(?:[-–—:]|\s)\s*([0-9]+[0-9\.,]*)$/);
    if (!m) continue;
    const name = m[1].replace(/[^\p{L}\s\-']/gu," ").replace(/\s{2,}/g," ").trim();
    let amount = m[2].replace(",",".");
    if (name && !isNaN(parseFloat(amount))){
      out.push({ name, amount: parseFloat(amount) });
    }
  }
  return out;
}

/* ========== Помощни ========== */
function downloadDataURL(dataURL, filename){
  const a = document.createElement("a");
  a.href = dataURL; a.download = filename; document.body.appendChild(a);
  a.click(); a.remove();
}
function escapeHtml(s){ return (s||"").replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

/* Старт */
window.addEventListener("load", ()=>{
  fitCanvas();
  toast("Готово за писане ✍️");
});
