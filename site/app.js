"use strict";
// Static GitHub-Pages front-end for hockey-analysis/out/ (see publish-hockey-analysis.md §7).
// Everything is client-side: fetch games.json -> game.json -> events.csv / heatmap data,
// then filter by period / team / player / event on the same `sel`.

const $ = s => document.querySelector(s);
const DATA = "data";
let GAME = null, EVENTS = [], POINTS = null;   // POINTS lazy-loaded from *_points.csv
const sel = { game:null, period:"all", team:"", player:"", types:new Set() };

// ---------- tiny CSV ----------
function csv(text){
  const [h,...rows] = text.trim().split(/\r?\n/);
  const cols = h.split(",");
  return rows.map(r=>{ const v=splitCsv(r); return Object.fromEntries(cols.map((c,i)=>[c,v[i]??""])); });
}
function splitCsv(line){
  const out=[]; let cur="", q=false;
  for (const ch of line){
    if (q){ if (ch==='"') q=false; else cur+=ch; }
    else if (ch===','){ out.push(cur); cur=""; }
    else if (ch==='"') q=true;
    else cur+=ch;
  }
  out.push(cur); return out;
}
const parseAssists = c => { try{ return (c.match(/'([^']+)'|"([^"]+)"/g)||[]).map(s=>s.slice(1,-1)); }catch{ return []; } };
const periodOfSeconds = (t,ps)=> (ps.find(p=> t>=p.vid_start && t<p.vid_end)||{}).period ?? null;
const assetSeconds = n => { const m=n.match(/(\d{3,6})/); return m? +m[1] : null; };

// ---------- URL state ----------
function readUrl(){
  const q=new URLSearchParams(location.search);
  sel.game=q.get("game"); sel.period=q.get("period")||"all";
  sel.team=q.get("team")||""; sel.player=q.get("player")||"";
}
function writeUrl(){
  const q=new URLSearchParams();
  if (sel.game) q.set("game",sel.game);
  if (sel.period!=="all") q.set("period",sel.period);
  if (sel.team) q.set("team",sel.team);
  if (sel.player) q.set("player",sel.player);
  history.replaceState(null,"",location.pathname+(q.toString()?"?"+q:""));
}

// ---------- boot ----------
(async function(){
  readUrl();
  const idx = await (await fetch(`${DATA}/games.json`)).json();
  const g=$("#game");
  idx.games.forEach(x=>{ const o=document.createElement("option"); o.value=x.dir; o.textContent=x.label; g.append(o); });
  g.value = sel.game && idx.games.some(x=>x.dir===sel.game) ? sel.game : idx.games[0].dir;
  g.onchange = ()=>{ sel.game=g.value; sel.player=""; POINTS=null; loadGame(); };
  await loadGame();
})();

async function loadGame(){
  sel.game = $("#game").value;
  GAME  = await (await fetch(`${DATA}/${sel.game}/game.json`)).json();
  EVENTS = csv(await (await fetch(`${DATA}/${sel.game}/events.csv`)).text());
  $("#score").textContent = GAME.score ? `${GAME.away} ${GAME.score} ${GAME.home}` : "";
  buildControls();
  render();
}

function buildControls(){
  // period
  const p=$("#period"); p.innerHTML=`<option value="all">All periods</option>`;
  GAME.periods.forEach(x=> p.add(new Option(
    `P${x.period} · ${x.dur_min} min · ${(x.wall_start||"").slice(0,5)}–${(x.wall_end||"").slice(0,5)}`, x.period)));
  p.value = sel.period; p.onchange=()=>{ sel.period=p.value; render(); };
  // team
  const t=$("#team"); t.innerHTML=`<option value="">Both teams</option>`;
  (GAME.filters.teams||[]).forEach(x=> t.add(new Option(x,x)));
  t.value=sel.team; t.onchange=()=>{ sel.team=t.value; render(); };
  // player
  const pl=$("#player"); pl.innerHTML=`<option value="">All players</option>`;
  const byTeam={}; (GAME.players||[]).forEach(x=> (byTeam[x.team] ||= []).push(x));
  Object.entries(byTeam).forEach(([team,list])=>{
    const og=document.createElement("optgroup"); og.label=team;
    list.sort((a,b)=>(+a.number||99)-(+b.number||99)).forEach(x=>{
      const o=new Option(`#${x.number} ${x.name}${x.pos?" "+x.pos:""}${x.hasEvents?"":" · no events"}`, x.name);
      og.append(o);
    });
    pl.append(og);
  });
  pl.value=sel.player; pl.onchange=()=>{ sel.player=pl.value; render(); };
  // event types
  const box=$("#types"); box.innerHTML="<legend>Events</legend>";
  sel.types = new Set(GAME.filters.eventTypes);
  GAME.filters.eventTypes.forEach(ty=>{
    const l=document.createElement("label");
    l.innerHTML=`<input type=checkbox checked value="${ty}"> ${ty}`;
    l.querySelector("input").onchange=e=>{ e.target.checked?sel.types.add(ty):sel.types.delete(ty); render(); };
    box.append(l);
  });
}

// ---------- filter predicates (publish doc §7) ----------
function eventVisible(r){
  if (sel.period!=="all" && r.period!==String(sel.period)) return false;
  if (sel.team && r.team!==sel.team) return false;
  if (sel.player && !(r.player===sel.player || r.scorer===sel.player || parseAssists(r.assists).includes(sel.player))) return false;
  if (!sel.types.has(r.type)) return false;
  return true;
}

// ---------- render ----------
async function render(){
  writeUrl();
  renderEvents();
  renderUnits();
  await renderHeatmap();
}

function renderEvents(){
  const rows = EVENTS.filter(eventVisible);
  $("#evcount").textContent = `(${rows.length}/${EVENTS.length})`;
  $("#events tbody").innerHTML = rows.map(r=>{
    const detail = r.type==="goal"
      ? `${r.score} ${r.scorer}${parseAssists(r.assists).length? " ("+parseAssists(r.assists).join(", ")+")":""}`
      : `${r.player} — ${r.infraction||""} ${r.minutes?r.minutes+"′":""}`;
    return `<tr class="${r.type}"><td>${r.period}</td><td>${r.game_clock}</td>
      <td>${r.team}</td><td>${r.type}</td><td>${detail}</td><td>${r.state||""}</td></tr>`;
  }).join("") || `<tr><td colspan=6>no events match</td></tr>`;
}

function renderUnits(){
  const u = (GAME.assets.lines||[]).find(a=>a.path.endsWith("units.json"));
  if (!u){ $("#units").innerHTML=""; return; }
  fetch(`${DATA}/${sel.game}/${u.path}`).then(r=>r.json()).then(j=>{
    $("#units").innerHTML = Object.entries(j).filter(([tm])=>!sel.team||tm===sel.team).map(([tm,r])=>
      `<b>${tm} lines (recovered):</b> ` +
      r.forward_units.map(f=>`${f.members.join("-")}${f.paper_unit?` [${f.paper_unit} ${f.match}]`:""}`).join(" &nbsp; ")
    ).join("<br>");
  });
}

// heatmap: prefer the pre-baked grid for the current team; if a single player is
// selected and a *_points.csv exists, bin that live.
async function renderHeatmap(){
  const hm = GAME.assets.heatmaps || [];
  const teamKey = sel.team ? sel.team.toLowerCase() : "all";
  const grid = hm.find(a=>a.path.endsWith(`_${teamKey}.grid.json`)) || hm.find(a=>a.path.endsWith("_all.grid.json"));
  const ptsAsset = hm.find(a=>a.path.endsWith("_points.csv"));
  let G, note;

  if (sel.player && ptsAsset){
    if (!POINTS) POINTS = csv(await (await fetch(`${DATA}/${sel.game}/${ptsAsset.path}`)).text());
    G = binPoints(POINTS);
    note = `${sel.player} · ${G.n} samples (binned from points.csv)`;
  } else if (grid){
    const j = await (await fetch(`${DATA}/${sel.game}/${grid.path}`)).json();
    G = { nx:j.nx, ny:j.ny, max:j.max, data:j.grid, n:j.n };
    note = `${grid.path.split("/").pop()} · ${j.n} samples`;
  } else { $("#hmnote").textContent="(no heatmap data)"; clearRink(); return; }

  $("#hmnote").textContent = "— " + note;
  paint(G);
}

function binPoints(rows, cell=0.5, nx=120, ny=60){
  const data=new Float32Array(nx*ny); let n=0;
  for (const r of rows){
    if (sel.period!=="all" && String(r.period)!==String(sel.period)) continue;
    if (sel.team && r.team!==sel.team) continue;
    if (sel.player && r.name!==sel.player) continue;
    const rx=+r.rx, ry=+r.ry;
    if (!(rx>=0&&rx<60&&ry>=0&&ry<30)) continue;
    data[((ry/30*ny)|0)*nx + ((rx/60*nx)|0)] += cell; n++;
  }
  blur(data,nx,ny,2);
  return { nx, ny, max:Math.max(...data)||1, data, n };
}
function blur(a,nx,ny,r){
  const t=a.slice();
  for (let y=0;y<ny;y++) for (let x=0;x<nx;x++){
    let s=0,c=0;
    for (let dy=-r;dy<=r;dy++) for (let dx=-r;dx<=r;dx++){
      const yy=y+dy, xx=x+dx;
      if (yy<0||yy>=ny||xx<0||xx>=nx) continue;
      s+=t[yy*nx+xx]; c++;
    }
    a[y*nx+x]=s/c;
  }
}

function inferno(v){ // compact inferno-ish ramp
  v=Math.max(0,Math.min(1,v));
  const stops=[[0,0,4],[40,11,84],[101,21,110],[159,42,99],[212,72,66],[245,125,21],[250,193,39],[252,255,164]];
  const f=v*(stops.length-1), i=Math.floor(f), t=f-i, a=stops[i], b=stops[Math.min(i+1,stops.length-1)];
  return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t];
}

function paint(G){
  const cv=$("#rink"), ctx=cv.getContext("2d"), W=cv.width, H=cv.height;
  const img=ctx.createImageData(W,H);
  for (let py=0;py<H;py++) for (let px=0;px<W;px++){
    const gx=Math.min(G.nx-1,(px/W*G.nx)|0), gy=Math.min(G.ny-1,((1-py/H)*G.ny)|0);
    const v=G.data[gy*G.nx+gx]/G.max, [r,g,b]=inferno(v), o=(py*W+px)*4;
    img.data[o]=r; img.data[o+1]=g; img.data[o+2]=b; img.data[o+3]=Math.min(235, 30+v*225);
  }
  ctx.putImageData(img,0,0);
  strokeRink(ctx,W,H);
}
function clearRink(){ const c=$("#rink"),x=c.getContext("2d"); x.fillStyle="#0b0b12"; x.fillRect(0,0,c.width,c.height); strokeRink(x,c.width,c.height); }
function strokeRink(ctx,W,H){
  const X=m=>m/60*W, Y=m=>H-m/30*H;
  ctx.strokeStyle="rgba(255,255,255,.5)"; ctx.lineWidth=1;
  ctx.strokeRect(X(0)+1,Y(30)+1,W-2,H-2);
  ctx.strokeStyle="rgba(120,170,255,.8)";
  [22.5,37.5].forEach(x=>{ ctx.beginPath(); ctx.moveTo(X(x),Y(0)); ctx.lineTo(X(x),Y(30)); ctx.stroke(); });
  ctx.strokeStyle="rgba(255,90,90,.8)";
  [4,30,56].forEach(x=>{ ctx.beginPath(); ctx.moveTo(X(x),Y(0)); ctx.lineTo(X(x),Y(30)); ctx.stroke(); });
  ctx.beginPath(); ctx.arc(X(30),Y(15),4.5/30*H,0,7); ctx.stroke();
  [[10,7],[10,23],[50,7],[50,23]].forEach(([x,y])=>{ ctx.beginPath(); ctx.arc(X(x),Y(y),4.5/30*H,0,7); ctx.stroke(); });
}

// footer
window.addEventListener("load",()=>{ setTimeout(()=>{ $("#meta").textContent =
  GAME ? `${GAME.id} · ${GAME.competition||""} · ${GAME.date||""} · homography: kp_v2 · ${GAME.hasTrackIdentity?"track identity available":"no track identity"}` : ""; },300); });
