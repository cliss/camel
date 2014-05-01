/***************************************************
 * INITIALIZATION                                  *
 ***************************************************/

var express = require('express');
var http = require('http');
var fs = require('fs');
var qfs = require('q-io/fs');
var sugar = require('sugar');
var _ = require('underscore');
var marked = require('marked');
var rss = require('rss');
var Handlebars = require('handlebars');

var app = express();
var server = http.createServer(app);

app.configure(function() {
    app.use(express.compress());
	app.use(express.bodyParser());
	app.use(express.static("public"));
});

// "Statics"
var postsRoot = './posts/';
var templateRoot = './templates/';
var metadataMarker = '@@';
var maxCacheSize = 50;
var postsPerPage = 10;
var postRegex = /^(.\/)?posts\/\d{4}\/\d{1,2}\/\d{1,2}\/(\w|-)*(.md)?/;
var utcOffset = -5;

var renderedPosts = {};
var renderedRss = {};
var headerSource = undefined;
var footerSource = null;
var postHeaderTemplate = null;
var siteMetadata = {};

/***************************************************
 * HELPER METHODS                                  *
 ***************************************************/

function init() {
    loadHeaderFooter('defaultTags.html', function (data) {
        // Note this comes in as a flat string; split on newlines for parsing metadata.
        siteMetadata = parseMetadata(data.split('\n'));

        // This relies on the above, so nest it.
        loadHeaderFooter('header.html', function (data) {
            headerSource = performMetadataReplacements(siteMetadata, data);
        });
    });
    loadHeaderFooter('footer.html', function (data) { footerSource = data; });
    loadHeaderFooter('postHeader.html', function (data) {
        Handlebars.registerHelper('formatPostDate', function (date) {
            return new Handlebars.SafeString(new Date(date).format('{Weekday} {d} {Month} {yyyy}, {h}:{mm} {TT}'));
        });
        postHeaderTemplate = Handlebars.compile(data); });

    setInterval(emptyCache, 30000);

    marked.setOptions({
        renderer: new marked.Renderer(),
        gfm: true,
        tables: true,
        smartLists: true,
        smartypants: true
    });
}

function loadHeaderFooter(file, completion) {
    fs.exists(templateRoot + file, function(exists) {
        if (exists) {
            fs.readFile(templateRoot + file, {encoding: 'UTF8'}, function (error, data) {
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
    renderedPosts[normalizedFileName(file)] = _.extend({ file: normalizedFileName(file), date: new Date() }, postData);

    if (_.size(renderedPosts) > maxCacheSize) {
        var sorted = _.sortBy(renderedPosts, function (post) { return post['date']; });
        delete renderedPosts[sorted.first()['file']];
    }

    //console.log('Cache has ' + JSON.stringify(_.keys(renderedPosts)));
}

function fetchFromCache(file) {
    return renderedPosts[normalizedFileName(file)] || null;
}

// Parses the metadata in the file
function parseMetadata(lines) {
    var retVal = {};

    lines.each(function (line) {
        line = line.replace(metadataMarker, '');
        line = line.compact();
        if (line.has('=')) {
            var firstIndex = line.indexOf('=');
            retVal[line.first(firstIndex)] = line.from(firstIndex + 1);
        }
    });

    // NOTE: Some metadata is added in generateHtmlAndMetadataForFile().

    // Merge with site default metadata
    Object.merge(retVal, siteMetadata, false, function(key, targetVal, sourceVal) {
        // Ensure that the file wins over the defaults.
        console.log('overwriting "' + sourceVal + '" with "' + targetVal);
        return targetVal;
    });

    return retVal;
}

function performMetadataReplacements(replacements, haystack) {
    _.keys(replacements).each(function (key) {
        // Ensure that it's a global replacement; non-regex treatment is first-only.
        haystack = haystack.replace(new RegExp(metadataMarker + key + metadataMarker, 'g'), replacements[key]);
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
    var metadataLines = _.filter(lines, function (line) { return line.startsWith(metadataMarker); });
    var body = _.difference(lines, metadataLines).join('\n');

    return {metadata: metadataLines, body: body};
}

// Gets the metadata & rendered HTML for this file
function generateHtmlAndMetadataForFile(file) {
    var retVal = fetchFromCache(file);
    if (retVal == undefined) {
        var lines = getLinesFromPost(file);
        var metadata = parseMetadata(lines['metadata']);
        metadata['File'] = file;
        metadata['link'] = externalFilenameForFile(file);
        // If this is a post, assume a body class of 'post'.
        if (postRegex.test(file)) {
            metadata['BodyClass'] = 'post';
        }
        var html =  parseHtml(lines['body'], metadata, postHeaderTemplate(metadata));
        addRenderedPostToCache(file, {
            metadata: metadata,
            body: html,
            lines: lines,
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
    metadata['link'] = externalFilenameForFile(file);
    return postHeaderTemplate(metadata) + body;
}

// Gets the external relative name/link for this file
function externalFilenameForFile(file) {
    return externalFilenameForFile(file, '');
}

// Gets the external absolute link for this file
function externalFilenameForFile(file, request) {
    var hostname = request != undefined ? request.headers.host : '';

    var retVal = hostname.length ? ('http://' + hostname) : '';
    retVal += '/' + file.replace('.md', '').replace(postsRoot, '').replace(postsRoot.replace('./', ''), '');
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
    qfs.listTree(postsRoot, function (name, stat) {
        return postRegex.test(name);
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

        completion(retVal);
    });
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
            if (count >= postsPerPage) {
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
    renderedPosts = {};
    renderedRss = {};
}

/***************************************************
 * ROUTE HELPERS                                   *
 ***************************************************/

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
    } else if (fetchFromCache(file) != null) {
        // Send the cached version.
        console.log('Sending cached file: ' + file);
        response.send(200, fetchFromCache(file)['body']);
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

function sendYearListing(request, response) {

    // TODO: Finish this

    response.send(500, {error: "Casey hasn't written this yet."});
}

// Handles a route by trying the cache first.
// file: file to try.
// sender: function to send result to the client. Only parameter is an object that has the key 'body', which is raw HTML
// generator: function to generate the raw HTML. Only parameter is a function that takes a completion handler that takes the raw HTML as its parameter.
// bestRouteHandler() --> generator() to build HTML --> completion() to add to cache and send
function baseRouteHandler(file, sender, generator) {
    if (fetchFromCache(file) == null) {
        generator(function (postData) {
            addRenderedPostToCache(file, {body: postData});
            sender({body: postData});
        });
    } else {
        console.log('In cache: ' + file);
        sender(fetchFromCache(file));
    }
}

/***************************************************
 * ROUTES                                          *
 ***************************************************/

app.get('/', function (request, response) {
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
    baseRouteHandler('/?p=' + page, function (cachedData) {
        response.send(cachedData['body']);
    }, function (completion) {
        var indexInfo = generateHtmlAndMetadataForFile(postsRoot + 'index.md');
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
        allPostsPaginated(function (pages) {
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

            var metadata = generateMetadataForFile(postsRoot + 'index.md');
            var header = performMetadataReplacements(metadata, headerSource);
            // Replace <title>...</title> with one-off for homepage, because it doesn't show both Page & Site titles.
            var titleBegin = header.indexOf('<title>') + "<title>".length;
            var titleEnd = header.indexOf('</title>');
            header = header.substring(0, titleBegin) + metadata['SiteTitle'] + header.substring(titleEnd);
            // Carry on with body
            bodyHtml = performMetadataReplacements(metadata, bodyHtml);
            var fullHtml = header + bodyHtml + footerTemplate(footerData) + footerSource;
            completion(fullHtml);
        });
    });
});

app.get('/rss', function (request, response) {
    if (renderedRss['date'] == undefined || new Date().getTime() - renderedRss['date'].getTime() > 3600000) {
        var feed = new rss({
            title: siteMetadata['SiteTitle'],
            description: 'Posts to ' + siteMetadata['SiteTitle'],
            feed_url: 'http://www.yoursite.com/rss',
            site_url: 'http://www.yoursite.com',
            author: 'Your Name',
            webMaster: 'Your Name',
            copyright: '2013-' + new Date().getFullYear() + ' Your Name',
            language: 'en',
            //categories: ['Category 1','Category 2','Category 3'],
            pubDate: new Date().toString(),
            ttl: '60'
        });

        var max = 10;
        var i = 0;
        allPostsSortedAndGrouped(function (postsByDay) {
            postsByDay.forEach(function (day) {
                day['articles'].forEach(function (article) {
                    if (i < max) {
                        ++i;
                        feed.item({
                            title: article['metadata']['Title'],
                            // Offset the time because Heroku's servers are GMT, whereas these dates are EST/EDT.
                            date: new Date(article['metadata']['Date']).addHours(utcOffset),
                            url: externalFilenameForFile(article['metadata']['File'], request),
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
app.get('/:year/:month', function (request, response) {
    var path = postsRoot + request.params.year + '/' + request.params.month;

    var postsByDay = {};

    qfs.listTree(path, function (name, stat) {
        return name.endsWith('.md');
    }).then(function (files) {
        _.each(files, function (file) {
            // Gather by day of month
            var metadata = generateHtmlAndMetadataForFile(file)['metadata'];
            var date = Date.create(metadata['Date']);
            var dayOfMonth = date.getDate();
            if (postsByDay[dayOfMonth] == undefined) {
                postsByDay[dayOfMonth] = [];
            }

            postsByDay[dayOfMonth].push({title: metadata['Title'], date: date, url: externalFilenameForFile(file)});
         });

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

         var header = headerSource.replace(metadataMarker + 'Title' + metadataMarker, "Day Listing");
         response.send(header + html + footerSource);
    });
 });

// Day view
app.get('/:year/:month/:day', function (request, response) {
    var path = postsRoot + request.params.year + '/' + request.params.month + '/' + request.params.day;

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
            postsToday.push(generateHtmlAndMetadataForFile(path + '/' + file));
        });

        // Go ahead and sort...
        postsToday = _.sortBy(postsToday, function (post) {
            // ...by their post date and TIME...
            return Date.create(post['metadata']['Date']);
        }); // ...Oldest first.

        postsToday.each(function (post) {
            var title = post['metadata']['Title'];
            html += '<li><a href="' + post['metadata']['link'] + '">' + post['metadata']['Title'] + '</a></li>';
        });

        var header = headerSource.replace(metadataMarker + 'Title' + metadataMarker, day.format('{Weekday}, {Month} {d}'));
        response.send(header + html + footerSource);
    })
 });


// Get a blog post, such as /2014/3/17/birthday
app.get('/:year/:month/:day/:slug', function (request, response) {
    var file = postsRoot + request.params.year + '/' + request.params.month + '/' + request.params.day + '/' + request.params.slug;

    loadAndSendMarkdownFile(file, response);
});

// Empties the cache.
// app.get('/tosscache', function (request, response) {
//     emptyCache();
//     response.send(205);
// });

// Support for non-blog posts, such as /about, as well as years, such as /2014.
app.get('/:slug', function (request, response) {
    // If this is a typical slug, send the file
    if (isNaN(request.params.slug)) {
        var file = postsRoot + request.params.slug;
        loadAndSendMarkdownFile(file, response);
    // If it's a year, handle that.
    } else {
        sendYearListing(request, response);
    }
});

/***************************************************
 * STARTUP                                         *
 ***************************************************/
init();
var port = Number(process.env.PORT || 5000);
server.listen(port);
console.log('Express server started on port %s', server.address().port);
