-- Harden onboarding/profile writes without exposing server-owned columns.

alter table public.profiles
  add column if not exists onboarding_completed_at timestamptz;

-- Existing users who already selected at least one sport have completed the
-- current onboarding flow. Keep new/auth-only profiles incomplete until they
-- save through save_my_profile().
update public.profiles
set onboarding_completed_at = coalesce(updated_at, created_at, now())
where onboarding_completed_at is null
  and cardinality(interests) > 0;

-- Replace the original case-sensitive unique constraint with a normalized
-- index. Before creating it, trim old values and deterministically rename only
-- colliding rows. A temporary target table lets us avoid collisions with names
-- such as "player_2" that may already exist in production data.
drop index if exists public.profiles_nickname_normalized_key;
alter table public.profiles drop constraint if exists profiles_nickname_key;

create temporary table profile_nickname_hardening (
  id uuid primary key,
  base_nickname text not null,
  duplicate_rank bigint not null,
  target_nickname text
);

insert into profile_nickname_hardening (id, base_nickname, duplicate_rank)
select
  normalized.id,
  normalized.base_nickname,
  row_number() over (
    partition by lower(normalized.base_nickname)
    order by normalized.created_at, normalized.id
  )
from (
  select
    p.id,
    p.created_at,
    case
      when char_length(btrim(p.nickname)) between 2 and 30 then btrim(p.nickname)
      else 'player'
    end as base_nickname
  from public.profiles p
) normalized;

update profile_nickname_hardening
set target_nickname = base_nickname
where duplicate_rank = 1;

do $$
declare
  duplicate_row record;
  suffix_number bigint;
  suffix_text text;
  candidate text;
begin
  for duplicate_row in
    select id, base_nickname, duplicate_rank
    from profile_nickname_hardening
    where duplicate_rank > 1
    order by lower(base_nickname), duplicate_rank, id
  loop
    suffix_number := duplicate_row.duplicate_rank;
    loop
      suffix_text := '_' || suffix_number::text;
      candidate := left(
        duplicate_row.base_nickname,
        greatest(1, 30 - char_length(suffix_text))
      ) || suffix_text;

      exit when not exists (
        select 1
        from profile_nickname_hardening existing
        where existing.target_nickname is not null
          and lower(existing.target_nickname) = lower(candidate)
      );
      suffix_number := suffix_number + 1;
    end loop;

    update profile_nickname_hardening
    set target_nickname = candidate
    where id = duplicate_row.id;
  end loop;
end;
$$;

update public.profiles profile
set nickname = hardened.target_nickname
from profile_nickname_hardening hardened
where hardened.id = profile.id
  and profile.nickname is distinct from hardened.target_nickname;

drop table profile_nickname_hardening;

alter table public.profiles
  drop constraint if exists profiles_nickname_trimmed_check;
alter table public.profiles
  add constraint profiles_nickname_trimmed_check
  check (nickname = btrim(nickname));

create unique index profiles_nickname_normalized_key
  on public.profiles ((lower(btrim(nickname))));

create or replace function public.is_nickname_available(p_nickname text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.uid() is not null
    and p_nickname is not null
    and char_length(btrim(p_nickname)) between 2 and 12
    and not exists (
      select 1
      from public.profiles profile
      where lower(btrim(profile.nickname)) = lower(btrim(p_nickname))
        and profile.id is distinct from auth.uid()
    );
$$;

create or replace function public.save_my_profile(
  p_nickname text,
  p_interests public.sport_code[],
  p_avatar_url text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  normalized_nickname text := btrim(p_nickname);
  normalized_interests public.sport_code[];
  initial_avatar_url text;
  saved_profile public.profiles%rowtype;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = '로그인이 필요합니다.';
  end if;

  if normalized_nickname is null
    or char_length(normalized_nickname) not between 2 and 12 then
    raise exception using errcode = '22023', message = '닉네임은 공백을 제외하고 2~12자로 입력해 주세요.';
  end if;

  select coalesce(array_agg(distinct sport order by sport), '{}'::public.sport_code[])
  into normalized_interests
  from unnest(coalesce(p_interests, '{}'::public.sport_code[])) as selected(sport)
  where sport is not null;

  if cardinality(normalized_interests) = 0 then
    raise exception using errcode = '22023', message = '관심 종목을 하나 이상 선택해 주세요.';
  end if;

  -- Used only when the auth trigger row is missing. Existing profile avatars are
  -- deliberately preserved whenever p_avatar_url is null.
  select coalesce(
    nullif(btrim(auth_user.raw_user_meta_data ->> 'avatar_url'), ''),
    nullif(btrim(auth_user.raw_user_meta_data ->> 'picture'), '')
  )
  into initial_avatar_url
  from auth.users auth_user
  where auth_user.id = actor_id;

  begin
    insert into public.profiles as existing_profile (
      id,
      nickname,
      avatar_url,
      interests,
      onboarding_completed_at
    ) values (
      actor_id,
      normalized_nickname,
      coalesce(p_avatar_url, initial_avatar_url),
      normalized_interests,
      now()
    )
    on conflict (id) do update
    set nickname = excluded.nickname,
        avatar_url = case
          when p_avatar_url is null then existing_profile.avatar_url
          else p_avatar_url
        end,
        interests = excluded.interests,
        onboarding_completed_at = now()
    returning * into saved_profile;
  exception
    when unique_violation then
      raise exception using
        errcode = '23505',
        message = '이미 사용 중인 닉네임입니다.';
  end;

  -- Repair rating rows as part of the same transaction when an old user or a
  -- partially-created auth account reaches onboarding.
  insert into public.player_ratings (profile_id, sport)
  select actor_id, sport
  from unnest(enum_range(null::public.sport_code)) as available(sport)
  on conflict (profile_id, sport) do nothing;

  return saved_profile;
end;
$$;

-- All profile writes go through save_my_profile so nickname length, normalized
-- uniqueness, interests and onboarding state cannot drift apart.
revoke all privileges on table public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

revoke all on function public.is_nickname_available(text)
  from public, anon, authenticated;
revoke all on function public.save_my_profile(text, public.sport_code[], text)
  from public, anon, authenticated;
grant execute on function public.is_nickname_available(text) to authenticated;
grant execute on function public.save_my_profile(text, public.sport_code[], text) to authenticated;

comment on column public.profiles.onboarding_completed_at is
  'Set only by the trusted profile save RPC after nickname and interests validation.';
comment on function public.is_nickname_available(text) is
  'Checks normalized nickname availability without exposing the profile table to unauthenticated users.';
comment on function public.save_my_profile(text, public.sport_code[], text) is
  'Creates or updates the authenticated user profile and repairs missing rating rows.';
