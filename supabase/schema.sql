-- Claude Ekibim · Takım modu şeması (Supabase / Postgres)
-- Yalnızca METADATA tutulur: sohbet, prompt ve yanıt metinleri asla buraya yazılmaz.
-- Kurulum: Supabase panelinde SQL Editor'e yapıştırıp çalıştır. Sonra Auth > Providers'tan GitHub/Google'ı aç.

create extension if not exists pgcrypto;

-- ---------- Takım ve üyeler ----------
create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique default encode(gen_random_bytes(6), 'hex'),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create table members (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  display_name text not null,
  avatar_url text,
  role text not null default 'member' check (role in ('owner','member')),
  -- presence (heartbeat her ~30 sn'de last_seen'i günceller; online = last_seen < 90 sn)
  last_seen timestamptz,
  topic text,                 -- "şu an üzerinde çalıştığı konu" (elle değiştirilebilir)
  active_repo text,
  active_branch text,
  last_activity_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

-- ---------- Repolar ----------
-- Takımın ortak repo listesi (GitHub full_name: "sahip/repo")
create table team_repos (
  team_id uuid not null references teams(id) on delete cascade,
  full_name text not null,
  added_by uuid not null default auth.uid(),
  added_at timestamptz not null default now(),
  primary key (team_id, full_name)
);

-- Üyenin repo bağlantısı + gh ile alınan özet (yerel klon yolu BURADA YOK, yalnızca kendi bilgisayarında)
create table member_repos (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  full_name text not null,
  installed boolean not null default false,   -- bu üyenin bilgisayarında kurulu mu
  branch text,
  last_commit_sha text,
  last_commit_msg text,
  last_commit_at timestamptz,
  open_prs jsonb not null default '[]',       -- [{number,title,url,author,branch}]
  synced_at timestamptz not null default now(),
  primary key (team_id, user_id, full_name)
);

-- ---------- Görev istekleri ----------
create table task_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  from_user uuid not null default auth.uid(),
  to_user uuid not null,
  title text not null,
  description text not null default '',
  repo text,
  status text not null default 'pending'
    check (status in ('pending','accepted','running','done','failed','declined','ignored','discussion')),
  conflict jsonb,             -- çakışma kontrolü sonucu {verdict, items[], reason}
  ignore_reason text,         -- "Yoksay" seçilirse neden
  topic_id uuid,              -- anlamlı çakışmada açılan Tartışma konusu
  result jsonb,               -- {summary, files[], pr_url} — alıcının makinesinde üretilir
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Tartışma ve kararlar ----------
create table topics (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  opened_by uuid not null default auth.uid(),
  title text not null,
  current_state text not null default '',     -- mevcut durum
  request_a text not null default '',         -- 1. tarafın isteği
  request_b text not null default '',         -- 2. tarafın isteği
  reason text not null default '',            -- çakışmanın nedeni
  repo text,
  task_id uuid,                               -- ilgili görev isteği
  status text not null default 'open' check (status in ('open','decided','dropped')),
  created_at timestamptz not null default now()
);

create table topic_options (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references topics(id) on delete cascade,
  label text not null,
  detail text not null default '',
  kind text not null default 'alt' check (kind in ('a','b','balanced','alt'))
);

create table topic_votes (
  topic_id uuid not null references topics(id) on delete cascade,
  option_id uuid not null references topic_options(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  primary key (topic_id, user_id)             -- üye başına tek oy (değiştirilebilir)
);

create table topic_comments (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references topics(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  body text not null,
  created_at timestamptz not null default now()
);

-- Kayıt altına alınmış kararlar: çakışma tespitinin "mevcut durum" kaynağı
create table decisions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  statement text not null,                    -- "Tüm karakterler siyah gözlü olacak"
  area text,                                  -- serbest etiket: "karakter", "ses"…
  repo text,
  topic_id uuid references topics(id),
  task_id uuid references task_requests(id),
  decided_by uuid not null default auth.uid(),
  active boolean not null default true,       -- yeni karar eskisini pasifleştirir
  created_at timestamptz not null default now()
);

-- Toplantı notları / transkriptler (elle yapıştırılır; çakışma taramasında okunur)
create table notes (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  title text not null,
  body text not null,
  repo text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

-- ---------- Güvenlik (RLS) ----------
create or replace function is_member(t uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from members where team_id = t and user_id = auth.uid()) $$;

alter table teams enable row level security;
alter table members enable row level security;
alter table team_repos enable row level security;
alter table member_repos enable row level security;
alter table task_requests enable row level security;
alter table topics enable row level security;
alter table topic_options enable row level security;
alter table topic_votes enable row level security;
alter table topic_comments enable row level security;
alter table decisions enable row level security;
alter table notes enable row level security;

create policy teams_read on teams for select using (is_member(id) or created_by = auth.uid());
create policy teams_insert on teams for insert with check (created_by = auth.uid());
create policy teams_update on teams for update using (created_by = auth.uid());

create policy members_read on members for select using (is_member(team_id));
-- Kimse başkası adına satır yazamaz; üyelik yalnızca create_team/join_team ile oluşur (aşağıda).
create policy members_update_self on members for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy members_delete_self on members for delete using (user_id = auth.uid());

create policy team_repos_rw on team_repos for all using (is_member(team_id)) with check (is_member(team_id));
create policy member_repos_read on member_repos for select using (is_member(team_id));
create policy member_repos_write on member_repos for all using (user_id = auth.uid() and is_member(team_id)) with check (user_id = auth.uid() and is_member(team_id));

create policy tasks_read on task_requests for select using (is_member(team_id));
create policy tasks_insert on task_requests for insert with check (is_member(team_id) and from_user = auth.uid());
-- Yalnızca alıcı (durum/sonuç) veya gönderen (yoksay/geri çek) günceller
create policy tasks_update on task_requests for update using (is_member(team_id) and (to_user = auth.uid() or from_user = auth.uid()));

create policy topics_rw on topics for all using (is_member(team_id)) with check (is_member(team_id));
create policy topic_options_rw on topic_options for all
  using (exists (select 1 from topics t where t.id = topic_id and is_member(t.team_id)))
  with check (exists (select 1 from topics t where t.id = topic_id and is_member(t.team_id)));
create policy topic_votes_rw on topic_votes for all
  using (exists (select 1 from topics t where t.id = topic_id and is_member(t.team_id)))
  with check (user_id = auth.uid() and exists (select 1 from topics t where t.id = topic_id and is_member(t.team_id)));
create policy topic_comments_rw on topic_comments for all
  using (exists (select 1 from topics t where t.id = topic_id and is_member(t.team_id)))
  with check (user_id = auth.uid() and exists (select 1 from topics t where t.id = topic_id and is_member(t.team_id)));
create policy decisions_rw on decisions for all using (is_member(team_id)) with check (is_member(team_id));
create policy notes_rw on notes for all using (is_member(team_id)) with check (is_member(team_id));

-- ---------- RPC: takım kur / davetle katıl ----------
create or replace function create_team(p_name text, p_display text, p_avatar text default null)
returns teams language plpgsql security definer set search_path = public as $$
declare t teams;
begin
  insert into teams(name, created_by) values (p_name, auth.uid()) returning * into t;
  insert into members(team_id, user_id, display_name, avatar_url, role) values (t.id, auth.uid(), p_display, p_avatar, 'owner');
  return t;
end $$;

create or replace function join_team(p_code text, p_display text, p_avatar text default null)
returns teams language plpgsql security definer set search_path = public as $$
declare t teams;
begin
  select * into t from teams where invite_code = lower(trim(p_code));
  if not found then raise exception 'Geçersiz davet kodu'; end if;
  insert into members(team_id, user_id, display_name, avatar_url) values (t.id, auth.uid(), p_display, p_avatar)
    on conflict (team_id, user_id) do update set display_name = excluded.display_name;
  return t;
end $$;

-- ---------- Realtime ----------
alter publication supabase_realtime add table members, task_requests, topics, topic_options, topic_votes, topic_comments, decisions, member_repos;
