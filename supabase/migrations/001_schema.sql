-- Melita FC Player Report: schema and access rules
-- Run once in the Supabase SQL editor (or `supabase db push`).


-- ---------- reference data ----------
create table public.age_groups (
  id     text primary key,                 -- U9, U10, ... U13G
  label  text not null,
  band   text not null,                    -- which score descriptions apply: 'U9–U10' or 'U11–U13'
  mixed  boolean not null default false,   -- mixed birth years (girls): compare with own birth year
  sort   int not null default 0
);

create table public.attributes (
  id          text primary key,            -- PHY01 ... TIPS-S
  pillar      text not null,
  name        text not null,
  description text not null,
  anchors     jsonb not null,              -- {"U9–U10": [low, mid, high], "U11–U13": [...]} or {"All ages": [...]}
  sort        int not null
);

create table public.cycles (
  id        text primary key,              -- e.g. 2026-27-C1
  label     text not null,
  opens_on  date,
  closes_on date,
  is_active boolean not null default false
);
create unique index one_active_cycle on public.cycles (is_active) where is_active;

create table public.players (
  id          uuid primary key default gen_random_uuid(),
  comet_no    text unique,                 -- national registration number; null until known
  full_name   text not null,
  birth_year  int,
  date_of_birth date,                   -- full date; used to lock each parent's report link. Never shown to coaches.
  created_at  timestamptz not null default now()
);

create table public.squad_members (
  cycle_id     text not null references public.cycles on delete cascade,
  age_group_id text not null references public.age_groups,
  player_id    uuid not null references public.players on delete cascade,
  primary key (cycle_id, age_group_id, player_id)
);

-- ---------- people ----------
-- Only emails listed here can use the app. The Head Coach maintains this list.
create table public.staff (
  email         text primary key check (email = lower(email)),
  full_name     text,
  is_head_coach boolean not null default false,
  active        boolean not null default true
);

create table public.coach_profiles (
  user_id    uuid primary key references auth.users on delete cascade,
  email      text not null,
  full_name  text not null,
  updated_at timestamptz not null default now()
);

create table public.coach_assignments (
  cycle_id     text not null references public.cycles on delete cascade,
  age_group_id text not null references public.age_groups,
  user_id      uuid not null references auth.users on delete cascade,
  role         text not null check (role in ('Lead','Assistant')),
  updated_at   timestamptz not null default now(),
  primary key (cycle_id, age_group_id, user_id)
);

-- ---------- the data coaches create ----------
create table public.ratings (
  cycle_id     text not null references public.cycles on delete cascade,
  age_group_id text not null references public.age_groups,
  player_id    uuid not null references public.players on delete cascade,
  attribute_id text not null references public.attributes,
  user_id      uuid not null references auth.users on delete cascade default auth.uid(),
  score        smallint check (score between 1 and 9),   -- 10 is never given
  not_observed boolean not null default false,
  updated_at   timestamptz not null default now(),
  primary key (cycle_id, age_group_id, player_id, attribute_id, user_id),
  check ((score is not null) <> not_observed)
);

create table public.comments (
  cycle_id     text not null references public.cycles on delete cascade,
  age_group_id text not null references public.age_groups,
  player_id    uuid not null references public.players on delete cascade,
  section      text not null check (section in ('physical','technical','tactical','psychology','behavioural')),
  user_id      uuid not null references auth.users on delete cascade default auth.uid(),
  body         text not null default '',
  updated_at   timestamptz not null default now(),
  primary key (cycle_id, age_group_id, player_id, section, user_id)
);

create table public.submissions (
  cycle_id     text not null references public.cycles on delete cascade,
  age_group_id text not null references public.age_groups,
  user_id      uuid not null references auth.users on delete cascade default auth.uid(),
  submitted_at timestamptz not null default now(),
  primary key (cycle_id, age_group_id, user_id)
);

-- last change per coach per group, so "changed since submitted" works
create table public.coach_activity (
  cycle_id     text not null,
  age_group_id text not null,
  user_id      uuid not null references auth.users on delete cascade,
  changed_at   timestamptz not null default now(),
  primary key (cycle_id, age_group_id, user_id)
);

-- ---------- helper functions (used by the access rules) ----------
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where email = lower(auth.jwt() ->> 'email') and active);
$$;

create or replace function public.is_head_coach() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where email = lower(auth.jwt() ->> 'email') and active and is_head_coach);
$$;

create or replace function public.cycle_open(c text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from cycles where id = c and is_active
                 and (closes_on is null or closes_on >= (now() at time zone 'Europe/Malta')::date));
$$;

create or replace function public.has_role(c text, g text, wanted text default null) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from coach_assignments
                 where cycle_id = c and age_group_id = g and user_id = auth.uid()
                   and (wanted is null or role = wanted));
$$;

create or replace function public.touch_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into coach_activity (cycle_id, age_group_id, user_id, changed_at)
  values (coalesce(new.cycle_id, old.cycle_id), coalesce(new.age_group_id, old.age_group_id), coalesce(new.user_id, old.user_id), now())
  on conflict (cycle_id, age_group_id, user_id) do update set changed_at = excluded.changed_at;
  return coalesce(new, old);
end $$;
create trigger ratings_activity after insert or update or delete on public.ratings for each row execute function public.touch_activity();
create trigger comments_activity after insert or update or delete on public.comments for each row execute function public.touch_activity();

-- ---------- access rules ----------
alter table public.age_groups        enable row level security;
alter table public.attributes        enable row level security;
alter table public.cycles            enable row level security;
alter table public.players           enable row level security;
alter table public.squad_members     enable row level security;
alter table public.staff             enable row level security;
alter table public.coach_profiles    enable row level security;
alter table public.coach_assignments enable row level security;
alter table public.ratings           enable row level security;
alter table public.comments          enable row level security;
alter table public.submissions       enable row level security;
alter table public.coach_activity    enable row level security;

-- reference data: every coach reads, only the Head Coach changes
create policy read_groups   on public.age_groups    for select using (is_staff());
create policy read_attrs    on public.attributes    for select using (is_staff());
create policy read_cycles   on public.cycles        for select using (is_staff());
create policy read_players  on public.players       for select using (is_staff());
create policy read_squads   on public.squad_members for select using (is_staff());
create policy head_groups   on public.age_groups    for all using (is_head_coach()) with check (is_head_coach());
create policy head_attrs    on public.attributes    for all using (is_head_coach()) with check (is_head_coach());
create policy head_cycles   on public.cycles        for all using (is_head_coach()) with check (is_head_coach());
create policy head_players  on public.players       for all using (is_head_coach()) with check (is_head_coach());
create policy head_squads   on public.squad_members for all using (is_head_coach()) with check (is_head_coach());

-- staff list: you can see your own row; the Head Coach manages all rows
create policy own_staff  on public.staff for select using (email = lower(auth.jwt() ->> 'email') or is_head_coach());
create policy head_staff on public.staff for all using (is_head_coach()) with check (is_head_coach());

-- profiles and assignments: coaches manage their own; Head Coach reads all
create policy prof_read  on public.coach_profiles for select using (user_id = auth.uid() or is_head_coach());
create policy prof_write on public.coach_profiles for insert with check (user_id = auth.uid() and is_staff());
create policy prof_upd   on public.coach_profiles for update using (user_id = auth.uid()) with check (user_id = auth.uid() and is_staff());

create policy asg_read   on public.coach_assignments for select using (user_id = auth.uid() or is_head_coach());
create policy asg_write  on public.coach_assignments for insert with check (user_id = auth.uid() and is_staff() and cycle_open(cycle_id));
create policy asg_upd    on public.coach_assignments for update using (user_id = auth.uid()) with check (user_id = auth.uid() and is_staff() and cycle_open(cycle_id));
create policy asg_del    on public.coach_assignments for delete using (user_id = auth.uid() and cycle_open(cycle_id));

-- ratings: a coach only ever sees and changes their own; Head Coach reads everyone's
create policy rat_read on public.ratings for select using (user_id = auth.uid() or is_head_coach());
create policy rat_ins  on public.ratings for insert with check (user_id = auth.uid() and is_staff() and has_role(cycle_id, age_group_id) and cycle_open(cycle_id));
create policy rat_upd  on public.ratings for update using (user_id = auth.uid()) with check (user_id = auth.uid() and has_role(cycle_id, age_group_id) and cycle_open(cycle_id));
create policy rat_del  on public.ratings for delete using (user_id = auth.uid() and cycle_open(cycle_id));

-- comments: only the group's lead coach writes them
create policy cm_read on public.comments for select using (user_id = auth.uid() or is_head_coach());
create policy cm_ins  on public.comments for insert with check (user_id = auth.uid() and is_staff() and has_role(cycle_id, age_group_id, 'Lead') and cycle_open(cycle_id));
create policy cm_upd  on public.comments for update using (user_id = auth.uid()) with check (user_id = auth.uid() and has_role(cycle_id, age_group_id, 'Lead') and cycle_open(cycle_id));

create policy sub_read on public.submissions for select using (user_id = auth.uid() or is_head_coach());
create policy sub_ins  on public.submissions for insert with check (user_id = auth.uid() and has_role(cycle_id, age_group_id) and cycle_open(cycle_id));
create policy sub_upd  on public.submissions for update using (user_id = auth.uid()) with check (user_id = auth.uid() and cycle_open(cycle_id));

create policy act_read on public.coach_activity for select using (user_id = auth.uid() or is_head_coach());

-- ---------- for the Head Coach screen and the 360 dashboard ----------
-- One row per player per attribute: average of all coaches, spread, and how many rated it.
create view public.rating_summary with (security_invoker = true) as
select r.cycle_id, r.age_group_id, r.player_id, p.comet_no, p.full_name, r.attribute_id,
       round(avg(r.score)::numeric, 2)               as avg_score,
       max(r.score) - min(r.score)                   as spread,
       count(r.score)                                as coaches_rated,
       count(*) filter (where r.not_observed)        as coaches_not_observed
from public.ratings r join public.players p on p.id = r.player_id
group by r.cycle_id, r.age_group_id, r.player_id, p.comet_no, p.full_name, r.attribute_id;

-- Head Coach progress list: who is rating which group and whether they submitted
create view public.coach_status with (security_invoker = true) as
select a.cycle_id, a.age_group_id, a.user_id, a.role, cp.full_name, cp.email,
       s.submitted_at, act.changed_at
from public.coach_assignments a
left join public.coach_profiles cp on cp.user_id = a.user_id
left join public.submissions s on s.cycle_id = a.cycle_id and s.age_group_id = a.age_group_id and s.user_id = a.user_id
left join public.coach_activity act on act.cycle_id = a.cycle_id and act.age_group_id = a.age_group_id and act.user_id = a.user_id;

grant select on public.rating_summary, public.coach_status to authenticated;

-- Full dates of birth are never readable from the app (coaches or Head Coach).
-- Only server-side code using the service role (the report-link check) can read them.
revoke select on public.players from anon, authenticated;
grant select (id, comet_no, full_name, birth_year, created_at) on public.players to authenticated;
