# MATCHPOINT Backend MVP

Supabase(Postgres, Auth, Realtime, RLS)를 기존 React/Vite 프론트에 연결한 MVP입니다.

환경변수가 없으면 기존 NPC 데모 모드가 그대로 동작합니다. `VITE_SUPABASE_URL`과
`VITE_SUPABASE_PUBLISHABLE_KEY`를 모두 설정하면 실제 사용자 백엔드 모드로 전환됩니다.

## 구현 범위

- 익명 베타, 이메일 OTP, 카카오 OAuth 로그인
- 사용자 프로필과 종목별 ELO
- 체육관 8곳과 운영자 관리형 예약 슬롯
- 3km 이내·ELO ±250 우선 실제 사용자 매칭 큐와 실시간 매칭방
- 매칭 성사 후 5분 내 전원 수락, 미수락 시 안전한 자동 취소
- 속도·총량 제한이 적용된 채팅, 시간 투표, 팀 구성, 준비 및 참가 확정
- 참가자 만장일치 경기 결과와 트랜잭션 기반 ELO 반영
- 경기 시작 전 매치 취소와 held 예약 슬롯 반환, 시작 후 결과 회피성 취소 차단
- 서버 알림과 완료 경기 이력의 기기 간 동기화
- 도전과제·칭호와 경기 후 익명 명예 평가
- 참가자 전용 RLS, 사용자 신고, 운영자가 인정한 신고 3회 영구 정지

실제 PG 결제와 체육관 외부 예약 API는 포함하지 않습니다. 화면의 `paid` 상태는 결제가
아니라 **MVP 참가 확정**을 의미합니다.

신고 판정은 `service_role` 전용 RPC로만 가능하며, 운영자용 관리 화면은 아직 포함하지
않습니다. 실제 예약·결제를 경진대회에서 어떻게 보여줄지는
[`COMPETITION_BOOKING_PAYMENT.md`](COMPETITION_BOOKING_PAYMENT.md)에 별도로 정리했습니다.

## 로컬에서 실행

요구사항은 Node.js 20 이상과 실행 중인 Docker Desktop입니다.

```bash
npm install
npm run supabase:start
```

첫 `supabase:start`는 Docker 이미지를 내려받고 migration/seed를 적용하므로 시간이 걸릴 수
있습니다. 시작이 끝나면 출력되는 API URL과 Publishable key(구버전 CLI는 anon key)를
`.env.local`에 넣습니다.

```env
VITE_SUPABASE_URL=http://127.0.0.1:55321
VITE_SUPABASE_PUBLISHABLE_KEY=로컬_publishable_또는_anon_key
VITE_NAVER_MAP_KEY_ID=
```

그다음 프론트를 실행합니다.

```bash
npm run dev
```

- 앱: <http://localhost:5173>
- Supabase Studio: <http://127.0.0.1:55323>
- 종료: `npm run supabase:stop`

## 카카오 로그인 설정

카카오 로그인 버튼과 콜백 화면은 구현되어 있지만, 저장소에는 실제 OAuth 자격 정보를
넣지 않습니다. 카카오디벨로퍼스에서 앱을 만든 뒤 **카카오 로그인 사용 설정을 ON**으로
바꾸고 REST API 키의 Client Secret도 활성화하세요. 동의 항목은 닉네임과 프로필 이미지를
설정하고, 이메일은 서비스에 필요할 때만 요청하면 됩니다.

카카오디벨로퍼스의 REST API 키에 다음 Redirect URI를 등록합니다.

```text
http://localhost:55321/auth/v1/callback
```

호스팅 Supabase도 함께 사용한다면 Dashboard의 Kakao Provider 화면에 표시되는 다음 형태의
주소도 등록합니다. 정확한 값은 Dashboard에서 복사하세요.

```text
https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
```

프로젝트 루트의 `.env.example`을 `.env`로 복사한 뒤 아래 두 값에 REST API 키와 Client
Secret을 넣습니다. `.env`는 Git에서 제외되어 있습니다.

```env
SUPABASE_AUTH_EXTERNAL_KAKAO_CLIENT_ID=카카오_REST_API_키
SUPABASE_AUTH_EXTERNAL_KAKAO_SECRET=활성화한_Client_Secret
```

`supabase/config.toml`의 `[auth.external.kakao]` 블록은 아래처럼 환경변수를 읽도록 설정되어
있습니다. 실제 키는 이 파일에 직접 쓰지 말고 반드시 로컬 `.env`에만 보관합니다.

```toml
[auth.external.kakao]
enabled = true
client_id = "env(SUPABASE_AUTH_EXTERNAL_KAKAO_CLIENT_ID)"
secret = "env(SUPABASE_AUTH_EXTERNAL_KAKAO_SECRET)"
redirect_uri = "http://localhost:55321/auth/v1/callback"
```

마지막으로 프론트가 준비되지 않은 로그인 버튼을 노출하지 않도록 둔 플래그를 `.env` 또는
`.env.local`에서 켭니다.

```env
VITE_KAKAO_LOGIN_ENABLED=true
```

설정 변경은 Auth 컨테이너를 다시 띄워야 반영됩니다.

```bash
npm run supabase:stop
npm run supabase:start
```

두 종류의 콜백 주소를 혼동하지 마세요.

- 카카오디벨로퍼스 Redirect URI: Supabase Auth의 `/auth/v1/callback`
- Supabase Redirect 허용 목록: 프론트의 `/auth/callback`

호스팅 프로젝트에서는 Dashboard의 Authentication > Providers에서 Kakao를 활성화하고 같은
Client ID/Secret을 등록합니다. 카카오 이메일 동의를 사용하지 않는다면 `Allow users without
an email`도 켜야 합니다. Authentication > URL Configuration에는 실제 배포 프론트 주소의
`/auth/callback`을 추가하세요. Client Secret과 `service_role` 키는 `VITE_` 환경변수에 넣으면
안 됩니다.

로컬 DB를 완전히 비우고 현재 migration으로 다시 만들 때는 아래처럼 실행합니다.

```bash
npm run supabase:stop -- --no-backup
npm run supabase:start
```

Supabase CLI의 `db reset`이 안정적으로 동작하는 환경에서는 `npm run supabase:reset`으로도
같은 작업을 할 수 있습니다.

## 자동 검증

로컬 Supabase가 실행된 상태에서 다음 명령을 실행합니다.

```bash
npm run verify:backend
```

여섯 검증 스크립트가 격리된 일회성 익명 사용자를 만들어 아래 흐름을 자동 확인합니다. 로컬 CLI가 출력하는
검증용 service-role 키는 스크립트 안에서만 사용하며 브라우저 번들에는 들어가지 않습니다.

1. 프로필 생성
2. 큐 재시도 멱등성, 동시 재시도와 활성 매치 중복 진입 차단
3. 3km 빠른 매칭과 비참가자 RLS/예약 내부 메타데이터 차단
4. 같은 시간 투표, 참가 확정과 예약 종료 전 결과 입력 차단
5. 승자·점수 만장일치와 ELO 갱신, 경기 완료
6. 진행 중 매치 취소와 held 슬롯 반환
7. 도전과제 해금·진행도·칭호 장착과 직접 쓰기 차단
8. 동시 결과 확정 및 도전과제/알림의 중복 생성 방지
9. 경기 후 명예의 대상·횟수·익명성·RLS와 누적 카운터
10. 오래된 큐, 먼 체육관, 빈 슬롯 없음, 경기 후 취소와 채팅 우회 차단
11. 5분 매칭 수락·동시 만료·재큐 진입의 멱등성
12. 운영자 신고 판정, dismissed 제외, 3회 영구 정지와 기능 차단

검증이 끝나면 생성한 사용자·큐·매치·전용 장소를 삭제하고 사용한 슬롯도 원래 상태로
복구합니다. 개별 검증은 `verify:mvp`, `verify:achievements`, `verify:honor`,
`verify:lifecycle`, `verify:acceptance`, `verify:sanctions` 스크립트로 나눠 실행할 수 있습니다.

프론트 프로덕션 빌드는 다음으로 확인합니다.

```bash
npm run build
```

## 브라우저 두 개로 수동 확인

1. 일반 창과 시크릿 창에서 각각 <http://localhost:5173>을 엽니다.
2. 양쪽 모두 `게스트 베타로 시작하기`를 누릅니다.
3. 서로 다른 닉네임을 만들고 배드민턴을 선택합니다.
4. 양쪽에서 `대치체육센터` → 배드민턴 → `1 : 1`로 큐를 시작합니다.
5. 매칭 성사 화면에서 양쪽 모두 5분 안에 수락합니다.
6. 자동으로 같은 매칭방에 들어오는지 확인하고 서로 채팅합니다.
7. 양쪽에서 같은 시간 슬롯을 선택합니다.
8. 양쪽에서 참가를 확정하면 경기가 `confirmed` 상태가 됩니다.
9. 확정한 예약 시간이 실제로 끝나면 `경기 종료 · 결과 입력` 버튼이 활성화됩니다.
10. 양쪽에서 같은 승리 팀과 같은 점수를 입력하고 결과/ELO가 동일하게 반영되는지 확인합니다.
11. 경기 후 상대 한 명에게 명예를 보내고, 프로필에서 누적 수치를 확인합니다.
12. `도전과제 · 칭호`에서 첫 경기/첫 승리 보상과 칭호 장착을 확인합니다.

결과/ELO와 칭호까지 바로 확인하려면 브라우저 수동 테스트 대신 `npm run verify:backend`를 사용하세요.
검증 스크립트는 service-role로 테스트 슬롯의 시간만 과거로 옮긴 뒤, 일반 참가자 권한으로
나머지 결과 흐름을 검증합니다.

단계별 DB 상태는 Supabase Studio의 `Table Editor`에서 확인할 수 있습니다.

## 호스팅 Supabase에 적용

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push --include-seed
```

Supabase Dashboard에서 다음 설정도 필요합니다.

- Authentication의 Anonymous Sign-Ins: 초대 베타에서만 활성화
- Kakao Provider: Client ID/Secret 등록
- Site URL과 Redirect URL: 실제 프론트 도메인 및 `/auth/callback`
- Project Settings > API의 URL과 Publishable key를 프론트 환경변수에 등록

운영 배포 전에는 익명 로그인을 끄고 카카오/이메일 로그인만 남기는 것을 권장합니다.
`service_role` 키는 절대 `VITE_` 환경변수나 브라우저 코드에 넣지 마세요. 원격 프로젝트에
자동 검증을 실행할 때만 셸의 `SUPABASE_SERVICE_ROLE_KEY`로 일시 주입합니다.

## 주요 파일

- `supabase/migrations/20260803010000_matchpoint_mvp.sql`: 스키마, RLS, RPC
- `supabase/migrations/20260810010000_achievements_titles.sql`: 도전과제, 칭호, 연승
- `supabase/migrations/20260810020000_auth_profile_hardening.sql`: 프로필 저장, 닉네임 검증
- `supabase/migrations/20260810030000_match_completion_hardening.sql`: 점수 형식, 참가자별 경기 완료
- `supabase/migrations/20260812010000_match_honor.sql`: 경기 후 익명 명예와 누적 등급
- `supabase/migrations/20260812020000_backend_lifecycle_hardening.sql`: 큐·취소·슬롯·채팅 생명주기 보강
- `supabase/migrations/20260812030000_match_acceptance.sql`: 5분 전원 수락과 만료
- `supabase/migrations/20260812040000_report_sanctions.sql`: 운영자 신고 판정과 3회 영구 정지
- `supabase/migrations/20260812050000_backend_final_guards.sql`: 서버 만료 정리와 제재 우회 차단
- `supabase/seed.sql`: 체육관과 향후 14일 슬롯
- `src/backend/`: 타입이 지정된 Supabase 클라이언트와 API
- `src/context/BackendProvider.tsx`: 세션 복구, 스냅샷 및 Realtime 동기화
- `scripts/verify-mvp.mjs`: 실제 두 사용자 백엔드 흐름 검증
- `scripts/verify-achievements.mjs`: 도전과제·칭호·멱등성/RLS 검증
- `scripts/verify-honor.mjs`: 명예 평가 제약·익명성 검증
- `scripts/verify-lifecycle-hardening.mjs`: 매치 생명주기·채팅·거리 가드 검증
- `scripts/verify-match-acceptance.mjs`: 5분 수락·만료 검증
- `scripts/verify-sanctions.mjs`: 신고 판정·제재·우회 차단 검증

seed 슬롯은 DB를 만든 시점부터 향후 14일치입니다. 실제 운영 또는 행사 시연 환경에서는
운영자가 슬롯을 주기적으로 보충해야 하며, 이를 전국 체육관의 실시간 예약 재고로 표현하면
안 됩니다.

스키마를 변경한 후에는 아래 명령으로 TypeScript 타입을 다시 생성할 수 있습니다.

```bash
npx supabase gen types typescript --local > src/backend/database.types.ts
```
