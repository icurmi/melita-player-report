import json, uuid, os
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
attrs=json.load(open(os.path.join(ROOT,'data/attributes.json'))); squads=json.load(open(os.path.join(ROOT,'data/squads.json')))
groups=[("U9","Under 9","U9–U10",False,1),("U10","Under 10","U9–U10",False,2),("U11","Under 11","U11–U13",False,3),("U12","Under 12","U11–U13",False,4),("U13","Under 13","U11–U13",False,5),("U13G","Under 13 Girls","U11–U13",True,6)]
q=lambda s: "null" if s is None else "'"+str(s).replace("'","''")+"'"
NS=uuid.UUID('6d1f2a8e-1933-4e11-9a3b-6d656c697461')
out=["-- Melita FC Player Report: seed data (age groups, 35 attributes, 2026/27 cycle 1, squads)","begin;"]
out.append("insert into public.age_groups (id,label,band,mixed,sort) values")
out.append(",\n".join(f"  ({q(g)},{q(l)},{q(b)},{'true' if m else 'false'},{s})" for g,l,b,m,s in groups)+"\non conflict (id) do update set label=excluded.label, band=excluded.band, mixed=excluded.mixed, sort=excluded.sort;")
out.append("insert into public.attributes (id,pillar,name,description,anchors,sort) values")
out.append(",\n".join(f"  ({q(a['id'])},{q(a['p'])},{q(a['n'])},{q(a['w'])},{q(json.dumps(a['a'],ensure_ascii=False))}::jsonb,{i+1})" for i,a in enumerate(attrs))+"\non conflict (id) do update set pillar=excluded.pillar, name=excluded.name, description=excluded.description, anchors=excluded.anchors, sort=excluded.sort;")
out.append("insert into public.cycles (id,label,opens_on,closes_on,is_active) values ('2026-27-C1','2026/27 · Report cycle 1 (January)','2026-12-01','2027-01-31',true) on conflict (id) do nothing;")
players={}; members=[]
for g,lst in squads.items():
    for p in lst:
        key=p['c'] or ('name:'+p['full'])
        pid=str(uuid.uuid5(NS,key))
        players[pid]=(p['c'],p['full'],p.get('y'),p.get('dob'))
        members.append((g,pid))
out.append("insert into public.players (id,comet_no,full_name,birth_year,date_of_birth) values")
out.append(",\n".join(f"  ('{pid}',{q(c)},{q(n)},{y if y else 'null'},{q(d)})" for pid,(c,n,y,d) in players.items())+"\non conflict (id) do update set comet_no=excluded.comet_no, full_name=excluded.full_name, birth_year=excluded.birth_year, date_of_birth=excluded.date_of_birth;")
out.append("insert into public.squad_members (cycle_id,age_group_id,player_id) values")
out.append(",\n".join(f"  ('2026-27-C1',{q(g)},'{pid}')" for g,pid in members)+"\non conflict do nothing;")
out.append("-- The Head Coach. Replace with your own email before running. Add other coaches from the Head Coach screen or here.")
out.append("insert into public.staff (email,full_name,is_head_coach) values ('head.coach@example.com','Head Coach',true) on conflict (email) do update set is_head_coach=true;")
out.append("commit;")
open(os.path.join(ROOT,'private/002_seed.sql'),'w').write("\n".join(out)+"\n")
print(len(players), len(members))
