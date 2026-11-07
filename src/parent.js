/* Parent pages: confirm.html and report.html.
   The link carries a secret in the # part of the URL (never sent to any server log).
   The parent must enter the child's date of birth; the database checks it and locks the link after 5 wrong tries. */
import "./styles.css";
import "./report.js";
import { createClient } from "@supabase/supabase-js";

const sb = (import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
  ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  : null;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const MODE = document.body.dataset.mode;           // "confirm" or "report"
const CONTACT = "the academy coaches";

// take the secret out of the address bar straight away, so it isn't shared or seen over a shoulder
const token = (location.hash.match(/t=([a-f0-9]{64})/) || [])[1] || null;
if (location.hash) history.replaceState(null, "", location.pathname);

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const thisYear = new Date().getFullYear();
function dobForm(msg = "", kind = "") {
  const opts = (from, to, label, fmt = v => v) => `<option value="">${label}</option>` +
    Array.from({ length: to - from + 1 }, (_, i) => from + i).map(v => `<option value="${v}">${fmt(v)}</option>`).join("");
  const intro = MODE === "confirm"
    ? `<h2>Confirm you're the parent or guardian</h2><p>To make sure player reports only ever reach the right family, please enter your child's date of birth.</p>`
    : `<h2>Open your child's player report</h2><p>For your child's privacy, please enter their date of birth to open the report.</p>`;
  $("#view").innerHTML = `<div class="onb"><form class="card" id="dob" novalidate>
    ${intro}
    <fieldset class="fld"><legend>Child's date of birth</legend>
      <div class="dobrow">
        <select id="d" aria-label="Day">${opts(1, 31, "Day")}</select>
        <select id="m" aria-label="Month">${opts(1, 12, "Month", v => MONTHS[v - 1])}</select>
        <select id="y" aria-label="Year">${opts(thisYear - 18, thisYear - 3, "Year")}</select>
      </div>
      <span class="err ${kind}" role="alert">${msg}</span>
    </fieldset>
    <div class="actions"><span class="note">This link is personal to you. Please don't forward it.</span><button class="btn primary" type="submit">Continue</button></div>
  </form></div>`;
}
function message(title, body) {
  $("#view").innerHTML = `<div class="onb"><div class="card"><h2>${title}</h2><p>${body}</p></div></div>`;
}
const why = {
  invalid:  ["This link doesn't work", `Please use the most recent email we sent you. If it still doesn't work, contact ${CONTACT}.`],
  replaced: ["This link has been replaced", "We've sent you a newer email. Please use the link in that one."],
  expired:  ["This link has expired", `Please contact ${CONTACT} for a new one.`],
  locked:   ["This link is locked", `The date of birth was entered wrongly too many times, so the link has been locked to protect your child's information. Please contact ${CONTACT} for a new link.`],
  withdrawn:["This report isn't available right now", `Please contact ${CONTACT}.`],
};

async function submit(e) {
  e.preventDefault();
  const d = +$("#d").value, m = +$("#m").value, y = +$("#y").value;
  if (!d || !m || !y) { $(".err").textContent = "Choose the day, month and year."; return; }
  const btn = e.target.querySelector("button"); btn.disabled = true; btn.textContent = "Checking…";
  const fn = MODE === "confirm" ? "confirm_contact" : "get_report";
  const { data, error } = await sb.rpc(fn, { p_token: token, d, m, y });
  if (error || !data) { btn.disabled = false; btn.textContent = "Continue"; $(".err").textContent = "Something went wrong. Check your connection and try again."; return; }
  if (data.status === "mismatch") {
    dobForm(`That date of birth doesn't match our records. ${data.attempts_left} attempt${data.attempts_left === 1 ? "" : "s"} left before the link locks.`);
    return;
  }
  if (why[data.status]) return message(...why[data.status]);
  if (MODE === "confirm") {
    return message("Thank you, you're confirmed", `You'll receive ${esc(data.child)}'s player report by email when it's ready.${data.dry_run ? " <br><br><b>Test link:</b> nothing was changed." : ""}`);
  }
  showReport(data);
}

function showReport(r) {
  document.title = `${r.player.full_name} · Melita FC Player Report`;
  const html = window.MelitaReport.render({
    player: { full: r.player.full_name, c: r.player.comet_no, y: r.player.birth_year },
    groupLabel: r.group.label, cycleLabel: r.cycle.label, attrs: r.attributes,
    own: r.own, team: r.team, best: r.best, comments: r.comments, coaches: r.coaches, crest: "/crest.png" });
  $("#view").innerHTML = `<div class="ov parentrep">
    <div class="rptools"><span class="note">${r.dry_run ? "<b>Test link.</b> " : ""}To save a copy, choose <b>Download PDF</b>, then "Save as PDF" as the printer.</span>
      <button class="btn primary" id="pdf">Download PDF</button></div>
    ${html}</div>`;
  $("#pdf").addEventListener("click", () => window.print());
}

if (!sb) message("Not available yet", "This page isn't connected yet. Please try again later.");
else if (!token) message(...why.invalid);
else { dobForm(); document.addEventListener("submit", submit); }
