# Going live: step by step

About **2 hours** in total, spread over a few days (DNS changes can take a few hours to take effect).
Do the steps in order. Each one ends with a ✅ check, so you know it worked before moving on.

You'll need: a club email address to own the accounts, access to melitafc.com's DNS (or whoever manages it), and your phone (for two-step login).

---

## Part A · Accounts (15 min)

1. **GitHub**: create a **private** repository `melita-player-report`. Upload everything in this folder **except** the `private/` folder (`.gitignore` already excludes it). Never put `private/` on GitHub: it holds children's and parents' details.
2. **Supabase**: create an organisation "Melita FC", then a project `melita-player-report`. **Region: Frankfurt (eu-central-1).** Save the database password in a password manager.
3. **Resend**: sign up with the club email.
4. **Netlify**: sign up with GitHub.

✅ Four accounts exist, all owned by a club email.

## Part B · Database (15 min)

In Supabase → **SQL Editor**, run these files in this order (open each, paste, Run):

1. `supabase/migrations/001_schema.sql`
2. `private/002_seed.sql`: first change `head.coach@example.com` near the bottom to **your** email
3. `supabase/migrations/003_parents_and_reports.sql`
4. `private/004_parent_contacts.sql`

✅ In **Table Editor**: `players` has 145 rows, `parent_contacts` has 279, `staff` has your email with `is_head_coach = true`.

## Part C · Sign-in emails (20 min)

1. **Resend → Domains → Add domain** `melitafc.com`. Resend shows 3–4 DNS records (SPF, DKIM, and optionally MX/DMARC). Add them at the club's DNS provider, then click **Verify** (can take a few hours).
2. **Resend → API Keys → Create**, permission **Sending access**, domain melitafc.com. Copy it.
3. **Supabase → Authentication → Emails → SMTP Settings** → enable custom SMTP:
   host `smtp.resend.com`, port `465`, user `resend`, password = the API key, sender `reports@melitafc.com`, name `Melita FC`.
4. **Supabase → Authentication → Emails → Templates → Magic Link**: change the subject to *Your Melita FC Player Report sign-in link*.
5. **Supabase → Authentication → URL Configuration**: Site URL `https://reports.melitafc.com`; Redirect URLs: add `https://reports.melitafc.com/**`.
6. **Supabase → Authentication → Multi-Factor**: make sure **TOTP** is enabled.

✅ Resend shows the domain as **Verified**.

## Part D · Website (20 min)

1. **Netlify → Add new site → Import from GitHub** → pick the repo. The build settings come from `netlify.toml`.
2. **Site configuration → Environment variables**: add
   - `VITE_SUPABASE_URL`: Supabase → Project Settings → API → Project URL
   - `VITE_SUPABASE_ANON_KEY`: same page, **anon public** key (never the service_role key)
3. **Deploys → Trigger deploy**.
4. **Domain management → Add a domain** → `reports.melitafc.com`. Netlify shows one CNAME record: add it at the DNS provider. HTTPS turns on by itself.

✅ `https://reports.melitafc.com` shows the sign-in page.

## Part E · Email sending (15 min)

In this folder (needs Node.js installed; `npx` runs the Supabase CLI without installing it):
```bash
npx supabase login
npx supabase link --project-ref YOUR-PROJECT-REF        # from the project URL
npx supabase secrets set RESEND_API_KEY=re_... SITE_URL=https://reports.melitafc.com \
  EMAIL_FROM="Melita FC <reports@melitafc.com>" EMAIL_REPLY_TO=academy@melitafc.com
npx supabase functions deploy send-emails
npx supabase functions deploy draft-comment              # optional AI comment drafts
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...    # only if you deployed draft-comment
```
Use a real club inbox for `EMAIL_REPLY_TO`: parents will reply there.

✅ Supabase → Edge Functions lists `send-emails`.

## Part F · Keep-alive (5 min)

GitHub repo → **Settings → Secrets and variables → Actions** → add `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
Then **Actions → Supabase keep-alive → Run workflow** once.

✅ The run shows a green tick. It now runs every 2 days by itself.
(When parent emails go live, consider Supabase **Pro** for guaranteed uptime and daily backups.)

## Part G · Your own first login (10 min)

1. Open the site, enter your email, open the link **on the same device**.
2. Fill in your details (you're also a coach: pick your group and role).
3. Open the **Head Coach** tab → **Set up two-step login** → scan the QR code with an authenticator app → enter the code.
4. Head Coach → **Coaches with access** → add each coach's name and email.

✅ You can see the Head Coach, Player reports and Parents & sending tabs.

## Part H · Test round before anyone else (30 min)

1. Ask one coach to sign in and rate a few attributes, then check **Head Coach** shows their progress.
2. **Parents & sending** → pick a group → **Send one test to me** (confirmation). Open it on your phone, enter the child's date of birth, check it confirms.
3. Rate and comment one player fully (or have the lead coach do it), **approve** them, then **Send one test to me** (report). Open it, enter the date of birth, check the report and **Download PDF**.
4. Try a wrong date of birth on a test link and check it counts down and locks.

✅ Everything above works. Now you're ready.

---

## Each report cycle

| When | What |
|---|---|
| Before ratings open | Head Coach → Coaches with access: add or remove coaches |
| 3–4 weeks before reports | Parents & sending → each group → **Dry run** → check your inbox → **Send to N parents** (confirmation) |
| During | Chase parents who haven't confirmed; fix emails or dates of birth flagged as *Wrong DOB* |
| Ratings deadline | Coaches finish and **Submit**; lead coaches write comments |
| Before sending | Head Coach tab: check outlined disagreements. Player reports: read each report. Parents & sending: **Approve** |
| Send | Per group: **Dry run** → check → type `SEND U12` → **Send** |
| After | Watch *Report opened*; resend or fix anything *Failed* or *Locked* |
| End of season | Head Coach → Season → **Delete parent data**; then start the next cycle |

## If something goes wrong

- **A parent says they got the wrong child's report:** they can't open it without that child's date of birth. In Parents & sending, **Remove** that email from the child, then check the registration data.
- **A parent is locked out:** check the date of birth on file. If it's right, click **Resend report** (the old link stops working).
- **Withdraw a report already sent:** untick **Approved**. The link stops working immediately.
- **The site says "Something went wrong":** check whether Supabase paused the project (Dashboard → Resume).
