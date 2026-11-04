# 오늘도 당구

4구·3구를 혼자 또는 둘이 번갈아 치는 웹 당구 게임. 당점·두께·힘에 따라 수구가 한 번 튕긴 뒤까지 경로를 보여 주는 안내선이 있어요.

- 웹: https://danggu.ohsangplay.com
- 앱 패키지명 / 번들 ID (예정): `com.ohsang.play.danggu`

## 구조

```
web/                 정적 웹 (빌드 도구 없음) → GitHub Pages로 배포
  index.html         게임 전체 (물리·화면·조작)
  js/config.js       배포 설정 (애드센스 ID 등)
  favicon.svg
  CNAME              danggu.ohsangplay.com
.github/workflows/
  pages.yml          main에 web/ 변경이 푸시되면 Pages 배포
```

앞으로 붙일 것: `worker/` (Cloudflare Worker 서버, 온라인 같이하기·랭킹), `app/` (Capacitor 앱).

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
