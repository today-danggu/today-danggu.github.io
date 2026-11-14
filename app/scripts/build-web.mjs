// web/ → app/www/ 로 복사하고 앱용 설정을 넣는다.
// - js/config.js: 운영 서버, 앱 표시(APP=true), 초대 링크 주소(SITE). 웹 광고(애드센스)는 앱에서 쓰지 않는다.
// - js/cap.js: Capacitor 플러그인 묶음 (src/native.js)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const web = path.join(root, '..', 'web');
const www = path.join(root, 'www');

fs.rmSync(www, { recursive: true, force: true });
fs.cpSync(web, www, { recursive: true, filter: (src) => !/[\\/](CNAME)$/.test(src) });

const API_BASE = process.env.API_BASE || 'https://api.ohsangplay.com/danggu';
fs.writeFileSync(
  path.join(www, 'js', 'config.js'),
  [
    '// 앱 빌드용 (app/scripts/build-web.mjs가 만든다)',
    'window.DANGGU_CONFIG = {',
    `  API_BASE: ${JSON.stringify(API_BASE)},`,
    "  SITE: 'https://danggu.ohsangplay.com/', // 초대 링크 주소 (앱 안 주소는 https://localhost라 따로 둔다)",
    "  ADSENSE_CLIENT: '',",
    '  ADSENSE_SLOTS: {},',
    '  APP: true,',
    '};',
    '',
  ].join('\n'),
);

const ads = JSON.parse(fs.readFileSync(path.join(root, 'ads.config.json'), 'utf8'));
const isTestId = (id) => !id || id.startsWith('ca-app-pub-3940256099942544/');
for (const [plat, P] of [['ios', 'IOS'], ['android', 'ANDROID']]) {
  const env = (k) => (process.env[`ADMOB_${P}_${k}`] || '').trim();
  if (env('APP_ID')) ads[plat].appId = env('APP_ID');
  if (env('INTERSTITIAL_ID')) ads[plat].interstitial = env('INTERSTITIAL_ID');
  const real = !isTestId(ads[plat].interstitial);
  // 보상형: 값이 있으면 그 ID, 실제 앱인데 값이 없으면 끈다(''), 테스트 빌드면 테스트 ID
  for (const [unit, key] of [['rewarded', 'REWARDED_ID']]) {
    if (env(key)) ads[plat][unit] = env(key);
    else if (real) ads[plat][unit] = '';
  }
}
const testingBy = { ios: isTestId(ads.ios.interstitial), android: isTestId(ads.android.interstitial) };
const units = (p) => ({ interstitial: ads[p].interstitial, rewarded: ads[p].rewarded });
await build({
  entryPoints: [path.join(root, 'src', 'native.js')],
  outfile: path.join(www, 'js', 'cap.js'),
  bundle: true,
  format: 'iife',
  minify: true,
  target: 'safari15',
  define: {
    __ADS__: JSON.stringify({
      ios: units('ios'),
      android: units('android'),
      testing: testingBy,
    }),
  },
  logLevel: 'warning',
});

const indexFile = path.join(www, 'index.html');
// 앱에서는 확대를 끈다. cap.js는 설정(config.js)보다 먼저 불러온다.
let html = fs
  .readFileSync(indexFile, 'utf8')
  .replace('content="width=device-width, initial-scale=1, viewport-fit=cover"', 'content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"');
if (!html.includes('js/cap.js')) html = html.replace('<script src="js/config.js"></script>', '<script src="js/cap.js"></script>\n<script src="js/config.js"></script>');
if (!html.includes('js/cap.js')) throw new Error('index.html에 js/config.js를 불러오는 줄이 없어요');
fs.writeFileSync(indexFile, html);
fs.writeFileSync(path.join(root, 'www-ads.json'), JSON.stringify({ iosAppId: ads.ios.appId, androidAppId: ads.android.appId, testing: testingBy.ios, testingAndroid: testingBy.android }));
const desc = (p) => ['interstitial', 'rewarded'].map((u) => `${u}:${!ads[p][u] ? '끔' : isTestId(ads[p][u]) ? '테스트' : '실제'}`).join(' ');
console.log(`www 준비 완료 (서버 ${API_BASE}) 광고 iOS[${desc('ios')}] 안드로이드[${desc('android')}]`);
