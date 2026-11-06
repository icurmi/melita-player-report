# Melita FC · Player Report

The web app coaches use to rate U9–U13 players (boys and girls) for the twice-yearly player report.
Coaches drag their squad onto a 1–9 ladder, one attribute at a time; lead coaches write the report comments; the Head Coach sees every coach's ratings combined.

- **Front end:** plain JavaScript + Vite. One static site, no server to run.
- **Back end:** [Supabase](https://supabase.com) (Postgres database, email sign-in, optional AI comment drafts).
- **Hosting:** any static host. Netlify config included.

## How it works for coaches

1. The Head Coach adds the coach's email (Head Coach tab → *Coaches with access*).
2. The coach opens the site, enters their email and gets a sign-in link. No password needed.
3. First visit: full name, age group, Lead or Assistant. Then a one-page explainer.
4. **Rate squad:** drag each player onto 1–9 for each of the 35 attributes. Undo with the button or Ctrl+Z.
5. **Comments** (lead coach only): five short comments per player, with *Draft from scores*.
6. **Review & submit:** checks for unfinished attributes, missing comments, too many 7–9s, and players with the same score everywhere. Then Submit.

Each coach only ever sees their own ratings. This is enforced by the database rules, not just the screens.

## Setup

Follow **GUIDE.md**: it walks through every account, setting and check, in order.

Database files, run in this order:
1. `supabase/migrations/001_schema.sql`: tables and access rules for coaches
2. `private/002_seed.sql`: age groups, attributes, cycle, squads and dates of birth (**private**)
3. `supabase/migrations/003_parents_and_reports.sql`: parents, secure report links, approvals, two-step login
4. `private/004_parent_contacts.sql`: parent emails (**private**)

The `private/` folder holds children's and parents' personal data. It's in `.gitignore`: never commit it, and keep it only on the club's machine or password manager.

## Running a new cycle (each January and May)

Easiest: **Head Coach → Season → Start new cycle**. Or in SQL:

In the SQL editor:
```sql
update cycles set is_active = false;
insert into cycles (id, label, opens_on, closes_on, is_active)
values ('2026-27-C2', '2026/27 · Report cycle 2 (May)', '2027-05-01', '2027-05-31', true);

-- carry the squads over, then adjust any moves
insert into squad_members (cycle_id, age_group_id, player_id)
select '2026-27-C2', age_group_id, player_id from squad_members where cycle_id = '2026-27-C1';
```
For a new season, update `data/squads.json`, run `npm run seed` to regenerate `002_seed.sql` with a new cycle id, and run it.
Players are matched by COMET number, so their history carries across seasons.

Ratings can't be changed after a cycle's `closes_on` date. To extend the deadline, change `closes_on`.

## Data for the 360 dashboard

- `ratings`: one row per player × attribute × coach × cycle (score 1–9, or *not observed*).
- `rating_summary` (view): per player × attribute, the coaches' average, the spread between coaches, and how many rated.
- `comments`, `submissions`, `coach_status` (view).

Players are keyed by `players.id`, with `comet_no` as the shared ID. The 360 dashboard can read the same Supabase project directly.

## Files

| Path | What it is |
|---|---|
| `src/main.js` | Coach and Head Coach screens (shared by the live app and the prototype) |
| `src/report.js` | The report layout (Head Coach screen and parent page) |
| `src/parent.js`, `confirm.html`, `report.html` | Parent pages with the date-of-birth lock |
| `supabase/functions/send-emails/` | The only way emails reach parents |
| `.github/workflows/keepalive.yml` | Stops the free Supabase project pausing |
| `GUIDE.md` | Go-live steps |
| `src/store-live.js` | Saves to Supabase |
| `src/store-demo.js` | Saves in the browser (prototype) |
| `src/styles.css` | Look and feel |
| `supabase/migrations/` | Database tables, access rules, seed data |
| `supabase/functions/draft-comment/` | Optional AI comment drafts |
| `data/` | Attributes, score descriptions and squads used to build the seed |
| `scripts/` | `gen_seed.py` (rebuild seed SQL), `build_prototype.py` (single-file demo) |

## Sending reports to parents: how it stays safe

1. **Contacts by COMET number**, imported from the registration form (typed by parents) and only where the child's ID or date of birth matches. Database rules stop one email being attached to two families, or more than 3 emails per child.
2. **Confirmation round:** each parent proves they know the child's date of birth before they can receive any report.
3. **Approval:** the Head Coach approves each report. Withdrawing approval kills the link instantly.
4. **Secure link:** 256-bit random secret in the `#` part of the URL (never sent to servers or logs), stored only as a SHA-256 hash, expires after 60 days, replaced on resend.
5. **Date-of-birth lock:** the report only opens with the child's date of birth, and the link locks after 5 wrong tries. Dates of birth are unreadable from the app; only the database check uses them.
6. **Sending:** only the server function can create links; it checks each email has exactly one recipient matching the database before sending. Dry runs go only to the Head Coach. Real sends need `SEND U12` typed. Everything is logged.
7. **Head Coach account:** two-step login (authenticator app) is required to see parents, approvals or other coaches' ratings.

Tested locally: `node` suites in the build notes cover every rule above, including wrong-child DOBs, lockout, replaced and withdrawn links, and a corrupted recipient being blocked.

## Known gaps

- **Fitness tests:** not collected yet (last year's report had them from U10).
- **Data to tidy:** no COMET number for Zachary Busuttil (U9) or Joshua Bolobaga Biyiki (U12). Zack Cutajar (U11) has no reliable date of birth, so his parents can't confirm until it's added. 34 children have parent emails that differ between the registration sheet and the form (`private/parent_emails_review.xlsx`).
- **Data protection:** this stores ratings about children. Keep the staff list current: remove a coach's access when they leave. Make sure the club's privacy notice to parents covers player assessments.
