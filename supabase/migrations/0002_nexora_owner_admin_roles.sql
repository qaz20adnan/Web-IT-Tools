-- NEXORA AI — add owner/admin roles and hierarchy protections
--
-- Additive migration. It does not update, delete or reset existing rows, and it
-- does not change the meaning of the existing roles.
--
-- Apply after 0001_nexora.sql:
--   supabase db push
--   (or paste into the Supabase SQL editor)
--
-- Rollback note: this file is intentionally forward-only. To roll back, first
-- ensure no profile uses the new `owner` or `admin` role, then restore the role
-- check and trigger definitions from 0001_nexora.sql. Do not run that rollback
-- automatically on a shared database.

-- ---------------------------------------------------------------------------
-- Role constraint (existing values remain valid)
-- ---------------------------------------------------------------------------

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in (
    'owner',
    'admin',
    'super_admin',
    'content_manager',
    'technical_editor',
    'support_specialist',
    'premium_member',
    'standard_member',
    'trial_member',
    'suspended_member'
  ));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

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
      and role in ('owner', 'admin', 'super_admin', 'content_manager', 'technical_editor', 'support_specialist')
  );
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'active' and role = 'owner'
  );
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'active' and role in ('owner', 'admin', 'super_admin')
  );
$$;

-- ---------------------------------------------------------------------------
-- Privilege escalation and last-owner protections
-- ---------------------------------------------------------------------------

create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  active_owners integer;
  active_super_admins integer;
begin
  -- The serverless service role is the trusted administration path. The
  -- application layer still applies the same hierarchy checks before writing.
  if current_setting('request.jwt.claim.role', true) = 'service_role' then
    return new;
  end if;

  if tg_op = 'UPDATE' and (new.role is distinct from old.role or new.status is distinct from old.status) then
    select p.role into actor_role
    from public.profiles p
    where p.id = auth.uid() and p.status = 'active';

    if actor_role is null or actor_role not in ('owner', 'admin', 'super_admin') then
      raise exception 'Only an active platform administrator may change role or status';
    end if;

    if old.role = 'owner' and actor_role <> 'owner' then
      raise exception 'Only the platform owner may change an owner account';
    end if;

    if new.role = 'owner' and old.role <> 'owner' and actor_role <> 'owner' then
      raise exception 'Only the platform owner may grant the owner role';
    end if;

    if old.role in ('admin', 'super_admin') and actor_role = 'admin' then
      raise exception 'A platform administrator cannot change a higher administrative role';
    end if;

    if actor_role = 'admin' and new.role in ('admin', 'super_admin') then
      raise exception 'A platform administrator cannot grant a higher administrative role';
    end if;

    if old.role = 'owner' and (new.role <> 'owner' or new.status <> 'active') then
      select count(*) into active_owners
      from public.profiles
      where role = 'owner' and status = 'active';
      if active_owners <= 1 then
        raise exception 'The last active platform owner cannot be demoted or suspended';
      end if;
    end if;

    if old.role = 'super_admin' and (new.role <> 'super_admin' or new.status <> 'active') then
      select count(*) into active_super_admins
      from public.profiles
      where role = 'super_admin' and status = 'active';
      if active_super_admins <= 1 then
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

create or replace function public.protect_profile_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  remaining integer;
begin
  if current_setting('request.jwt.claim.role', true) = 'service_role' then
    return old;
  end if;

  select p.role into actor_role
  from public.profiles p
  where p.id = auth.uid() and p.status = 'active';

  if actor_role is null or actor_role not in ('owner', 'admin', 'super_admin') then
    raise exception 'Only an active platform administrator may delete an account';
  end if;

  if old.role = 'owner' then
    if actor_role <> 'owner' then
      raise exception 'Only the platform owner may delete an owner account';
    end if;
    select count(*) into remaining from public.profiles where role = 'owner' and status = 'active';
    if remaining <= 1 then
      raise exception 'The last active platform owner cannot be deleted';
    end if;
  end if;

  if old.role = 'super_admin' then
    if actor_role not in ('owner', 'super_admin') then
      raise exception 'Only an owner or super administrator may delete a super administrator';
    end if;
    select count(*) into remaining from public.profiles where role = 'super_admin' and status = 'active';
    if remaining <= 1 then
      raise exception 'The last active super administrator cannot be deleted';
    end if;
  end if;

  if old.role = 'admin' and actor_role = 'admin' then
    raise exception 'A platform administrator cannot delete another platform administrator';
  end if;

  return old;
end;
$$;

drop trigger if exists profiles_protect_delete on public.profiles;
create trigger profiles_protect_delete before delete on public.profiles
  for each row execute function public.protect_profile_delete();
