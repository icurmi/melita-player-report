/* Melita FC player report layout: shared by the Head Coach screen and the parent report page. */
(function(){
const esc = s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt = v=> v==null ? "–" : (Math.round(v*10)/10).toFixed(1).replace(/\.0$/,"");
const CHART_LABEL = n=>n.replace(" (In Possession)","").replace(" (Out Possession)","").replace("Understanding of main Principles","Main principles").replace("Understanding of Main Principles","Main principles")
  .replace("Insight (vision)","Insight").replace("1V1 application","1v1").replace("1V1 Application","1v1").replace("Role(s) responsibility","Role").replace("Role(s) Responsibility","Role")
  .replace("Agility (Change of Direction at Speed)","Agility").replace("Cardiovascular Endurance","Endurance").replace("Creativity with the ball","Creativity").replace("Running with Ball","Running w/ ball");
function barsSVG(items, title){
  const W=560, H=230, L=items.length>5?52:30, B=items.length>5?62:30, T=30, pw=W-L-10, ph=H-B-T;
  const gw = pw/items.length, bw = Math.min(22, gw*0.32);
  const y = v=>T+ph-(v/10)*ph;
  let g = "";
  [0,2,4,6,8,10].forEach(v=>{ g += `<line x1="${L}" x2="${W-10}" y1="${y(v)}" y2="${y(v)}" class="gl"/><text x="${L-6}" y="${y(v)+4}" class="ax" text-anchor="end">${v}</text>`; });
  items.forEach((it,i)=>{
    const cx = L + gw*i + gw/2;
    if(it.own!=null){ g += `<rect x="${cx-bw-1}" y="${y(it.own)}" width="${bw}" height="${T+ph-y(it.own)}" class="bo"/><text x="${cx-bw/2-1}" y="${y(it.own)-4}" class="vl" text-anchor="middle">${fmt(it.own)}</text>`; }
    if(it.team!=null){ g += `<rect x="${cx+1}" y="${y(it.team)}" width="${bw}" height="${T+ph-y(it.team)}" class="bt"/>`; }
    const lx = cx, ly = T+ph+14;
    g += items.length>5 ? `<text x="${lx}" y="${ly}" class="xl" text-anchor="end" transform="rotate(-35 ${lx} ${ly})">${esc(it.label)}</text>` : `<text x="${lx}" y="${ly+2}" class="xl" text-anchor="middle">${esc(it.label)}</text>`;
  });
  return `<figure class="chart"><figcaption>${title?`<b>${esc(title)}</b>`:""}<span><i class="ko"></i>Own</span><span><i class="kt"></i>Team average</span></figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title||"")} chart">${g}</svg></figure>`;
}
function highlight(items){
  const d = items.filter(x=>x.own!=null && x.team!=null).map(x=>({label:x.label, diff:x.own-x.team}));
  if(!d.length) return {best:null, worst:null};
  const s = [...d].sort((a,b)=>b.diff-a.diff);
  const best = s[0].diff>0.25 ? s[0] : null, worst = s[s.length-1].diff<-0.25 ? s[s.length-1] : null;
  return {best, worst};
}
const sg = v=>(v>0?"+":"")+fmt(v);
function hlBox(items){
  const {best, worst} = highlight(items);
  return `<div class="hl"><div class="hb">${best?`${esc(best.label)} <b>(${sg(best.diff)})</b>`:"No clear strength yet"}</div><div class="hw">${worst?`${esc(worst.label)} <b>(${sg(worst.diff)})</b>`:"No weakness identified"}</div></div>`;
}

function render(d){
  // d: {player:{full,c,y}, groupLabel, cycleLabel, attrs:[{id,p,n,w}], own:{id:n}, team:{id:n}, best:{id:n}, comments:{section:text}, coaches, crest}
  const p = d.player, A = d.attrs, cm = d.comments||{};
  const num = v=> (v==null || v==="" ? null : +v);
  const items = pillar=>A.filter(a=>a.p===pillar).map(a=>({label:CHART_LABEL(a.n), own:num(d.own[a.id]), team:num(d.team[a.id])}));
  const box = (title, sec, its)=>`<div class="rbox"><h4>${title}</h4><p class="${cm[sec]?"":"empty"}">${cm[sec]?esc(cm[sec]):"No comment written yet."}</p>${its?hlBox(its):""}</div>`;
  const tips = A.filter(a=>a.p==="TIPS");
  const tipsRows = tips.map(a=>{ const o=num(d.own[a.id]); return `<tr><td><b>${a.n.replace("TIPS ","")[0]}:</b> ${esc(a.w.replace(/\.$/,""))}</td><td class="tv"><span class="tb"><i style="width:${(o||0)*10}%"></i></span><b>${fmt(o)}</b></td><td>${fmt(num(d.team[a.id]))}</td><td class="mb">${fmt(num(d.best[a.id]))}</td></tr>`; }).join("");
  const tipsVals = tips.map(a=>({n:a.n.replace("TIPS ","").replace(" (Game Vision)","").replace(" (Attitude)",""), v:num(d.own[a.id])})).filter(x=>x.v!=null);
  const topV = tipsVals.length ? Math.max(...tipsVals.map(x=>x.v)) : null;
  const strongest = topV==null ? "" : tipsVals.filter(x=>x.v>=topV-0.01).map(x=>x.n.toUpperCase()).join(", ");
  const first = (p.full||"").split(" ")[0];
  const season = (d.cycleLabel||"").split(" ")[0];
  return `<article class="report">
    <section class="page">
      <header class="rh">
        <div><h1>${esc(p.full)}</h1>
          <div class="rmeta"><span class="tag">PLAYER PROFILE ${esc(season)}</span><span>${esc(d.groupLabel)}</span>${p.c?`<span>COMET ${esc(p.c)}</span>`:""}${p.y?`<span>Born ${p.y}</span>`:""}</div></div>
        ${d.crest?`<img src="${d.crest}" alt="Melita FC" class="rcrest">`:""}
      </header>
      <p class="disc">This report is a guide to support ${esc(first)}'s development. Every coach in the group rated each player, and the scores below are their average. Scores compare players with the best in Malta of the same age: <b>5</b> is the typical level, <b>7–9</b> is among the best, and 10 is never given. Ratings are coaches' judgement, so they remain subjective. If you'd like to talk it through, ask for a one-to-one with the coach.</p>
      <div class="rrow">${barsSVG(items("Physical"),"Physical")}${box("Physical","physical",items("Physical"))}</div>
      <div class="rrow">${barsSVG(items("Technical"),"Technical")}${box("Technical","technical",items("Technical"))}</div>
      <table class="tips"><thead><tr><th>TIPS score</th><th>Own score</th><th>Team avg</th><th class="mb">Melita best</th></tr></thead><tbody>${tipsRows}</tbody></table>
      ${strongest?`<p class="strong">Strongest pillar: ${esc(strongest)}</p>`:""}
    </section>
    <section class="page">
      <div class="rrow">${barsSVG(items("Tactical – In Possession"),"In possession")}${box("Tactical","tactical",items("Tactical – In Possession"))}</div>
      <div class="rrow">${barsSVG(items("Tactical – Out of Possession"),"Out of possession")}<div class="rbox"><h4>Out of possession</h4>${hlBox(items("Tactical – Out of Possession"))}</div></div>
      <div class="rrow">${barsSVG(items("Psychological"),"Psychology")}${box("Psychology","psychology",null)}</div>
      <div class="rrow">${barsSVG(items("Behavioural"),"Behaviour")}${box("Behavioural","behavioural",null)}</div>
      <footer class="rf">Melita FC Development Phase · ${esc(d.cycleLabel)} · rated by ${d.coaches} coach${d.coaches===1?"":"es"}; "not observed" scores are left out.</footer>
    </section>
  </article>`;
}
window.MelitaReport = { render };
})();
