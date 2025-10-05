/* ========== Помощни ========== */
const $ = (s,p=document)=>p.querySelector(s);
const $$ = (s,p=document)=>[...p.querySelectorAll(s)];
const msgBox = $('#msg');
function showMsg(t, ms=2200){ msgBox.textContent=t; msgBox.classList.remove('hidden'); clearTimeout(showMsg.t); showMsg.t=setTimeout(()=>msgBox.classList.add('hidden'), ms); }
const DB_KEY='veresia-local-v2';
const LAST_NAME_KEY='veresia:lastName';
const getLastName = ()=> localStorage.getItem(LAST_NAME_KEY)||'';
const setLastName = v=> localStorage.setItem(LAST_NAME_KEY,(v||'').trim());
const fmt = (n)=> (Number(n)||0).toFixed(2);

/* ========== Локални данни ========== */
async function dbAll(){ return JSON.parse(localStorage.getItem(DB_KEY)||'[]'); }
async function dbWrite(arr){ localStorage.setItem(DB_KEY, JSON.stringify(arr)); }
async function dbAdd(rec){ const a=await dbAll(); a.push(rec); await dbWrite(a); }
async function dbDelete(rid){ const a=await dbAll(); await dbWrite(a.filter(x=>x.rid!==rid)); }
async function dbByName(name){
  const n=(name||'').trim().toLowerCase(); if(!n) return [];
  const a=await dbAll(); return a.filter(x=> (x.nameLower||'')===n).sort((A,B)=>B.ts-A.ts);
}
function uuid(){ return (crypto.randomUUID?.() || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0,v=c==='x'?r:(r&0x3|0x8);return v.toString(16);})); }

/* ========== Платно ========== */
const canvas = $('#pad');
let ctx, dpr=1, drawing=false, pid=null, stroke=[], history=[];
function resize(){
  const r = canvas.getBoundingClientRect();
  dpr = Math.max(1, window.devicePixelRatio||1);
  canvas.width = Math.round(r.width*dpr);
  canvas.height= Math.round(r.height*dpr);
  ctx = canvas.getContext('2d');
  ctx.lineCap='round'; ctx.lineJoin='round'; ctx.strokeStyle='#f1f5ff';
  draw();
}
function draw(){
  const g=ctx; g.clearRect(0,0,canvas.width,canvas.height);
  for(const s of history) drawStroke(g,s);
  if(stroke.length>1) drawStroke(g,stroke);
}
function drawStroke(g,s){
  g.beginPath();
  let lastW = 2*dpr;
  g.moveTo(s[0].x*dpr,s[0].y*dpr);
  for(let i=1;i<s.length;i++){
    const a=s[i-1], b=s[i];
    const midX=(a.x+b.x)/2*dpr, midY=(a.y+b.y)/2*dpr;
    const w = 1.6*dpr + 2.4*(b.p||0.4)*dpr;
    g.lineWidth = lastW = lastW*0.7 + w*0.3;
    g.quadraticCurveTo(a.x*dpr,a.y*dpr, midX,midY);
  }
  g.stroke();
}
function press(e){ return (e.pressure==null||e.pressure===0) ? 0.35 : Math.max(0.1,Math.min(1,e.pressure)); }
function okPointer(e){ return e.pointerType==='pen' || e.pointerType==='touch'; }

canvas.addEventListener('pointerdown', e=>{
  if(!okPointer(e)) return;
  e.preventDefault(); canvas.setPointerCapture(e.pointerId);
  drawing=true; pid=e.pointerId; stroke=[{x:e.offsetX,y:e.offsetY,p:press(e)}];
});
canvas.addEventListener('pointermove', e=>{
  if(!drawing || e.pointerId!==pid) return;
  e.preventDefault();
  const pt={x:e.offsetX,y:e.offsetY,p:press(e)};
  const last=stroke[stroke.length-1];
  if(Math.hypot(pt.x-last.x,pt.y-last.y)<0.5) return;
  stroke.push(pt); draw();
});
['pointerup','pointercancel','pointerleave','pointerout'].forEach(ev=>{
  canvas.addEventListener(ev, e=>{
    if(e.pointerId!==pid) return;
    e.preventDefault();
    if(stroke.length>1) history.push(stroke);
    stroke=[]; drawing=false; pid=null; draw();
  });
});
['touchstart','touchmove','wheel','gesturestart','gesturechange'].forEach(ev=>{
  canvas.addEventListener(ev, e=> e.preventDefault(), {passive:false});
});
window.addEventListener('resize', resize); setTimeout(resize,0);

/* ========== Бутони върху платното ========== */
$('#btnUndo').onclick = ()=>{ history.pop(); draw(); };
$('#btnClear').onclick = ()=>{ history=[]; draw(); };

/* ========== Bottom sheet Запис ========== */
const sheetSave = $('#sheetSave');
const inpName = $('#inpName'); const inpAmount = $('#inpAmount');
function openSave(){
  sheetSave.classList.remove('hidden');
  // попълни „последно име“
  const ln=getLastName(); if(ln && !inpName.value) inpName.value=ln;
  setTimeout(()=> inpName.focus(), 50);
}
function closeSave(){ sheetSave.classList.add('hidden'); }
$('#btnSaveOpen').onclick = openSave;
$('#sheetSaveClose').onclick = closeSave;

$('#btnSave').onclick = async ()=>{
  try{
    const name = (inpName.value||'').trim();
    if(!name){ inpName.focus(); return showMsg('Въведи име.'); }
    const amount = Number(String(inpAmount.value||'').replace(',','.'));
    if(!Number.isFinite(amount)){ inpAmount.focus(); return showMsg('Невалидна сума.'); }
    if(history.length===0) return showMsg('Няма написано съдържание.');

    const dataURL = canvas.toDataURL('image/png');
    const rec = {
      rid: uuid(),
      name, nameLower: name.toLowerCase(),
      amount: Number(amount),
      ts: Date.now(),
      imageData: dataURL
    };
    await dbAdd(rec);
    setLastName(name);
    history=[]; draw();
    inpAmount.value=''; showMsg('Записано.'); closeSave();
  }catch(err){ console.error(err); showMsg('Грешка при запис.'); }
};

/* ========== Изглед Търсене/Преглед ========== */
const viewSearch = $('#viewSearch');
const btnSearchOpen = $('#btnSearchOpen');
const btnSearchClose = $('#btnSearchClose');
const inpSearch = $('#inpSearch');
const namesList = $('#namesList');
const recordsList = $('#recordsList');
const namesSection = $('#namesSection');
const recordsSection= $('#recordsSection');
const selectedNameEl = $('#selectedName');
const selectedTotalEl = $('#selectedTotal');

btnSearchOpen.onclick = async ()=>{
  await renderNames();
  viewSearch.classList.remove('hidden');
  inpSearch.value = getLastName(); // подсказка
  setTimeout(()=> inpSearch.focus(), 60);
};
btnSearchClose.onclick = ()=> viewSearch.classList.add('hidden');
$('#btnBackToNames').onclick = ()=>{ recordsSection.classList.add('hidden'); namesSection.classList.remove('hidden'); };

inpSearch.addEventListener('input', ()=> renderNames());

async function renderNames(){
  const q = (inpSearch.value||'').trim().toLowerCase();
  const all = await dbAll();
  const groups = new Map();
  for(const r of all){
    const key = r.name||'';
    if(q && !key.toLowerCase().includes(q)) continue;
    const g = groups.get(key)||{name:key,total:0,count:0};
    g.total += Number(r.amount)||0; g.count++; groups.set(key,g);
  }
  namesList.innerHTML='';
  const arr = [...groups.values()].sort((A,B)=>A.name.localeCompare(B.name,'bg'));
  for(const g of arr){
    const item = document.createElement('div');
    item.className='item';
    item.innerHTML = `
      <div class="grow">
        <div class="title">${g.name}</div>
        <div class="muted">${g.count} запис(а)</div>
      </div>
      <div class="tag">${fmt(g.total)} лв</div>
    `;
    item.onclick = ()=> openRecords(g.name);
    namesList.appendChild(item);
  }
  namesSection.classList.remove('hidden');
  recordsSection.classList.add('hidden');
}

async function openRecords(name){
  setLastName(name);
  selectedNameEl.textContent = name;
  const list = await dbByName(name);
  let sum=0;
  recordsList.innerHTML='';
  for(const r of list){
    sum += Number(r.amount)||0;
    const item = document.createElement('div');
    item.className='item';
    item.innerHTML = `
      <img src="${r.imageData}" alt="" style="width:64px;height:38px;object-fit:cover;border-radius:8px;border:1px solid var(--border)"/>
      <div class="grow">
        <div class="muted">${new Date(r.ts).toLocaleString()}</div>
        <div class="title">${fmt(r.amount)} лв</div>
      </div>
      <button class="icon del" title="Изтрий" data-rid="${r.rid}">🗑</button>
    `;
    item.querySelector('.del').onclick = async (e)=>{
      e.stopPropagation();
      await dbDelete(r.rid);
      openRecords(name);
      showMsg('Изтрито.');
    };
    recordsList.appendChild(item);
  }
  selectedTotalEl.textContent = `${fmt(sum)} лв`;
  namesSection.classList.add('hidden');
  recordsSection.classList.remove('hidden');
}

$('#btnExport').onclick = async ()=>{
  const data = await dbAll();
  const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download=`veresia-backup-${Date.now()}.json`; a.click(); URL.revokeObjectURL(a.href);
  showMsg('Експортът започна.');
};

/* Инициализация: сложи последно име в полето за запазване, когато отвориш шийта */
document.addEventListener('keydown', (e)=>{
  if(e.key==='Escape'){
    if(!sheetSave.classList.contains('hidden')) closeSave();
    else if(!viewSearch.classList.contains('hidden')) viewSearch.classList.add('hidden');
  }
});
