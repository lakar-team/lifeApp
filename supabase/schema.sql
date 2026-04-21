-- ============================================
-- ADAMTOOL — Supabase Database Schema
-- Run this in the Supabase SQL Editor
-- supabase.com > Project > SQL Editor > New query
-- ============================================

-- ============================================
-- APP CATEGORIES
-- ============================================
create table if not exists app_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  icon        text not null default 'grid',  -- lucide icon name
  created_at  timestamptz default now()
);

-- ============================================
-- APPS
-- ============================================
create table if not exists apps (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,           -- e.g. 'math-genie'
  name        text not null,                  -- e.g. 'Math Genie'
  description text not null,
  icon        text not null default 'wrench', -- lucide icon name
  path        text not null,                  -- e.g. '/apps/math-genie/'
  status      text not null default 'coming_soon'
                check (status in ('live', 'coming_soon', 'hidden')),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ============================================
-- APP <-> CATEGORY (many-to-many)
-- ============================================
create table if not exists app_category_map (
  app_id       uuid references apps(id) on delete cascade,
  category_id  uuid references app_categories(id) on delete cascade,
  primary key (app_id, category_id)
);

-- ============================================
-- USAGE LOGS
-- ============================================
create table if not exists usage_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  app_id      uuid references apps(id) on delete set null,
  action      text not null
                check (action in ('launch', 'heartbeat', 'close')),
  session_id  text,                           -- groups actions per visit
  ip          text,
  created_at  timestamptz default now()
);

-- ============================================
-- USER PROFILES (extends Supabase auth.users)
-- ============================================
create table if not exists user_profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  is_creator  boolean default false,          -- true only for you
  created_at  timestamptz default now()
);

-- Auto-create profile on new user signup
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into user_profiles (id)
  values (new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ============================================
-- UPDATED_AT trigger for apps
-- ============================================
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists apps_updated_at on apps;
create trigger apps_updated_at
  before update on apps
  for each row execute procedure update_updated_at();

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

-- app_categories: anyone can read
alter table app_categories enable row level security;
create policy "Anyone can view categories"
  on app_categories for select using (true);

-- apps: anyone can view live/coming_soon; hidden only creator
alter table apps enable row level security;
create policy "Anyone can view non-hidden apps"
  on apps for select using (status != 'hidden');

-- app_category_map: anyone can read
alter table app_category_map enable row level security;
create policy "Anyone can view app_category_map"
  on app_category_map for select using (true);

-- usage_logs: users can read their own logs only
alter table usage_logs enable row level security;
create policy "Users view own usage logs"
  on usage_logs for select
  using (auth.uid() = user_id);

-- user_profiles: users can read their own profile
alter table user_profiles enable row level security;
create policy "Users view own profile"
  on user_profiles for select
  using (auth.uid() = id);
create policy "Users update own profile"
  on user_profiles for update
  using (auth.uid() = id);
