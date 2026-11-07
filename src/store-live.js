/* Live store: Supabase (Postgres + email sign-in). Same interface as store-demo.js. */
import { createClient } from "@supabase/supabase-js";

const SB_URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const CONFIGURED = !!(SB_URL && KEY);
const sb = CONFIGURED ? createClient(SB_URL, KEY, { auth: { persistSession: true, detectSessionInUrl: true, flowType: "pkce" } }) : null;

let cache = { groups: [], attrs: [], cycle: null, user: null, activity: {} };
const must = ({ data, error }) => { if (error) throw error; return data; };

window.STORE = {
  mode: "live",
  get cycle() { return cache.cycle || { id: "", label: "" }; },
  async init() {
    if (!CONFIGURED) throw new Error("NOT_CONFIGURED");
    const hadLink = /[?&#](code|error|error_description|token_hash)=/.test(location.search + location.hash);
    const { data: { session } } = await sb.auth.getSession();
    if (hadLink) history.replaceState(null, "", location.pathname);
    if (!session) return { signedIn: false, linkFailed: hadLink };
    cache.user = session.user;
    const email = (session.user.email || "").toLowerCase();
    const staff = must(await sb.from("staff").select("email,is_head_coach,active").eq("email", email).maybeSingle());
    if (!staff || !staff.active) return { signedIn: true, isStaff: false, email };
    const [groups, attrs, cycles] = await Promise.all([
      sb.from("age_groups").select("*").order("sort"),
      sb.from("attributes").select("*").order("sort"),
      sb.from("cycles").select("*").eq("is_active", true).limit(1),
    ]);
    cache.groups = must(groups).map(g => ({ id: g.id, label: g.label, band: g.band, mixed: g.mixed }));
    cache.attrs = must(attrs).map(a => ({ id: a.id, p: a.pillar, n: a.name, w: a.description, a: a.anchors }));
    const c = must(cycles)[0];
    if (!c) throw new Error("No active report cycle. The Head Coach needs to set one as active.");
    cache.cycle = { id: c.id, label: c.label, closes: c.closes_on };
    return { signedIn: true, isStaff: true, isHead: staff.is_head_coach, email };
  },
  groups: () => cache.groups,
  attrs: () => cache.attrs,

  async sendLink(email) {
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
    if (error) throw new Error(error.message.includes("rate") ? "Too many attempts. Wait a minute and try again." : error.message);
  },
  async verifyCode(email, token) {
    const { error } = await sb.auth.verifyOtp({ email, token, type: "email" });
    if (error) throw error;
  },
  async signOut() { await sb.auth.signOut(); try { localStorage.removeItem("melita-ui-v5"); } catch (e) {} },

  async profile() {
    const uid = cache.user.id;
    const prof = must(await sb.from("coach_profiles").select("*").eq("user_id", uid).maybeSingle());
    if (!prof) return null;
    const asg = must(await sb.from("coach_assignments").select("*").eq("user_id", uid).eq("cycle_id", cache.cycle.id).order("updated_at", { ascending: false }));
    let ui = {}; try { ui = JSON.parse(localStorage.getItem("melita-ui-v5")) || {}; } catch (e) {}
    const current = asg.find(a => a.age_group_id === ui.group) || asg[0];
    return { name: prof.full_name, email: prof.email, role: current?.role || "", group: current?.age_group_id || "" };
  },
  async saveProfile({ name, role, group }) {
    const uid = cache.user.id, now = new Date().toISOString();
    must(await sb.from("coach_profiles").upsert({ user_id: uid, email: cache.user.email, full_name: name, updated_at: now }));
    must(await sb.from("coach_assignments").upsert({ cycle_id: cache.cycle.id, age_group_id: group, user_id: uid, role, updated_at: now }));
  },

  async loadGroup(g) {
    const c = cache.cycle.id, uid = cache.user.id;
    const [sq, rt, cm, sub, act] = await Promise.all([
      sb.from("squad_members").select("player_id, players(id, comet_no, full_name, birth_year)").eq("cycle_id", c).eq("age_group_id", g),
      sb.from("ratings").select("player_id,attribute_id,score,not_observed").eq("cycle_id", c).eq("age_group_id", g).eq("user_id", uid),
      sb.from("comments").select("player_id,section,body").eq("cycle_id", c).eq("age_group_id", g).eq("user_id", uid),
      sb.from("submissions").select("submitted_at").eq("cycle_id", c).eq("age_group_id", g).eq("user_id", uid).maybeSingle(),
      sb.from("coach_activity").select("changed_at").eq("cycle_id", c).eq("age_group_id", g).eq("user_id", uid).maybeSingle(),
    ]);
    const players = must(sq).map(r => ({ id: r.players.id, full: r.players.full_name, c: r.players.comet_no, y: r.players.birth_year }))
      .sort((a, b) => a.full.localeCompare(b.full));
    const ratings = {};
    must(rt).forEach(r => { (ratings[r.attribute_id] ||= {})[r.player_id] = r.not_observed ? "NO" : r.score; });
    const comments = {};
    must(cm).forEach(r => { (comments[r.player_id] ||= {})[r.section] = r.body; });
    const s = must(sub), a = must(act);
    cache.activity[g] = { submitted: s ? Date.parse(s.submitted_at) : 0, changed: a ? Date.parse(a.changed_at) : 0 };
    return { players, ratings, comments, submission: s ? { submittedAt: Date.parse(s.submitted_at) } : null };
  },
  async saveRating(g, attrId, playerId, value) {
    const key = { cycle_id: cache.cycle.id, age_group_id: g, player_id: playerId, attribute_id: attrId, user_id: cache.user.id };
    if (value === undefined) {
      must(await sb.from("ratings").delete().match(key));
    } else {
      must(await sb.from("ratings").upsert({ ...key, score: value === "NO" ? null : value, not_observed: value === "NO", updated_at: new Date().toISOString() }));
    }
    (cache.activity[g] ||= {}).changed = Date.now();
  },
  async saveComment(g, playerId, section, text) {
    must(await sb.from("comments").upsert({ cycle_id: cache.cycle.id, age_group_id: g, player_id: playerId, section, user_id: cache.user.id, body: text, updated_at: new Date().toISOString() }));
    (cache.activity[g] ||= {}).changed = Date.now();
  },
  async submit(g) {
    const now = new Date();
    must(await sb.from("submissions").upsert({ cycle_id: cache.cycle.id, age_group_id: g, user_id: cache.user.id, submitted_at: now.toISOString() }));
    cache.activity[g] = { submitted: now.getTime() + 1000, changed: cache.activity[g]?.changed || 0 };
    return { submittedAt: now.getTime() };
  },
  changedSinceSubmit(g) { const a = cache.activity[g]; return !!(a && a.submitted && a.changed > a.submitted); },

  // AI draft through the draft-comment edge function. Returns null if it isn't set up, so the built-in draft is used.
  async draftComment(payload) {
    try {
      const { data, error } = await sb.functions.invoke("draft-comment", { body: {
        first_name: payload.player.full.split(" ")[0], section: payload.section.label, age_group: payload.group, scores: payload.scores } });
      if (error) return null;
      return (data && data.text) || null;
    } catch (e) { return null; }
  },

  // ---------- Head Coach ----------
  async headLoad(g) {
    const c = cache.cycle.id;
    const [sq, rt, cs, cm] = await Promise.all([
      sb.from("squad_members").select("player_id, players(id, comet_no, full_name, birth_year)").eq("cycle_id", c).eq("age_group_id", g),
      fetchAll(q => q.from("ratings").select("player_id,attribute_id,user_id,score,not_observed").eq("cycle_id", c).eq("age_group_id", g)),
      sb.from("coach_status").select("*").eq("cycle_id", c).eq("age_group_id", g),
      sb.from("comments").select("player_id,section,body,user_id").eq("cycle_id", c).eq("age_group_id", g),
    ]);
    const players = must(sq).map(r => ({ id: r.players.id, full: r.players.full_name, c: r.players.comet_no, y: r.players.birth_year }))
      .sort((a, b) => a.full.localeCompare(b.full));
    const ratings = {};
    rt.forEach(r => { ((ratings[r.attribute_id] ||= {})[r.player_id] ||= {})[r.user_id] = r.not_observed ? "NO" : r.score; });
    const coaches = must(cs).map(x => ({ user_id: x.user_id, full_name: x.full_name || x.email, email: x.email, role: x.role, submitted_at: x.submitted_at }))
      .sort((a, b) => (a.role === "Lead" ? -1 : 1) - (b.role === "Lead" ? -1 : 1));
    // report comments come from the group's lead coach
    const lead = coaches.find(x => x.role === "Lead");
    const comments = {};
    must(cm).filter(r => !lead || r.user_id === lead.user_id).forEach(r => { (comments[r.player_id] ||= {})[r.section] = r.body; });
    return { players, coaches, ratings, comments };
  },
  // ---------- two-step login (Head Coach) ----------
  async mfaStatus() {
    const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    const { data: f } = await sb.auth.mfa.listFactors();
    const totp = (f?.totp || []).find(x => x.status === "verified");
    return { level: data?.currentLevel, enrolled: !!totp, factorId: totp?.id };
  },
  async mfaEnroll() {
    const { data: f } = await sb.auth.mfa.listFactors();
    for (const x of (f?.all || []).filter(x => x.status === "unverified")) await sb.auth.mfa.unenroll({ factorId: x.id });
    const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "Melita Head Coach" });
    if (error) throw error;
    const q = data.totp.qr_code || "";
    const qr = q.startsWith("data:") ? q : "data:image/svg+xml;charset=utf-8," + encodeURIComponent(q);
    return { factorId: data.id, qr, secret: data.totp.secret };
  },
  async mfaVerify(factorId, code) {
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) throw new Error("That code didn't work. Check the time on your phone and try the newest code.");
  },

  // ---------- parents & sending (Head Coach, two-step login) ----------
  async parentsLoad(g) {
    const c = cache.cycle.id;
    const sq = must(await sb.from("squad_members").select("player_id, players(id, full_name, birth_year)").eq("cycle_id", c).eq("age_group_id", g));
    const ids = sq.map(r => r.player_id);
    const [pc, ap, lg, cm] = await Promise.all([
      sb.from("parent_contacts").select("*").in("player_id", ids),
      sb.from("report_approvals").select("player_id, approved_at").eq("cycle_id", c).eq("age_group_id", g),
      sb.from("email_log").select("id,created_at,purpose,player_id,contact_id,status,dry_run,recipient,intended_recipient,error").in("player_id", ids).order("id", { ascending: false }).limit(2000),
      sb.from("comments").select("player_id, section, body").eq("cycle_id", c).eq("age_group_id", g),
    ]);
    const players = sq.map(r => ({ id: r.players.id, full: r.players.full_name, y: r.players.birth_year })).sort((a, b) => a.full.localeCompare(b.full));
    const comments = {}; must(cm).forEach(r => { if ((r.body || "").trim()) (comments[r.player_id] ||= new Set()).add(r.section); });
    return { players, contacts: must(pc), approvals: Object.fromEntries(must(ap).map(a => [a.player_id, a.approved_at])),
             log: must(lg), commentCount: Object.fromEntries(Object.entries(comments).map(([k, v]) => [k, v.size])) };
  },
  async approve(g, playerIds, on) {
    const c = cache.cycle.id;
    if (on) must(await sb.from("report_approvals").upsert(playerIds.map(p => ({ cycle_id: c, age_group_id: g, player_id: p }))));
    else must(await sb.from("report_approvals").delete().eq("cycle_id", c).eq("age_group_id", g).in("player_id", playerIds));
  },
  async addContact(playerId, email, full_name, relation) {
    must(await sb.from("parent_contacts").insert({ player_id: playerId, email: email.toLowerCase().trim(), full_name, relation: relation || null }));
  },
  async setContactActive(id, active) { must(await sb.from("parent_contacts").update({ active }).eq("id", id)); },
  async sendEmails(body) {
    const { data, error } = await sb.functions.invoke("send-emails", { body });
    if (error) {
      let msg = error.message;
      try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch (e) {}
      throw new Error(msg);
    }
    return data;
  },
  async startCycle(id, label, opens, closes, copyFrom) {
    must(await sb.rpc("start_cycle", { p_id: id, p_label: label, p_opens: opens || null, p_closes: closes || null, p_copy_squads_from: copyFrom || null }));
  },
  async purgeParents() { return must(await sb.rpc("purge_parent_data")); },

  async headStaff() { return must(await sb.from("staff").select("*").order("email")); },
  async addStaff(email, full_name) { must(await sb.from("staff").upsert({ email: email.toLowerCase(), full_name, active: true })); },
  async setStaffActive(email, active) { must(await sb.from("staff").update({ active }).eq("email", email)); },
  download(name, text) {
    const a = document.createElement("a");
    a.href = window.URL.createObjectURL(new Blob([text], { type: "text/csv" })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  },
};

// Supabase returns at most 1000 rows per request; a group can have ~2,000+ ratings.
async function fetchAll(build) {
  const out = []; const size = 1000;
  for (let from = 0; ; from += size) {
    const rows = must(await build(sb).range(from, from + size - 1));
    out.push(...rows); if (rows.length < size) break;
  }
  return out;
}
