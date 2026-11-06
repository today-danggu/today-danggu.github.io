// 앱에서만 쓰는 네이티브 기능을 게임 화면(web/index.html)이 쓸 수 있게 window.DangguNative로 내놓는다.
// build-web.mjs가 esbuild로 묶어서 www/js/cap.js로 넣는다. 웹 사이트에는 들어가지 않는다.
import { Capacitor } from '@capacitor/core';
import { AdMob } from '@capacitor-community/admob';
import { Share } from '@capacitor/share';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';
import { StatusBar } from '@capacitor/status-bar';

/* global __ADS__ */
const platform = Capacitor.getPlatform();
window.DangguNative = {
  isNative: Capacitor.isNativePlatform(),
  platform,
  /** 이 플랫폼의 광고 단위 { interstitial, testing } */
  ads: { ...(__ADS__[platform] ?? {}), testing: !!__ADS__.testing[platform] },
  AdMob,
  Share,
  Haptics,
  ImpactStyle,
  NotificationType,
  Browser,
  App,
  StatusBar,
};
