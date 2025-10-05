(() => {
  const $ = s => document.querySelector(s);
  const pad = $("#pad");
  const ctx = pad.getContext("2d", { willReadFrequently:true });

  const PEN_COLOR = "#ffffff";
  const PEN_WIDTH = 3.2;
  const penOnly = $("#penOnly");

  let drawing = false;
  let path = [];
  let undo = [];

  function fitCanvas(){
    const r = pad.getBoundingClientRect();
    pad.width = Math.floor(r.width * devicePixelRatio);
    pad.height = Math.floor(r.height * devicePixelRatio);
    ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
    clearCanvas(); // начертай празен лист с линии от фона (фонът е в CSS)
  }
  function clearCanvas(){
    ctx.clearRect(0,0,pad.width,pad.height);
  }
  window.addEventListener("resize", fitCanvas);

  function begin(x,y){
    drawing = true; path = [{x,y}];
    ctx.lineJoin="round"; ctx.lineCap="round";
    ctx.strokeStyle=PEN_COLOR; ctx.lineWidth=PEN_WIDTH;
    ctx.beginPath(); ctx.moveTo(x,y);
  }
  function move(x,y){
    if(!drawing) return;
    ctx.lineTo(x,y); ctx.stroke();
    path.push({x,y});
  }
  function end(){
    if(!drawing) return;
    drawing=false; ctx.closePath();
    // snapshot за undo
    undo.push(pad.toDataURL("image/png"));
    if (undo.length>25) undo.shift();
  }

  function client(ev){
    if (ev.touches && ev.touches[0]) return {x:ev.touches[0].clientX,y:ev.touches[0].clientY};
    return {x:ev.clientX,y:ev.clientY};
  }
  function toCanvas(x,y){
    const r = pad.getBoundingClientRect();
    return {x:x-r.left,y:y-r.top};
  }
  function allow(ev){
    if (penOnly.checked && ev.pointerType && ev.pointerType!=="pen") return false;
    return true;
  }

  // предотвратява скрола при рисуване
  ["touchstart","touchmove"].forEach(t=>{
    pad.addEventListener(t, e=>e.preventDefault(), {passive:false});
  });

  pad.addEventListener("pointerdown", (ev)=>{
    if(!allow(ev)) return;
    ev.preventDefault();
    pad.setPointerCapture(ev.pointerId);
    const p = toCanvas(ev.clientX, ev.clientY);
    begin(p.x,p.y);
  });
  pad.addEventListener("pointermove", (ev)=>{
    if(!allow(ev) || !drawing) return;
    ev.preventDefault();
    const p = toCanvas(ev.clientX, ev.clientY);
    move(p.x,p.y);
  });
  const finish = (ev)=>{ if(drawing){ ev.preventDefault(); end(); } };
  pad.addEventListener("pointerup", finish);
  pad.addEventListener("pointercancel", finish);
  pad.addEventListener("pointerleave", finish);

  /* ---------- UI ---------- */
  $("#btn-new").onclick = () => { undo=[]; clearCanvas(); toast("Нова страница"); };
  $("#btn-clear").onclick = () => { undo=[]; clearCanvas(); };
  $("#btn-undo").onclick = () => {
    const last = undo.pop(); if (!last) return;
    const img = new Image(); img.onload = () => {
      ctx.clearRect(0,0,pad.width,pad.height);
      ctx.drawImage(img, 0,0, pad.width/devicePixelRatio, pad.height/devicePixelRatio);
    }; img.src = last;
  };

  $("#btn-save").onclick = async () => {
    // 1) сваляне на PNG
    const png = pad.toDataURL("image/png");
    const fileName = `veresia-${new Date().toISOString().replace(/[:.]/g,"-")}.png`;
    downloadDataURL(png, fileName);

    // 2) ръчно въвеждане (както беше при първата сайт-версия)
    const name = prompt("Въведи име:");
    if (!name){ toast("Не е въведено име."); return; }
    const amountStr = prompt("Сума (лв):", "0");
    const amount = parseFloat((amountStr||"").replace(",","."));
    if (Number.isNaN(amount)){ toast("Невалидна сума."); return; }

    const rec = { id: `e_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
                  name: name.trim(), amount: +(amount.toFixed(2)),
                  file: fileName, ts: Date.now() };
    const all = loadDB(); all.push(rec); saveDB(all);
    toast(`Записано: ${rec.name} — ${rec.amount.toFixed(2)} лв.`);
  };

  // Drawer
  const drawer = $("#drawer");
  $("#btn-search").onclick = ()=>{ drawer.classList.add("open"); drawer.setAttribute("aria-hidden","false"); renderResults(); };
  $("#drawer-close").onclick = ()=>{ drawer.classList.remove("open"); drawer.setAttribute("aria-hidden","true"); };
  $("#q-run").onclick = renderResults;

  function renderResults(){
    const q = ($("#q-name").value||"").trim().toLowerCase();
    const list = loadDB().filter(r => !q || (r.name||"").toLowerCase().includes(q));
    const host = $("#results");
    if (!list.length){ host.innerHTML = `<div class="result">Няма резултати.</div>`; return; }
    const sum = list.reduce((a,b)=>a+(Number(b.amount)||0),0);
    host.innerHTML = list.map(r=>`
      <div class="result">
        <h4>${escapeHtml(r.name)}</h4>
        <div class="sum">Сума: <strong>${(Number(r.amount)||0).toFixed(2)} лв.</strong></div>
        <div class="meta">Файл: ${escapeHtml(r.file||"-")} • ${new Date(r.ts).toLocaleString()}</div>
        <div style="margin-top:6px;display:flex;gap:8px">
          <button class="btn small" data-del="${r.id}">Изтрий</button>
        </div>
      </div>
    `).join("") + `
      <div class="result"><h4>Общо</h4><div class="sum"><strong>${sum.toFixed(2)} лв.</strong></div></div>
    `;
    host.querySelectorAll("[data-del]").forEach(b=>{
      b.onclick = () => {
        const id = b.getAttribute("data-del");
        const all = loadDB().filter(x=>x.id!==id); saveDB(all);
        renderResults(); toast("Изтрито.");
      };
    });
  }

  /* ---------- База (localStorage) ---------- */
  const KEY = "veresia_entries_v1";
  function loadDB(){ try{ return JSON.parse(localStorage.getItem(KEY)||"[]"); }catch{ return []; } }
  function saveDB(arr){ localStorage.setItem(KEY, JSON.stringify(arr)); }

  /* ---------- Помощни ---------- */
  function toast(msg){
    const host = $("#toast");
    host.innerHTML = `<div class="msg">${msg}</div>`;
    setTimeout(()=>host.innerHTML="",1500);
  }
  function downloadDataURL(dataURL, filename){
    const a = document.createElement("a");
    a.href = dataURL; a.download = filename; document.body.appendChild(a);
    a.click(); a.remove();
  }
  function escapeHtml(s){ return (s||"").replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  // Старт
  window.addEventListener("load", fitCanvas);
})();
