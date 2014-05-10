var fs           = require('fs')
  , marked       = require('marked')
  , Handlebars   = require('handlebars')
  , qfs = require('q-io/fs')
  , _            = require('underscore');

var appHelpers = function(app) {
  function init() {
      loadHeaderFooter('defaultTags.html', function (data) {
          // Note this comes in as a flat string; split on newlines for parsing metadata.
          app.caches.siteMetadata = parseMetadata(data.split('\n'));

          // This relies on the above, so nest it.
          loadHeaderFooter('header.html', function (data) {
              headerSource = performMetadataReplacements(app.caches.siteMetadata, data);
          });
      });
      loadHeaderFooter('footer.html', function (data) { footerSource = data; });
      loadHeaderFooter('postHeader.html', function (data) {
          Handlebars.registerHelper('formatPostDate', function (date) {
              return new Handlebars.SafeString(new Date(date).format('{Weekday} {d} {Month} {yyyy}, {h}:{mm} {TT}'));
          });
          Handlebars.registerHelper('formatIsoDate', function (date) {
              return new Handlebars.SafeString(date !== undefined ? new Date(date).iso() : '');
          });
          postHeaderTemplate = Handlebars.compile(data); });

      // Kill the cache every 30 minutes.
      setInterval(emptyCache, app.options.cacheResetTimeInMillis);

      marked.setOptions({
          renderer: new marked.Renderer(),
          gfm: true,
          tables: true,
          smartLists: true,
          smartypants: true
      });
  }

  function loadHeaderFooter(file, completion) {
      fs.exists(app.options.templateRoot + file, function(exists) {
          if (exists) {
              fs.readFile(app.options.templateRoot + file, {encoding: 'UTF8'}, function (error, data) {
                  if (!error) {
                      completion(data);
                  }
              });
          }
      });
  }

  function normalizedFileName(file) {
      var retVal = file;
      if (file.startsWith('posts')) {
          retVal = './' + file;
      }

      retVal = retVal.replace('.md', '');

      return retVal;
  }

  function addRenderedPostToCache(file, postData) {
      //console.log('Adding to cache: ' + normalizedFileName(file));
      app.caches.renderedPosts[normalizedFileName(file)] = _.extend({ file: normalizedFileName(file), date: new Date() }, postData);

      if (_.size(app.caches.renderedPosts) > app.options.maxCacheSize) {
          var sorted = _.sortBy(app.caches.renderedPosts, function (post) { return post['date']; });
          delete app.caches.renderedPosts[sorted.first()['file']];
      }

      //console.log('Cache has ' + JSON.stringify(_.keys(app.caches.renderedPosts)));
  }

  function fetchFromCache(file) {
      return app.caches.renderedPosts[normalizedFileName(file)] || null;
  }

  // Parses the metadata in the file
  function parseMetadata(lines) {
      var retVal = {};

      lines.each(function (line) {
          line = line.replace(app.options.metadataMarker, '');
          line = line.compact();
          if (line.has('=')) {
              var firstIndex = line.indexOf('=');
              retVal[line.first(firstIndex)] = line.from(firstIndex + 1);
          }
      });

      // NOTE: Some metadata is added in generateHtmlAndMetadataForFile().

      // Merge with site default metadata
      Object.merge(retVal, app.caches.siteMetadata, false, function(key, targetVal, sourceVal) {
          // Ensure that the file wins over the defaults.
          console.log('overwriting "' + sourceVal + '" with "' + targetVal);
          return targetVal;
      });

      return retVal;
  }

  function performMetadataReplacements(replacements, haystack) {
      _.keys(replacements).each(function (key) {
          // Ensure that it's a global replacement; non-regex treatment is first-only.
          haystack = haystack.replace(new RegExp(app.options.metadataMarker + key + app.options.metadataMarker, 'g'), replacements[key]);
      });

      return haystack;
  }

  // Parses the HTML and renders it.
  function parseHtml(lines, replacements, postHeader) {
      // Convert from markdown
      var body = performMetadataReplacements(replacements, marked(lines));
      // Perform replacements
      var header = performMetadataReplacements(replacements, headerSource);
      // Concatenate HTML
      return header + postHeader + body + footerSource;
  }

  // Gets all the lines in a post and separates the metadata from the body
  function getLinesFromPost(file) {
      file = file.endsWith('.md') ? file : file + '.md';
      var data = fs.readFileSync(file, {encoding: 'UTF8'});

      // Extract the pieces
      var lines = data.lines();
      var metadataLines = _.filter(lines, function (line) { return line.startsWith(app.options.metadataMarker); });
      var body = _.difference(lines, metadataLines).join('\n');

      return {metadata: metadataLines, body: body};
  }

  // Gets the metadata & rendered HTML for this file
  function generateHtmlAndMetadataForFile(file) {
      var retVal = fetchFromCache(file);
      if (retVal == undefined) {
          var lines = getLinesFromPost(file);
          var metadata = parseMetadata(lines['metadata']);
          metadata['relativeLink'] = externalFilenameForFile(file);
          metadata['header'] = postHeaderTemplate(metadata);
          // If this is a post, assume a body class of 'post'.
          if (app.options.postRegex.test(file)) {
              metadata['BodyClass'] = 'post';
          }
          var html =  parseHtml(lines['body'], metadata, postHeaderTemplate(metadata));
          addRenderedPostToCache(file, {
              metadata: metadata,
              body: html,
              unwrappedBody: performMetadataReplacements(metadata, generateBodyHtmlForFile(file)) }
          );
      }

      return fetchFromCache(file);
  }

  // Gets the metadata for this file
  function generateMetadataForFile(file) {
      return generateHtmlAndMetadataForFile(file)['metadata'];
  }

  // Gets the rendered HTML for this file, with header/footer.
  function generateHtmlForFile(file) {
      return generateHtmlAndMetadataForFile(file)['body'];
  }

  // Gets the body HTML for this file, no header/footer.
  function generateBodyHtmlForFile(file) {
      var parts = getLinesFromPost(file);
      var body = marked(parts['body']);
      var metadata = parseMetadata(parts['metadata']);
      metadata['relativeLink'] = externalFilenameForFile(file);
      return body;
  }

  // Gets the external relative name/link for this file
  function externalFilenameForFile(file) {
      return externalFilenameForFile(file, '');
  }

  // Gets the external absolute link for this file
  function externalFilenameForFile(file, request) {
      var hostname = request != undefined ? request.headers.host : '';

      var retVal = hostname.length ? ('http://' + hostname) : '';
      retVal += file.at(0) == '/' && hostname.length > 0 ? '' : '/';
      retVal += file.replace('.md', '').replace(app.options.postsRoot, '').replace(app.options.postsRoot.replace('./', ''), '');
      return retVal;
  }

  // Gets all the posts, grouped by day and sorted descending.
  // Completion handler gets called with an array of objects.
  // Array
  //   +-- Object
  //   |     +-- 'date' => Date for these articles
  //   |     `-- 'articles' => Array
  //   |            +-- (Article Object)
  //   |            +-- ...
  //   |            `-- (Article Object)
  //   + ...
  //   |
  //   `-- Object
  //         +-- 'date' => Date for these articles
  //         `-- 'articles' => Array
  //                +-- (Article Object)
  //                +-- ...
  //                `-- (Article Object)
  function allPostsSortedAndGrouped(completion) {
      if (Object.size(app.caches.allPostsSortedGrouped) != 0) {
          completion(app.caches.allPostsSortedGrouped);
      } else {
          qfs.listTree(app.options.postsRoot, function (name, stat) {
              return app.options.postRegex.test(name);
          }).then(function (files) {
              // Lump the posts together by day
              var groupedFiles = _.groupBy(files, function (file) {
                  var parts = file.split('/');
                  return new Date(parts[1], parts[2] - 1, parts[3]);
              });

              // Sort the days from newest to oldest
              var retVal = [];
              var sortedKeys = _.sortBy(_.keys(groupedFiles), function (date) {
                  return new Date(date);
              }).reverse();

              // For each day...
              _.each(sortedKeys, function (key) {
                  // Get all the filenames...
                  var articleFiles = groupedFiles[key];
                  var articles = [];
                  // ...get all the data for that file ...
                  _.each(articleFiles, function (file) {
                      articles.push(generateHtmlAndMetadataForFile(file));
                  });

                  // ...so we can sort the posts...
                  articles = _.sortBy(articles, function (article) {
                      // ...by their post date and TIME.
                      return Date.create(article['metadata']['Date']);
                  }).reverse();
                  // Array of objects; each object's key is the date, value
                  // is an array of objects
                  // In that array of objects, there is a body & metadata.
                  retVal.push({date: key, articles: articles});
              });

              app.caches.allPostsSortedGrouped = retVal;
              completion(retVal);
          });
      }
  }

  // Gets all the posts, paginated.
  // Goes through the posts, descending date order, and joins
  // days together until there are 10 or more posts. Once 10
  // posts are hit, that's considered a page.
  // Forcing to exactly 10 posts per page seemed artificial, and,
  // frankly, harder.
  function allPostsPaginated(completion) {
      allPostsSortedAndGrouped(function (postsByDay) {
          var pages = [];
          var thisPageDays = [];
          var count = 0;
          postsByDay.each(function (day) {
              count += day['articles'].length;
              thisPageDays.push(day);
              // Reset count if need be
              if (count >= app.options.postsPerPage) {
                  pages.push({ page: pages.length + 1, days: thisPageDays });
                  thisPageDays = [];
                  count = 0;
              }
          });

          if (thisPageDays.length > 0) {
              pages.push({ page: pages.length + 1, days: thisPageDays});
          }

          completion(pages);
      });
  }

  // Empties the caches.
  function emptyCache() {
      console.log('Emptying the cache.');
      app.caches.renderedPosts = {};
      renderedRss = {};
      app.caches.allPostsSortedGrouped = {};
  }


  app.init = init;
  app.fetchFromCache = fetchFromCache;
  app.generateHtmlAndMetadataForFile = generateHtmlAndMetadataForFile;
  app.addRenderedPostToCache = addRenderedPostToCache;
  app.allPostsPaginated = allPostsPaginated;
  app.generateMetadataForFile = generateMetadataForFile;
  app.performMetadataReplacements = performMetadataReplacements;
}

module.exports = appHelpers
