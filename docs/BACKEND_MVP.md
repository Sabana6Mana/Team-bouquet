# MATCHPOINT Backend MVP

Supabase(Postgres, Auth, Realtime, RLS)를 기존 React/Vite 프론트에 연결한 MVP입니다.

환경변수가 없으면 기존 NPC 데모 모드가 그대로 동작합니다. `VITE_SUPABASE_URL`과
`VITE_SUPABASE_PUBLISHABLE_KEY`를 모두 설정하면 실제 사용자 백엔드 모드로 전환됩니다.

## 구현 범위

- 익명 베타, 이메일 OTP, 카카오 OAuth 로그인
- 사용자 프로필과 종목별 ELO
- 체육관 8곳과 운영자 관리형 예약 슬롯
- 3km 이내·ELO ±250 우선 실제 사용자 매칭 큐와 실시간 매칭방
- 채팅, 시간 투표, 팀 구성, 준비 및 참가 확정
- 참가자 만장일치 경기 결과와 트랜잭션 기반 ELO 반영
- 진행 중 매치 취소와 held 예약 슬롯 반환
- 참가자 전용 RLS, 알림, 사용자 신고

실제 PG 결제와 체육관 외부 예약 API는 포함하지 않습니다. 화면의 `paid` 상태는 결제가
아니라 **MVP 참가 확정**을 의미합니다.

DB 알림을 기존 Alerts 화면에 합치는 작업과 완료 경기 이력의 기기 간 동기화는 다음 범위로
남겨 두었습니다. 현재 경기 진행 상태와 ELO 결과 자체는 서버에 저장됩니다.

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
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=로컬_publishable_또는_anon_key
VITE_NAVER_MAP_KEY_ID=
```

그다음 프론트를 실행합니다.

```bash
npm run dev
```

- 앱: <http://localhost:5173>
- Supabase Studio: <http://127.0.0.1:54323>
- 종료: `npm run supabase:stop`

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
npm run verify:mvp
```

스크립트가 일회성 익명 사용자를 만들어 아래 흐름을 자동 확인합니다. 로컬 CLI가 출력하는
검증용 service-role 키는 스크립트 안에서만 사용하며 브라우저 번들에는 들어가지 않습니다.

1. 프로필 생성
2. 큐 재시도 멱등성, 동시 재시도와 활성 매치 중복 진입 차단
3. 3km 빠른 매칭과 비참가자 RLS/예약 내부 메타데이터 차단
4. 같은 시간 투표, 참가 확정과 예약 종료 전 결과 입력 차단
5. 승자·점수 만장일치와 ELO 갱신, 경기 완료
6. 진행 중 매치 취소와 held 슬롯 반환

프론트 프로덕션 빌드는 다음으로 확인합니다.

```bash
npm run build
```

## 브라우저 두 개로 수동 확인

1. 일반 창과 시크릿 창에서 각각 <http://localhost:5173>을 엽니다.
2. 양쪽 모두 `게스트 베타로 시작하기`를 누릅니다.
3. 서로 다른 닉네임을 만들고 배드민턴을 선택합니다.
4. 양쪽에서 `대치체육센터` → 배드민턴 → `1 : 1`로 큐를 시작합니다.
5. 자동으로 같은 매칭방에 들어오는지 확인하고 서로 채팅합니다.
6. 양쪽에서 같은 시간 슬롯을 선택합니다.
7. 양쪽에서 참가를 확정하면 경기가 `confirmed` 상태가 됩니다.
8. 확정한 예약 시간이 실제로 끝나면 `경기 종료 · 결과 입력` 버튼이 활성화됩니다.
9. 양쪽에서 같은 승리 팀을 고르고 결과/ELO가 동일하게 반영되는지 확인합니다.

결과/ELO까지 바로 확인하려면 브라우저 수동 테스트 대신 `npm run verify:mvp`를 사용하세요.
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
- `supabase/seed.sql`: 체육관과 향후 14일 슬롯
- `src/backend/`: 타입이 지정된 Supabase 클라이언트와 API
- `src/context/BackendProvider.tsx`: 세션 복구, 스냅샷 및 Realtime 동기화
- `scripts/verify-mvp.mjs`: 실제 두 사용자 백엔드 흐름 검증

스키마를 변경한 후에는 아래 명령으로 TypeScript 타입을 다시 생성할 수 있습니다.

```bash
npx supabase gen types typescript --local > src/backend/database.types.ts
```
