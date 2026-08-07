# MATCHPOINT 게임 지도 MVP 확인법

## 실행

```powershell
npm install
npm run supabase:start
npx supabase migration up --local
npm run dev
```

터미널에 표시되는 로컬 주소를 Chrome 또는 Edge에서 엽니다.

MapLibre 게임 지도가 기본값입니다. `.env.local`에 아래 설정이 없어도 같은 값으로 실행됩니다.

```dotenv
VITE_MAP_ENGINE=maplibre
```

## 화면에서 확인할 것

1. 첫 화면이 `강남구 · 배드민턴` 기준으로 표시되는지 확인합니다.
2. 지도를 움직이거나 확대해도 체육관 건물과 공룡이 좌표에서 밀리지 않는지 확인합니다.
3. 체육관을 한 번 누르면 건물이 커지고 이름·ELO·점선 경로가 표시되는지 확인합니다.
4. 같은 체육관을 한 번 더 누르면 체육관 상세 정보가 열리는지 확인합니다.
5. `배드민턴 1:1 매칭 시작`을 누르면 배드민턴·1대1이 선택된 매칭 설정 화면으로 이동하는지 확인합니다.
6. 진행 중인 매칭이 있을 때 버튼이 `진행 중인 매칭으로 돌아가기`로 바뀌는지 확인합니다.
7. 우측 종목 버튼과 현재 위치 버튼이 동작하는지 확인합니다.
8. MAP → RANKING → MAP으로 여러 번 이동해도 지도나 체육관이 중복되지 않는지 확인합니다.

시연 화면을 안정적으로 유지하기 위해 실제 위치가 강남 데모 지역에서 멀면 지도 위 공룡만 강남 기준 위치에 표시됩니다. 실제 매칭 요청의 위치 데이터는 기존 앱 상태를 그대로 사용합니다.

## 기존 지도 폴백 확인

`.env.local`에서 아래처럼 바꾸고 개발 서버를 다시 시작합니다.

```dotenv
VITE_MAP_ENGINE=naver
```

네이버 지도 키가 있으면 네이버 지도가, 키가 없으면 기존 내장 지도가 표시되면 정상입니다.

## 최종 명령 검증

```powershell
git diff --check
npm run build
npm run verify:mvp
```

`verify:mvp`는 Docker와 로컬 Supabase가 실행 중이어야 합니다.
