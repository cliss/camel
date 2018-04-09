/**
 * Welcome to your Workbox-powered service worker!
 *
 * You'll need to register this file in your web app and you should
 * disable HTTP caching for this file too.
 * See https://goo.gl/nhQhGp
 *
 * The rest of the code is auto-generated. Please don't update this file
 * directly; instead, make changes to your Workbox build configuration
 * and re-run your build process.
 * See https://goo.gl/2aRDsh
 */

importScripts("https://storage.googleapis.com/workbox-cdn/releases/3.0.1/workbox-sw.js");

/**
 * The workboxSW.precacheAndRoute() method efficiently caches and responds to
 * requests for URLs in the manifest.
 * See https://goo.gl/S9QRab
 */
self.__precacheManifest = [
  {
    "url": "camel.js",
    "revision": "de09c8d423e0169a0a1f8781150c7770"
  },
  {
    "url": "gulpfile.js",
    "revision": "55d0f86f383993e0ed6e98c44fe95d1f"
  },
  {
    "url": "nodemon.json",
    "revision": "0d89096e993b0f2fa83dafe75b39af79"
  },
  {
    "url": "npm-shrinkwrap.json",
    "revision": "3e59aa77de6001e0d9c122e580772422"
  },
  {
    "url": "package.json",
    "revision": "6aa7f9281273a58df3c1b5aec7a1ba8a"
  },
  {
    "url": "public/css/site.css",
    "revision": "d41d8cd98f00b204e9800998ecf8427e"
  },
  {
    "url": "templates/defaultTags.html",
    "revision": "ef7d2b1868e57bcb8d70a16900a5dff6"
  },
  {
    "url": "templates/footer.html",
    "revision": "758cd82a731ba8cf3317d84ef1dab3ba"
  },
  {
    "url": "templates/header.html",
    "revision": "8131d7aa2fc733214addbf1bc21dd5ed"
  },
  {
    "url": "templates/postHeader.html",
    "revision": "4f70406be1e12c634c80f3f77b985ec1"
  },
  {
    "url": "templates/rssFooter.html",
    "revision": "3b3af845cc407bac7b6d7a13ae19ee76"
  }
].concat(self.__precacheManifest || []);
workbox.precaching.suppressWarnings();
workbox.precaching.precacheAndRoute(self.__precacheManifest, {});
