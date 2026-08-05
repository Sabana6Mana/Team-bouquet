-- Existing frontend venue fixtures, plus rolling local-development slots.
insert into public.venues (id, name, sports, lat, lng, address, price_per_hour)
values
  ('v1', '잠실 국민체육센터', array['badminton', 'tabletennis', 'basketball']::public.sport_code[], 37.5188, 127.1012, '서울 송파구 올림픽로 240', 24000),
  ('v2', '잠실한강공원 테니스장', array['tennis']::public.sport_code[], 37.5171, 127.0966, '서울 송파구 한가람로 65', 40000),
  ('v3', '신천 배드민턴 클럽', array['badminton']::public.sport_code[], 37.5148, 127.1043, '서울 송파구 백제고분로 362', 28000),
  ('v4', '성내천 탁구장', array['tabletennis']::public.sport_code[], 37.5272, 127.1152, '서울 송파구 성내천로 200', 16000),
  ('v5', '올림픽공원 실내 농구장', array['basketball']::public.sport_code[], 37.5215, 127.1198, '서울 송파구 올림픽로 424', 36000),
  ('v6', '아시아공원 시민 체육관', array['tennis', 'basketball']::public.sport_code[], 37.5132, 127.1082, '서울 송파구 오금로 62', 20000),
  ('v7', '잠실 스포츠플렉스', array['badminton', 'tabletennis', 'tennis']::public.sport_code[], 37.5243, 127.0998, '서울 송파구 올림픽로 269', 32000),
  ('v8', '몽촌토성 커뮤니티 체육관', array['basketball', 'badminton']::public.sport_code[], 37.5192, 127.1145, '서울 송파구 위례성대로 51', 22000)
on conflict (id) do update set
  name = excluded.name,
  sports = excluded.sports,
  lat = excluded.lat,
  lng = excluded.lng,
  address = excluded.address,
  price_per_hour = excluded.price_per_hour,
  active = true;

insert into public.venue_slots (venue_id, starts_at, ends_at, price)
select
  v.id,
  ((current_date + day.day_offset + make_interval(hours => hour_value)) at time zone 'Asia/Seoul') as starts_at,
  ((current_date + day.day_offset + make_interval(hours => hour_value + 1)) at time zone 'Asia/Seoul') as ends_at,
  v.price_per_hour
from public.venues v
cross join generate_series(1, 14) as day(day_offset)
cross join unnest(array[9, 11, 13, 15, 17, 19]) as hours(hour_value)
where v.active
on conflict (venue_id, starts_at) do nothing;
