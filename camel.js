/***************************************************
 * INITIALIZATION                                  *
 ***************************************************/

var express   = require('express')
  , compress  = require('compression')
  , http      = require('http')
  , fs        = require('fs')
  , sugar     = require('sugar')
  , rss       = require('rss');

var app = express();

// "Statics"
app.options = {
  postsRoot: './posts/',
  templateRoot: './templates/',
  metadataMarker: '@@',
  maxCacheSize: 50,
  postsPerPage: 10,
  postRegex: /^(.\/)?posts\/\d{4}\/\d{1,2}\/\d{1,2}\/(\w|-)*(.md)?/,
  utcOffset: 5,
  cacheResetTimeInMillis: 1800000
}

app.caches = {
  renderedPosts: {},
  renderedRss: {},
  allPostsSortedGrouped: {},
  siteMetadata: {}
}

app.sources = {
  headerSource: undefined,
  footerSource: null,
  postHeaderTemplate: null
}

routes = require('./routes')(app)
require('./helpers')(app)

app.use(compress());
app.use(express.static("public"));

app.use(routes)
app.init();

var server = http.createServer(app);

server.listen(Number(process.env.PORT || 5000));
console.log('Express server started on port %s', server.address().port);
