-- Existing frontend venue fixtures, plus rolling local-development slots.
insert into public.venues (id, name, sports, lat, lng, address, price_per_hour)
values
  ('v1', '대치체육센터', array['badminton', 'tabletennis', 'basketball']::public.sport_code[], 37.4999, 127.0581, '서울 강남구 대치동', 24000),
  ('v2', '테헤란 테니스파크', array['tennis']::public.sport_code[], 37.5064, 127.0436, '서울 강남구 역삼동', 40000),
  ('v3', '역삼 배드민턴센터', array['badminton']::public.sport_code[], 37.5011, 127.0374, '서울 강남구 역삼동', 28000),
  ('v4', '선릉 탁구아레나', array['tabletennis']::public.sport_code[], 37.5048, 127.0486, '서울 강남구 삼성동', 16000),
  ('v5', '삼성 코트하우스', array['basketball']::public.sport_code[], 37.5112, 127.0567, '서울 강남구 삼성동', 36000),
  ('v6', '도곡 시민체육관', array['tennis', 'basketball']::public.sport_code[], 37.4887, 127.0450, '서울 강남구 도곡동', 20000),
  ('v7', '강남 스포츠플렉스', array['badminton', 'tabletennis', 'tennis']::public.sport_code[], 37.5089, 127.0396, '서울 강남구 논현동', 32000),
  ('v8', '대청 커뮤니티체육관', array['basketball', 'badminton']::public.sport_code[], 37.4934, 127.0610, '서울 강남구 일원동', 22000)
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
