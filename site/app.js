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
  buildRinkLines();
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

// heatmap source, in priority order:
//   single player   -> bin *_points.csv live (period/team/name filtered)
//   a period picked  -> pre-baked p<N>_full_<team>.grid.json, else bin points.csv
//   otherwise        -> pre-baked whole-game grid for the team (game_<team>.grid.json)
async function renderHeatmap(){
  const hm = GAME.assets.heatmaps || [];
  const teamKey = sel.team ? sel.team.toLowerCase() : "all";
  const ptsAsset   = hm.find(a=>a.path.endsWith("_points.csv"));
  const periodGrid = sel.period!=="all" &&
    hm.find(a=>a.path.endsWith(`p${sel.period}_full_${teamKey}.grid.json`));
  const wholeGrid  = hm.find(a=>a.path.endsWith(`_${teamKey}.grid.json`)) ||
                     hm.find(a=>a.path.endsWith("_all.grid.json"));
  const loadJson = p => fetch(`${DATA}/${sel.game}/${p}`).then(r=>r.json());
  const loadPoints = async () => { if (!POINTS) POINTS = csv(await (await fetch(`${DATA}/${sel.game}/${ptsAsset.path}`)).text()); };
  let G, note;

  if (sel.player){
    if (!ptsAsset){ $("#hmnote").textContent=" — no point cloud in this export"; clearRink(); return; }
    await loadPoints();
    G = binPoints(POINTS);
    note = G.n ? `${sel.player} · ${G.n} samples (points.csv)`
               : `${sel.player} — no per-player points (jersey identity not run on the full-game export)`;
  } else if (periodGrid){
    const j = await loadJson(periodGrid.path);
    G = { nx:j.nx, ny:j.ny, max:j.max, data:j.grid, n:j.n };
    note = `${periodGrid.path.split("/").pop()} · ${j.n} samples`;
  } else if (sel.period!=="all" && ptsAsset){
    await loadPoints();
    G = binPoints(POINTS);
    note = `P${sel.period}${sel.team?" · "+sel.team:""} · ${G.n} samples (points.csv)`;
  } else if (wholeGrid){
    const j = await loadJson(wholeGrid.path);
    G = { nx:j.nx, ny:j.ny, max:j.max, data:j.grid, n:j.n };
    note = `${wholeGrid.path.split("/").pop()} · ${j.n} samples`;
  } else { $("#hmnote").textContent=" — no heatmap data"; clearRink(); return; }

  $("#hmnote").textContent = " — " + note;
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

// ---------- SVG contour heatmap ----------
// Rink coords are metres (rx 0..60, ry 0..30, ry up); the <g> groups carry
// transform="translate(0 30) scale(1 -1)" so a path drawn in metres lands right.
const LEVELS = [0.06, 0.12, 0.20, 0.30, 0.43, 0.58, 0.75, 0.92];

function buildRinkLines(){
  const g=$("#lines"); if (!g) return;
  const el=[];
  el.push(`<rect class="board" x="0" y="0" width="60" height="30" rx="2"/>`);
  [22.5,37.5].forEach(x=> el.push(`<line class="blue" x1="${x}" y1="0" x2="${x}" y2="30"/>`));
  [4,30,56].forEach(x=> el.push(`<line class="red" x1="${x}" y1="0" x2="${x}" y2="30"/>`));
  el.push(`<circle class="blue" cx="30" cy="15" r="4.5"/>`);
  [[10,7],[10,23],[50,7],[50,23]].forEach(([x,y])=> el.push(`<circle class="red" cx="${x}" cy="${y}" r="4.5"/>`));
  [[30,15],[10,7],[10,23],[50,7],[50,23]].forEach(([x,y])=> el.push(`<circle class="dot" cx="${x}" cy="${y}" r="0.3"/>`));
  g.innerHTML=el.join("");
}

// one <path d> (multiple M..Z subpaths) tracing data==level, via marching squares
function contourPath(data, nx, ny, level){
  const w=nx+2, h=ny+2, f=new Float64Array(w*h);          // zero-pad -> closed loops
  for (let y=0;y<ny;y++) for (let x=0;x<nx;x++) f[(y+1)*w+(x+1)] = data[y*nx+x];
  const X = px => (px-0.5)/nx*60, Y = py => (py-0.5)/ny*30;
  const t = (a,b)=>{ const d=b-a; return Math.max(0,Math.min(1, Math.abs(d)<1e-9 ? 0.5 : (level-a)/d)); };
  const key = (x,y)=> Math.round(x*1000)+"_"+Math.round(y*1000);
  const segs=[], inc=new Map();
  const add=(p,q)=>{ const s={a:p,b:q,u:false}; segs.push(s);
    for (const e of [p,q]){ const k=key(e[0],e[1]); (inc.get(k)||inc.set(k,[]).get(k)).push(s); } };

  for (let y=0;y<h-1;y++) for (let x=0;x<w-1;x++){
    const TL=f[y*w+x], TR=f[y*w+x+1], BR=f[(y+1)*w+x+1], BL=f[(y+1)*w+x];
    const ci=(TL>level?1:0)|(TR>level?2:0)|(BR>level?4:0)|(BL>level?8:0);
    if (ci===0 || ci===15) continue;
    const top    = [X(x + t(TL,TR)), Y(y)];
    const right  = [X(x+1),          Y(y + t(TR,BR))];
    const bottom = [X(x + t(BL,BR)), Y(y+1)];
    const left   = [X(x),            Y(y + t(TL,BL))];
    switch (ci){
      case 1: case 14: add(left, top); break;
      case 2: case 13: add(top, right); break;
      case 3: case 12: add(left, right); break;
      case 4: case 11: add(right, bottom); break;
      case 6: case 9:  add(top, bottom); break;
      case 7: case 8:  add(left, bottom); break;
      case 5:  ((TL+TR+BR+BL)/4 > level) ? (add(left,top), add(right,bottom))
                                         : (add(left,bottom), add(top,right)); break;
      case 10: ((TL+TR+BR+BL)/4 > level) ? (add(left,bottom), add(top,right))
                                         : (add(left,top), add(right,bottom)); break;
    }
  }
  let d="";
  for (const s0 of segs){
    if (s0.u) continue;
    s0.u=true;
    const ring=[s0.a, s0.b];
    for (let guard=0; guard<segs.length; guard++){
      const tail=ring[ring.length-1], k=key(tail[0],tail[1]);
      const nb=(inc.get(k)||[]).find(s=>!s.u);
      if (!nb) break;
      nb.u=true;
      const nextPt = key(nb.a[0],nb.a[1])===k ? nb.b : nb.a;
      ring.push(nextPt);
      if (key(nextPt[0],nextPt[1])===key(ring[0][0],ring[0][1])) break;
    }
    if (ring.length>2)
      d += "M"+ring.map(p=>p[0].toFixed(2)+" "+p[1].toFixed(2)).join("L")+"Z";
  }
  return d;
}

function paint(G){
  const heat=$("#heat"); if (!heat) return;
  let svg="";
  for (const lv of LEVELS){
    const d=contourPath(G.data, G.nx, G.ny, lv*G.max);
    if (!d) continue;
    const [r,g,b]=inferno(lv);
    svg += `<path d="${d}" fill="rgb(${r|0},${g|0},${b|0})" fill-opacity="${(0.32+0.6*lv).toFixed(3)}"/>`;
  }
  heat.innerHTML = svg;
}
function clearRink(){ const h=$("#heat"); if (h) h.innerHTML=""; }

// footer
window.addEventListener("load",()=>{ setTimeout(()=>{ $("#meta").textContent =
  GAME ? `${GAME.id} · ${GAME.competition||""} · ${GAME.date||""} · homography: kp_v2 · ${GAME.hasTrackIdentity?"track identity available":"no track identity"}` : ""; },300); });
