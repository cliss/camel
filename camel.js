/***************************************************
* INITIALIZATION                                  *
***************************************************/

var express = require('express');
var compress = require('compression');
var http = require('http');
var fs = require('fs');
var qfs = require('q-io/fs');
var sugar = require('sugar');
var _ = require('underscore');
var markdownit = require('markdown-it')({
	html: true,
	xhtmlOut: true,
	typographer: true
}).use(require('markdown-it-footnote'));
var Rss = require('rss');
var Handlebars = require('handlebars');
var version = require('./package.json').version;
var Twitter = require('twitter');
var twitterClient = new Twitter({
	consumer_key: process.env.TWITTER_CONSUMER_KEY,
	consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
	access_token_key: process.env.TWITTER_ACCESS_TOKEN,
	access_token_secret: process.env.TWITTER_TOKEN_SECRET
});

var app = express();
app.use(compress());
app.use(express.static("public"));
app.use(function (request, response, next) {
	response.header('X-powered-by', 'Camel (https://github.com/cliss/camel)');
	next();
});
var server = http.createServer(app);

// "Statics"
var postsRoot = './posts/';
var templateRoot = './templates/';
var metadataMarker = '@@';
var maxCacheSize = 50;
var postsPerPage = 10;
var footnoteAnchorRegex = /[#"]fn\d+/g;
var footnoteIdRegex = /fnref\d+/g;
var utcOffset = 5;
var cacheResetTimeInMillis = 1800000;
var twitterUsername = 'caseylisscom';
var twitterClientNeedle = 'Camel Spitter';

var renderedPosts = {};
var renderedRss = {};
var renderedAlternateRss = {};
var allPostsSortedGrouped = {};
var headerSource;
var footerSource = null;
var postHeaderTemplate = null;
var rssFooterTemplate = null;
var siteMetadata = {};

/***************************************************
* HELPER METHODS                                  *
***************************************************/

function normalizedFileName(file) {
	var retVal = file;
	if (file.startsWith('posts')) {
		retVal = './' + file;
	}

	retVal = retVal.replace('.md', '');

	return retVal;
}

function fetchFromCache(file) {
	return renderedPosts[normalizedFileName(file)] || null;
}

function addRenderedPostToCache(file, postData) {
	//console.log('Adding to cache: ' + normalizedFileName(file));
	renderedPosts[normalizedFileName(file)] = _.extend({ file: normalizedFileName(file), date: new Date() }, postData);

	if (_.size(renderedPosts) > maxCacheSize) {
		var sorted = _.sortBy(renderedPosts, function (post) { return post.date; });
		delete renderedPosts[sorted.first().file];
	}

	//console.log('Cache has ' + JSON.stringify(_.keys(renderedPosts)));
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
		return targetVal;
	});

	return retVal;
}

// Gets the external link for this file. Relative if request is
// not specified. Absolute if request is specified.
function externalFilenameForFile(file, request) {
	var hostname = typeof(request) !== 'undefined' ? request.headers.host : '';

	var retVal = hostname.length ? ('http://' + hostname) : '';
	retVal += file.at(0) === '/' && hostname.length > 0 ? '' : '/';
	retVal += file.replace('.md', '').replace(postsRoot, '').replace(postsRoot.replace('./', ''), '');
	return retVal;
}

function performMetadataReplacements(replacements, haystack) {
	_.keys(replacements).each(function (key) {
		// Ensure that it's a global replacement; non-regex treatment is first-only.
		haystack = haystack.replace(new RegExp(metadataMarker + key + metadataMarker, 'g'), replacements[key]);
	});

	return haystack;
}

// Gets the metadata & rendered HTML for this file
function generateHtmlAndMetadataForFile(file) {
	var retVal = fetchFromCache(file);
	if (typeof(retVal) !== 'undefined') {
		var lines = getLinesFromPost(file);
		var metadata = parseMetadata(lines.metadata);
		metadata.relativeLink = externalFilenameForFile(file);
		// If this is a post, assume a body class of 'post'.
		if (fileIsPost(file)) {
			metadata.BodyClass = 'post';
		}

		addRenderedPostToCache(file, {
			metadata: metadata,
			header: performMetadataReplacements(metadata, headerSource),
			postHeader:  performMetadataReplacements(metadata, postHeaderTemplate(metadata)),
			rssFooter: performMetadataReplacements(metadata, rssFooterTemplate(metadata)),
			unwrappedBody: performMetadataReplacements(metadata, markdownit.render(lines.body)),
			html: function () {
				return this.header +
					this.postHeader +
					this.unwrappedBody +
					footerSource;
			}
		});
	}

	return fetchFromCache(file);
}

function fileIsPost(file) {
	var postRegex = /^(.\/)?posts\/\d{4}\/\d{1,2}\/\d{1,2}\/(\w|-|\+)*(.redirect|.md)?$/;
	return postRegex.test(file);
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
	if (Object.size(allPostsSortedGrouped) !== 0) {
		completion(allPostsSortedGrouped);
	} else {
		qfs.listTree(postsRoot, function (name, stat) {
			return fileIsPost(name);
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
					if (!file.endsWith('redirect')) {
						articles.push(generateHtmlAndMetadataForFile(file));
					}
				});

				// ...so we can sort the posts...
				articles = _.sortBy(articles, function (article) {
					// ...by their post date and TIME.
					return Date.create(article.metadata.Date);
				}).reverse();
				// Array of objects; each object's key is the date, value
				// is an array of objects
				// In that array of objects, there is a body & metadata.
				// Note if this day only had a redirect, it may have no articles.
				if (articles.length > 0) {
					retVal.push({date: key, articles: articles});
				}
			});

			allPostsSortedGrouped = retVal;
			completion(retVal);
		});
	}
}

function tweetLatestPost() {
	if (twitterClient !== null && typeof(process.env.TWITTER_CONSUMER_KEY) !== 'undefined') {
		twitterClient.get('statuses/user_timeline', {screen_name: twitterUsername}, function (error, tweets) {
			if (error) {
				console.log(JSON.stringify(error, undefined, 2));
				return;
			}

			var lastUrl = null, i = 0;
			while (lastUrl === null && i < tweets.length) {
				if (tweets[i].source.has(twitterClientNeedle) &&
					tweets[i].entities &&
					tweets[i].entities.urls) {
					lastUrl = tweets[i].entities.urls[0].expanded_url;
				} else {
					i += 1;
				}
			}

			allPostsSortedAndGrouped(function (postsByDay) {
				var latestPost = postsByDay[0].articles[0];
				var link = latestPost.metadata.SiteRoot + latestPost.metadata.relativeLink;

				if (lastUrl !== link) {
					console.log('Tweeting new link: ' + link);

					// Figure out how many characters we have to play with.
					twitterClient.get('help/configuration', null, function (error, configuration) {
						var suffix = " \n\n";
						var maxSize = 140 - configuration.short_url_length_https - suffix.length;

						// Shorten the title if need be.
						var title = latestPost.metadata.Title;
						if (title.length > maxSize) {
							title = title.substring(0, maxSize - 3) + '...';
						}

						var params = {
							status: title + suffix + link
						};
						twitterClient.post('statuses/update', params, function (error, tweet, response) {
								if (error) {
									console.log(JSON.stringify(error, undefined, 2));
								}
						});
					});
				} else {
					console.log('Twitter is up to date.');
				}
			});
		});
	}
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

// Empties the caches.
function emptyCache() {
	console.log('Emptying the cache.');
	renderedPosts = {};
	renderedRss = {};
	allPostsSortedGrouped = {};

	tweetLatestPost();
}

function init() {
	loadHeaderFooter('defaultTags.html', function (data) {
		// Note this comes in as a flat string; split on newlines for parsing metadata.
		siteMetadata = parseMetadata(data.split('\n'));

		// This relies on the above, so nest it.
		loadHeaderFooter('header.html', function (data) {
			headerSource = data;
		});
	});
	loadHeaderFooter('footer.html', function (data) { footerSource = data; });
	loadHeaderFooter('rssFooter.html', function (data) {
		rssFooterTemplate = Handlebars.compile(data);
	});
	loadHeaderFooter('postHeader.html', function (data) {
		Handlebars.registerHelper('formatPostDate', function (date) {
			return new Handlebars.SafeString(new Date(date).format('{Weekday}, {d} {Month} {yyyy}'));
		});
		Handlebars.registerHelper('formatIsoDate', function (date) {
			return new Handlebars.SafeString(typeof(date) !== 'undefined' ? new Date(date).iso() : '');
		});
		postHeaderTemplate = Handlebars.compile(data);
	});

	// Kill the cache every 30 minutes.
	setInterval(emptyCache, cacheResetTimeInMillis);

	tweetLatestPost();
}

// Gets the rendered HTML for this file, with header/footer.
function generateHtmlForFile(file) {
	var fileData = generateHtmlAndMetadataForFile(file);
	return fileData.html();
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
			count += day.articles.length;
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

/***************************************************
* ROUTE HELPERS                                   *
***************************************************/

function send404(response, file) {
	console.log('404: ' + file);
	response.status(404).send(generateHtmlForFile('posts/404.md'));
}

function loadAndSendMarkdownFile(file, response) {
	if (file.endsWith('.md')) {
		// Send the source file as requested.
		console.log('Sending source file: ' + file);
		fs.exists(file, function (exists) {
			if (exists) {
				fs.readFile(file, {encoding: 'UTF8'}, function (error, data) {
					if (error) {
						response.status(500).send({error: error});
						return;
					}
					response.type('text/x-markdown; charset=UTF-8');
					response.status(200).send(data);
					return;
				});
			} else {
				response.status(400).send({error: 'Markdown file not found.'});
			}
		});
	} else if (fetchFromCache(file) !== null) {
		// Send the cached version.
		console.log('Sending cached file: ' + file);
		response.status(200).send(fetchFromCache(file).html());
	} else {
		var found = false;
		// Is this a post?
		if (fs.existsSync(file + '.md')) {
			found = true;
			console.log('Sending file: ' + file);
			var html = generateHtmlForFile(file);
			response.status(200).send(html);
		// Or is this a redirect?
		} else if (fs.existsSync(file + '.redirect')) {
			var data = fs.readFileSync(file + '.redirect', {encoding: 'UTF8'});
			if (data.length > 0) {
				var parts = data.split('\n');
				if (parts.length >= 2) {
					found = true;
					console.log('Redirecting to: ' + parts[1]);
					response.redirect(parseInt(parts[0], 10), parts[1]);
				}
			}
		}

		if (!found) {
			send404(response, file);
			return;
		}
	}
}

// Sends a listing of an entire year's posts.
function sendYearListing(request, response) {
	var year = request.params.slug;
	var retVal = '<div class="center"><h1>' + year + '</h1></div>';
	var currentMonth = null;
	var anyFound = false;

	allPostsSortedAndGrouped(function (postsByDay) {
		postsByDay.each(function (day) {
			var thisDay = Date.create(day.date);
			if (thisDay.is(year)) {
				// Date.isBetween() is not inclusive, so back the from date up one
				var thisMonth = new Date(Number(year), Number(currentMonth)).addDays(-1);
				// ...and advance the to date by two (one to offset above, one to genuinely add).
				var nextMonth = Date.create(thisMonth).addMonths(1).addDays(2);

				//console.log(thisMonth.short() + ' <-- ' + thisDay.short() + ' --> ' + nextMonth.short() + '?   ' + (thisDay.isBetween(thisMonth, nextMonth) ? 'YES' : 'NO'));
				if (currentMonth === null || !thisDay.isBetween(thisMonth, nextMonth)) {
					// If we've started a month list, end it, because we're on a new month now.
					if (currentMonth >= 0) {
						retVal += '</ul>';
					}

					anyFound = true;
					currentMonth = thisDay.getMonth();
					retVal += '<h2><a href="/' + year + '/' + (currentMonth + 1) + '/">' + thisDay.format('{Month}') + '</a></h2>\n<ul>';
				}

				day.articles.each(function (article) {
					retVal += '<li><a href="' + externalFilenameForFile(article.file) + '">' + article.metadata.Title + '</a></li>';
				});
			}
		});

		if (!anyFound) {
			retVal += "<i>No posts found.</i>";
		}

		var updatedSource = performMetadataReplacements(siteMetadata, headerSource);
		var header = updatedSource.replace(metadataMarker + 'Title' + metadataMarker, 'Posts for ' + year);
		response.status(200).send(header + retVal + footerSource);
	});

}

// Handles a route by trying the cache first.
// file: file to try.
// sender: function to send result to the client. Only parameter is an object that has the key 'body', which is raw HTML
// generator: function to generate the raw HTML. Only parameter is a function that takes a completion handler that takes the raw HTML as its parameter.
// baseRouteHandler() --> generator() to build HTML --> completion() to add to cache and send
function baseRouteHandler(file, sender, generator) {
	if (fetchFromCache(file) === null) {
		console.log('Not in cache: ' + file);
		generator(function (postData) {
			addRenderedPostToCache(file, {body: postData});
			sender({body: postData});
		});
	} else {
		console.log('In cache: ' + file);
		sender(fetchFromCache(file));
	}
}

// Generates a RSS feed.
// The linkGenerator is what determines if the articles will link
// to this site or to the target of a link post; it takes an article.
// The completion function takes an object:
// {
//   date: // Date the generation happened
//   rss: // Rendered RSS
// }
function generateRss(request, feedUrl, linkGenerator, completion) {
	var feed = new Rss({
		title: siteMetadata.SiteTitle,
		description: 'Posts to ' + siteMetadata.SiteTitle,
		feed_url: siteMetadata.SiteRoot + feedUrl,
		site_url: siteMetadata.SiteRoot,
		image_url: siteMetadata.SiteRoot + '/images/favicon.png',
		author: 'Your Name',
		copyright: '2013-' + new Date().getFullYear() + ' Your Name',
		language: 'en',
		pubDate: new Date().toString(),
		ttl: '60'
	});

	var max = 10;
	var i = 0;
	allPostsSortedAndGrouped(function (postsByDay) {
		postsByDay.forEach(function (day) {
			day.articles.forEach(function (article) {
				if (i < max) {
					i += 1;
					feed.item({
						title: article.metadata.Title,
						// Offset the time because Heroku's servers are GMT, whereas these dates are EST/EDT.
						date: new Date(article.metadata.Date).addHours(utcOffset),
						url: linkGenerator(article),
						guid: externalFilenameForFile(article.file, request),
						description: article.unwrappedBody.replace(/<script[\s\S]*?<\/script>/gm, "").concat(article.rssFooter)
					});
				}
			});
		});

		completion({
			date: new Date(),
			rss: feed.xml()
		});
	});
}

function homepageBuilder(page, completion, redirect) {
	var indexInfo = generateHtmlAndMetadataForFile(postsRoot + 'index.md');
	var footnoteIndex = 0;

	Handlebars.registerHelper('formatDate', function (date) {
		return new Handlebars.SafeString(new Date(date).format('{Weekday}<br />{d}<br />{Month}<br />{yyyy}'));
	});
	Handlebars.registerHelper('dateLink', function (date) {
		var parsedDate = new Date(date);
		return '/' + parsedDate.format("{yyyy}") + '/' + parsedDate.format("{M}") + '/' + parsedDate.format('{d}') + '/';
	});
	Handlebars.registerHelper('offsetFootnotes', function (html) {
		// Each day will call this helper once. We will offset the footnotes
		// to account for multiple days being on one page. This will avoid
		// conflicts with footnote numbers. If two days both have footnote,
		// they would both be "fn1". Which doesn't work; they need to be unique.
		var retVal = html.replace(footnoteAnchorRegex, '$&' + footnoteIndex);
		retVal = retVal.replace(footnoteIdRegex, '$&' + footnoteIndex);
		footnoteIndex += 1;

		return retVal;
	});
	Handlebars.registerPartial('article', indexInfo.metadata.ArticlePartial);
	var dayTemplate = Handlebars.compile(indexInfo.metadata.DayTemplate);
	var footerTemplate = Handlebars.compile(indexInfo.metadata.FooterTemplate);

	var bodyHtml = '';
	allPostsPaginated(function (pages) {
		// If we're asking for a page that doesn't exist, redirect.
		if (page < 0 || page > pages.length) {
			redirect(pages.length > 1 ? '/page/' + pages.length : '/');
			return;
		}
		var days = pages[page - 1].days;
		days.forEach(function (day) {
			bodyHtml += dayTemplate(day);
		});

		// If we have more data to display, set up footer links.
		var footerData = {};
		if (page > 1) {
			footerData.prevPage = page - 1;
		}
		if (pages.length > page) {
			footerData.nextPage = page + 1;
		}

		var fileData = generateHtmlAndMetadataForFile(postsRoot + 'index.md');
		var metadata = fileData.metadata;
		var header = fileData.header;
		// Replace <title>...</title> with one-off for homepage, because it doesn't show both Page & Site titles.
		var titleBegin = header.indexOf('<title>') + "<title>".length;
		var titleEnd = header.indexOf('</title>');
		header = header.substring(0, titleBegin) + metadata.SiteTitle + header.substring(titleEnd);
		// Carry on with body
		bodyHtml = performMetadataReplacements(metadata, bodyHtml);
		var fullHtml = header + bodyHtml + footerTemplate(footerData) + footerSource;
		completion(fullHtml);
	});
}


/***************************************************
* ROUTES                                          *
***************************************************/

app.get('/', function (request, response) {
    // Determine which page we're on, and make that the filename
    // so we cache by paginated page.
    var page = 1;
    if (typeof(request.query.p) !== 'undefined') {
        page = Number(request.query.p);
        if (isNaN(page)) {
            response.redirect('/');
            return;
        } else {
        	response.redirect('/page/' + page);
        	return;
        }
    }

    // Do the standard route handler. Cough up a cached page if possible.
    baseRouteHandler('/page/1', function (cachedData) {
        response.status(200).send(cachedData.body);
    }, function (completion) {
        homepageBuilder(page, completion, function (destination) {
        	response.redirect(destination);
        });
    });
});

app.get('/page/:page', function (request, response) {
	var page = Number(request.params.page);
	if (isNaN(page)) {
		response.redirect('/');
		return;
	}

	// Do the standard route handler. Cough up a cached page if possible.
    baseRouteHandler('/page/' + page, function (cachedData) {
        response.status(200).send(cachedData.body);
    }, function (completion) {
        homepageBuilder(page, completion, function (destination) {
        	response.redirect(destination);
        });
    });
});

app.get('/rss', function (request, response) {
	if ('user-agent' in request.headers && request.headers['user-agent'].has('subscriber')) {
		console.log('RSS: ' + request.headers['user-agent']);
	}
	response.type('application/rss+xml');

	if (typeof(renderedRss.date) === 'undefined' || new Date().getTime() - renderedRss.date.getTime() > 3600000) {
		generateRss(request, '/rss', function (article) {
			if (typeof(article.metadata.Link) !== 'undefined') {
				return article.metadata.Link;
			}
			return externalFilenameForFile(article.file, request);
		}, function (rss) {
			renderedRss = rss;
			response.status(200).send(renderedRss.rss);
		});
	} else {
		response.status(200).send(renderedRss.rss);
	}
});

app.get('/rss-alternate', function (request, response) {
	if ('user-agent' in request.headers && request.headers['user-agent'].has('subscriber')) {
		console.log('Alternate RSS: ' + request.headers['user-agent']);
	}
	response.type('application/rss+xml');

	if (typeof(renderedAlternateRss.date) === 'undefined' || new Date().getTime() - renderedAlternateRss.date.getTime() > 3600000) {
		generateRss(request, '/rss-alternate', function (article) {
			return externalFilenameForFile(article.file, request);
		}, function (rss) {
			renderedAlternateRss = rss;
			response.status(200).send(renderedAlternateRss.rss);
		});
	} else {
		response.status(200).send(renderedAlternateRss.rss);
	}
});

// Month view
app.get('/:year/:month', function (request, response) {

	allPostsSortedAndGrouped(function (postsByDay) {
		var seekingDay = new Date(request.params.year, request.params.month - 1);

		var html = '<div class="center"><h1>' + seekingDay.format('{Month} {yyyy}') + "</h1></div>";
		var anyFound = false;
		postsByDay.each(function (day) {
			var thisDay = new Date(day.date);
			if (thisDay.is(seekingDay.format('{Month} {yyyy}'))) {
				anyFound = true;

				html += "<h2>" + thisDay.format('{Weekday}, {Month} {d}') + "</h2><ul>";
				day.articles.each(function (article) {
					html += '<li><a href="' + article.metadata.relativeLink + '">' + article.metadata.Title + '</a></li>';
				});
				html += '</ul>';
			}
		});

		if (!anyFound) {
			html += "<i>No posts found.</i>";
		}
		var header = performMetadataReplacements(siteMetadata, headerSource).replace(
			metadataMarker + 'Title' + metadataMarker,
			seekingDay.format('{Month} {yyyy}') + '&mdash;' + siteMetadata.SiteTitle);
		response.status(200).send(header + html + footerSource);
	});
});

// Day view
app.get('/:year/:month/:day', function (request, response) {

	allPostsSortedAndGrouped(function (postsByDay) {
		var seekingDay = new Date(request.params.year, request.params.month - 1, request.params.day);

		postsByDay.each(function (day) {
			var thisDay = new Date(day.date);
			if (thisDay.is(seekingDay)) {
				var html = "<h1>Posts from " + seekingDay.format('{Weekday}, {Month} {d}, {yyyy}') + "</h1><ul>";
				day.articles.each(function (article) {
					html += '<li><a href="' + article.metadata.relativeLink + '">' + article.metadata.Title + '</a></li>';
				});

				var header = performMetadataReplacements(siteMetadata, headerSource).replace(
					metadataMarker + 'Title' + metadataMarker,
					seekingDay.format('{Weekday}, {Month} {d}, {Year}'));
				response.status(200).send(header + html + footerSource);
			}
		});
	});
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

app.get('/count', function (request, response) {
	console.log("/count");
	allPostsSortedAndGrouped(function (all) {
		var count = 0;
		var day;
		var days = 0;
		for (day in _.keys(all)) {
			days += 1;
			count += all[day].articles.length;
		}

		response.send(count + ' articles, across ' + days + ' days that have at least one post.');
	});
});

// Support for non-blog posts, such as /about, as well as years, such as /2014.
app.get('/:slug', function (request, response) {
	// If this is a typical slug, send the file
	if (isNaN(request.params.slug)) {
		var file = postsRoot + request.params.slug;
		loadAndSendMarkdownFile(file, response);
	// If it's a year, handle that.
	} else if (request.params.slug >= 2000) {
		sendYearListing(request, response);
	// If it's garbage (ie, a year less than 2013), send a 404.
	} else {
		send404(response, request.params.slug);
	}
});

/***************************************************
* STARTUP                                         *
***************************************************/
init();
var port = Number(process.env.PORT || 5000);
server.listen(port, function () {
console.log('Camel v' + version + ' server started on port %s', server.address().port);
});
