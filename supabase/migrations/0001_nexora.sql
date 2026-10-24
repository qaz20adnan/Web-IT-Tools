-- NEXORA AI — initial schema
-- Apply with: supabase db push  (or paste into the Supabase SQL editor)
-- Safe to run once on a new project. It does not drop or overwrite existing data.
--
-- Design notes:
-- * Supabase Auth (auth.users) remains the only credential store. No passwords
--   are stored in application tables.
-- * Server functions use the service role and always filter by the authenticated
--   user id. RLS policies below provide defense-in-depth for direct database
--   access with a user access token.
-- * Profiles hold the authorization role. Privilege fields are protected by a
--   trigger so a user cannot promote themselves through the REST API.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and status = 'active'
      and role in ('super_admin', 'content_manager', 'technical_editor', 'support_specialist')
  );
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'active' and role = 'super_admin'
  );
$$;

-- ---------------------------------------------------------------------------
-- Profiles and roles
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'standard_member'
    check (role in ('super_admin','content_manager','technical_editor','support_specialist','premium_member','standard_member','trial_member','suspended_member')),
  status text not null default 'active' check (status in ('active','suspended','pending')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists profiles_email_key on public.profiles (lower(email));
create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists profiles_status_idx on public.profiles (status);

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Block privilege escalation and last-admin lockout through direct REST access.
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('request.jwt.claim.role', true) = 'service_role' then
    return new;
  end if;

  if tg_op = 'UPDATE' and (new.role is distinct from old.role or new.status is distinct from old.status) then
    if not public.is_super_admin() then
      raise exception 'Only an active super administrator may change role or status';
    end if;
    if old.role = 'super_admin' and (new.role <> 'super_admin' or new.status <> 'active') then
      if (select count(*) from public.profiles where role = 'super_admin' and status = 'active') <= 1 then
        raise exception 'The last active super administrator cannot be demoted or suspended';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_privileges on public.profiles;
create trigger profiles_protect_privileges before update on public.profiles
  for each row execute function public.protect_profile_privileges();

-- ---------------------------------------------------------------------------
-- Trials, subscriptions, usage
-- ---------------------------------------------------------------------------

create table if not exists public.trials (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  started_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.trial_claims (
  email_hash text primary key,
  first_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.subscription_plans (
  id text primary key,
  name_en text not null,
  name_ar text not null,
  price_cents integer,
  currency text,
  interval text not null default 'month',
  features jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  plan_id text not null default 'standard',
  status text not null default 'active' check (status in ('active','trialing','past_due','canceled','expired')),
  provider text not null default 'manual',
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists subscriptions_updated_at on public.subscriptions;
create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();

create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  type text not null,
  amount_cents integer,
  currency text,
  provider text,
  reference text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists billing_events_user_idx on public.billing_events (user_id, created_at desc);

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  provider text,
  model text,
  tokens_in integer,
  tokens_out integer,
  cost_usd numeric(12, 6),
  created_at timestamptz not null default now()
);

create index if not exists usage_events_user_day_idx on public.usage_events (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Private workspace
-- ---------------------------------------------------------------------------

create table if not exists public.cases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  category text not null default 'other',
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  status text not null default 'open' check (status in ('open','investigating','resolved','closed')),
  environment text not null default '',
  symptoms text not null default '',
  logs text not null default '',
  causes text not null default '',
  tests text not null default '',
  fixes text not null default '',
  resolution text not null default '',
  lessons text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists cases_user_idx on public.cases (user_id, updated_at desc);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text not null default '',
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists notes_user_idx on public.notes (user_id, updated_at desc);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  provider text not null default '',
  model text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists conversations_user_idx on public.conversations (user_id, updated_at desc);

create table if not exists public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists conversation_messages_conversation_idx on public.conversation_messages (conversation_id, created_at);
create index if not exists conversation_messages_user_idx on public.conversation_messages (user_id);

drop trigger if exists cases_updated_at on public.cases;
create trigger cases_updated_at before update on public.cases
  for each row execute function public.set_updated_at();

drop trigger if exists notes_updated_at on public.notes;
create trigger notes_updated_at before update on public.notes
  for each row execute function public.set_updated_at();

drop trigger if exists conversations_updated_at on public.conversations;
create trigger conversations_updated_at before update on public.conversations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Content, news, feedback, audit, settings
-- ---------------------------------------------------------------------------

create table if not exists public.articles (
  id text primary key,
  slug text not null unique,
  title_en text not null,
  title_ar text not null,
  summary_en text not null,
  summary_ar text not null,
  body_en text not null,
  body_ar text not null,
  domain text not null,
  tags text[] not null default '{}',
  product_version text not null default 'all',
  difficulty text not null default 'intermediate',
  verification text not null default 'draft',
  author text not null default 'editorial',
  sources jsonb not null default '[]'::jsonb,
  related_script_ids text[] not null default '{}',
  published boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.content_revisions (
  id uuid primary key default gen_random_uuid(),
  article_id text not null references public.articles(id) on delete cascade,
  editor_id uuid references public.profiles(id) on delete set null,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.news_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null unique,
  category text not null default 'industry',
  enabled boolean not null default true,
  interval_minutes integer not null default 60 check (interval_minutes between 5 and 1440),
  last_status text,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create table if not exists public.news_ingestion_logs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.news_sources(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  items integer,
  error text
);

create table if not exists public.content_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  content_type text not null,
  content_id text not null,
  reason text not null,
  message text not null default '',
  status text not null default 'open' check (status in ('open','resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null
);

create index if not exists content_feedback_status_idx on public.content_feedback (status, created_at desc);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  actor_email text,
  action text not null,
  target_type text not null,
  target_id text,
  outcome text not null default 'success' check (outcome in ('success','failure','denied')),
  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_created_idx on public.audit_events (created_at desc);

create table if not exists public.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.trials enable row level security;
alter table public.trial_claims enable row level security;
alter table public.subscriptions enable row level security;
alter table public.subscription_plans enable row level security;
alter table public.billing_events enable row level security;
alter table public.usage_events enable row level security;
alter table public.cases enable row level security;
alter table public.notes enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_messages enable row level security;
alter table public.articles enable row level security;
alter table public.content_revisions enable row level security;
alter table public.news_sources enable row level security;
alter table public.news_ingestion_logs enable row level security;
alter table public.content_feedback enable row level security;
alter table public.audit_events enable row level security;
alter table public.platform_settings enable row level security;

-- profiles: read/update own; staff may read all.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select using (id = auth.uid() or public.is_staff());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- trials / subscriptions / usage / billing
drop policy if exists trials_select_own on public.trials;
create policy trials_select_own on public.trials for select using (user_id = auth.uid() or public.is_staff());

drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own on public.subscriptions for select using (user_id = auth.uid() or public.is_staff());

drop policy if exists plans_select on public.subscription_plans;
create policy plans_select on public.subscription_plans for select using (true);

drop policy if exists billing_select_own on public.billing_events;
create policy billing_select_own on public.billing_events for select using (user_id = auth.uid() or public.is_staff());

drop policy if exists usage_select_own on public.usage_events;
create policy usage_select_own on public.usage_events for select using (user_id = auth.uid() or public.is_staff());

-- workspace: strict ownership
drop policy if exists cases_owner on public.cases;
create policy cases_owner on public.cases for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists notes_owner on public.notes;
create policy notes_owner on public.notes for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists conversations_owner on public.conversations;
create policy conversations_owner on public.conversations for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists messages_owner on public.conversation_messages;
create policy messages_owner on public.conversation_messages for all
  using (user_id = auth.uid() and exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()))
  with check (user_id = auth.uid() and exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()));

-- content: public read (published), staff write
drop policy if exists articles_public_read on public.articles;
create policy articles_public_read on public.articles for select using (published or public.is_staff());

drop policy if exists articles_staff_write on public.articles;
create policy articles_staff_write on public.articles for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists revisions_staff on public.content_revisions;
create policy revisions_staff on public.content_revisions for select using (public.is_staff());

drop policy if exists news_sources_select on public.news_sources;
create policy news_sources_select on public.news_sources for select using (public.is_staff());

drop policy if exists news_logs_select on public.news_ingestion_logs;
create policy news_logs_select on public.news_ingestion_logs for select using (public.is_staff());

drop policy if exists feedback_insert_own on public.content_feedback;
create policy feedback_insert_own on public.content_feedback for insert with check (user_id = auth.uid());

drop policy if exists feedback_select on public.content_feedback;
create policy feedback_select on public.content_feedback for select using (user_id = auth.uid() or public.is_staff());

drop policy if exists audit_select_staff on public.audit_events;
create policy audit_select_staff on public.audit_events for select using (public.is_staff());

drop policy if exists settings_select_staff on public.platform_settings;
create policy settings_select_staff on public.platform_settings for select using (public.is_staff());

-- ---------------------------------------------------------------------------
-- Storage: private files for the workspace (diagnostic uploads)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'workspace',
  'workspace',
  false,
  10485760,
  array['image/png','image/jpeg','image/webp','text/plain','application/json','text/csv','application/pdf']
)
on conflict (id) do nothing;

drop policy if exists workspace_objects_read on storage.objects;
create policy workspace_objects_read on storage.objects for select
  using (bucket_id = 'workspace' and owner = auth.uid());

drop policy if exists workspace_objects_write on storage.objects;
create policy workspace_objects_write on storage.objects for insert
  with check (bucket_id = 'workspace' and owner = auth.uid());

drop policy if exists workspace_objects_delete on storage.objects;
create policy workspace_objects_delete on storage.objects for delete
  using (bucket_id = 'workspace' and owner = auth.uid());

-- Seed the base plans (no payment provider is claimed).
insert into public.subscription_plans (id, name_en, name_ar, price_cents, currency, interval, features, active)
values
  ('trial', 'Free trial', 'تجربة مجانية', null, null, 'month', '{"ai": true, "vision": true, "workspace": true}'::jsonb, true),
  ('standard', 'Standard', 'قياسي', null, null, 'month', '{"ai": false, "workspace": true}'::jsonb, true),
  ('premium', 'Premium', 'متقدم', null, null, 'month', '{"ai": true, "vision": true, "workspace": true}'::jsonb, true)
on conflict (id) do nothing;
