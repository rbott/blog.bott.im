const packageJson = require('../../package.json');

module.exports = {
  // ---------------------------------------------------------------------------
  // Information about your site
  // ---------------------------------------------------------------------------
  site: {
    title: 'blog.bott.im',
    description: 'Personal Opinions, Tech Projects and Open Source in General',
    url: process.env.URL || 'https://blog.bott.im/',
    logo: '/images/logo.svg',
    language: 'en',
    startYear: 2024 ,
    generator: {
      name: 'Eleventy',
      version: packageJson.dependencies['@11ty/eleventy'].replace('^', ''),
      url: 'https://11ty.dev',
    },
    dir: 'auto',
    template: {
      name: 'Bliss',
      url: 'https://github.com/lwojcik/eleventy-template-bliss',
      credit: {
        name: 'Offbeat Bits',
        url: 'https://offbeatbits.com',
      },
    },
  },
  // ---------------------------------------------------------------------------
  // Information about YOU, the site author
  // ---------------------------------------------------------------------------
  author: {
    name: 'Rudolph Bott',
    url: 'https://blog.bott.im/',
    fediverse: [
      {
        username: 'rbo_ne',
        server: 'chaos.social',
        url: 'https://chaos.social/@rbo_ne',
      },
      {
        username: 'rbo_ne',
        server: 'pixelfed.de',
        url: 'https://pixelfed.de/@rbo_ne',
      }
    ],
  },
  // ---------------------------------------------------------------------------
  // Pages linked in the footer on the right side
  // ---------------------------------------------------------------------------
  metaPages: [
    // {
    //   url: 'https://example.org/link-1/',
    //   title: 'Example link 1',
    // },
  ],
  // ---------------------------------------------------------------------------
  // Default settings for OpenGraph functionality (tags and generated images)
  // ---------------------------------------------------------------------------
  opengraph: {
    type: 'website',
    // Default image to use when none is specified
    image: '/images/share-1200x600.jpg',
    // Opt-in to automatic generation of OpenGraph images
    // If disabled, default images will be used
    // If enabled, make sure you _like_ the way they look like
    // (build the site and find the images in _site/images/share folder)
    // To modify what generated OG images look like
    // edit content/_data/utils/og-image.njk
    enableImageGeneration: false,
    // Background color for auto-generated OpenGraph images
    ogImageBackgroundColor: '#1773cf',
    // Text color for for auto-generated OpenGraph images
    ogImageTextColor: '#fff',
  },
  // ---------------------------------------------------------------------------
  // Default settings for Twitter graph tags
  // ---------------------------------------------------------------------------
  twitter: {
    card: 'summary_large_image',
    image: '/images/share-1200x600.jpg',
  },
  // ---------------------------------------------------------------------------
  // Settings for post tags
  // ---------------------------------------------------------------------------
  tags: {
    displayOnArchivePage: true,
    displayOnPostPage: true,
    pageUrlPrefix: 'tag',
    postsPerPage: 10,
  },
  // ---------------------------------------------------------------------------
  // Settings for PWA
  // ---------------------------------------------------------------------------
  enablePWA: false, // If enabled, service worker for PWA will be registered
  manifestJson: {
    language: 'en-US',
    themeColor: '#1773cf',
    backgroundColor: '#1773cf',
  },
  // ---------------------------------------------------------------------------
  // Settings for post share buttons
  //
  // Possible options:
  // mastodon, twitter, linkedin, facebook, hackernews, clipboard
  //
  // 'clipboard' is an option to copy the article URL to user's clipboard
  //
  // ---------------------------------------------------------------------------
  shareButtons: [
    'mastodon',
    'twitter',
    'hackernews',
    'clipboard',
  ],
  // ---------------------------------------------------------------------------
  // Date formats used on the site (mostly somewhere around post contents).
  // ---------------------------------------------------------------------------
  dateFormats: {
    readable: 'd LLL yyyy',
    fullReadable: 'd LLLL yyyy',
  },
  // ---------------------------------------------------------------------------
  // Settings for RSS feeds (Atom)
  // ---------------------------------------------------------------------------
  feed: {
    stylesheet: {
      url: '/feed.xsl',
      baseColor: '#1773cf',
    },
    excerpts: {
      title: 'RSS feed (excerpts)',
      path: '/excerpts.xml',
      limit: 10,
    },
    full: {
      title: 'RSS feed (full articles)',
      path: '/full.xml',
      limit: 10,
    },
  },
  // ---------------------------------------------------------------------------
  // Settings for JSON feeds.
  // JSON feeds in this site follow JSON Feed Version 1.1 specification:
  // https://www.jsonfeed.org/version/1.1/
  // ---------------------------------------------------------------------------
  json: {
    excerpts: {
      title: 'JSON feed (excerpts)',
      path: '/excerpts.json',
      limit: 10,
    },
    full: {
      title: 'JSON feed (full articles)',
      path: '/full.json',
      limit: 10,
    },
  },
  // ---------------------------------------------------------------------------
  // Site icons, used mostly for PWA manifest
  // ---------------------------------------------------------------------------
  icons: {
    ico: '/favicon.ico',
    svg: '/favicon.svg',
    i192: '/icon-192.png',
    i512: '/icon-512.png',
  },
  localeSort: {
    language: 'en',
    options: {
      sensitivity: 'base',
    },
  },
  enableReadingProgressBar: true,
};
