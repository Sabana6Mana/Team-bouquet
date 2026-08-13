-- MATCHPOINT's public app flow requires a confirmed phone identity.
-- Keep this check server-side so hidden OAuth/email/anonymous clients cannot
-- bypass the React route guard and invoke Data API RPCs directly.

create or replace function public.require_phone_verified_request()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  claims jsonb := coalesce(auth.jwt(), '{}'::jsonb);
  token_role text := coalesce(claims ->> 'role', '');
  token_phone text := nullif(pg_catalog.btrim(coalesce(claims ->> 'phone', '')), '');
  token_issuer text := coalesce(claims ->> 'iss', '');
  token_is_anonymous boolean := coalesce((claims ->> 'is_anonymous')::boolean, false);
begin
  -- Trusted backend maintenance and automated verification requests.
  if token_role = 'service_role' then
    return;
  end if;

  -- Supabase only places the top-level phone claim on the confirmed identity.
  if token_phone is not null then
    return;
  end if;

  -- Backend verifier scripts intentionally create throwaway anonymous users on
  -- the local CLI stack. Never allow this exception on a hosted issuer.
  if token_is_anonymous
    and token_issuer ~ '^http://(127\.0\.0\.1|localhost)(:[0-9]+)?/auth/v1$'
  then
    return;
  end if;

  raise insufficient_privilege using message = '휴대폰 인증이 필요합니다.';
end;
$$;

revoke all on function public.require_phone_verified_request() from public;
grant execute on function public.require_phone_verified_request() to anon, authenticated, service_role;

alter role authenticator
  set pgrst.db_pre_request = 'public.require_phone_verified_request';

notify pgrst, 'reload config';
