// ============================================
// orOS — Central Config 
// ============================================

var OROS_CONFIG = {
  baseHref: '/',
  version: '0.8',
  channel: 'stable',
  domain: 'https://useoros.online',
  cacheName: 'oros-v0.8',
  
  // SEO Configuration
  seo: {
    title: 'orOS — The Artist\'s Operating System',
    description: 'Privacy-first creative toolkit. Writer, Case Converter, and more. Works offline. No tracking. No ads.',
    keywords: ['text editor', 'case converter', 'privacy', 'offline', 'writer', 'open source', 'Greek'],
    author: 'Christos Koulaxizis',
    twitterHandle: '@koulaxizis',
    ogImage: '/og-image.png',
    twitterImage: '/twitter-card.png'
  }
};

if (typeof window !== 'undefined') {
  window.OROS_CONFIG = OROS_CONFIG;
}