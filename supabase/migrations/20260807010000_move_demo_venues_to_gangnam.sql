-- Keep the stable venue IDs used by the frontend and verifier while moving
-- the competition demo data from Songpa to the Gangnam badminton showcase.
update public.venues as venue
set
  name = demo.name,
  sports = demo.sports,
  lat = demo.lat,
  lng = demo.lng,
  address = demo.address,
  price_per_hour = demo.price_per_hour
from (values
  ('v1', '대치체육센터', array['badminton', 'tabletennis', 'basketball']::public.sport_code[], 37.4999::double precision, 127.0581::double precision, '서울 강남구 대치동', 24000),
  ('v2', '테헤란 테니스파크', array['tennis']::public.sport_code[], 37.5064::double precision, 127.0436::double precision, '서울 강남구 역삼동', 40000),
  ('v3', '역삼 배드민턴센터', array['badminton']::public.sport_code[], 37.5011::double precision, 127.0374::double precision, '서울 강남구 역삼동', 28000),
  ('v4', '선릉 탁구아레나', array['tabletennis']::public.sport_code[], 37.5048::double precision, 127.0486::double precision, '서울 강남구 삼성동', 16000),
  ('v5', '삼성 코트하우스', array['basketball']::public.sport_code[], 37.5112::double precision, 127.0567::double precision, '서울 강남구 삼성동', 36000),
  ('v6', '도곡 시민체육관', array['tennis', 'basketball']::public.sport_code[], 37.4887::double precision, 127.0450::double precision, '서울 강남구 도곡동', 20000),
  ('v7', '강남 스포츠플렉스', array['badminton', 'tabletennis', 'tennis']::public.sport_code[], 37.5089::double precision, 127.0396::double precision, '서울 강남구 논현동', 32000),
  ('v8', '대청 커뮤니티체육관', array['basketball', 'badminton']::public.sport_code[], 37.4934::double precision, 127.0610::double precision, '서울 강남구 일원동', 22000)
) as demo(id, name, sports, lat, lng, address, price_per_hour)
where venue.id = demo.id;
