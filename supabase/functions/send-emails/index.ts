// send-emails: the only way parent emails leave the system.
// Called from the Head Coach screen. Requires a signed-in Head Coach with two-step login.
// Deploy:  supabase functions deploy send-emails
// Secrets: supabase secrets set RESEND_API_KEY=re_... SITE_URL=https://reports.melitafc.com \
//          EMAIL_FROM="Melita FC <reports@melitafc.com>" EMAIL_REPLY_TO=academy@melitafc.com
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { sendAll, type Prepared, type Purpose } from "./logic.ts";

const cors = { "Access-Control-Allow-Origin": Deno.env.get("SITE_URL") ?? "*",
               "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const cfg = { siteUrl: Deno.env.get("SITE_URL") ?? "", from: Deno.env.get("EMAIL_FROM") ?? "", replyTo: Deno.env.get("EMAIL_REPLY_TO") ?? "", club: "Melita FC" };
  if (!apiKey || !cfg.siteUrl || !cfg.from || !cfg.replyTo) return json({ error: "Email sending isn't set up yet (missing secrets)." }, 501);

  // 1. who is asking? must be the Head Coach with two-step login (checked by the database)
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await asUser.auth.getUser();
  const { data: isHead } = await asUser.rpc("is_head_coach");
  if (!user || isHead !== true) return json({ error: "Head Coach with two-step login only." }, 403);

  // 2. what to send
  const b = await req.json().catch(() => ({}));
  const purpose = b.purpose as Purpose, group = String(b.group ?? ""), dryRun = b.mode !== "real";
  if (!["confirm", "report"].includes(purpose) || !group) return json({ error: "Bad request" }, 400);
  if (b.mode === "real" && b.confirm_text !== `SEND ${group}`) return json({ error: `Type SEND ${group} to confirm a real send.` }, 400);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: cyc } = await admin.from("cycles").select("id").eq("is_active", true).maybeSingle();
  if (!cyc) return json({ error: "No active cycle" }, 400);
  const { data: prof } = await admin.from("coach_profiles").select("email").eq("user_id", user.id).maybeSingle();
  const actorEmail = (prof?.email ?? user.email ?? "").toLowerCase();

  // 3. the database picks the recipients and creates one link per parent per child
  const { data: rows, error } = await admin.rpc("prepare_emails", {
    p_purpose: purpose, p_cycle: cyc.id, p_group: group, p_dry_run: dryRun, p_actor: user.id,
    p_player: b.player_id ?? null, p_contact: b.contact_id ?? null });
  if (error) return json({ error: error.message }, 500);
  const list = (rows ?? []) as Prepared[];
  if (list.length > 400) return json({ error: "Too many in one go; send one age group at a time." }, 400);
  if (!list.length) return json({ prepared: 0, sent: 0, failed: 0, note: purpose === "report"
    ? "Nothing to send: reports must be approved and parents confirmed, and anyone already sent is skipped."
    : "Nothing to send: everyone in this group has confirmed or already been sent the email." });

  // 4. send, marking every email sent or failed
  const mark = async (id: number, status: "sent" | "failed", pid?: string | null, err?: string | null) => {
    await admin.rpc("mark_email", { p_log: id, p_status: status, p_provider: pid ?? null, p_error: err ?? null });
  };
  const r = await sendAll(list, purpose, dryRun, actorEmail, cfg, apiKey, fetch, mark);
  return json({ prepared: list.length, ...r, dry_run: dryRun });
});
