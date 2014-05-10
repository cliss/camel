var helpers = function(app) {

function loadAndSendMarkdownFile(file, response) {
  if (file.endsWith('.md')) {
    // Send the source file as requested.
    console.log('Sending source file: ' + file);
    fs.exists(file, function (exists) {
      if (exists) {
        fs.readFile(file, {encoding: 'UTF8'}, function (error, data) {
          if (error) {
            response.send(500, {error: error});
            return;
          }
          response.type('text/x-markdown; charset=UTF-8');
          response.send(data);
          return;
        });
      } else {
        response.send(400, {error: 'Markdown file not found.'});
      }
    });
  } else if (app.fetchFromCache(file) != null) {
    // Send the cached version.
    console.log('Sending cached file: ' + file);
    response.send(200, app.fetchFromCache(file)['body']);
    return;
  } else {
    // Fetch the real deal.
    console.log('Sending file: ' + file)
    fs.exists(file + '.md', function (exists) {
      if (!exists) {
        response.send(404, {error: 'A post with that address is not found.'});
        return;
      }

      var html = generateHtmlForFile(file);
      response.send(200, html);
    });
  }
}

// Sends a listing of an entire year's posts.
function sendYearListing(request, response) {
  var year = request.params.slug;
  var retVal = '<h1>Posts for ' + year + '</h1>';
  var currentMonth = null;

  allPostsSortedAndGrouped(function (postsByDay) {
    postsByDay.each(function (day) {
      var thisDay = Date.create(day['date']);
      if (thisDay.is(year)) {
        // Date.isBetween() is not inclusive, so back the from date up one
        var thisMonth = new Date(Number(year), Number(currentMonth)).addDays(-1);
        // ...and advance the to date by two (one to offset above, one to genuinely add).
        var nextMonth = Date.create(thisMonth).addMonths(1).addDays(2);

        //console.log(thisMonth.short() + ' <-- ' + thisDay.short() + ' --> ' + nextMonth.short() + '?   ' + (thisDay.isBetween(thisMonth, nextMonth) ? 'YES' : 'NO'));
        if (currentMonth == null || !thisDay.isBetween(thisMonth, nextMonth)) {
          // If we've started a month list, end it, because we're on a new month now.
          if (currentMonth >= 0) {
            retVal += '</ul>'
          }

          currentMonth = thisDay.getMonth();
          retVal += '<h2><a href="/' + year + '/' + (currentMonth + 1) + '/">' + thisDay.format('{Month}') + '</a></h2>\n<ul>';
        }

        day['articles'].each(function (article) {
          retVal += '<li><a href="' + externalFilenameForFile(article['file']) + '">' + article['metadata']['Title'] + '</a></li>';
        });
      }
    });

    var header = headerSource.replace(metadataMarker + 'Title' + metadataMarker, 'Posts for ' + year);
    response.send(header + retVal + footerSource);
  });

}

// Handles a route by trying the cache first.
// file: file to try.
// sender: function to send result to the client. Only parameter is an object that has the key 'body', which is raw HTML
// generator: function to generate the raw HTML. Only parameter is a function that takes a completion handler that takes the raw HTML as its parameter.
// bestRouteHandler() --> generator() to build HTML --> completion() to add to cache and send
function baseRouteHandler(file, sender, generator) {
  if (app.fetchFromCache(file) == null) {
    generator(function (postData) {
      app.addRenderedPostToCache(file, {body: postData});
      sender({body: postData});
    });
  } else {
    console.log('In cache: ' + file);
    sender(app.fetchFromCache(file));
  }
}


  return {
    loadAndSendMarkdownFile: loadAndSendMarkdownFile,
    sendYearListing: sendYearListing,
    baseRouteHandler: baseRouteHandler
  }
}

module.exports = helpers
