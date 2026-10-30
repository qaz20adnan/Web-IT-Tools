-- ADNAN TECH — make the service-role bypass in the profile guards reachable again
--
-- The 0001/0002 guards treat the serverless service role as the trusted
-- administration path by reading the `request.jwt.claim.role` GUC. PostgREST no
-- longer publishes per-claim GUCs; it publishes `request.jwt.claims` as one JSON
-- document. The old branch therefore never matched, and every service-role write
-- that changed a guarded column (`profiles.role`, `profiles.status`) or deleted a
-- profile failed with the administrator exception, which broke `owner:promote`,
-- the admin user editor and account deletion.
--
-- `request_jwt_role()` reads the role from the claims document only. The legacy
-- per-claim GUC is deliberately not consulted: a session-pinned GUC can outlive
-- the request that set it, so honouring it would let a stale `service_role` value
-- authorise a later request. Every rule below is unchanged, and application code
-- keeps performing its own permission checks (`requirePermission`, `canManageRole`,
-- `canAssignRole`) before it writes.

create or replace function public.request_jwt_role()
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  claims text := nullif(current_setting('request.jwt.claims', true), '');
begin
  if claims is null then
    return null;
  end if;
  begin
    return claims::jsonb ->> 'role';
  exception when others then
    -- A malformed claims document must not turn into an authorization grant.
    return null;
  end;
end;
$$;

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
  if public.request_jwt_role() = 'service_role' then
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
  if public.request_jwt_role() = 'service_role' then
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

revoke all on function public.request_jwt_role() from public;
grant execute on function public.request_jwt_role() to authenticated, service_role, anon;
