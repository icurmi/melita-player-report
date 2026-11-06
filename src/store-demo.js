/* Demo store: everything lives in this browser (prototype). Same interface as store-live.js. */
(function(){
  const KEY = "melita-rating-demo-v5";
  const read = ()=>{ try{ return JSON.parse(localStorage.getItem(KEY)) || {}; }catch(e){ return {}; } };
  let db = read();
  const write = ()=>{ try{ localStorage.setItem(KEY, JSON.stringify(db)); }catch(e){} };
  const DATA = window.MELITA_DATA; // {groups, attrs, squads:{U9:[{id,full,c,y}]}}

  window.STORE = {
    mode: "demo",
    cycle: {id:"2026-27-C1", label:"2026/27 · Report cycle 1 (January)"},
    async init(){
      // The prototype shows the Head Coach screens too, so they can be previewed.
      return { signedIn:true, email: db.coach?.email || "", isHead:true, isStaff:true };
    },
    groups: ()=>DATA.groups,
    attrs: ()=>DATA.attrs,
    async profile(){ return db.coach ? {...db.coach} : null; },
    async saveProfile(p){ db.coach = {...p}; write(); },
    async loadGroup(g){
      db.g ||= {}; db.g[g] ||= {r:{}, c:{}, sub:null};
      const players = (DATA.squads[g]||[]).map((p,i)=>({id: p.c || `${g}-${i}`, full:p.full, c:p.c, y:p.y}));
      return { players, ratings: db.g[g].r, comments: db.g[g].c, submission: db.g[g].sub, sample:false };
    },
    async saveRating(g, attrId, playerId, value){
      const r = (db.g[g].r[attrId] ||= {});
      if(value===undefined) delete r[playerId]; else r[playerId] = value;
      db.g[g].changedAt = Date.now(); write();
    },
    async saveComment(g, playerId, section, text){
      const c = (db.g[g].c[playerId] ||= {});
      c[section] = text; db.g[g].changedAt = Date.now(); write();
    },
    async submit(g){ db.g[g].sub = {submittedAt: Date.now()}; db.g[g].changedAt = 0; write(); return db.g[g].sub; },
    changedSinceSubmit(g){ return !!(db.g?.[g]?.sub && db.g[g].changedAt); },
    async draftComment(){ return null; },   // demo uses the built-in draft writer
    async signOut(){},
    // ---- Head Coach (prototype: your own ratings, plus the sample assistant if a sample squad is loaded) ----
    async headLoad(g){
      const players = (DATA.squads[g]||[]).map((p,i)=>({id: p.c || `${g}-${i}`, full:p.full, c:p.c, y:p.y}));
      const gd = db.g?.[g] || {r:{}, c:{}};
      const ratings = {};
      const add = (src, uid)=>Object.entries(src||{}).forEach(([aid,m])=>Object.entries(m).forEach(([pid,v])=>{ ((ratings[aid] ||= {})[pid] ||= {})[uid] = v; }));
      add(gd.r, "me"); add(gd.r2, "sample");
      const coaches = [{user_id:"me", full_name: db.coach?.name || "You", email: db.coach?.email || "", role: db.coach?.role || "Lead", submitted_at: gd.sub ? new Date(gd.sub.submittedAt).toISOString() : null}];
      if(gd.r2) coaches.push({user_id:"sample", full_name:"Sample Assistant", email:"assistant@example.com", role:"Assistant", submitted_at:new Date().toISOString()});
      return { players, coaches, ratings, comments: gd.c || {} };
    },
    async headStaff(){ return [{email: db.coach?.email || "you@example.com", full_name: db.coach?.name || "You", is_head_coach:true, active:true}, ...(db.staff||[])]; },
    async addStaff(email, full_name){ (db.staff ||= []).push({email, full_name, is_head_coach:false, active:true}); write(); },
    async setStaffActive(email, active){ (db.staff||[]).forEach(x=>{ if(x.email===email) x.active = active; }); write(); },
    download(){ throw new Error("Downloads work in the live app."); },
    // ---- prototype: two-step login is simulated; parents are made-up addresses; nothing is ever emailed ----
    async mfaStatus(){ return {level: db.mfa ? "aal2" : "aal1", enrolled: !!db.mfa}; },
    async mfaEnroll(){ return {factorId:"demo", qr:"", secret:"JBSWY3DPEHPK3PXP"}; },
    async mfaVerify(_, code){ if(!/^\d{6}$/.test(code)) throw new Error("Enter the 6-digit code from your app."); db.mfa = true; write(); },
    async parentsLoad(g){
      const players = (DATA.squads[g]||[]).map((p,i)=>({id: p.c || `${g}-${i}`, full:p.full, y:p.y})).sort((a,b)=>a.full.localeCompare(b.full));
      db.par ||= {}; const P = (db.par[g] ||= {contacts:null, approvals:{}, log:[]});
      if(!P.contacts){ P.contacts = []; players.forEach((p,i)=>{ const last=p.full.split(" ").slice(1).join("").toLowerCase().replace(/[^a-z]/g,"");
        P.contacts.push({id:`${p.id}-1`, player_id:p.id, email:`parent1.${last}@example.com`, full_name:"Parent One", relation:"Father", active:true, confirmed_at: i%4===0?null:new Date().toISOString()});
        if(i%3) P.contacts.push({id:`${p.id}-2`, player_id:p.id, email:`parent2.${last}@example.com`, full_name:"Parent Two", relation:"Mother", active:true, confirmed_at: i%5===0?null:new Date().toISOString()}); }); write(); }
      const cc = {}; Object.entries(db.g?.[g]?.c||{}).forEach(([pid,secs])=>{ cc[pid] = Object.values(secs).filter(t=>(t||"").trim()).length; });
      return {players, contacts:P.contacts, approvals:P.approvals, log:P.log, commentCount:cc};
    },
    async approve(g, ids, on){ const P=db.par[g]; ids.forEach(id=>{ if(on) P.approvals[id]=new Date().toISOString(); else delete P.approvals[id]; }); write(); },
    async addContact(pid, email, full_name, relation){ const g=Object.keys(db.par).find(k=>db.par[k].contacts.some(c=>c.player_id===pid)); db.par[g].contacts.push({id:pid+"-"+Date.now(), player_id:pid, email, full_name, relation, active:true, confirmed_at:null}); write(); },
    async setContactActive(id, on){ Object.values(db.par).forEach(P=>P.contacts.forEach(c=>{ if(c.id===id) c.active=on; })); write(); },
    async sendEmails(b){
      const P = db.par[b.group]; const me = db.coach?.email || "you@example.com"; const dry = b.mode!=="real";
      if(b.mode==="real" && b.confirm_text!==`SEND ${b.group}`) throw new Error(`Type SEND ${b.group} to confirm a real send.`);
      const sentBefore = c=>P.log.some(l=>l.contact_id===c.id && l.purpose===b.purpose && !l.dry_run && ["sent","opened","confirmed"].includes(l.status));
      const list = P.contacts.filter(c=>c.active && (!b.player_id || c.player_id===b.player_id) && (!b.contact_id || c.id===b.contact_id)
        && (b.purpose==="confirm" ? (!c.confirmed_at || b.contact_id) : (c.confirmed_at && P.approvals[c.player_id]))
        && (dry || b.player_id || b.contact_id || !sentBefore(c)));
      list.forEach(c=>P.log.unshift({id:Date.now()+Math.random(), created_at:new Date().toISOString(), purpose:b.purpose, player_id:c.player_id, contact_id:c.id, status:"sent", dry_run:dry, recipient: dry?me:c.email, intended_recipient:c.email}));
      write();
      return {prepared:list.length, sent:list.length, failed:0, dry_run:dry, note: list.length?"":"Nothing to send.", demo:true};
    },
    async startCycle(){ throw new Error("Starting a new cycle works in the live app."); },
    async purgeParents(){ db.par = {}; write(); return {contacts:"all", links:"all", log:"all"}; },
    // ---- sample squad: every attribute rated, comments drafted, plus a second coach ----
    loadSample(g, coach, draft){
      const players = (DATA.squads[g]||[]).map((p,i)=>({id: p.c || `${g}-${i}`, full:p.full}));
      let seed = 7; const rnd = ()=>{ seed = (seed*16807) % 2147483647; return (seed-1)/2147483646; };
      const pillarBias = {}; const r = {}, r2 = {};
      const base = players.map(()=>3.6 + rnd()*3.2);
      const tilt = players.map(()=>({}));
      DATA.attrs.forEach(a=>{
        r[a.id] = {}; r2[a.id] = {};
        players.forEach((p,i)=>{
          const t = (tilt[i][a.p] ??= (rnd()-0.5)*2.4);
          if(rnd() < 0.015){ r[a.id][p.id] = "NO"; r2[a.id][p.id] = "NO"; return; }
          const v = Math.max(1, Math.min(9, Math.round(base[i] + t + (rnd()-0.5)*1.8)));
          r[a.id][p.id] = v;
          const d = rnd(); r2[a.id][p.id] = Math.max(1, Math.min(9, v + (d<0.08?2:d<0.16?-2:d<0.4?1:d<0.6?-1:0)));
        });
      });
      db.coach = {...coach, group:g};
      db.g ||= {}; db.g[g] = {r, r2, c:{}, sub:null};
      write();
      return db.g[g];
    },
    async reset(){ db = {}; write(); }
  };
})();
