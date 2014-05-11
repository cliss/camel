var express        = require('express')
  , router         = express.Router()
  , Handlebars     = require('handlebars')
  , qfs            = require('q-io/fs')

routes = function(app) {
  router.get('/', function (request, response) {
    // Determine which page we're on, and make that the filename
    // so we cache by paginated page.
    var page = 1;
    if (request.query.p != undefined) {
      page = Number(request.query.p);
      if (isNaN(page)) {
        response.redirect('/');
      }
    }

    // Do the standard route handler. Cough up a cached page if possible.
    app.baseRouteHandler('/?p=' + page, function (cachedData) {
      response.send(cachedData['body']);
    }, function (completion) {
      var indexInfo = app.generateHtmlAndMetadataForFile(app.options.postsRoot + 'index.md');
      Handlebars.registerHelper('formatDate', function (date) {
        return new Handlebars.SafeString(new Date(date).format('{Weekday}<br />{d}<br />{Month}<br />{yyyy}'));
      });
      Handlebars.registerHelper('dateLink', function (date) {
        var parsedDate = new Date(date);
        return '/' + parsedDate.format("{yyyy}") + '/' + parsedDate.format("{M}") + '/' + parsedDate.format('{d}') + '/';
      });
      Handlebars.registerPartial('article', indexInfo['metadata']['ArticlePartial']);
      var dayTemplate = Handlebars.compile(indexInfo['metadata']['DayTemplate']);
      var footerTemplate = Handlebars.compile(indexInfo['metadata']['FooterTemplate']);

      var bodyHtml = '';
      app.allPostsPaginated(function (pages) {
        // If we're asking for a page that doesn't exist, redirect.
        if (page < 0 || page > pages.length) {
          response.redirect(pages.length > 1 ? '/?p=' + pages.length : '/');
        }
        var days = pages[page - 1]['days'];
        days.forEach(function (day) {
          bodyHtml += dayTemplate(day);
        });

        // If we have more data to display, set up footer links.
        var footerData = {};
        if (page > 1) {
          footerData['prevPage'] = page - 1;
        }
        if (pages.length > page) {
          footerData['nextPage'] = page + 1;
        }

        var metadata = app.generateMetadataForFile(app.options.postsRoot + 'index.md');
        var header = app.performMetadataReplacements(metadata, headerSource);
        // Replace <title>...</title> with one-off for homepage, because it doesn't show both Page & Site titles.
        var titleBegin = header.indexOf('<title>') + "<title>".length;
        var titleEnd = header.indexOf('</title>');
        header = header.substring(0, titleBegin) + metadata['SiteTitle'] + header.substring(titleEnd);
        // Carry on with body
        bodyHtml = app.performMetadataReplacements(metadata, bodyHtml);
        var fullHtml = header + bodyHtml + footerTemplate(footerData) + footerSource;
        completion(fullHtml);
      });
    });
  });

  router.get('/rss', function (request, response) {
    response.type('application/rss+xml');
    if (renderedRss['date'] == undefined || new Date().getTime() - renderedRss['date'].getTime() > 3600000) {
      var feed = new rss({
        title: siteMetadata['SiteTitle'],
        description: 'Posts to ' + siteMetadata['SiteTitle'],
        feed_url: 'http://www.yoursite.com/rss',
        site_url: 'http://www.yoursite.com',
        author: 'Your Name',
        webMaster: 'Your Name',
        copyright: '2013-' + new Date().getFullYear() + ' Your Name',
        image_url: 'http://www.yoursite.com/images/favicon.png',
        language: 'en',
        //categories: ['Category 1','Category 2','Category 3'],
        pubDate: new Date().toString(),
        ttl: '60'
      });

      var max = 10;
      var i = 0;
      app.allPostsSortedAndGrouped(function (postsByDay) {
        postsByDay.forEach(function (day) {
          day['articles'].forEach(function (article) {
            if (i < max) {
              ++i;
              feed.item({
                title: article['metadata']['Title'],
                // Offset the time because Heroku's servers are GMT, whereas these dates are EST/EDT.
                date: new Date(article['metadata']['Date']).addHours(utcOffset),
                url: externalFilenameForFile(article['file'], request),
                description: article['unwrappedBody']
              });
            }
          });
        });

        renderedRss = {
          date: new Date(),
          rss: feed.xml()
        };

        response.send(renderedRss['rss']);
      });
    } else {
      response.send(renderedRss['rss']);
    }
  });

  // Month view
  router.get('/:year/:month', function (request, response) {
    var path = app.options.postsRoot + request.params.year + '/' + request.params.month;
    console.log('1')

    var postsByDay = {};

    qfs.listTree(path, function (name, stat) {
      console.log('1.2')
      return name.endsWith('.md');
    }).then(function (files) {
      console.log('2')
      console.log(JSON.stringify(files))


      _.each(files, function (file) {
        console.log(2.1)
        // Gather by day of month
        var metadata = app.generateHtmlAndMetadataForFile(file)['metadata'];
        var date = Date.create(metadata['Date']);
        var dayOfMonth = date.getDate();
        if (postsByDay[dayOfMonth] == undefined) {
          postsByDay[dayOfMonth] = [];
        }

        postsByDay[dayOfMonth].push({title: metadata['Title'], date: date, url: externalFilenameForFile(file)});
      });

      console.log('3')


      var html = "";
      // Get the days of the month, reverse ordered.
      var orderedKeys = _.sortBy(Object.keys(postsByDay), function (key) { return parseInt(key); }).reverse();
      // For each day of the month...
      _.each(orderedKeys, function (key) {
        var day = new Date(request.params.year, request.params.month - 1, parseInt(key));
        html += "<h1>" + day.format('{Weekday}, {Month} {d}') + '</h1><ul>';
        _.each(postsByDay[key], function (post) {
          html += '<li><a href="' + post['url'] + '">' + post['title']  + '</a></li>';
        });
        html += '</ul>';
      });

      console.log('4')


      var header = headerSource.replace(app.options.metadataMarker + 'Title' + app.options.metadataMarker, "Day Listing");

      console.log('5')

      response.send(header + html + footerSource);
    });
  });

  // Day view
  router.get('/:year/:month/:day', function (request, response) {
    var path = app.options.postsRoot + request.params.year + '/' + request.params.month + '/' + request.params.day;

    // Get all the files in the directory
    fs.readdir(path, function (error, files) {
      if (error) {
        response.send(400, {error: "This path doesn't exist."});
        return;
      }

      var day = new Date(request.params.year, request.params.month - 1, request.params.day);
      var html = "<h1>Posts from " + day.format('{Weekday}, {Month} {d}') + "</h1><ul>";

      // Get all the data for each file
      var postsToday = [];
      files.each(function (file) {
        postsToday.push(app.generateHtmlAndMetadataForFile(path + '/' + file));
      });

      // Go ahead and sort...
      postsToday = _.sortBy(postsToday, function (post) {
        // ...by their post date and TIME...
        return Date.create(post['metadata']['Date']);
      }); // ...Oldest first.

      postsToday.each(function (post) {
        var title = post['metadata']['Title'];
        html += '<li><a href="' + post['metadata']['relativeLink'] + '">' + post['metadata']['Title'] + '</a></li>';
      });

      var header = headerSource.replace(app.options.metadataMarker + 'Title' + app.options.metadataMarker, day.format('{Weekday}, {Month} {d}'));
      response.send(header + html + footerSource);
    })
  });


  // Get a blog post, such as /2014/3/17/birthday
  router.get('/:year/:month/:day/:slug', function (request, response) {
    var file = app.options.postsRoot + request.params.year + '/' + request.params.month + '/' + request.params.day + '/' + request.params.slug;

    app.loadAndSendMarkdownFile(file, response);
  });

  // Empties the cache.
  // app.get('/tosscache', function (request, response) {
  //     emptyCache();
  //     response.send(205);
  // });

  // Support for non-blog posts, such as /about, as well as years, such as /2014.
  router.get('/:slug', function (request, response) {
    // If this is a typical slug, send the file
    if (isNaN(request.params.slug)) {
      var file = app.options.postsRoot + request.params.slug;
      app.loadAndSendMarkdownFile(file, response);
      // If it's a year, handle that.
    } else {
      app.sendYearListing(request, response);
    }
  });

  return router;
}

module.exports = routes
