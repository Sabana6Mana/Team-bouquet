# MATCHPOINT 모바일 앱 실행 가이드

MATCHPOINT는 같은 React 화면을 두 가지 방식으로 실행합니다.

- **웹**: Vite 개발 서버를 Chrome, Edge 같은 브라우저에서 엽니다.
- **Android 앱**: 웹 빌드 결과물(`dist`)을 Capacitor가 Android WebView 안에 넣어 APK로 실행합니다.

화면과 백엔드 코드는 대부분 공유하지만, APK에서는 위치 권한, 상태바와 노치 여백,
키보드 크기 조절, Android 뒤로가기, 카카오 로그인 후 앱 복귀를 네이티브 기능으로 처리합니다.

현재 저장소에는 **Capacitor 7 기반 Android 프로젝트만** 들어 있습니다. Expo/React Native 앱과
PWA가 아니며, iOS 프로젝트는 아직 없습니다.

## 1. 웹과 APK의 차이

| 구분 | 웹 개발 서버 | Android APK |
| --- | --- | --- |
| 실행 위치 | PC 또는 휴대폰 브라우저 | Android WebView |
| 화면 코드 | `src`를 Vite가 바로 제공 | `npm run mobile:sync` 당시의 `dist`가 APK에 포함됨 |
| 주소 | `http://localhost:5173` | 앱 내부 `https://localhost` |
| 위치 | 브라우저 위치 권한 | Android 위치 권한 |
| 카카오 로그인 | 현재 브라우저에서 이동 후 웹 콜백 | 외부 브라우저를 열고 딥링크로 앱 복귀 |
| 코드 변경 반영 | Vite가 즉시 새로고침 | 다시 동기화하고 앱을 빌드해야 함 |

`npm run dev`만 실행해도 APK가 자동으로 바뀌지는 않습니다. React, CSS, 이미지가 바뀌면
반드시 `npm run mobile:sync`를 다시 실행해야 합니다.

## 2. 필요한 개발 환경

다음 버전을 기준으로 사용합니다.

- **Node.js 20 LTS**
- **Capacitor 7** — `npm install`로 저장소에 지정된 버전이 설치됩니다.
- **Java JDK 21** — Capacitor 7 Android 빌드에 필요합니다.
- **Android Studio**
- **Android SDK Platform 35**
- Android SDK Build-Tools 35, Platform-Tools, Command-line Tools

버전 확인:

```powershell
node -v
npm -v
java -version
```

Node가 20이 아니거나 Java가 21이 아니면 먼저 버전을 맞춥니다. Android Studio의
`SDK Manager`에서 Android SDK Platform 35와 필요한 SDK Tools를 설치합니다.

현재 Windows 검증 PC의 실제 설치 위치는 다음과 같습니다.

```text
JDK 21: C:\Program Files\Eclipse Adoptium\jdk-21.0.12.8-hotspot
Android SDK: C:\Users\박광민\AppData\Local\Android\Sdk
```

PowerShell을 새로 열 때 다음처럼 현재 셸의 경로를 맞춥니다. 다른 PC에서는 실제 JDK 설치
위치만 바꾸고, Android SDK는 보통 `$env:LOCALAPPDATA\Android\Sdk`에 있습니다.

```powershell
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.8-hotspot"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\cmdline-tools\latest\bin;$env:Path"

java -version
& "$env:ANDROID_HOME\platform-tools\adb.exe" version
```

Android Studio로 `android` 폴더를 처음 열면 SDK 경로가 들어간
`android/local.properties`가 생성됩니다. 이 파일은 PC마다 경로가 달라 Git에 올리지 않습니다.

현재 검증 기준 설치 패키지는 `platforms;android-35`, `build-tools;35.0.0`,
`platform-tools`, `emulator`, `system-images;android-35;google_apis;x86_64`입니다. 화면 검증용
AVD는 Pixel 7, Android 15(API 35), x86_64 조합을 사용합니다.

### Android SDK 라이선스

Android SDK 라이선스는 개발자가 내용을 확인하고 **직접 동의해야 합니다**. 자동으로 대신
동의시키거나 라이선스 입력을 Git에 저장하면 안 됩니다.

가장 쉬운 방법은 Android Studio의 SDK Manager에서 설치 중 표시되는 약관을 직접 확인하고
동의하는 것입니다. 명령줄을 사용한다면 다음 명령을 본인이 실행하고 각 약관을 읽은 후
직접 `y` 또는 `n`을 입력합니다.

```powershell
& "$env:ANDROID_HOME\cmdline-tools\latest\bin\sdkmanager.bat" --licenses
```

## 3. 백엔드 환경변수 준비

저장소 루트의 `.env.local`에 프론트가 사용할 공개 설정을 넣습니다.

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
VITE_KAKAO_LOGIN_ENABLED=true
```

- `service_role` 키와 카카오 Client Secret은 절대 넣지 않습니다.
- `.env.local`은 Git에 올리지 않습니다.
- `VITE_` 값은 빌드할 때 APK 안에 포함되므로 값을 바꾼 후 다시 동기화해야 합니다.

```powershell
npm run mobile:sync
```

### 실제 기기에서 로컬 주소 사용 주의

휴대폰이나 Android 에뮬레이터에서 `127.0.0.1`과 `localhost`는 개발 PC가 아니라
**그 휴대폰 또는 에뮬레이터 자신**입니다. 따라서 현재 PC에서 실행 중인
`http://127.0.0.1:55321`을 그대로 APK에 넣으면 백엔드 연결과 로그인이 되지 않습니다.

- 대회 시연과 실제 기기 검증에는 **호스팅된 Supabase HTTPS 주소를 권장**합니다.
- Android 에뮬레이터에서 PC 서버는 보통 `10.0.2.2`로 접근할 수 있지만, OAuth 콜백,
  HTTP 보안 정책과 방화벽까지 별도로 맞춰야 합니다.
- 실제 휴대폰에서 PC의 LAN IP를 사용하는 방법도 있지만 같은 Wi-Fi, Windows 방화벽,
  HTTPS와 OAuth 리다이렉트 설정이 모두 필요합니다.

즉, 단순 화면 검증은 로컬 데모 모드로 할 수 있지만, **실제 카카오 로그인과 다중 사용자
백엔드 검증은 호스팅 Supabase로 진행하는 것이 가장 안정적**입니다.

## 4. 최초 실행

저장소 루트에서 의존성을 설치하고 Android 프로젝트를 동기화합니다.

```powershell
npm install
npm run mobile:sync
```

`mobile:sync`는 다음 두 작업을 차례대로 수행합니다.

1. TypeScript 검사와 Vite 프로덕션 빌드
2. `dist`와 Capacitor 플러그인을 Android 프로젝트에 복사

Android Studio로 프로젝트를 엽니다.

```powershell
npm run mobile:open
```

Android Studio에서:

1. Gradle 동기화가 끝날 때까지 기다립니다.
2. Device Manager에서 에뮬레이터를 만들거나 USB 디버깅을 켠 실제 휴대폰을 연결합니다.
3. 상단 기기 목록에서 대상 기기를 고릅니다.
4. `Run app` 버튼을 누릅니다.

실제 휴대폰 연결 확인은 다음 명령으로 할 수 있습니다.

```powershell
adb devices
```

## 5. 개발 중 반복 작업

### 브라우저에서 빠르게 UI 확인

```powershell
npm run dev
```

이 방식은 빠르지만 위치 권한, 딥링크, Android 뒤로가기 같은 네이티브 기능은 검증하지 못합니다.

### React/CSS/이미지 변경 후 Android에 반영

```powershell
npm run mobile:sync
```

그다음 Android Studio에서 앱을 다시 실행합니다. 웹 파일만 빠르게 복사하고 싶을 때는
`npm run build` 후 `npx cap copy android`를 사용할 수 있지만, 플러그인이나 Capacitor 설정이
바뀌었다면 반드시 전체 `mobile:sync`를 사용합니다.

### Android 프로젝트 열기

```powershell
npm run mobile:open
```

## 6. 디버그 APK 만들기

저장소 루트에서 다음 명령을 실행합니다.

```powershell
npm run mobile:build:android
```

성공하면 디버그 APK가 다음 위치에 생성됩니다.

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

이 APK는 개발·시연용 디버그 서명본입니다. Google Play 제출용 릴리스 AAB, 정식 키스토어와
서명 보관 절차는 아직 별도로 구성해야 합니다.

Gradle만 다시 실행하려면:

```powershell
cd android
.\gradlew.bat assembleDebug
```

단, 웹 코드가 바뀌었다면 먼저 저장소 루트에서 `npm run mobile:sync`를 실행해야 합니다.

## 7. 카카오 로그인과 딥링크

Android 앱의 로그인 복귀 주소는 다음과 같습니다.

```text
com.teambouquet.matchpoint://auth/callback
```

로그인 흐름은 다음 순서입니다.

1. 앱이 Supabase에 카카오 로그인 URL을 요청합니다.
2. Android Custom Tab에서 카카오 로그인 화면을 엽니다.
3. 카카오가 Supabase OAuth 콜백으로 돌아갑니다.
4. Supabase가 MATCHPOINT 딥링크로 이동합니다.
5. Android가 MATCHPOINT를 다시 열고 PKCE 코드로 세션을 만듭니다.

### Supabase Dashboard

`Authentication → URL Configuration → Redirect URLs`에 다음 주소를 추가합니다.

```text
com.teambouquet.matchpoint://auth/callback
```

Kakao Provider에도 REST API 키와 Client Secret을 설정하고 활성화합니다.

### Kakao Developers

Kakao Developers의 Redirect URI에는 MATCHPOINT 딥링크가 아니라 **Supabase가 표시하는
Provider Callback URL**을 등록합니다.

호스팅 Supabase 예시:

```text
https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
```

로컬 Supabase 예시:

```text
http://localhost:55321/auth/v1/callback
```

카카오 로그인 동의항목은 현재 앱 기준으로 `닉네임`과 `프로필 사진`을 설정합니다.
카카오톡 메시지 전송 권한은 필요하지 않습니다.

앱 ID나 딥링크 이름을 바꾸려면 다음 설정을 함께 변경해야 합니다.

- `capacitor.config.ts`의 `appId`
- `src/lib/nativeRuntime.ts`의 `NATIVE_AUTH_REDIRECT`
- `android/app/src/main/res/values/strings.xml`의 `custom_url_scheme`
- Supabase Redirect URL 허용 목록

하나라도 다르면 카카오 로그인 후 앱으로 돌아오지 못합니다.

## 8. 실제 기기 화면 QA

에뮬레이터만으로 끝내지 말고 최소 한 대의 실제 Android 휴대폰에서도 확인합니다.

### 권장 화면 크기

| 유형 | 세로 크기 예시 | 함께 확인할 것 |
| --- | --- | --- |
| 소형 | 320×568, 360×640 | 버튼·시간표·긴 닉네임 잘림 |
| 일반 | 390×844, 412×915 | 기준 UI와 노치·제스처 바 |
| 대형 | 430×932 | 콘텐츠가 과하게 벌어지지 않는지 |
| 가로 | 568×320, 667×375, 844×390 | 매칭방 선수·시간표·채팅 겹침 |

### 기능별 체크표

| 영역 | 확인할 상태 | 합격 기준 |
| --- | --- | --- |
| 설치·실행 | 최초 실행, 재실행, 스플래시 | 흰 화면이나 무한 로딩 없이 지도 또는 로그인으로 이동 |
| 로그인 | 카카오 로그인·취소·재로그인 | 외부 브라우저에서 앱으로 복귀하고 세션 유지 |
| 온보딩 | 닉네임 키보드, 종목과 모드 선택 | 키보드가 입력창·다음 버튼을 가리지 않음 |
| 위치 | 허용·거부·다시 허용 | 거부해도 기본 위치로 실행되고 강제 종료되지 않음 |
| 지도 | 이동·확대·체육관 선택·팝업 | HUD가 노치에 가리지 않고 지도와 3D 체육관이 표시됨 |
| 하단 탭 | MAP·RANKING·CLAN·ALERTS | 제스처 바와 겹치지 않고 마지막 내용까지 스크롤 가능 |
| 프로필 | 프로필·도전과제·칭호 | 긴 목록과 긴 닉네임이 화면 밖으로 나가지 않음 |
| 매칭 시작 | 설정·대기·취소 | 연속 탭해도 중복 큐가 생기지 않고 뒤로가기 정상 |
| 매칭방 세로 | 1대1·2대2·3대3, 날짜·시간 투표 | 선수, 시간표, 하단 입력창이 겹치지 않음 |
| 매칭방 가로 | 회전 전후, 채팅·선수 정보 | 가운데 시간표가 조작 가능하고 좌우 패널이 잘리지 않음 |
| 채팅 | 키보드 열기·닫기, 긴 메시지 | 입력창과 전송 버튼이 보이고 메시지 영역만 스크롤됨 |
| 경기 완료 | 팀 편성·결과 투표·명예 평가 | 마지막 확인 버튼이 제스처 바 위에 있고 중복 제출되지 않음 |
| 생명주기 | 홈 이동·백그라운드·화면 잠금·복귀 | 로그인과 진행 중 매칭이 유지되고 지도가 다시 표시됨 |
| Android 뒤로가기 | 일반 화면·루트·외부 로그인 | 이전 화면으로 이동하고 루트에서는 앱을 최소화함 |
| 네트워크 | 느린 통신·잠깐 끊김·복구 | 오류 안내가 보이고 재접속 후 상태가 복구됨 |

공통으로 다음 네 가지를 모든 화면에서 확인합니다.

- 상단 버튼과 제목이 상태바·노치에 가리지 않는가
- 하단 버튼이 Android 제스처 바에 가리지 않는가
- 의도하지 않은 가로 스크롤이 생기지 않는가
- 키보드를 열어도 현재 입력과 주요 버튼을 계속 조작할 수 있는가

Chrome의 `chrome://inspect/#devices`에서 USB 연결된 WebView의 콘솔과 네트워크 오류를
확인하면 실제 기기 문제를 찾기 쉽습니다.

### 현재 완료한 브라우저 반응형 검증

2026년 8월 12일 기준으로 다음 8개 화면 크기에서 지도, 프로필, 도전과제, 랭킹, 클랜,
알림, 매칭 설정의 7개 화면을 조합한 **56개 레이아웃 검사**를 실행했다.

```text
320×568, 360×640, 390×844, 412×915, 430×932
568×320, 667×375, 844×390
```

56개 조합 모두 루트 화면의 의도하지 않은 가로 넘침이 없고, 긴 내용은 내부 스크롤로
도달할 수 있음을 확인했다. 320×568에서는 데모 흐름을 직접 조작해 다음 전 과정도 확인했다.

```text
지도 → 매칭 설정 → 3대3 시간 합의 → 팀 편성 → 참가 확정 화면
→ 경기 결과·점수 합의 → ELO 결과 → 상대 한 명에게 명예 전달 → 지도 복귀
```

568×320 가로 화면에서는 매칭방의 좌우 선수 열, 가운데 날짜·시간표, 결과 화면을 별도로
확인했다. 이 과정에서 소형 가로 화면의 선수 열과 시간표 폭, 세로 화면 시간표의 그리드 넘침,
안전 영역 여백을 보완했다.

이 결과는 **브라우저 뷰포트 검증**이다. Android 상태바, 실제 소프트 키보드, 위치 권한 창,
카카오 로그인 후 딥링크 복귀, WebGL 성능은 SDK 라이선스 동의와 APK 빌드가 끝난 뒤 실제
에뮬레이터 또는 휴대폰에서 한 번 더 확인해야 한다.

## 9. 알려진 제약

- 현재 네이티브 프로젝트는 **Android만** 있습니다.
- iOS 앱을 로컬에서 빌드하고 실제 기기로 확인하려면 **Mac과 Xcode가 반드시 필요**합니다.
- iOS를 추가할 때는 Mac에서 Capacitor iOS 프로젝트, 권한 문구, Universal Link 또는
  커스텀 URL 스킴, 카카오 복귀를 별도로 검증해야 합니다.
- 현재 생성 명령은 디버그 APK 기준입니다. 스토어 배포용 서명과 AAB는 별도 작업입니다.
- 지도 타일, 웹폰트, Supabase와 카카오 로그인이 인터넷 연결에 의존합니다.
- MapLibre와 Three.js를 함께 사용하므로 저사양 Android의 WebGL 성능을 실제 기기에서
  확인해야 합니다.
- APK에는 마지막 `mobile:sync` 시점의 웹 파일이 들어갑니다. 동기화를 잊으면 브라우저에서
  본 최신 화면과 APK 화면이 다를 수 있습니다.
- 실제 체육관 예약과 PG 결제는 모바일 포장 여부와 별개의 백엔드 연동 범위입니다.
