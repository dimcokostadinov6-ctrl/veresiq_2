/* ===== помощни ===== */
const $=(s,p=document)=>p.querySelector(s);
const $$=(s,p=document)=>[...p.querySelectorAll(s)];
const msg=$('#msg'); let msgT=null;
function toast(t,ms=2000){ clearTimeout(msgT); msg.textContent=t; msg.classList.remove('hidden'); msgT=setTimeout(()=>msg.classList.add('hidden'),ms); }
const DB_KEY='veresia-db-v3';
const LAST_NAME='veresia:lastName';
const fmt = n => (Number(n)||0).toFixed(2);

/* ===== база (localStorage) ===== */
const db = {
  all(){ return JSON.parse(localStorage.getItem(DB_KEY)||'[]'); },
  save(arr){ localStorage.setItem(DB_KEY, JSON.stringify(arr)); },
  add(rec){ const a=this.all(); a.push(rec); this.save(a); },
  del(rid){ const a=this.all().filter(x=>x.rid!==rid); this.save(a); },
  byName(name){ const k=(name||'').toLowerCase().trim(); return this.all().filter(x=>x.nameLower===k).sort((A,B)=>B.ts-A.ts);}
};
const lastName = { get:()=>localStorage.getItem(LAST_NAME)||'', set:v=>localStorage.setItem(LAST_NAME,(v||'').trim()) };

/* ===== платно ===== */
const pad = $('#pad');
let ctx, dpr=1, drawing=false, pid=null, stroke=[], history=[];
function resize(){
  const r=pad.getBoundingClientRect(); dpr=Math.max(1,window.devicePixelRatio||1);
  pad.width=Math.round(r.width*dpr); pad.height=Math.round(r.height*dpr);
  ctx=pad.getContext('2d'); ctx.lineCap='round'; ctx.lineJoin='round'; ctx.strokeStyle='#f1f5ff';
  draw();
}
function draw(){
  ctx.clearRect(0,0,pad.width,pad.height);
  for(const s of history) drawStroke(s);
  if(stroke.length>1) drawStroke(stroke);
}
function drawStroke(s){
  const g=ctx; g.beginPath(); let lastW=2*dpr;
  g.moveTo(s[0].x*dpr,s[0].y*dpr);
  for(let i=1;i<s.length;i++){
    const a=s[i-1], b=s[i]; const mx=(a.x+b.x)/2*dpr, my=(a.y+b.y)/2*dpr;
    const w = 1.6*dpr + 2.2*(b.p||0.4)*dpr; g.lineWidth = lastW = lastW*.7 + w*.3;
    g.quadraticCurveTo(a.x*dpr,a.y*dpr,mx,my);
  } g.stroke();
}
const isPen = e=> e.pointerType==='pen' || e.pointerType==='touch';
const pres = e=> (e.pressure==null||e.pressure===0)?0.35:Math.max(.1,Math.min(1,e.pressure));

pad.addEventListener('pointerdown', e=>{
  if(!isPen(e)) return; e.preventDefault(); pad.setPointerCapture(e.pointerId);
  drawing=true; pid=e.pointerId; stroke=[{x:e.offsetX,y:e.offsetY,p:pres(e)}];
});
pad.addEventListener('pointermove', e=>{
  if(!drawing || e.pointerId!==pid) return; e.preventDefault();
  const pt={x:e.offsetX,y:e.offsetY,p:pres(e)}; const last=stroke[stroke.length-1];
  if(Math.hypot(pt.x-last.x,pt.y-last.y)<0.5) return; stroke.push(pt); draw();
});
['pointerup','pointercancel','pointerleave','pointerout'].forEach(ev=>{
  pad.addEventListener(ev,e=>{
    if(e.pointerId!==pid) return; e.preventDefault();
    if(stroke.length>1){ 
      // ако е дълга сравнително права линия => „зачертаване“
      if(isStrike(stroke)){ handleStrike(stroke); }
      else { history.push(stroke); }
    }
    stroke=[]; drawing=false; pid=null; draw();
  });
});
['touchstart','touchmove','wheel','gesturestart','gesturechange'].forEach(ev=> pad.addEventListener(ev,e=>e.preventDefault(),{passive:false}));
window.addEventListener('resize',resize); setTimeout(resize,0);

/* ===== бутони ===== */
$('#btnUndo').onclick=()=>{ history.pop(); draw(); };
$('#btnClear').onclick=()=>{ history=[]; draw(); };
$('#btnSearchToggle').onclick=()=> document.body.classList.toggle('search-open');

/* ===== OCR (български, чрез Tesseract.js) ===== */
let tessReady=false, tessWorker=null;
async function ensureTesseract(){
  if(tessReady) return;
  tessWorker = await Tesseract.createWorker({
    logger: m => { /* console.log(m.status, m.progress) */ }
  });
  await tessWorker.loadLanguage('bul'); // български език
  await tessWorker.initialize('bul');
  tessReady=true;
}

/* извличане на име и сума от OCR текста */
function parseNameAndAmount(text){
  // взимаме първия приличен ред за „име“ (има букви, поне 2 знака), и търсим число за сума
  const lines = text.split(/\n+/).map(s=>s.trim()).filter(Boolean);
  let name = lines.find(s=>/[А-ЯA-ZЁЇІЄ][а-яa-zёїіє]{1,}/.test(s)) || '';
  // чистим странни символи
  name = name.replace(/[^0-9А-Яа-яA-Za-zЁёЇїІіЄє .,-]/g,'').trim();

  // търси число с , или .
  const m = text.match(/(\d+(?:[.,]\d+)?)/);
  const amount = m ? Number(m[1].replace(',','.')) : NaN;

  return { name, amount: Number.isFinite(amount)?amount:0 };
}

/* ===== Записване ===== */
$('#btnSave').onclick = async ()=>{
  try{
    if(history.length===0) return toast('Няма написано съдържание.');
    // снимка на листа
    const dataURL = pad.toDataURL('image/png');

    // OCR
    await ensureTesseract();
    const { data } = await tessWorker.recognize(dataURL);
    const { name, amount } = parseNameAndAmount(data.text||'');

    if(!name){ toast('Не успях да разчета име. Можеш да допишеш по-ясно и пак „Запази“.'); }

    const rec = {
      rid: crypto.randomUUID?.() || String(Date.now()),
      ts: Date.now(),
      name: name || '(неразчетено)',
      nameLower: (name||'(неразчетено)').toLowerCase(),
      amount: Number(amount)||0,
      imageData: dataURL
    };
    db.add(rec);
    lastName.set(rec.name);

    // чистим листа
    history=[]; draw();
    toast(`Записано: ${rec.name} • ${fmt(rec.amount)} лв`);
    // обнови панела ако е отворен
    if(document.body.classList.contains('search-open')) renderNames();
  }catch(err){
    console.error(err);
    toast('Грешка при запис.');
  }
};

/* ===== Зачертаване: права линия върху име => изтриване ===== */
/* 1) откриване на права дълга линия */
function isStrike(s){
  if(s.length<8) return false;
  // линеарна регресия за наклон и остатъци
  const xs=s.map(p=>p.x), ys=s.map(p=>p.y);
  const n=s.length, sumX=xs.reduce((a,b)=>a+b), sumY=ys.reduce((a,b)=>a+b);
  const sumXY=s.reduce((a,p)=>a+p.x*p.y,0), sumXX=xs.reduce((a,b)=>a+b*b,0);
  const denom = n
