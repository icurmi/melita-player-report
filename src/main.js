/* Melita FC Player Report: shared UI for the prototype (demo store) and the live app (Supabase store). */
(async function(){
const S = window.STORE;
const $ = (s,el=document)=>el.querySelector(s);
const esc = s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

const LEVELS = {10:"Outstanding",9:"Excellent",8:"Very good",7:"Good",6:"Above average",5:"Average",4:"Below average",3:"Weak",2:"Very weak",1:"Extremely weak"};
const SHORT = {"Tactical – In Possession":"In possession","Tactical – Out of Possession":"Out of possession"};
const SECTIONS = [
  {id:"physical",    label:"Physical",    pillars:["Physical"]},
  {id:"technical",   label:"Technical",   pillars:["Technical"]},
  {id:"tactical",    label:"Tactical",    pillars:["Tactical – In Possession","Tactical – Out of Possession"]},
  {id:"psychology",  label:"Psychology",  pillars:["Psychological"]},
  {id:"behavioural", label:"Behavioural", pillars:["Behavioural"]},
];
const TOP_SHARE = 0.25;          // warn when more than this share of a squad sits in 7–9
const UI_KEY = "melita-ui-v5";

let ATTRS = [], GROUPS = [], PILLARS = [];
let D = {players:[], ratings:{}, comments:{}, submission:null, sample:false};   // data for the current group
let auth = {signedIn:false};
let st = Object.assign({step:"details", group:"", cur:0, view:"rate", cp:0, rp:0, hcGroup:""}, (()=>{ try{ return JSON.parse(localStorage.getItem(UI_KEY))||{}; }catch(e){ return {}; } })());
let coach = {name:"", role:"", email:""};
let undoStack = [];
const saveUI = ()=>{ try{ localStorage.setItem(UI_KEY, JSON.stringify({step:st.step, group:st.group, cur:st.cur, view:st.view, cp:st.cp, rp:st.rp})); }catch(e){} };

const grp = ()=>GROUPS.find(g=>g.id===st.group);
const anchors = a=>a.a[grp()?.band] || a.a["All ages"] || Object.values(a.a)[0];
let MAINYEAR = 0;
function computeMainYear(){
  const c={}; D.players.forEach(p=>{ if(p.y) c[p.y]=(c[p.y]||0)+1; });
  const top = Object.entries(c).sort((x,y)=>y[1]-x[1])[0]; MAINYEAR = top ? +top[0] : 0;
}
const isLU = p=>!!(!grp()?.mixed && p.y && MAINYEAR && p.y > MAINYEAR);
const isLead = ()=>coach.role==="Lead";
const R = id=>(D.ratings[id] ||= {});
const placed = id=>D.players.filter(p=>p.id in (D.ratings[id]||{})).length;
const totalDone = ()=>ATTRS.filter(a=>placed(a.id)===D.players.length && D.players.length).length;
const num = (id,pid)=>{ const v=(D.ratings[id]||{})[pid]; return typeof v==="number"?v:null; };
const avg = arr=>{ const f=arr.filter(v=>v!=null); return f.length? f.reduce((a,b)=>a+b,0)/f.length : null; };
const fmt = v=> v==null ? "–" : (Math.round(v*10)/10).toFixed(1).replace(/\.0$/,"");
const first = p=>(p.full||"").split(" ")[0];

function toast(msg, kind=""){
  const t = $("#toast"); t.textContent = msg; t.className = "show "+kind;
  clearTimeout(toast.t); toast.t = setTimeout(()=>t.className="", 3200);
}
function persist(promise){ promise?.catch?.(err=>{ console.error(err); toast("Couldn't save: check your connection. Your last change may not be stored.", "bad"); }); }

/* ---------- checks used by the warning, review and head-coach screens ---------- */
function topCount(attrId){ return D.players.filter(p=>{ const v=num(attrId,p.id); return v!=null && v>=7; }).length; }
function topWarn(attrId){
  const n = topCount(attrId), rated = D.players.filter(p=>num(attrId,p.id)!=null).length;
  return (n >= 4 && n > Math.max(3, Math.round(D.players.length*TOP_SHARE))) ? {n, rated} : null;
}
function flatProfile(p){
  const vals = ATTRS.filter(a=>a.p!=="TIPS").map(a=>num(a.id,p.id)).filter(v=>v!=null);
  if(vals.length < 15) return null;
  const counts = {}; vals.forEach(v=>counts[v]=(counts[v]||0)+1);
  const [mode, n] = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
  const share = n/vals.length;
  const m = avg(vals), sd = Math.sqrt(avg(vals.map(v=>(v-m)**2)));
  return (share >= 0.7 || sd < 0.6) ? {mode:+mode, share, sd} : null;
}

/* ---------- comment drafts ---------- */
function levelPhrase(v){
  if(v==null) return null;
  if(v>=7) return "is among the best in Malta for this age";
  if(v>=6) return "is above the typical level for this age";
  if(v>=4.5) return "is around the typical level for this age";
  if(v>=3.5) return "is slightly below the typical level for this age";
  return "has clear room to develop";
}
const short = n=>n.replace(" (In Possession)"," in possession").replace(" (Out Possession)"," out of possession").replace("Agility (Change of Direction at Speed)","agility").replace("Creativity with the ball","creativity").replace("Cardiovascular Endurance","endurance").replace("Running with Ball","running with the ball").replace("Role(s) responsibility","role responsibility").replace("Role(s) Responsibility","role responsibility").replace("Understanding of main Principles","understanding of the main principles").replace("Understanding of Main Principles","understanding of the main principles").replace("1V1 application","1v1 play").replace("1V1 Application","1v1 defending");
function templateDraft(p, sec){
  const list = ATTRS.filter(a=>sec.pillars.includes(a.p)).map(a=>({n:a.n, v:num(a.id,p.id)})).filter(x=>x.v!=null);
  if(!list.length) return "";
  const m = avg(list.map(x=>x.v));
  const sorted = [...list].sort((a,b)=>b.v-a.v);
  const best = sorted.filter(x=>x.v>=Math.max(m+0.5, sorted[0].v)).slice(0,2);
  const low = sorted[sorted.length-1];
  const lc = s=>short(s).toLowerCase();
  const lead = {physical:"Physically", technical:"Technically", tactical:"Tactically", psychology:"Mentally", behavioural:"In attitude and behaviour"}[sec.id];
  let t = `${lead}, ${first(p)} ${levelPhrase(m)}.`;
  if(best.length && best[0].v > low.v) t += ` Stands out for ${best.map(x=>lc(x.n)).join(" and ")}.`;
  if(low && low.v < m - 0.4) t += ` The main area to work on is ${lc(low.n)}.`;
  else if(sorted[0].v - low.v < 1) t += ` A balanced profile with no clear weakness.`;
  return t;
}

/* ---------- header & tabs ---------- */
function renderHeader(){
  const inApp = st.step==="app";
  $("#meta").textContent = `${grp()?grp().label+" · ":""}${S.cycle.label}`;
  $("#coachBox").innerHTML = coach.name && st.step!=="login"
    ? `<div class="who"><span>${esc(coach.name)}</span><span class="role">${esc(coach.role)} coach</span>${inApp?`<button data-edit>Edit details</button>`:""}${S.mode==="live"?`<button data-signout>Sign out</button>`:""}</div>` : "";
  const tabs = [["rate","Rate squad"],["overview","Squad overview"]];
  if(isLead()) tabs.push(["comments","Comments"]);
  tabs.push(["review","Review & submit"]);
  if(auth.isHead) tabs.push(["head","Head Coach"], ["reports","Player reports"], ["parents","Parents & sending"]);
  const d = totalDone();
  $("#tabs").style.display = inApp ? "" : "none";
  $("#tabs").innerHTML = tabs.map(([v,l])=>`<button role="tab" data-v="${v}" aria-selected="${st.view===v}">${l}${v==="review"&&D.submission&&!S.changedSinceSubmit(st.group)?' <span class="okdot" title="Submitted">✓</span>':""}</button>`).join("")
    + `<div class="progress"><span>${d} / ${ATTRS.length} attributes complete</span><div class="bar"><i style="width:${d/ATTRS.length*100}%"></i></div></div>`;
}

/* ---------- sign in (live only) ---------- */
let loginMsg = "";
function renderLogin(msg=""){
  $("#view").innerHTML = `<div class="onb"><form class="card" id="loginForm" novalidate>
    <div><h2>Player Report 2026/27</h2></div>
    <p>Sign in with your email. We'll email you a sign-in code. No password needed.</p>
    <div class="fld"><label for="l-email">Email</label>
      <input id="l-email" name="email" type="email" autocomplete="email" placeholder="name@example.com" required>
      <span class="err">${esc(msg)}</span></div>
    <div class="actions"><span></span><button class="btn primary" type="submit">Email me a code</button></div>
  </form></div>`;
}
function renderLinkSent(email, msg=""){
  $("#view").innerHTML = `<div class="onb"><form class="card" id="codeForm" novalidate>
    <div><h2>Check your email</h2></div>
    <p>We sent a sign-in email to <b>${esc(email)}</b>. Type the code from the email below. It works on any device and can take a minute to arrive; check your spam folder too.</p>
    <input type="hidden" name="email" value="${esc(email)}">
    <div class="fld"><label for="l-code">Sign-in code</label>
      <input id="l-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="123456" required>
      <span class="err">${esc(msg)}</span></div>
    <div class="actions"><button class="btn" type="button" data-relogin>Use a different email</button><button class="btn primary" type="submit">Sign in</button></div>
  </form></div>`;
  setTimeout(()=>$("#l-code")?.focus(), 0);
}
function renderNotStaff(){
  $("#view").innerHTML = `<div class="onb"><div class="card">
    <div><h2>You're not on the coaches list yet</h2></div>
    <p><b>${esc(auth.email)}</b> isn't registered as a Melita coach for this report. Ask the Head Coach to add your email, then sign in again.</p>
    <div class="actions"><button class="btn" data-signout>Sign out</button><span></span></div></div></div>`;
}

/* ---------- onboarding ---------- */
function steps(n){
  return `<div class="steps">${["Your details","How it works","Rate"].map((t,k)=>`<span class="${k===n?"on":""}"><i>${k+1}</i>${t}</span>`).join('<span aria-hidden="true">·</span>')}</div>`;
}
function renderDetails(err={}){
  const c = coach, live = S.mode==="live";
  $("#view").innerHTML = `<div class="onb"><form class="card" id="detForm" novalidate>
    ${steps(0)}
    <div><h2>Player Report 2026/27</h2></div>
    <p>Tell us who is rating. Your ratings are private: other coaches in your group can't see them. The Head Coach combines every coach's ratings into the final report.</p>
    <fieldset class="fld"><legend>Age group you're rating</legend>
      <div class="groups">${GROUPS.map(g=>`<label><input type="radio" name="group" id="g-${g.id}" value="${g.id}" ${st.group===g.id?"checked":""}><span>${g.label}</span></label>`).join("")}</div>
      <span class="err">${err.group||""}</span></fieldset>
    <div class="fld"><label for="f-name">Full name</label>
      <input id="f-name" name="name" autocomplete="name" value="${esc(c.name)}" placeholder="e.g. Isaac Curmi">
      <span class="err">${err.name||""}</span></div>
    <fieldset class="fld"><legend>Your role in this group</legend>
      <div class="roles">
        <label><input type="radio" name="role" id="r-lead" value="Lead" ${c.role==="Lead"?"checked":""}><span><b>Lead coach</b>Rates every player and writes the report comments.</span></label>
        <label><input type="radio" name="role" id="r-asst" value="Assistant" ${c.role==="Assistant"?"checked":""}><span><b>Assistant coach</b>Rates every player. Comments are written by the lead.</span></label>
      </div><span class="err">${err.role||""}</span></fieldset>
    <div class="fld"><label for="f-email">Email</label>
      <input id="f-email" name="email" type="email" autocomplete="email" value="${esc(live?auth.email:c.email)}" ${live?"readonly":""} placeholder="name@example.com">
      <span class="err">${err.email||""}</span></div>
    <div class="actions"><span></span><button class="btn primary" type="submit">Continue →</button></div>
    ${S.loadSample?`<div class="samplebox"><b>Just want to look around?</b> Load a sample squad with every attribute rated, comments written and a second coach, then jump to any screen.
      <button class="btn" type="button" data-sample>Load a sample squad</button><span class="note">Uses the age group ticked above (Under 11 if none).</span></div>`:""}
  </form></div>`;
}
function renderIntro(){
  const sc = [1,2,3,4,5,6,7,8,9,10].map(n=>`<div class="${n===10?"x":n>=7?"e":n===5?"a":""}">${n}</div>`).join("");
  const scl = ["Extremely weak","Very weak","Weak","Below avg","Average","Above avg","Good","Very good","Excellent","Not used"].map(t=>`<span>${t}</span>`).join("");
  const ex = D.players.slice(0,6).map(p=>esc(p.full));
  $("#view").innerHTML = `<div class="onb"><div class="card wide">
    ${steps(1)}
    <div><h2>How rating works</h2></div>
    <p>You'll rate the ${esc(grp().label)} squad (${D.players.length} players) on ${ATTRS.length} attributes. One attribute at a time, you place the whole squad on a ladder, so you can always see how players rank against each other.</p>
    <div class="how">
      <section><h3><span class="n">1</span>Compare with the best in Malta</h3>
        <p>${grp().mixed?`Score every girl against the <b>best girls in Malta born in the same year as her</b>, not against her teammates. Her year of birth is shown next to her name.`:`Score every player against the <b>best player in Malta in this age group</b>, not against your own teammates.`}</p>
        <div class="scale">${sc}</div><div class="scl">${scl}</div>
        <ul style="margin-top:8px"><li><b>10 is never given.</b></li><li><b>7, 8 or 9</b> means among the best in Malta at that attribute.</li></ul>
      </section>
      <section><h3><span class="n">2</span>Drag the squad onto the ladder</h3>
        <p>Every player starts in the <b>To place</b> list. <b>Drag each player onto their score</b>, starting with your best player at the skill and working down.</p>
        <div class="mini">
          <div class="e"><b>9</b><span></span></div>
          <div class="e"><b>8</b><span>${ex[0]?`<i>${ex[0]}</i>`:""}</span></div>
          <div class="e"><b>7</b><span>${ex.slice(1,3).map(n=>`<i>${n}</i>`).join("")}</span></div>
          <div><b>6</b><span>${ex.slice(3,6).map(n=>`<i>${n}</i>`).join("")}</span></div>
        </div>
        <p style="margin-top:8px">Players on the same row are equal. Changed your mind? Drag the player to another row, or press <b>Undo</b>.</p>
      </section>
      <section><h3><span class="n">3</span>Use the descriptions</h3>
        <p>Above each ladder you'll see what a <b>1–3</b>, a <b>5</b> and a <b>7–9</b> look like for this age. Scores in between sit between those descriptions. Using them keeps every coach's scores consistent.</p>
      </section>
      <section><h3><span class="n">4</span>A few rules</h3>
        <ul>
          <li>Rate what you've seen across the whole period, not the last match.</li>
          <li>Your progress saves as you go. ${isLead()?"When the ratings are done, write a short comment for each player, then ":"When you're done, "}go to <b>Review &amp; submit</b>.</li>
        </ul>
      </section>
    </div>
    <div class="actions"><button class="btn" data-step="details">← Back</button><button class="btn primary" data-step="app">Start rating →</button></div>
  </div></div>`;
}

/* ---------- rating ---------- */
function chip(p){
  const tag = isLU(p) ? `<span class="yr" title="Ladder-up player">LU</span>` : (grp()?.mixed && p.y ? `<span class="by" title="Year of birth">${p.y}</span>` : "");
  return `<span class="chip" data-p="${esc(p.id)}" title="${p.c?"COMET "+esc(p.c):"No COMET number"}">${esc(p.full)} ${tag}</span>`;
}
function renderRate(){
  const a = ATTRS[st.cur];
  const m = R(a.id);
  let side = "";
  PILLARS.forEach(pl=>{
    side += `<div class="grp">${esc(pl)}</div>`;
    ATTRS.forEach((x,i)=>{ if(x.p!==pl) return;
      const c = placed(x.id), pct = D.players.length ? Math.round(c/D.players.length*100) : 0;
      side += `<button class="att" data-a="${i}" aria-current="${i===st.cur}"><span class="dot ${pct===100?"done":""}" style="--p:${pct}"></span><span class="nm">${esc(x.n)}</span>${topWarn(x.id)?'<span class="wdot" title="Many players in 7–9">!</span>':""}<span class="ct">${c}/${D.players.length}</span></button>`;
    });
  });
  const by = {};
  D.players.forEach(p=>{ if(p.id in m) (by[m[p.id]] ||= []).push(p); });
  const sortN = arr=>(arr||[]).sort((x,y)=>x.full.localeCompare(y.full));
  let rows = `<div class="row off"><div class="lab"><span class="num">10</span><span class="lv"><b>Outstanding</b>Not used</span></div><div class="slot"></div></div>`;
  rows += `<div class="sep">Among the best in Malta for this age</div>`;
  for(let s=9;s>=1;s--){
    if(s===6) rows += `<div class="sep" style="color:var(--muted)">Around the typical Maltese level</div>`;
    if(s===3) rows += `<div class="sep" style="color:var(--muted)">Clear gap to the typical level</div>`;
    const list = sortN(by[s]);
    rows += `<div class="row ${s>=7?"elite":""}" data-s="${s}">
      <div class="lab"><span class="num">${s}</span><span class="lv"><b>${LEVELS[s]}</b>${list.length} player${list.length===1?"":"s"}</span></div>
      <div class="slot">${list.map(chip).join("") || `<span class="empty">Drop players here</span>`}</div></div>`;
  }
  const no = sortN(by["NO"]);
  rows += `<div class="row no" data-s="NO"><div class="lab"><span class="num">–</span><span class="lv"><b>Not observed</b>Left out of averages</span></div>
    <div class="slot">${no.map(chip).join("") || `<span class="empty">Injured, absent, or not seen</span>`}</div></div>`;

  const unplaced = D.players.filter(p=>!(p.id in m));
  const done = unplaced.length===0;
  const tray = done
    ? `<div class="tray doneT"><div class="donemsg">All ${D.players.length} players placed. Check the ladder, then go to the next attribute.</div></div>`
    : `<div class="tray" data-s="TRAY"><h3>To place <span class="pill">${unplaced.length} left</span></h3><p class="trayfor">Rating: <b>${esc(a.n)}</b></p>
        <div class="slot">${unplaced.map(chip).join("")}</div></div>`;
  const w = topWarn(a.id);
  const warn = w ? `<div class="warn"><b>${w.n} players are in 7–9.</b> 7–9 means among the best in Malta for this age. Check that's true for each of them.</div>` : "";

  const prev = ATTRS[st.cur-1], next = ATTRS[st.cur+1];
  const foot = `<div class="foot">
      <div>${prev?`<button class="btn" data-go="${st.cur-1}">← <span class="lbl">${esc(prev.n)}</span></button>`:""}</div>
      <div class="mid"><b>${st.cur+1} of ${ATTRS.length}</b> · ${D.players.length-unplaced.length}/${D.players.length} placed</div>
      <div class="r">${next?`<button class="btn ${done?"primary":""}" data-go="${st.cur+1}"><span class="lbl">${esc(next.n)}</span> →</button>`:`<button class="btn primary" data-view="${isLead()?"comments":"review"}">${isLead()?"Write comments":"Review & submit"} →</button>`}</div>
    </div>`;

  $("#view").innerHTML = `<div class="rate">
    <aside class="attrs" aria-label="Attributes">${side}</aside>
    <div class="mainwrap"><main class="board">
      <div class="stack">${D.sample?`<div class="notice">Prototype: the ${esc(grp().label)} squad hasn't been loaded, so sample players are shown.</div>`:""}
      <div class="ahead"><div><span class="pill">${esc(a.p)}</span><h2>${esc(a.n)}</h2><p>${esc(a.w)}</p></div></div>
      <div class="rubric">
        <div class="rb"><b>1–3 · Weak</b>${esc(anchors(a)[0])}</div>
        <div class="rb"><b>5 · Average in Malta</b>${esc(anchors(a)[1])}</div>
        <div class="rb"><b>7–9 · Among the best in Malta</b>${esc(anchors(a)[2])}</div>
      </div>
      <div class="tip"><span>Drag each player onto their score, starting with your best player.${grp()?.mixed?" Compare each girl with the best girls in Malta born in the same year.":""}</span></div></div>
      ${tray}
      <div class="ladder"><div class="ladhead"><span class="pill">${esc(a.p)}</span><b>${esc(a.n)}</b><span class="lw">${esc(a.w)}</span>
        <button class="btn undo" data-undo ${undoStack.length?"":"disabled"} title="Undo last move (Ctrl+Z)">↶ Undo</button></div>${warn}${rows}</div>
    </main>${foot}</div></div>`;
}

/* ---------- overview ---------- */
function cellColor(v){
  if(v==null) return "var(--bg)";
  const t = (v-1)/8, mix = (a,b)=>Math.round(a+(b-a)*t);
  return `rgb(${mix(250,200)},${mix(236,16)},${mix(238,46)})`;
}
function heatTable(players, getV, getFlag, extraCol){
  const rows = players.map(p=>({p, cells:ATTRS.map(a=>({a, v:getV(a.id,p.id), f:getFlag?getFlag(a.id,p.id):false}))}));
  rows.forEach(r=>r.tot = avg(r.cells.filter(c=>c.a.p!=="TIPS").map(c=>c.v)));
  const teamAvg = ATTRS.map(a=>avg(players.map(p=>getV(a.id,p.id))));
  const best = ATTRS.map(a=>{ const vs = players.map(p=>getV(a.id,p.id)).filter(v=>v!=null); return vs.length?Math.max(...vs):null; });
  rows.sort((x,y)=>(y.tot??-1)-(x.tot??-1));
  const firstOf = pl=>ATTRS.findIndex(x=>x.p===pl);
  let head1 = `<tr><th class="nm"></th>`, head2 = `<tr><th class="nm" style="vertical-align:bottom">Player</th>`;
  PILLARS.forEach((pl,k)=>{
    const n = ATTRS.filter(a=>a.p===pl).length;
    head1 += (k?`<th class="gap"></th>`:"") + `<th class="pgrp" colspan="${n}">${esc(SHORT[pl]||pl)}</th>`;
    ATTRS.forEach((a,ai)=>{ if(a.p!==pl) return; head2 += (k&&ai===firstOf(pl)?`<th class="gap"></th>`:"") + `<th class="vert"><span>${esc(a.n.replace(" (In Possession)","").replace(" (Out Possession)","").replace("TIPS ",""))}</span></th>`; });
  });
  head1 += `<th></th>${extraCol?"<th></th>":""}</tr>`; head2 += `<th class="pgrp" style="vertical-align:bottom">Overall</th>${extraCol?`<th class="pgrp" style="vertical-align:bottom">${extraCol.label}</th>`:""}</tr>`;
  const cellsRow = getter=>{ let h=""; PILLARS.forEach((pl,k)=>ATTRS.forEach((a,ai)=>{ if(a.p!==pl) return; h += (k&&ai===firstOf(pl)?`<td class="gap"></td>`:"") + getter(a,ai); })); return h; };
  const line = (label, vals, color)=>`<tr><td class="nm" style="color:${color}">${label}</td>${cellsRow((a,ai)=>`<td class="c" style="font-weight:700;font-size:11px">${fmt(vals[ai])}</td>`)}<td class="tot"></td>${extraCol?"<td></td>":""}</tr>`;
  const body = rows.map(r=>`<tr><td class="nm">${esc(r.p.full)}${isLU(r.p)?' <span class="yr">LU</span>':""}</td>${cellsRow((a,ai)=>{
      const c = r.cells[ai], v = c.v, dark = v!=null && v>=6;
      return `<td class="c ${c.f?"flag":""}" style="background:${cellColor(v)};color:${dark?"#fff":"var(--ink)"}" title="${esc(r.p.full)} · ${esc(a.n)}: ${fmt(v)}${c.f?" (coaches differ by 2+)":""}">${v==null?"":fmt(v)}</td>`;
    })}<td class="tot">${fmt(r.tot)}</td>${extraCol?`<td class="tot">${extraCol.get(r.p)}</td>`:""}</tr>`).join("");
  return `<div class="tw"><table><thead>${head1}${head2}</thead><tbody>${line("Melita best", best, "var(--red-dark)")}${line("Team average", teamAvg, "var(--muted)")}${body}</tbody></table></div>
    <div class="legend"><span><i class="sw" style="background:${cellColor(1)}"></i>1</span><span><i class="sw" style="background:${cellColor(5)}"></i>5</span><span><i class="sw" style="background:${cellColor(9)}"></i>9</span><span><i class="sw" style="background:var(--bg)"></i>Not rated / not observed</span><span><b style="color:var(--red)">LU</b> Ladder-up player</span>${getFlag?`<span><i class="sw" style="outline:2px solid var(--ink);outline-offset:-3px;background:${cellColor(6)}"></i>Coaches differ by 2+</span>`:""}</div>`;
}
function renderOverview(){
  const flat = D.players.filter(p=>flatProfile(p));
  $("#view").innerHTML = `<div class="ov">
    <div class="ovh"><h2>My squad overview</h2>
      <p>Your own ratings only, sorted by overall score. Read down a column to check the ranking for one attribute, or across a row to check one player's profile. To change a score, go back to Rate squad.</p>
      <span class="lock">🔒 Only you and the Head Coach can see these ratings.</span>
    </div>
    ${flat.length?`<div class="warn" style="margin-bottom:12px"><b>${flat.length} player${flat.length===1?" has":"s have"} almost the same score on every attribute:</b> ${flat.map(p=>esc(p.full)).join(", ")}. That usually means rating the player overall rather than each skill. Worth a second look.</div>`:""}
    ${heatTable(D.players, num)}
  </div>`;
}

/* ---------- comments (lead coach) ---------- */
function sectionDone(p){ const c = D.comments[p.id]||{}; return SECTIONS.filter(s=>(c[s.id]||"").trim()).length; }
function renderComments(){
  if(!isLead()){ st.view="rate"; return render(); }
  const ps = [...D.players].sort((a,b)=>a.full.localeCompare(b.full));
  st.cp = Math.min(st.cp, ps.length-1);
  const p = ps[st.cp];
  const c = D.comments[p.id] || {};
  const nav = ps.map((x,i)=>{ const n=sectionDone(x); return `<button class="att" data-cp="${i}" aria-current="${i===st.cp}"><span class="dot ${n===SECTIONS.length?"done":""}" style="--p:${n/SECTIONS.length*100}"></span><span class="nm">${esc(x.full)}</span><span class="ct">${n}/${SECTIONS.length}</span></button>`; }).join("");
  const blocks = SECTIONS.map(sec=>{
    const items = ATTRS.filter(a=>sec.pillars.includes(a.p)).map(a=>({a, v:num(a.id,p.id)}));
    const bars = items.map(({a,v})=>`<div class="sb" title="${esc(a.n)}: ${fmt(v)}"><span class="sbn">${esc(a.n.replace(" (In Possession)"," · IP").replace(" (Out Possession)"," · OOP").replace("Agility (Change of Direction at Speed)","Agility"))}</span><span class="sbt"><i style="width:${v?v*10:0}%;background:${v>=7?"var(--red)":"var(--ink)"}"></i></span><span class="sbv">${v??"–"}</span></div>`).join("");
    return `<section class="cm">
      <div class="cmh"><h3>${sec.label}</h3><button class="btn" data-draft="${sec.id}">Draft from scores</button></div>
      <div class="cmb"><div class="bars">${bars}</div>
      <textarea id="cm-${sec.id}" data-sec="${sec.id}" rows="4" placeholder="Write 1–3 sentences for the parents. Use 'Draft from scores' to get started, then make it personal.">${esc(c[sec.id]||"")}</textarea></div>
    </section>`;
  }).join("");
  const unrated = ATTRS.filter(a=>num(a.id,p.id)==null && R(a.id)[p.id]!=="NO").length;
  $("#view").innerHTML = `<div class="rate">
    <aside class="attrs" aria-label="Players"><div class="grp">Players</div>${nav}</aside>
    <div class="mainwrap"><main class="board cmboard">
      <div class="stack"><div class="ahead"><div><span class="pill">Comments · ${st.cp+1} of ${ps.length}</span><h2>${esc(p.full)}</h2>
        <p>These comments go on ${esc(first(p))}'s report for parents. Keep them specific, positive and honest. Saved as you type.${unrated?` <b>${unrated} attribute${unrated===1?"":"s"} not rated yet</b>, so drafts may be incomplete.`:""}</p></div></div></div>
      <div class="cms">${blocks}</div>
    </main>
    <div class="foot">
      <div>${st.cp>0?`<button class="btn" data-cpgo="${st.cp-1}">← <span class="lbl">${esc(ps[st.cp-1].full)}</span></button>`:""}</div>
      <div class="mid"><b>${sectionDone(p)}/${SECTIONS.length}</b> sections written</div>
      <div class="r">${st.cp<ps.length-1?`<button class="btn ${sectionDone(p)===SECTIONS.length?"primary":""}" data-cpgo="${st.cp+1}"><span class="lbl">${esc(ps[st.cp+1].full)}</span> →</button>`:`<button class="btn primary" data-view="review">Review &amp; submit →</button>`}</div>
    </div></div></div>`;
}

/* ---------- review & submit ---------- */
function renderReview(){
  const incomplete = ATTRS.map((a,i)=>({a,i,n:placed(a.id)})).filter(x=>x.n<D.players.length);
  const warns = ATTRS.map((a,i)=>({a,i,w:topWarn(a.id)})).filter(x=>x.w);
  const flat = D.players.filter(p=>flatProfile(p));
  const cm = isLead() ? D.players.filter(p=>sectionDone(p)<SECTIONS.length) : [];
  const ready = incomplete.length===0 && cm.length===0;
  const sub = D.submission, changed = S.changedSinceSubmit(st.group);
  const item = (ok, title, body)=>`<li class="${ok?"ok":"todo"}"><span class="ic">${ok?"✓":"!"}</span><div><b>${title}</b>${body?`<div class="sub">${body}</div>`:""}</div></li>`;
  const links = (arr, fn)=>arr.slice(0,12).map(fn).join("") + (arr.length>12?` <span class="more">+${arr.length-12} more</span>`:"");
  $("#view").innerHTML = `<div class="ov"><div class="review">
    <h2>Review &amp; submit</h2>
    <p class="lead">${esc(grp().label)} · ${D.players.length} players · ${esc(coach.role)} coach</p>
    ${sub?`<div class="status ${changed?"warnbg":"okbg"}">${changed?`You submitted on ${new Date(sub.submittedAt).toLocaleDateString("en-GB",{day:"numeric",month:"short"})}, then made changes. Submit again so the Head Coach gets the latest version.`:`Submitted on ${new Date(sub.submittedAt).toLocaleString("en-GB",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}. You can still make changes until the deadline; you'll be asked to submit again.`}</div>`:""}
    <ul class="checks">
      ${item(!incomplete.length, incomplete.length?`${incomplete.length} attribute${incomplete.length===1?"":"s"} not finished`:`All ${ATTRS.length} attributes rated`,
        incomplete.length?links(incomplete, x=>`<button class="lnk" data-a="${x.i}" data-view="rate">${esc(x.a.n)} (${x.n}/${D.players.length})</button>`):"")}
      ${isLead()?item(!cm.length, cm.length?`Comments missing for ${cm.length} player${cm.length===1?"":"s"}`:"Comments written for every player",
        cm.length?links(cm, p=>`<button class="lnk" data-cpname="${esc(p.id)}">${esc(p.full)} (${sectionDone(p)}/${SECTIONS.length})</button>`):""):""}
      ${item(!warns.length, warns.length?`${warns.length} attribute${warns.length===1?" has":"s have"} a lot of players in 7–9`:"Top scores (7–9) look selective",
        warns.length?`Check these are all among the best in Malta for this age: `+links(warns, x=>`<button class="lnk" data-a="${x.i}" data-view="rate">${esc(x.a.n)} (${x.w.n})</button>`):"")}
      ${item(!flat.length, flat.length?`${flat.length} player${flat.length===1?" has":"s have"} almost the same score everywhere`:"Players have varied profiles",
        flat.length?`Usually means rating the player overall rather than each skill: `+links(flat, p=>`<span class="tagname">${esc(p.full)}</span>`):"")}
    </ul>
    <p class="note">The last two are only prompts. You can submit with them if you're happy with your ratings.</p>
    <div class="actions"><span></span><button class="btn primary big" data-submit ${ready?"":"disabled"}>${sub&&!changed?"Submitted ✓":sub?"Submit again":"Submit my ratings"}</button></div>
    ${!ready?`<p class="note" style="text-align:right">Finish the items marked <b>!</b> above to submit.</p>`:""}
    ${S.mode==="demo"?`<details class="exp"><summary>See the data that will be sent</summary><p><button class="btn" id="copy">Copy CSV</button> <span id="copied"></span></p><textarea id="csv" readonly>${esc(csv())}</textarea></details>`:""}
  </div></div>`;
}
function csv(){
  const lines = ["age_group,comet_no,player,birth_year,attribute_id,attribute,coach_name,coach_role,score"];
  ATTRS.forEach(a=>D.players.forEach(p=>{ const s=(D.ratings[a.id]||{})[p.id]; if(s===undefined) return;
    lines.push([st.group,p.c||"",`"${p.full}"`,p.y||"",a.id,`"${a.n}"`,`"${coach.name}"`,coach.role,s==="NO"?"":s].join(",")); }));
  return lines.join("\n");
}

/* ---------- head coach (live) ---------- */
let HC = {group:null, data:null, loading:false, staff:null};
async function loadHead(g){
  HC = {group:g, data:null, loading:true, staff:HC.staff}; render();
  try{ HC.data = await S.headLoad(g); }catch(e){ console.error(e); toast("Couldn't load the group's ratings.", "bad"); }
  HC.loading = false; render();
}
function renderHead(){
  const g = st.hcGroup || st.group;
  if(HC.group!==g && !HC.loading){ loadHead(g); return; }
  const sel = `<div class="seg light">${GROUPS.map(x=>`<button data-hc="${x.id}" aria-pressed="${x.id===g}">${esc(x.label.replace("Under ","U"))}</button>`).join("")}</div>`;
  if(!HC.data){ $("#view").innerHTML = `<div class="ov"><div class="ovh"><h2>Head Coach</h2>${sel}</div><p>Loading…</p></div>`; return; }
  const {players, coaches, ratings} = HC.data;  // ratings: {attrId:{playerId:{userId:score|"NO"}}}
  const vals = (aid,pid)=>Object.values(ratings[aid]?.[pid]||{}).filter(v=>typeof v==="number");
  const getV = (aid,pid)=>avg(vals(aid,pid));
  const getF = (aid,pid)=>{ const v=vals(aid,pid); return v.length>1 && Math.max(...v)-Math.min(...v)>=2; };
  const total = ATTRS.length*players.length;
  let flags=0; ATTRS.forEach(a=>players.forEach(p=>{ if(getF(a.id,p.id)) flags++; }));
  const crows = coaches.map(c=>{
    let n=0; ATTRS.forEach(a=>players.forEach(p=>{ if(ratings[a.id]?.[p.id]?.[c.user_id]!==undefined) n++; }));
    return `<tr><td class="nm">${esc(c.full_name)}</td><td>${esc(c.role)}</td><td>${esc(c.email)}</td><td><div class="bar"><i style="width:${total?n/total*100:0}%"></i></div> ${total?Math.round(n/total*100):0}%</td><td>${c.submitted_at?`<span class="okc">Submitted ${new Date(c.submitted_at).toLocaleDateString("en-GB",{day:"numeric",month:"short"})}</span>`:'<span class="muted">Not yet</span>'}</td></tr>`;
  }).join("") || `<tr><td colspan="5" class="muted" style="padding:10px">No coaches have started this group yet.</td></tr>`;
  $("#view").innerHTML = `<div class="ov">
    <div class="ovh"><h2>Head Coach</h2>${sel}
      <p>Average of all coaches' ratings for ${esc(GROUPS.find(x=>x.id===g)?.label)}. <b>${flags}</b> score${flags===1?"":"s"} where coaches differ by 2 or more are outlined: worth a quick chat before reports go out.</p></div>
    <div class="tw" style="margin-bottom:16px"><table class="ctab"><thead><tr><th class="nm">Coach</th><th>Role</th><th>Email</th><th>Progress</th><th>Status</th></tr></thead><tbody>${crows}</tbody></table></div>
    ${heatTable(players, getV, getF, {label:"Coaches", get:p=>Math.max(0,...ATTRS.map(a=>vals(a.id,p.id).length))})}
    <p style="margin-top:14px"><button class="btn" data-hcexport>Download all ratings (CSV)</button></p>
    <div class="staffbox"><h3>Coaches with access</h3>
      <p class="note">Only these emails can sign in. Add a coach here, then send them the link to this page.</p>
      <form id="staffForm" class="staffform" novalidate><input name="name" placeholder="Full name" aria-label="Coach full name"><input name="email" type="email" placeholder="coach@email.com" aria-label="Coach email"><button class="btn primary" type="submit">Add coach</button></form>
      <div id="staffList">${HC.staff?staffRows():"Loading…"}</div></div>
    <div class="staffbox"><h3>Season</h3>
      <form id="cycleForm" novalidate><p class="note">Start the next report cycle. The current one (${esc(S.cycle.label)}) is closed and kept for history.</p>
        <div class="staffform"><input name="cid" placeholder="ID, e.g. 2026-27-C2" aria-label="Cycle ID"><input name="label" placeholder="Name, e.g. 2026/27 · Report cycle 2 (May)" aria-label="Cycle name" style="min-width:280px">
          <label class="note">Opens <input name="opens" type="date"></label><label class="note">Deadline <input name="closes" type="date"></label>
          <label class="note"><input name="copy" type="checkbox" checked> Copy current squads</label><button class="btn" type="submit">Start new cycle</button></div></form>
      <form id="purgeForm" novalidate style="margin-top:14px"><p class="note"><b>End of season:</b> delete all parent emails, report links and the email log. Ratings and reports are kept.</p>
        <div class="staffform"><input name="confirm" placeholder="Type DELETE" aria-label="Type DELETE to confirm"><button class="btn" type="submit">Delete parent data</button></div></form>
    </div>
  </div>`;
  if(!HC.staff) S.headStaff().then(r=>{ HC.staff=r; const el=$("#staffList"); if(el) el.innerHTML=staffRows(); }).catch(()=>{});
}
function staffRows(){
  return `<table class="ctab"><tbody>${HC.staff.map(x=>`<tr><td>${esc(x.full_name||"")}</td><td>${esc(x.email)}</td><td>${x.is_head_coach?"Head Coach":"Coach"}</td><td>${x.active?"Active":'<span class="muted">Removed</span>'}</td><td>${x.is_head_coach?"":`<button class="lnk" data-staff="${esc(x.email)}" data-on="${x.active?0:1}">${x.active?"Remove access":"Restore"}</button>`}</td></tr>`).join("")}</tbody></table>`;
}
function headCsv(){
  const {players, coaches, ratings, comments} = HC.data;
  const cn = Object.fromEntries(coaches.map(c=>[c.user_id,c]));
  const lines = ["age_group,comet_no,player,birth_year,attribute_id,attribute,pillar,coach_name,coach_role,score"];
  ATTRS.forEach(a=>players.forEach(p=>Object.entries(ratings[a.id]?.[p.id]||{}).forEach(([u,s])=>{
    lines.push([HC.group,p.c||"",`"${p.full}"`,p.y||"",a.id,`"${a.n}"`,`"${a.p}"`,`"${cn[u]?.full_name||u}"`,cn[u]?.role||"",s==="NO"?"":s].join(","));
  })));
  return lines.join("\n");
}

/* ---------- player reports (Head Coach) ---------- */
function renderReports(){
  const g = st.hcGroup || st.group;
  if(HC.group!==g && !HC.loading){ loadHead(g); return; }
  const sel = `<div class="seg light">${GROUPS.map(x=>`<button data-hc="${x.id}" aria-pressed="${x.id===g}">${esc(x.label.replace("Under ","U"))}</button>`).join("")}</div>`;
  if(!HC.data){ $("#view").innerHTML = `<div class="ov"><div class="ovh"><h2>Player reports</h2>${sel}</div><p>Loading…</p></div>`; return; }
  const {players, ratings, comments, coaches} = HC.data;
  const vals = (aid,pid)=>Object.values(ratings[aid]?.[pid]||{}).filter(v=>typeof v==="number");
  const own = (aid,pid)=>avg(vals(aid,pid));
  const team = Object.fromEntries(ATTRS.map(a=>[a.id, avg(players.map(p=>own(a.id,p.id)))]));
  const best = Object.fromEntries(ATTRS.map(a=>{ const v=players.map(p=>own(a.id,p.id)).filter(x=>x!=null); return [a.id, v.length?Math.max(...v):null]; }));
  const ps = [...players].sort((a,b)=>a.full.localeCompare(b.full));
  st.rp = Math.max(0, Math.min(st.rp||0, ps.length-1));
  const p = ps[st.rp];
  if(!p){ $("#view").innerHTML = `<div class="ov"><div class="ovh"><h2>Player reports</h2>${sel}</div><p>No players in this group.</p></div>`; return; }
  const nCoaches = Math.max(0,...ATTRS.map(a=>vals(a.id,p.id).length));
  const nav = ps.map((x,i)=>{ const n = Object.values(comments[x.id]||{}).filter(t=>(t||"").trim()).length; return `<button class="att" data-rp="${i}" aria-current="${i===st.rp}"><span class="dot ${n>=SECTIONS.length?"done":""}" style="--p:${n/SECTIONS.length*100}"></span><span class="nm">${esc(x.full)}</span></button>`; }).join("");
  const crest = $(".crest img")?.getAttribute("src") || "";
  const gl = GROUPS.find(x=>x.id===g)?.label || "";
  $("#view").innerHTML = `<div class="rate">
    <aside class="attrs" aria-label="Players"><div class="grp">${esc(gl)} · ${ps.length} players</div>${nav}</aside>
    <div class="mainwrap"><main class="board rpboard">
      <div class="rptools">${sel}<span class="note">Built from the average of ${coaches.length} coach${coaches.length===1?"":"es"}' ratings and the lead coach's comments. Compared with the team average.</span>${S.mode==="live"?`<button class="btn" data-print>Print / save as PDF</button>`:""}</div>
      ${window.MelitaReport.render({ player:p, groupLabel:gl, cycleLabel:S.cycle.label, attrs:ATTRS,
          own:Object.fromEntries(ATTRS.map(a=>[a.id, own(a.id,p.id)])), team, best, comments:comments[p.id]||{}, coaches:nCoaches, crest })}
    </main>
    <div class="foot">
      <div>${st.rp>0?`<button class="btn" data-rpgo="${st.rp-1}">← <span class="lbl">${esc(ps[st.rp-1].full)}</span></button>`:""}</div>
      <div class="mid"><b>${st.rp+1} of ${ps.length}</b></div>
      <div class="r">${st.rp<ps.length-1?`<button class="btn" data-rpgo="${st.rp+1}"><span class="lbl">${esc(ps[st.rp+1].full)}</span> →</button>`:""}</div>
    </div></div></div>`;
}


/* ---------- two-step login gate (Head Coach) ---------- */
let MFA = {checked:false, level:null, enrolled:false, factorId:null, enroll:null, err:""};
function mfaOk(){ return MFA.checked && MFA.level==="aal2"; }
async function checkMfa(){ try{ Object.assign(MFA, await S.mfaStatus(), {checked:true}); }catch(e){ MFA.checked = true; MFA.err = "Couldn't check two-step login."; } render(); }
function renderMfa(){
  if(!MFA.checked){ $("#view").innerHTML = `<div class="onb"><div class="card"><p>Checking two-step login…</p></div></div>`; checkMfa(); return; }
  const e = MFA.enroll;
  $("#view").innerHTML = `<div class="onb"><form class="card" id="mfaForm" novalidate>
    <div><h2>Two-step login</h2></div>
    <p>The Head Coach screens show every coach's ratings and parents' emails, so they need a code from an authenticator app on your phone (Google Authenticator, Microsoft Authenticator or 1Password) as well as your email link.</p>
    ${!MFA.enrolled && !e ? `<div class="actions"><span></span><button class="btn primary" type="button" data-mfa-start>Set up two-step login</button></div>` : ""}
    ${e ? `<ol class="mfasteps"><li>Open your authenticator app and add an account by scanning this code.</li></ol>
      ${e.qr?`<img src="${e.qr}" alt="QR code for your authenticator app" class="qr">`:""}
      <p class="note">Can't scan? Enter this key instead: <code>${esc(e.secret)}</code></p>` : ""}
    ${MFA.enrolled || e ? `<div class="fld"><label for="mfa-code">6-digit code from the app</label>
      <input id="mfa-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456">
      <span class="err">${esc(MFA.err)}</span></div>
      <div class="actions"><span></span><button class="btn primary" type="submit">Verify</button></div>` : ""}
    ${S.mode==="demo"?`<p class="note">Prototype: enter any 6 digits.</p>`:""}
  </form></div>`;
}

/* ---------- parents & sending (Head Coach) ---------- */
let PAR = {group:null, data:null, loading:false, confirming:null, busy:false};
async function loadParents(g){
  PAR = {group:g, data:null, loading:true, confirming:null, busy:false}; render();
  try{ PAR.data = await S.parentsLoad(g); }catch(e){ console.error(e); toast("Couldn't load parents.", "bad"); }
  PAR.loading = false; render();
}
function contactState(c, log){
  const mine = log.filter(l=>l.contact_id===c.id && !l.dry_run);
  const has = (purpose, st)=>mine.some(l=>l.purpose===purpose && l.status===st);
  return {
    confirmSent: mine.some(l=>l.purpose==="confirm" && ["sent","confirmed","dob_mismatch","locked"].includes(l.status)),
    mismatches: mine.filter(l=>l.status==="dob_mismatch").length,
    locked: has("confirm","locked") || has("report","locked"),
    reportSent: mine.some(l=>l.purpose==="report" && ["sent","opened"].includes(l.status)),
    reportOpened: has("report","opened"),
    failed: mine.some(l=>l.status==="failed"),
  };
}
function renderParents(){
  const g = st.hcGroup || st.group;
  if(PAR.group!==g && !PAR.loading){ loadParents(g); return; }
  const sel = `<div class="seg light">${GROUPS.map(x=>`<button data-hc="${x.id}" aria-pressed="${x.id===g}">${esc(x.label.replace("Under ","U"))}</button>`).join("")}</div>`;
  if(!PAR.data){ $("#view").innerHTML = `<div class="ov"><div class="ovh"><h2>Parents &amp; sending</h2>${sel}</div><p>Loading…</p></div>`; return; }
  const {players, contacts, approvals, log, commentCount} = PAR.data;
  const active = contacts.filter(c=>c.active);
  const confirmed = active.filter(c=>c.confirmed_at);
  const unconfirmedToSend = active.filter(c=>!c.confirmed_at && !contactState(c,log).confirmSent).length;
  const approvedIds = Object.keys(approvals);
  const reportReady = confirmed.filter(c=>approvals[c.player_id] && !contactState(c,log).reportSent).length;
  const complete = p=>(commentCount[p.id]||0)>=SECTIONS.length;
  const noConfirmedParent = players.filter(p=>approvals[p.id] && !confirmed.some(c=>c.player_id===p.id));
  const btns = (purpose, n)=>`<div class="sendrow">
      <button class="btn" data-send="${purpose}" data-mode="test" ${PAR.busy?"disabled":""}>Send one test to me</button>
      <button class="btn" data-send="${purpose}" data-mode="dry" ${PAR.busy?"disabled":""}>Dry run: all to me</button>
      <button class="btn primary" data-send="${purpose}" data-mode="real" ${PAR.busy||!n?"disabled":""}>Send to ${n} parent${n===1?"":"s"}…</button></div>
    ${PAR.confirming===purpose?`<div class="confirmbox"><b>This sends real emails to ${n} parent${n===1?"":"s"} in ${esc(GROUPS.find(x=>x.id===g)?.label)}.</b> Have you checked the dry run? Type <code>SEND ${g}</code> to continue.
      <div class="sendrow"><input id="sendConfirm" autocomplete="off" placeholder="SEND ${g}"><button class="btn primary" data-send-real="${purpose}">Send now</button><button class="btn" data-send-cancel>Cancel</button></div></div>`:""}`;
  const chip = (c)=>{ const s = contactState(c,log);
    const st_ = s.locked ? ["bad","Locked"] : c.confirmed_at ? ["ok","Confirmed"] : s.mismatches ? ["warn",`Wrong DOB ×${s.mismatches}`] : s.confirmSent ? ["", "Waiting"] : ["","Not sent"];
    const rep = s.reportOpened ? `<span class="pchip ok">Report opened</span>` : s.reportSent ? `<span class="pchip">Report sent</span>` : "";
    return `<div class="contact ${c.active?"":"off"}"><span class="cem" title="${esc(c.full_name||"")}${c.relation?" · "+esc(c.relation):""}">${esc(c.email)}</span>
      <span class="pchip ${st_[0]}">${st_[1]}</span>${rep}${s.failed?'<span class="pchip bad">Failed</span>':""}
      <span class="cacts">${c.active?`${!c.confirmed_at?`<button class="lnk" data-resend="confirm" data-contact="${esc(c.id)}">Resend confirm</button>`:""}${c.confirmed_at&&approvals[c.player_id]?`<button class="lnk" data-resend="report" data-contact="${esc(c.id)}">Resend report</button>`:""}<button class="lnk" data-deact="${esc(c.id)}" data-on="0">Remove</button>`:`<button class="lnk" data-deact="${esc(c.id)}" data-on="1">Restore</button>`}</span></div>`; };
  const rows = players.map(p=>{ const cs = contacts.filter(c=>c.player_id===p.id);
    return `<tr><td class="nm">${esc(p.full)}</td><td>${cs.map(chip).join("") || '<span class="pchip bad">No parent email</span>'}</td>
      <td class="ctr">${commentCount[p.id]||0}/${SECTIONS.length}</td>
      <td class="ctr"><label class="tog"><input type="checkbox" data-approve="${esc(p.id)}" ${approvals[p.id]?"checked":""}><span>${approvals[p.id]?"Approved":"Approve"}</span></label></td></tr>`; }).join("");
  const recent = log.slice(0,12).map(l=>{ const p = players.find(x=>x.id===l.player_id);
    return `<li><span class="muted">${new Date(l.created_at).toLocaleString("en-GB",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}</span> ${l.dry_run?"<b>[test]</b> ":""}${esc(l.purpose)} · ${esc(p?.full||"")} · <b>${esc(l.status.replace("_"," "))}</b>${l.dry_run?` → ${esc(l.recipient||"")}`:""}</li>`; }).join("") || "<li class='muted'>Nothing yet.</li>";
  $("#view").innerHTML = `<div class="ov"><div class="parents">
    <div class="ovh"><h2>Parents &amp; sending</h2>${sel}
      <p>Reports only go to parents who have <b>confirmed</b> with their child's date of birth, and only for reports you've <b>approved</b>. Every link opens one child's report and needs that child's date of birth.${S.mode==="demo"?" <b>Prototype: made-up parent addresses; nothing is emailed.</b>":""}</p></div>
    <div class="pcards">
      <section class="pcard"><h3><span class="n">1</span>Confirm parents</h3>
        <p><b>${confirmed.length}</b> of ${active.length} parents confirmed. ${unconfirmedToSend} haven't been sent the confirmation email yet.</p>
        ${btns("confirm", unconfirmedToSend)}</section>
      <section class="pcard"><h3><span class="n">2</span>Approve reports</h3>
        <p><b>${approvedIds.length}</b> of ${players.length} approved. ${players.filter(complete).length} have all comments written.</p>
        <div class="sendrow"><button class="btn" data-approve-all ${players.some(p=>complete(p)&&!approvals[p.id])?"":"disabled"}>Approve all with comments complete</button></div>
        ${noConfirmedParent.length?`<p class="warn" style="margin-top:8px">${noConfirmedParent.length} approved player${noConfirmedParent.length===1?" has":"s have"} no confirmed parent yet, so their report can't be sent: ${noConfirmedParent.slice(0,6).map(p=>esc(p.full)).join(", ")}${noConfirmedParent.length>6?"…":""}</p>`:""}</section>
      <section class="pcard"><h3><span class="n">3</span>Send reports</h3>
        <p><b>${reportReady}</b> confirmed parent${reportReady===1?"":"s"} of approved players still to receive the report.</p>
        ${btns("report", reportReady)}</section>
    </div>
    <div class="tw"><table class="ptab"><thead><tr><th class="nm">Player</th><th>Parents</th><th>Comments</th><th>Report</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="pfoot">
      <form id="addParentForm" class="staffbox" novalidate><h3>Add a parent email</h3>
        <p class="note">They'll need to confirm with the child's date of birth before receiving any report.</p>
        <div class="staffform"><select name="player" aria-label="Player">${players.map(p=>`<option value="${esc(p.id)}">${esc(p.full)}</option>`).join("")}</select>
          <input name="name" placeholder="Parent's full name" aria-label="Parent's full name"><input name="email" type="email" placeholder="parent@email.com" aria-label="Parent email">
          <select name="relation" aria-label="Relation"><option>Mother</option><option>Father</option><option>Guardian</option></select><button class="btn primary" type="submit">Add</button></div></form>
      <div class="staffbox"><h3>Recent activity</h3><ul class="actlog">${recent}</ul></div>
    </div>
  </div></div>`;
}
async function doSend(purpose, mode, extra={}){
  const g = PAR.group;
  let body = {purpose, group:g, mode: mode==="real"?"real":"dry_run", ...extra};
  if(mode==="test"){
    const {contacts, approvals} = PAR.data;
    const c = purpose==="confirm" ? contacts.find(c=>c.active) : contacts.find(c=>c.active && c.confirmed_at && approvals[c.player_id]);
    if(!c){ toast(purpose==="report"?"Approve a report with a confirmed parent first.":"No parent emails in this group.", "bad"); return; }
    body.contact_id = c.id;
  }
  PAR.busy = true; render();
  try{
    const r = await S.sendEmails(body);
    const what = r.dry_run ? "test email" : "email";
    toast(r.prepared ? `${r.sent} ${what}${r.sent===1?"":"s"} sent${r.failed?`, ${r.failed} failed`:""}.${r.dry_run?" Check your inbox.":""}` : (r.note || "Nothing to send."), r.failed?"bad":"good");
  }catch(e){ toast(e.message || "Sending failed.", "bad"); }
  PAR.busy = false; PAR.confirming = null; PAR.group = null; render();
}

/* ---------- render ---------- */
function render(){
  const keep = [".board","aside.attrs",".tray",".ov",".tw"].map(sel=>{ const el=$(sel); return el && [sel, el.scrollTop, el.scrollLeft]; }).filter(Boolean);
  renderHeader();
  if(st.step==="login"){ renderLogin(loginMsg); loginMsg=""; }
  else if(st.step==="notstaff") renderNotStaff();
  else if(st.step==="details") renderDetails();
  else if(st.step==="intro") renderIntro();
  else if(st.view==="overview") renderOverview();
  else if(st.view==="comments") renderComments();
  else if(st.view==="review") renderReview();
  else if(["head","reports","parents"].includes(st.view) && auth.isHead && !mfaOk()) renderMfa();
  else if(st.view==="head" && auth.isHead) renderHead();
  else if(st.view==="reports" && auth.isHead) renderReports();
  else if(st.view==="parents" && auth.isHead) renderParents();
  else renderRate();
  keep.forEach(([sel,t,l])=>{ const el=$(sel); if(el){ el.scrollTop=t; el.scrollLeft=l; } });
  saveUI();
}

/* ---------- actions ---------- */
function place(pid, s){
  const a = ATTRS[st.cur], m = R(a.id);
  const prev = m[pid];
  const next = s==="TRAY" ? undefined : s;
  if(prev===next) return;
  undoStack.push({cur:st.cur, attrId:a.id, pid, prev});
  if(undoStack.length>50) undoStack.shift();
  if(next===undefined) delete m[pid]; else m[pid] = next;
  persist(S.saveRating(st.group, a.id, pid, next));
  HC.group = null;
  render();
}
function undo(){
  const u = undoStack.pop(); if(!u) return;
  const m = R(u.attrId);
  if(u.prev===undefined) delete m[u.pid]; else m[u.pid] = u.prev;
  persist(S.saveRating(st.group, u.attrId, u.pid, u.prev));
  if(st.view!=="rate" || st.cur!==u.cur){ st.view="rate"; st.cur=u.cur; }
  render();
}
async function openGroup(g){
  const res = await S.loadGroup(g);
  D = {players: res.players, ratings: res.ratings||{}, comments: res.comments||{}, submission: res.submission||null, sample: !!res.sample};
  undoStack = [];
  computeMainYear();
}
let cmTimer = {};
document.addEventListener("input", e=>{
  const ta = e.target.closest?.("textarea[data-sec]"); if(!ta) return;
  const ps = [...D.players].sort((a,b)=>a.full.localeCompare(b.full)); const p = ps[st.cp];
  const sec = ta.dataset.sec; (D.comments[p.id] ||= {})[sec] = ta.value;
  clearTimeout(cmTimer[sec]); cmTimer[sec] = setTimeout(()=>persist(S.saveComment(st.group, p.id, sec, ta.value)), 600);
  const mid = $(".foot .mid"); if(mid) mid.innerHTML = `<b>${sectionDone(p)}/${SECTIONS.length}</b> sections written`;
  const cur = $(`[data-cp="${st.cp}"]`); if(cur){ const n=sectionDone(p); cur.querySelector(".ct").textContent = `${n}/${SECTIONS.length}`; const d=cur.querySelector(".dot"); d.style.setProperty("--p", n/SECTIONS.length*100); d.classList.toggle("done", n===SECTIONS.length); }
});
document.addEventListener("submit", async e=>{
  e.preventDefault();
  const f = e.target;
  if(f.id==="loginForm"){
    const email = f.email.value.trim();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ renderLogin("Enter a valid email address, e.g. name@example.com."); return; }
    f.querySelector("button").disabled = true;
    try{ await S.sendLink(email); renderLinkSent(email); }
    catch(err){ renderLogin(err.message || "Couldn't send the link. Try again in a minute."); }
    return;
  }
  if(f.id==="codeForm"){
    const email = f.email.value, code = f.code.value.replace(/\D/g,"");
    if(code.length<6){ renderLinkSent(email, "Enter the code from the email."); return; }
    f.querySelector("[type=submit]").disabled = true;
    try{ await S.verifyCode(email, code); location.replace(location.pathname); }
    catch(err){ renderLinkSent(email, "That code didn't work or has expired. Check the latest email, or use a different email to get a new code."); }
    return;
  }
  if(f.id==="mfaForm"){
    const code = (f.code?.value||"").trim(); const fid = MFA.enroll?.factorId || MFA.factorId;
    try{ await S.mfaVerify(fid, code); MFA = {checked:false, level:null, enrolled:true, factorId:null, enroll:null, err:""}; HC = {group:null, data:null, loading:false, staff:null}; PAR.group=null; toast("Two-step login on.", "good"); render(); }
    catch(err){ MFA.err = err.message; render(); }
    return;
  }
  if(f.id==="addParentForm"){
    const email=f.email.value.trim().toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ toast("Enter a valid email address.", "bad"); return; }
    try{ await S.addContact(f.player.value, email, f.name.value.trim(), f.relation.value); toast("Parent added. Send them the confirmation email next.", "good"); PAR.group=null; render(); }
    catch(err){ toast(/duplicate|unique/i.test(err.message||"")?"That email is already on this player.":"Couldn't add the parent.", "bad"); }
    return;
  }
  if(f.id==="cycleForm"){
    const id=f.cid.value.trim(), label=f.label.value.trim();
    if(!id||!label){ toast("Give the cycle an ID and a name.", "bad"); return; }
    try{ await S.startCycle(id, label, f.opens.value, f.closes.value, f.copy.checked ? S.cycle.id : null); toast("New cycle started. Reloading…", "good"); setTimeout(()=>location.reload(), 900); }
    catch(err){ toast(err.message||"Couldn't start the cycle.", "bad"); }
    return;
  }
  if(f.id==="purgeForm"){
    if(f.confirm.value.trim()!=="DELETE"){ toast("Type DELETE to confirm.", "bad"); return; }
    try{ const r = await S.purgeParents(); toast("Parent data deleted.", "good"); f.reset(); }catch(err){ toast(err.message||"Couldn't delete.", "bad"); }
    return;
  }
  if(f.id==="staffForm"){
    const email=f.email.value.trim().toLowerCase(), name=f.name.value.trim();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ toast("Enter a valid email address.", "bad"); return; }
    try{ await S.addStaff(email, name); HC.staff = await S.headStaff(); $("#staffList").innerHTML = staffRows(); f.reset(); toast(`${email} can now sign in.`, "good"); }
    catch(err){ toast("Couldn't add the coach.", "bad"); }
    return;
  }
  if(f.id!=="detForm") return;
  const name = f.name.value.trim(), email = f.email.value.trim(), role = (f.querySelector("input[name=role]:checked")||{}).value||"";
  const group = (f.querySelector("input[name=group]:checked")||{}).value||"";
  const err = {};
  if(!group) err.group = "Choose your age group.";
  if(name.split(/\s+/).length < 2) err.name = "Enter your first and last name.";
  if(!role) err.role = "Choose lead or assistant.";
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) err.email = "Enter a valid email address, e.g. name@example.com.";
  coach = {name, role, email};
  if(Object.keys(err).length){ renderDetails(err); return; }
  try{ await S.saveProfile({name, role, email, group}); }catch(e2){ toast(e2.message||"Couldn't save your details.", "bad"); return; }
  if(group!==st.group){ st.group = group; st.cur = 0; st.cp = 0; }
  await openGroup(st.group);
  st.step = "intro"; render(); window.scrollTo(0,0);
});
document.addEventListener("click", async e=>{
  const t = e.target;
  if(t.closest("[data-relogin]")){ renderLogin(); return; }
  if(t.closest("[data-signout]")){ await S.signOut(); location.reload(); return; }
  const stp = t.closest("[data-step]"); if(stp){ st.step = stp.dataset.step; if(st.step==="app") st.view="rate"; render(); return; }
  if(t.closest("[data-edit]")){ st.step="details"; render(); return; }
  if(t.closest("[data-undo]")){ undo(); return; }
  const tab = t.closest("[role=tab]"); if(tab){ st.view = tab.dataset.v; render(); $(".board")?.scrollTo(0,0); return; }
  const at = t.closest("[data-a]"); if(at){ st.cur = +at.dataset.a; st.view = "rate"; render(); $(".board")?.scrollTo(0,0); return; }
  const v = t.closest("[data-view]"); if(v){ st.view = v.dataset.view; render(); return; }
  const go = t.closest("[data-go]"); if(go){ st.cur = +go.dataset.go; render(); $(".board")?.scrollTo(0,0); return; }
  const cp = t.closest("[data-cp]"); if(cp){ st.cp = +cp.dataset.cp; render(); $(".board")?.scrollTo(0,0); return; }
  const cpg = t.closest("[data-cpgo]"); if(cpg){ st.cp = +cpg.dataset.cpgo; render(); $(".board")?.scrollTo(0,0); return; }
  const cpn = t.closest("[data-cpname]"); if(cpn){ const ps=[...D.players].sort((a,b)=>a.full.localeCompare(b.full)); st.cp = ps.findIndex(p=>String(p.id)===cpn.dataset.cpname); st.view="comments"; render(); return; }
  const dr = t.closest("[data-draft]"); if(dr){
    const ps=[...D.players].sort((a,b)=>a.full.localeCompare(b.full)); const p=ps[st.cp]; const sec=SECTIONS.find(s=>s.id===dr.dataset.draft);
    const ta = $(`#cm-${sec.id}`);
    if(ta.value.trim() && !ta.dataset.confirm){ ta.dataset.confirm="1"; dr.textContent="Replace my text?"; return; }
    dr.disabled = true; dr.textContent = "Drafting…";
    let text = null;
    try{ text = await S.draftComment({player:p, section:sec, scores: ATTRS.filter(a=>sec.pillars.includes(a.p)).map(a=>({attribute:a.n, score:num(a.id,p.id)})), group:grp().label}); }catch(err){ console.warn(err); }
    text = text || templateDraft(p, sec);
    ta.value = text; ta.dispatchEvent(new Event("input", {bubbles:true})); delete ta.dataset.confirm;
    dr.disabled = false; dr.textContent = "Draft from scores"; ta.focus();
    return;
  }
  if(t.closest("[data-submit]")){
    const b = t.closest("[data-submit]"); b.disabled = true;
    try{ D.submission = await S.submit(st.group); toast("Submitted. Thank you!", "good"); }catch(err){ toast("Couldn't submit: check your connection and try again.", "bad"); }
    render(); return;
  }
  if(t.closest("[data-mfa-start]")){ try{ MFA.enroll = await S.mfaEnroll(); MFA.err=""; }catch(err){ MFA.err = err.message||"Couldn't start set-up."; } render(); return; }
  const sd = t.closest("[data-send]"); if(sd){ const m=sd.dataset.mode; if(m==="real"){ PAR.confirming = sd.dataset.send; render(); $("#sendConfirm")?.focus(); } else doSend(sd.dataset.send, m==="test"?"test":"dry"); return; }
  if(t.closest("[data-send-cancel]")){ PAR.confirming=null; render(); return; }
  const sr = t.closest("[data-send-real]"); if(sr){ const typed=$("#sendConfirm").value.trim(); if(typed!==`SEND ${PAR.group}`){ toast(`Type SEND ${PAR.group} exactly.`, "bad"); return; } doSend(sr.dataset.sendReal, "real", {confirm_text: typed}); return; }
  const rs = t.closest("[data-resend]"); if(rs){ doSend(rs.dataset.resend, "real", {contact_id: rs.dataset.contact, confirm_text:`SEND ${PAR.group}`}); return; }
  const dc = t.closest("[data-deact]"); if(dc){ try{ await S.setContactActive(dc.dataset.deact, dc.dataset.on==="1"); PAR.group=null; render(); }catch(err){ toast("Couldn't update.", "bad"); } return; }
  if(t.closest("[data-approve-all]")){ const {players, commentCount, approvals} = PAR.data; const ids = players.filter(p=>(commentCount[p.id]||0)>=SECTIONS.length && !approvals[p.id]).map(p=>p.id);
    try{ await S.approve(PAR.group, ids, true); toast(`${ids.length} report${ids.length===1?"":"s"} approved.`, "good"); PAR.group=null; render(); }catch(err){ toast("Couldn't approve.", "bad"); } return; }
  const rp = t.closest("[data-rp]"); if(rp){ st.rp = +rp.dataset.rp; render(); $(".board")?.scrollTo(0,0); return; }
  const rpg = t.closest("[data-rpgo]"); if(rpg){ st.rp = +rpg.dataset.rpgo; render(); $(".board")?.scrollTo(0,0); return; }
  if(t.closest("[data-print]")){ window.print(); return; }
  if(t.closest("[data-sample]")){
    const f = $("#detForm"); const g = (f.querySelector("input[name=group]:checked")||{}).value || "U11";
    const name = f.name.value.trim().split(/\s+/).length>1 ? f.name.value.trim() : "Sample Coach";
    coach = {name, role:"Lead", email: f.email.value.trim() || "coach@example.com"};
    S.loadSample(g, coach);
    st.group = g; st.cur = 0; st.cp = 0; st.rp = 0; st.hcGroup = g; HC = {group:null, data:null, loading:false, staff:null};
    await openGroup(g);
    for(const p of D.players){ D.comments[p.id] = {}; for(const sec of SECTIONS){ const t2 = templateDraft(p, sec); D.comments[p.id][sec.id] = t2; await S.saveComment(g, p.id, sec.id, t2); } }
    st.step = "app"; st.view = "reports"; render(); toast("Sample squad loaded. Use the tabs to look around.", "good");
    return;
  }
  const hc = t.closest("[data-hc]"); if(hc){ st.hcGroup = hc.dataset.hc; st.rp = 0; HC.group=null; PAR.group=null; PAR.confirming=null; render(); return; }
  const sf = t.closest("[data-staff]"); if(sf){ try{ await S.setStaffActive(sf.dataset.staff, sf.dataset.on==="1"); HC.staff = await S.headStaff(); $("#staffList").innerHTML = staffRows(); }catch(err){ toast("Couldn't update access.", "bad"); } return; }
  if(t.closest("[data-hcexport]")){ S.download(`melita-ratings-${HC.group}.csv`, headCsv()); return; }
  if(t.id==="copy"){ const ta=$("#csv"); navigator.clipboard?.writeText(ta.value).then(()=>{$("#copied").textContent="Copied";},()=>{ta.select();$("#copied").textContent="Select all and copy";}); return; }
});
document.addEventListener("change", async e=>{
  const cb = e.target.closest?.("[data-approve]"); if(!cb) return;
  try{ await S.approve(PAR.group, [cb.dataset.approve], cb.checked); PAR.group=null; render(); }catch(err){ toast("Couldn't update approval.", "bad"); cb.checked=!cb.checked; }
});
document.addEventListener("keydown", e=>{
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==="z" && st.step==="app" && st.view==="rate" && !e.target.matches?.("input,textarea")){ e.preventDefault(); undo(); }
});

/* pointer drag & drop: mouse, touch and pen */
let drag=null, suppressClick=false;
document.addEventListener("pointerdown", e=>{
  const ch = e.target.closest?.(".chip[data-p]"); if(!ch || e.button>0) return;
  drag = {id:ch.dataset.p, x:e.clientX, y:e.clientY, el:ch, ghost:null, on:false};
});
document.addEventListener("pointermove", e=>{
  if(!drag) return;
  if(!drag.on){
    if(Math.hypot(e.clientX-drag.x, e.clientY-drag.y) < 6) return;
    drag.on = true;
    const g = drag.el.cloneNode(true); g.classList.add("sel","ghosting");
    const r = drag.el.getBoundingClientRect();
    g.style.cssText = `position:fixed;left:0;top:0;width:${r.width}px;pointer-events:none;z-index:99;transform:translate(${e.clientX-r.width/2}px,${e.clientY-20}px) rotate(-2deg)`;
    document.body.appendChild(g); drag.ghost = g; drag.el.style.opacity=".3";
    document.body.classList.add("dragging");
  }
  e.preventDefault();
  const w = drag.ghost.offsetWidth;
  drag.ghost.style.transform = `translate(${e.clientX-w/2}px,${e.clientY-20}px) rotate(-2deg)`;
  document.querySelectorAll(".over").forEach(x=>x.classList.remove("over"));
  const tgt = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-s]");
  if(tgt) tgt.classList.add("over");
  const b = $(".board"); if(b){ const br=b.getBoundingClientRect();
    if(e.clientY < br.top+60) b.scrollBy(0,-14); else if(e.clientY > br.bottom-110) b.scrollBy(0,14); }
}, {passive:false});
function endDrag(e){
  if(!drag) return;
  const d = drag; drag = null;
  if(!d.on) return;
  d.ghost.remove(); d.el.style.opacity=""; document.body.classList.remove("dragging");
  suppressClick = true; setTimeout(()=>suppressClick=false, 0);
  const tgt = e && document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-s]");
  document.querySelectorAll(".over").forEach(x=>x.classList.remove("over"));
  if(tgt){ const s = tgt.dataset.s; place(d.id, s==="NO"||s==="TRAY"?s:+s); }
}
document.addEventListener("pointerup", endDrag);
document.addEventListener("pointercancel", ()=>endDrag(null));
document.addEventListener("click", e=>{ if(suppressClick){ e.stopPropagation(); e.preventDefault(); } }, true);

/* ---------- boot ---------- */
$("#view").innerHTML = `<div class="onb"><div class="card"><p>Loading…</p></div></div>`;
try{
  auth = await S.init();
  ATTRS = S.attrs(); GROUPS = S.groups(); PILLARS = [...new Set(ATTRS.map(a=>a.p))];
  if(!auth.signedIn){ st.step = "login"; if(auth.linkFailed) loginMsg = "That sign-in link didn't work here (it may have expired or been opened in a different browser). Enter your email to get a new code."; }
  else if(!auth.isStaff){ st.step = "notstaff"; }
  else {
    const prof = await S.profile();
    if(prof){ coach = {name:prof.name, role:prof.role, email:prof.email||auth.email}; if(prof.group) st.group = prof.group; }
    else { coach.email = auth.email||""; }
    if(!prof || !st.group || !GROUPS.find(g=>g.id===st.group)) st.step = "details";
    else { await openGroup(st.group); if(st.step==="login"||st.step==="notstaff") st.step="app"; }
  }
  st.cur = Math.min(st.cur||0, ATTRS.length-1);
  render();
}catch(err){
  console.error(err);
  $("#view").innerHTML = err?.message==="NOT_CONFIGURED"
    ? `<div class="onb"><div class="card"><h2>Setup needed</h2><p>This site isn't connected to the database yet. In Netlify, add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> under Site configuration → Environment variables, then trigger a new deploy.</p></div></div>`
    : `<div class="onb"><div class="card"><h2>Something went wrong</h2><p>We couldn't load the player report. Check your connection and refresh the page. If it keeps happening, tell the Head Coach.</p></div></div>`;
}
})();
