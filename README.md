# 오늘도 당구

4구·3구·포켓볼(8볼)을 혼자, 한 기기에서 둘이, 또는 온라인으로 치는 웹 당구 게임. 당점·두께·힘에 따라 수구가 한 번 튕긴 뒤까지 경로를 보여 주는 안내선이 있어요.

- 웹: https://danggu.ohsangplay.com
- 앱 패키지명 / 번들 ID (예정): `com.ohsang.play.danggu`

## 구조

```
web/                 정적 웹 (빌드 도구 없음) → GitHub Pages로 배포
  index.html         게임 전체 (물리·화면·조작)
  js/config.js       배포 설정 (애드센스 ID 등)
  favicon.svg
  CNAME              danggu.ohsangplay.com
worker/              온라인 같이하기 서버 (Cloudflare Worker + Durable Object)
  src/match.ts       방 상태 규칙 (입장·샷·결과·다시 하기·나가기)
  src/room.ts        방 하나 = Durable Object 하나, WebSocket
  src/index.ts       POST /api/rooms, GET /api/rooms/:code/ws
.github/workflows/
  pages.yml          main에 web/ 변경이 푸시되면 Pages 배포
  server.yml         worker/ 변경이 푸시되면 타입 검사·테스트 후 서버 배포
```

app/                 스토어 앱 (Capacitor 8). web/을 앱 안에 묶는다
  scripts/build-web.mjs  web/ → app/www/ 복사, 앱용 설정·네이티브 묶음(cap.js) 넣기
  src/native.js      AdMob·진동·공유·상태바·앱 링크를 window.DangguNative로
  assets/            아이콘·스플래시 원본 (npx @capacitor/assets generate)
  android/ ios/      네이티브 프로젝트 (가로 고정)

## 앱 (오늘도 당구)

- 패키지명 / 번들 ID: `com.ohsang.play.danggu`, 가로 화면 고정, 상태 표시줄 숨김
- 광고: 경기가 끝날 때 전면 광고(AdMob), 3분에 한 번까지. 게임 중에는 광고 없음
  - 처음 실행: 유럽 등은 동의 화면 → iPhone은 안내 후 추적 허용 요청 → 광고 시작
  - 광고 ID는 저장소 Variables로: `ADMOB_IOS_APP_ID`, `ADMOB_IOS_INTERSTITIAL_ID`, `ADMOB_ANDROID_APP_ID`, `ADMOB_ANDROID_INTERSTITIAL_ID` (없으면 구글 테스트 광고)
- 초대 링크 `https://danggu.ohsangplay.com/?room=코드`가 앱으로 바로 열림 (앱이 없으면 웹)
  - iOS: Secrets `APPLE_TEAM_ID`가 있으면 Pages 배포 때 `.well-known/apple-app-site-association`을 만든다
  - 안드로이드: Variables `ANDROID_CERT_SHA256`(업로드 키, Play 앱 서명 키를 쉼표로)이 있으면 `assetlinks.json`
- 공유 버튼(시스템 공유 창), 샷·득점 진동, 안드로이드 뒤로가기(창 닫기 → 메뉴 → 앱 내리기)

### 빌드

- 안드로이드: Actions → **안드로이드 빌드** → Run workflow. 업로드 키 Secrets(`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`)가 있으면 서명된 AAB, 없으면 디버그 APK
- iOS: Actions → **iOS 빌드 → TestFlight 업로드** → Run workflow. Secrets `APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8_BASE64` 필요 (야추와 같은 값)
- 로컬: `cd app && npm install && npm run build` (web 묶기 + `cap sync`)

## 온라인 같이하기

- 서버 주소: `https://api.ohsangplay.com/danggu` (야추와 같은 api.ohsangplay.com을 경로로 나눠 씀)
- 방장이 종목·목표 점수를 정해 방을 만들고, 친구는 초대 링크(`?room=코드`)나 방 코드 4글자로 들어와요. 두 명이 차면 바로 시작해요.
- 물리 계산은 **치는 사람 화면**이 하고, 결과(공 위치·점수·차례)를 서버에 보내요. 상대 화면은 같은 샷을 재생한 뒤 그 결과로 위치를 맞춰요. (기기마다 소수점 계산이 조금씩 달라 생기는 어긋남을 막음)
- 내 차례에 조준하는 모습(방향·힘·당점)은 상대 화면에 실시간으로 보여요.
- 새로고침·끊김: 같은 브라우저면 자동으로 같은 자리로 돌아와요. 치다가 끊기면 다시 들어올 때 결과를 바로 계산해서 이어가요.
- 다시 하기는 두 사람이 모두 눌러야 시작하고, 먼저 치는 사람이 바뀌어요.
- 아무도 없는 방은 15분, 2시간 넘게 진행이 없는 방은 정리돼요.

### 배포 준비 (한 번만)

저장소 **Settings → Secrets and variables → Actions**에 야추와 같은 값을 넣어요.

- `CLOUDFLARE_API_TOKEN`: Workers Scripts 편집 + ohsangplay.com 영역의 Workers Routes 편집 권한
- `CLOUDFLARE_ACCOUNT_ID`

### 로컬에서 서버까지 같이 돌리기

```
cd worker && npm install && npx wrangler dev --port 8787
cd web && python3 -m http.server 8080
# 브라우저: http://localhost:8080/?api=http://localhost:8787
```

## 포켓볼 (8볼)

- 구멍 6개, 공 15개 삼각 랙. 브레이크 전에는 흰 공을 왼쪽 선 안에 놓고 쳐요.
- 처음 넣은 공으로 솔리드(1~7)·스트라이프(9~15)가 정해지고, 내 공을 다 넣은 뒤 8번을 넣으면 승리.
- 파울(아무 공도 못 맞힘, 내 공이 아닌 공을 먼저 맞힘, 흰 공이 들어감) → 상대가 흰 공을 원하는 곳에 놓고 침(프리볼).
- 8번이 일찍 들어가거나 8번을 넣으며 파울이면 패배. 브레이크에 들어간 8번은 제자리에 다시 놓음.
- 혼자하기: 15개를 모두 넣으면 끝(8번은 마지막). 샷 수 기록.
- 간단하게 하려고 포켓 지정(콜)과 '맞힌 뒤 쿠션' 규칙은 넣지 않았어요.

## 화면 배치

- PC: 당구대 + 오른쪽 조작 패널. 가로 1300px 이상이면 좌우 160×600 광고, 그보다 좁으면 아래 728×90 광고.
- 휴대폰 가로 (또는 가로 900px 미만 / 세로 560px 미만 창): 왼쪽 힘 막대, 오른쪽 당점·두께·미세 조준 휠. 게임 중 광고 없음, 경기 종료 화면에만 300×250.
- 세로 화면: 가로로 돌리라는 안내.

## 광고

`web/js/config.js`의 `ADSENSE_CLIENT`가 비어 있으면 광고 자리를 모두 숨겨요. 광고 자리는 `<aside class="ad-slot" data-ad="left|right|bottom|result">`.

## 로컬에서 보기

```
cd web && python3 -m http.server 8080
```
