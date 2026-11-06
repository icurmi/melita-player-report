-- Melita FC Player Report: parent contacts, secure report links, approvals, two-step login,
-- new cycles and data retention. Run after 001_schema.sql.

-- ---------- Head Coach powers need two-step login ----------
-- Supabase puts "aal2" in the session once the authenticator-app code has been entered.
create or replace function public.is_head_coach() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where email = lower(auth.jwt() ->> 'email') and active and is_head_coach)
     and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

-- ---------- tables ----------
create table public.parent_contacts (
  id           uuid primary key default gen_random_uuid(),
  player_id    uuid not null references public.players on delete cascade,
  full_name    text,
  relation     text check (relation in ('Father','Mother','Guardian')),
  email        text not null check (email = lower(email) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  confirmed_at timestamptz,               -- set when the parent enters the right date of birth from the confirmation email
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (player_id, email)
);

create table public.report_approvals (
  cycle_id     text not null references public.cycles on delete cascade,
  age_group_id text not null references public.age_groups,
  player_id    uuid not null references public.players on delete cascade,
  approved_by  uuid not null default auth.uid() references auth.users,
  approved_at  timestamptz not null default now(),
  primary key (cycle_id, age_group_id, player_id)
);

-- One row per link sent. The link holds a 256-bit random secret; only its SHA-256 is stored here.
create table public.access_tokens (
  id              uuid primary key default gen_random_uuid(),
  token_hash      text not null unique,
  purpose         text not null check (purpose in ('confirm','report')),
  contact_id      uuid not null references public.parent_contacts on delete cascade,
  player_id       uuid not null references public.players on delete cascade,
  cycle_id        text references public.cycles on delete cascade,
  age_group_id    text references public.age_groups,
  dry_run         boolean not null default false,
  expires_at      timestamptz not null,
  failed_attempts int not null default 0,
  locked_at       timestamptz,
  used_at         timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now()
);
create index on public.access_tokens (contact_id, purpose);

create table public.email_log (
  id                 bigserial primary key,
  created_at         timestamptz not null default now(),
  purpose            text not null,
  cycle_id           text,
  age_group_id       text,
  player_id          uuid references public.players on delete set null,
  contact_id         uuid references public.parent_contacts on delete set null,
  token_id           uuid references public.access_tokens on delete set null,
  recipient          text,      -- where it actually went (the Head Coach for dry runs)
  intended_recipient text,      -- the parent it is meant for
  dry_run            boolean not null default false,
  status             text not null check (status in ('prepared','sent','failed','opened','confirmed','dob_mismatch','locked','expired','revoked')),
  provider_id        text,
  error              text,
  created_by         uuid
);
create index on public.email_log (player_id, purpose);

alter table public.parent_contacts  enable row level security;
alter table public.report_approvals enable row level security;
alter table public.access_tokens    enable row level security;   -- no policies: never readable from the app
alter table public.email_log        enable row level security;

create policy head_contacts  on public.parent_contacts  for all using (is_head_coach()) with check (is_head_coach());
create policy head_approvals on public.report_approvals for all using (is_head_coach()) with check (is_head_coach());
create policy head_log_read  on public.email_log        for select using (is_head_coach());

-- ---------- extra safety on parent contacts ----------
-- At most 3 active contacts per child, and one email can't belong to children from different families
-- (siblings sharing a parent are fine: same surname). Anything else must be fixed in the data first.
create or replace function public._check_contact() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int; other text; mine text;
begin
  if new.active then
    select count(*) into n from parent_contacts where player_id = new.player_id and active and id <> new.id;
    if n >= 3 then raise exception 'A child can have at most 3 parent emails.'; end if;
    select lower(split_part(full_name, ' ', -1)) into mine from players where id = new.player_id;
    select string_agg(distinct lower(split_part(p.full_name, ' ', -1)), ',') into other
      from parent_contacts pc join players p on p.id = pc.player_id
     where pc.email = new.email and pc.active and pc.player_id <> new.player_id
       and lower(split_part(p.full_name, ' ', -1)) <> mine;
    if other is not null then raise exception 'This email is already linked to a child from another family. Check it before adding.'; end if;
  end if;
  return new;
end $$;
create trigger parent_contact_check before insert or update on public.parent_contacts for each row execute function public._check_contact();

-- ---------- helpers ----------
create or replace function public._sha256(t text) returns text
language sql immutable as $$ select encode(sha256(convert_to(t, 'UTF8')), 'hex') $$;

create or replace function public._new_secret() returns text
language sql volatile as $$ select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') $$;

create or replace function public._dob(d int, m int, y int) returns date
language plpgsql immutable as $$
begin
  return make_date(y, m, d);
exception when others then
  return null;
end $$;

-- ---------- preparing emails (called only by the send-emails server function) ----------
-- p_purpose: 'confirm' or 'report'. p_dry_run: send everything to the Head Coach instead of parents.
-- p_player / p_contact: limit to one child / one parent (resend). Returns one row per email to send.
create or replace function public.prepare_emails(
  p_purpose text, p_cycle text, p_group text, p_dry_run boolean, p_actor uuid,
  p_player uuid default null, p_contact uuid default null)
returns table (log_id bigint, token text, recipient text, intended_recipient text, parent_name text,
               child_first_name text, child_full_name text, group_label text, cycle_label text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  r record; secret text; tid uuid; lid bigint; actor_email text; exp interval;
begin
  if p_purpose not in ('confirm','report') then raise exception 'bad purpose'; end if;
  select lower(email) into actor_email from coach_profiles where user_id = p_actor;
  if p_dry_run and actor_email is null then raise exception 'no email for the person running the dry run'; end if;
  exp := case when p_dry_run then interval '2 days' when p_purpose = 'confirm' then interval '30 days' else interval '60 days' end;

  for r in
    select pc.id contact_id, pc.email, pc.full_name parent_name, p.id player_id, p.full_name,
           split_part(p.full_name, ' ', 1) first_name, g.label group_label, c.label cycle_label
    from squad_members sm
    join players p on p.id = sm.player_id
    join parent_contacts pc on pc.player_id = p.id and pc.active
    join age_groups g on g.id = sm.age_group_id
    join cycles c on c.id = sm.cycle_id
    where sm.cycle_id = p_cycle and sm.age_group_id = p_group
      and (p_player is null or p.id = p_player)
      and (p_contact is null or pc.id = p_contact)
      and case p_purpose
            when 'confirm' then (pc.confirmed_at is null or p_contact is not null)
            else pc.confirmed_at is not null
                 and exists (select 1 from report_approvals a where a.cycle_id = p_cycle and a.age_group_id = p_group and a.player_id = p.id)
          end
      -- in a bulk run, skip anyone already sent this email for real
      and (p_dry_run or p_player is not null or p_contact is not null or not exists (
            select 1 from email_log l where l.contact_id = pc.id and l.purpose = p_purpose and not l.dry_run
              and l.status in ('sent','opened','confirmed')
              and (p_purpose = 'confirm' or (l.cycle_id = p_cycle and l.age_group_id = p_group))))
    order by p.full_name, pc.email
  loop
    -- a fresh real link replaces any earlier link for the same parent, child and purpose
    if not p_dry_run then
      update access_tokens set revoked_at = now()
       where contact_id = r.contact_id and player_id = r.player_id and purpose = p_purpose and not dry_run
         and revoked_at is null and (p_purpose = 'confirm' or (cycle_id = p_cycle and age_group_id = p_group));
    end if;
    secret := _new_secret();
    insert into access_tokens (token_hash, purpose, contact_id, player_id, cycle_id, age_group_id, dry_run, expires_at)
    values (_sha256(secret), p_purpose, r.contact_id, r.player_id, p_cycle, p_group, p_dry_run, now() + exp)
    returning id into tid;
    insert into email_log (purpose, cycle_id, age_group_id, player_id, contact_id, token_id, recipient, intended_recipient, dry_run, status, created_by)
    values (p_purpose, p_cycle, p_group, r.player_id, r.contact_id, tid,
            case when p_dry_run then actor_email else r.email end, r.email, p_dry_run, 'prepared', p_actor)
    returning id into lid;
    log_id := lid; token := secret;
    recipient := case when p_dry_run then actor_email else r.email end;
    intended_recipient := r.email; parent_name := r.parent_name;
    child_first_name := r.first_name; child_full_name := r.full_name;
    group_label := r.group_label; cycle_label := r.cycle_label; expires_at := now() + exp;
    return next;
  end loop;
end $$;

create or replace function public.mark_email(p_log bigint, p_status text, p_provider text default null, p_error text default null)
returns void language sql security definer set search_path = public as $$
  update email_log set status = p_status, provider_id = p_provider, error = p_error where id = p_log;
$$;

-- ---------- shared token check (date-of-birth lock) ----------
-- Returns the token row if the date of birth matches; otherwise records the failure.
create or replace function public._check_token(p_token text, p_purpose text, d int, m int, y int, out ok boolean, out reason text, out t access_tokens)
language plpgsql security definer set search_path = public as $$
declare dob date; given date; left_ int;
begin
  ok := false;
  select * into t from access_tokens where token_hash = _sha256(coalesce(p_token,'')) and purpose = p_purpose;
  if not found then reason := 'invalid'; return; end if;
  if t.revoked_at is not null then reason := 'replaced'; return; end if;
  if t.locked_at is not null then reason := 'locked'; return; end if;
  if t.expires_at < now() then reason := 'expired'; return; end if;
  select date_of_birth into dob from players where id = t.player_id;
  given := _dob(d, m, y);
  if dob is null or given is null or given <> dob then
    update access_tokens set failed_attempts = failed_attempts + 1,
           locked_at = case when failed_attempts + 1 >= 5 then now() end
     where id = t.id returning * into t;
    insert into email_log (purpose, cycle_id, age_group_id, player_id, contact_id, token_id, dry_run, status)
    values (p_purpose, t.cycle_id, t.age_group_id, t.player_id, t.contact_id, t.id, t.dry_run,
            case when t.locked_at is not null then 'locked' else 'dob_mismatch' end);
    reason := case when t.locked_at is not null then 'locked' else 'mismatch' end;
    return;
  end if;
  ok := true; reason := 'ok';
end $$;

-- ---------- what the parent pages call (no sign-in; the link + date of birth is the key) ----------
create or replace function public.confirm_contact(p_token text, d int, m int, y int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record; p record;
begin
  select * into c from _check_token(p_token, 'confirm', d, m, y);
  if not c.ok then
    return jsonb_build_object('status', c.reason, 'attempts_left', greatest(0, 5 - coalesce((c.t).failed_attempts, 0)));
  end if;
  if not (c.t).dry_run then
    update parent_contacts set confirmed_at = coalesce(confirmed_at, now()) where id = (c.t).contact_id;
  end if;
  update access_tokens set used_at = coalesce(used_at, now()) where id = (c.t).id;
  insert into email_log (purpose, player_id, contact_id, token_id, dry_run, status)
  values ('confirm', (c.t).player_id, (c.t).contact_id, (c.t).id, (c.t).dry_run, 'confirmed');
  select full_name into p from players where id = (c.t).player_id;
  return jsonb_build_object('status', 'confirmed', 'child', split_part(p.full_name, ' ', 1), 'dry_run', (c.t).dry_run);
end $$;

create or replace function public.get_report(p_token text, d int, m int, y int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record; tk access_tokens; lead uuid; result jsonb;
begin
  select * into c from _check_token(p_token, 'report', d, m, y);
  if not c.ok then
    return jsonb_build_object('status', c.reason, 'attempts_left', greatest(0, 5 - coalesce((c.t).failed_attempts, 0)));
  end if;
  tk := c.t;
  -- if the Head Coach withdraws approval, links stop working
  if not exists (select 1 from report_approvals where cycle_id = tk.cycle_id and age_group_id = tk.age_group_id and player_id = tk.player_id) then
    return jsonb_build_object('status', 'withdrawn');
  end if;
  update access_tokens set used_at = coalesce(used_at, now()) where id = tk.id;
  insert into email_log (purpose, cycle_id, age_group_id, player_id, contact_id, token_id, dry_run, status)
  values ('report', tk.cycle_id, tk.age_group_id, tk.player_id, tk.contact_id, tk.id, tk.dry_run, 'opened');

  select user_id into lead from coach_assignments
   where cycle_id = tk.cycle_id and age_group_id = tk.age_group_id and role = 'Lead' order by updated_at desc limit 1;

  with per_player as (
    select player_id, attribute_id, avg(score)::numeric avg_score, count(score) n
    from ratings where cycle_id = tk.cycle_id and age_group_id = tk.age_group_id and score is not null
    group by player_id, attribute_id)
  select jsonb_build_object(
    'status', 'ok',
    'dry_run', tk.dry_run,
    'player', (select jsonb_build_object('full_name', full_name, 'comet_no', comet_no, 'birth_year', birth_year) from players where id = tk.player_id),
    'group',  (select jsonb_build_object('id', id, 'label', label, 'mixed', mixed) from age_groups where id = tk.age_group_id),
    'cycle',  (select jsonb_build_object('id', id, 'label', label) from cycles where id = tk.cycle_id),
    'attributes', (select jsonb_agg(jsonb_build_object('id', id, 'p', pillar, 'n', name, 'w', description) order by sort) from attributes),
    'own',  coalesce((select jsonb_object_agg(attribute_id, round(avg_score, 2)) from per_player where player_id = tk.player_id), '{}'::jsonb),
    'team', coalesce((select jsonb_object_agg(attribute_id, v) from (select attribute_id, round(avg(avg_score), 2) v from per_player group by attribute_id) x), '{}'::jsonb),
    'best', coalesce((select jsonb_object_agg(attribute_id, v) from (select attribute_id, round(max(avg_score), 2) v from per_player group by attribute_id) x), '{}'::jsonb),
    'coaches', coalesce((select max(n) from per_player where player_id = tk.player_id), 0),
    'comments', coalesce((select jsonb_object_agg(section, body) from comments
                           where cycle_id = tk.cycle_id and age_group_id = tk.age_group_id and player_id = tk.player_id and user_id = lead), '{}'::jsonb)
  ) into result;
  return result;
end $$;

-- ---------- new report cycle (Head Coach) ----------
create or replace function public.start_cycle(p_id text, p_label text, p_opens date, p_closes date, p_copy_squads_from text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_head_coach() then raise exception 'Head Coach only'; end if;
  update cycles set is_active = false where is_active;
  insert into cycles (id, label, opens_on, closes_on, is_active) values (p_id, p_label, p_opens, p_closes, true);
  if p_copy_squads_from is not null then
    insert into squad_members (cycle_id, age_group_id, player_id)
    select p_id, age_group_id, player_id from squad_members where cycle_id = p_copy_squads_from;
  end if;
end $$;

-- ---------- end of season: delete parent data (Head Coach) ----------
create or replace function public.purge_parent_data() returns jsonb
language plpgsql security definer set search_path = public as $$
declare a int; b int; c int;
begin
  if not is_head_coach() then raise exception 'Head Coach only'; end if;
  delete from email_log;        get diagnostics a = row_count;
  delete from access_tokens;    get diagnostics b = row_count;
  delete from parent_contacts;  get diagnostics c = row_count;
  return jsonb_build_object('log', a, 'links', b, 'contacts', c);
end $$;

-- ---------- keep-alive for the free plan ----------
create table if not exists public.keepalive (id int primary key, pinged_at timestamptz);
alter table public.keepalive enable row level security;
create or replace function public.ping() returns timestamptz
language sql security definer set search_path = public as $$
  insert into keepalive (id, pinged_at) values (1, now())
  on conflict (id) do update set pinged_at = excluded.pinged_at returning pinged_at;
$$;

-- ---------- who may call what ----------
revoke execute on all functions in schema public from public, anon;
grant execute on function public.is_staff(), public.is_head_coach(), public.cycle_open(text), public.has_role(text, text, text) to authenticated;
grant execute on function public.start_cycle(text, text, date, date, text), public.purge_parent_data() to authenticated;
grant execute on function public.confirm_contact(text, int, int, int), public.get_report(text, int, int, int), public.ping() to anon, authenticated;
-- prepare_emails / mark_email: server function only (service role), never the browser
revoke execute on function public.prepare_emails(text, text, text, boolean, uuid, uuid, uuid), public.mark_email(bigint, text, text, text) from authenticated;
grant  execute on function public.prepare_emails(text, text, text, boolean, uuid, uuid, uuid), public.mark_email(bigint, text, text, text) to service_role;
