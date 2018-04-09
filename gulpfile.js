const gulp = require('gulp');
const workboxBuild = require('workbox-build');

gulp.task('service-worker', () => {
  return workboxBuild.generateSW({
    globDirectory: './',
    globPatterns: [
      '**\/*.{html,json,js,css,jpeg}',
    ],
    swDest: './sw.js',
  });
});
