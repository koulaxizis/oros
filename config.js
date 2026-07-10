// ============================================
// orOS — Central Config 
// ============================================

var OROS_CONFIG = {
  baseHref: '/',
  version: '0.7',
  channel: 'stable',
  domain: 'https://useoros.com',
  cacheName: 'oros-v0.7'
};

if (typeof window !== 'undefined') {
  window.OROS_CONFIG = OROS_CONFIG;
}