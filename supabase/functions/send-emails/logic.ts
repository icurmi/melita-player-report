// Pure logic for send-emails: building messages and sending them safely.
// Kept free of Deno/Supabase imports so it can be unit-tested.

export type Prepared = {
  log_id: number; token: string; recipient: string; intended_recipient: string; parent_name: string | null;
  child_first_name: string; child_full_name: string; group_label: string; cycle_label: string; expires_at: string;
};
export type Purpose = "confirm" | "report";
export type Config = { siteUrl: string; from: string; replyTo: string; club: string };

const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Malta" });
const firstName = (n: string | null) => (n || "").trim().split(/\s+/)[0] || "";

export function buildEmail(p: Prepared, purpose: Purpose, dryRun: boolean, cfg: Config) {
  const kid = p.child_first_name;
  const hello = firstName(p.parent_name) ? `Dear ${firstName(p.parent_name)},` : "Dear parent or guardian,";
  const link = `${cfg.siteUrl.replace(/\/$/, "")}/${purpose === "confirm" ? "confirm" : "report"}.html#t=${p.token}`;
  const expires = day(p.expires_at);
  const subject = (dryRun ? "[TEST] " : "") + (purpose === "confirm"
    ? `Please confirm: ${kid}'s Melita FC player report`
    : `${kid}'s Melita FC Player Report is ready`);
  const lines = purpose === "confirm"
    ? [
      `Twice a season our coaches prepare a development report for every player in the Development Phase.`,
      `Before we send ${kid}'s report, please confirm that you are ${kid}'s parent or guardian. You'll be asked for ${kid}'s date of birth.`,
    ]
    : [
      `${kid}'s player report for ${p.cycle_label} is ready.`,
      `To open it, you'll be asked for ${kid}'s date of birth. You can save it as a PDF from the report page.`,
    ];
  const button = purpose === "confirm" ? `Confirm I'm ${kid}'s parent or guardian` : `Open ${kid}'s report`;
  const small = `This link is personal to you and stops working on ${expires}. Please don't forward it. If you are not ${kid}'s parent or guardian, ignore this email and let us know at ${cfg.replyTo}.`;
  const banner = dryRun
    ? `<div style="background:#FFF3CD;border:1px solid #E0C36A;padding:10px 14px;border-radius:6px;margin-bottom:16px;font-size:14px;color:#5C4400">
         <b>TEST, not sent to the parent.</b><br>Would go to: <b>${esc(p.intended_recipient)}</b><br>For: <b>${esc(p.child_full_name)}</b> (${esc(p.group_label)})</div>` : "";
  const html = `<!doctype html><html><body style="margin:0;background:#F4F1F1;font-family:Arial,Helvetica,sans-serif;color:#141414">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="background:#fff;border-top:4px solid #C8102E;border-radius:8px;padding:28px 26px">
      ${banner}
      <div style="font-size:13px;letter-spacing:.12em;color:#C8102E;font-weight:bold;margin-bottom:14px">${esc(cfg.club.toUpperCase())}</div>
      <p style="font-size:16px;margin:0 0 12px">${esc(hello)}</p>
      ${lines.map((l) => `<p style="font-size:15px;line-height:1.5;margin:0 0 12px">${esc(l)}</p>`).join("")}
      <p style="margin:22px 0"><a href="${esc(link)}" style="background:#C8102E;color:#fff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:6px;display:inline-block">${esc(button)}</a></p>
      <p style="font-size:12.5px;line-height:1.5;color:#6B6366;margin:0">${esc(small)}</p>
    </div>
    <p style="font-size:12px;color:#8A8285;text-align:center;margin-top:14px">${esc(cfg.club)} · Development Phase</p>
  </div></body></html>`;
  const text = [
    dryRun ? `[TEST] Would go to: ${p.intended_recipient} for ${p.child_full_name} (${p.group_label})\n` : "",
    hello, "", ...lines, "", `${button}: ${link}`, "", small, "", `${cfg.club} · Development Phase`,
  ].join("\n");
  return { from: cfg.from, reply_to: cfg.replyTo, to: [p.recipient], subject, html, text };
}

// Last line of defence before anything leaves: every message goes to exactly one address,
// and that address is the parent the database chose (or the Head Coach for a test run).
export function assertSafe(p: Prepared, msg: { to: string[] }, dryRun: boolean, actorEmail: string) {
  const expected = (dryRun ? actorEmail : p.intended_recipient).toLowerCase();
  if (msg.to.length !== 1) throw new Error(`log ${p.log_id}: more than one recipient`);
  if (msg.to[0].toLowerCase() !== expected) throw new Error(`log ${p.log_id}: recipient mismatch`);
  if (p.recipient.toLowerCase() !== expected) throw new Error(`log ${p.log_id}: prepared recipient mismatch`);
  if (!/^[a-f0-9]{64}$/.test(p.token)) throw new Error(`log ${p.log_id}: bad link`);
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
type Mark = (logId: number, status: "sent" | "failed", providerId?: string | null, error?: string | null) => Promise<void>;

// Sends in batches of up to 50 through Resend's batch API. Every email is marked sent or failed.
export async function sendAll(rows: Prepared[], purpose: Purpose, dryRun: boolean, actorEmail: string, cfg: Config,
                              apiKey: string, fetchFn: Fetch, mark: Mark) {
  const out = { sent: 0, failed: 0, errors: [] as string[] };
  for (let i = 0; i < rows.length; i += 50) {
    if (i > 0) await new Promise((r) => setTimeout(r, 700));   // Resend allows ~2 requests a second
    const chunk = rows.slice(i, i + 50);
    const msgs: ReturnType<typeof buildEmail>[] = [];
    const ok: Prepared[] = [];
    for (const p of chunk) {
      const m = buildEmail(p, purpose, dryRun, cfg);
      try { assertSafe(p, m, dryRun, actorEmail); msgs.push(m); ok.push(p); }
      catch (e) { out.failed++; out.errors.push(String((e as Error).message)); await mark(p.log_id, "failed", null, "blocked by safety check"); }
    }
    if (!msgs.length) continue;
    let res: Response | null = null, body: any = null, err = "";
    try {
      res = await fetchFn("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json", "User-Agent": "melita-player-report",
                   "Idempotency-Key": `melita-${purpose}-${ok[0].log_id}-${ok[ok.length - 1].log_id}` },
        body: JSON.stringify(msgs),
      });
      body = await res.json().catch(() => null);
    } catch (e) { err = String((e as Error).message); }
    const ids: string[] = Array.isArray(body?.data) ? body.data.map((d: any) => d?.id) : [];
    if (res?.ok && ids.length === ok.length) {
      for (let k = 0; k < ok.length; k++) { await mark(ok[k].log_id, "sent", ids[k], null); out.sent++; }
    } else {
      const msg = err || body?.message || `HTTP ${res?.status}`;
      for (const p of ok) { await mark(p.log_id, "failed", null, msg); out.failed++; }
      out.errors.push(msg);
    }
  }
  return out;
}
