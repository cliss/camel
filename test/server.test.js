// Runs camel.js against a temp copy of the site and checks what it serves.

var test = require('node:test');
var assert = require('node:assert');
var standardSite = require('../lib/standard-site');
var helpers = require('./helpers');

test('without a publication: no standard.site route or tags', async function (t) {
	var site = helpers.makeSite();
	var server = await helpers.startServer(site);
	t.after(function () { server.stop(); site.remove(); });

	var wellKnown = await fetch(server.url + '/.well-known/site.standard.publication');
	assert.strictEqual(wellKnown.status, 404);

	var html = await (await fetch(server.url + '/2014/5/1/sample-post')).text();
	assert.doesNotMatch(html, /site\.standard/);
	assert.doesNotMatch(html, /@@StandardSiteLinks@@/);
});

test('with a publication: verification route and link tags', async function (t) {
	var site = helpers.makeSite({ publication: helpers.PUBLICATION_URI });
	var server = await helpers.startServer(site);
	t.after(function () { server.stop(); site.remove(); });

	var wellKnown = await fetch(server.url + '/.well-known/site.standard.publication');
	assert.strictEqual(wellKnown.status, 200);
	assert.match(wellKnown.headers.get('content-type'), /^text\/plain/);
	assert.strictEqual(await wellKnown.text(), helpers.PUBLICATION_URI);

	// A post carries both tags, and its document URI is the one the sync writes.
	var post = await (await fetch(server.url + '/2015/2/6/sample-link-post')).text();
	var publishedAt = standardSite.publishedAtFor({ Date: '2015-02-06 12:00' }, './posts/2015/2/6/sample-link-post.md', 5);
	var documentUri = standardSite.documentUri(helpers.PUBLICATION_URI, publishedAt, '/2015/2/6/sample-link-post');
	assert.ok(post.includes('<link rel="site.standard.publication" href="' + helpers.PUBLICATION_URI + '" />'));
	assert.ok(post.includes('<link rel="site.standard.document" href="' + documentUri + '" />'));

	// Every other page carries the publication tag only.
	for (var page of ['/', '/about', '/2015/2', '/2015']) {
		var html = await (await fetch(server.url + page)).text();
		assert.ok(html.includes('rel="site.standard.publication"'), page + ' is missing the publication tag');
		assert.ok(!html.includes('rel="site.standard.document"'), page + ' should not have a document tag');
		assert.ok(!html.includes('@@StandardSiteLinks@@'), page + ' has an unreplaced placeholder');
	}
});

test('a scheduled post reachable by URL has no document link yet', async function (t) {
	var site = helpers.makeSite({ publication: helpers.PUBLICATION_URI });
	site.writePost('2999/1/1/future.md', '@@ Title=Future\n@@ Date=2999-01-01 09:00\n\nLater.\n');
	var server = await helpers.startServer(site);
	t.after(function () { server.stop(); site.remove(); });

	var html = await (await fetch(server.url + '/2999/1/1/future')).text();
	assert.match(html, /Later\./);
	assert.ok(html.includes('rel="site.standard.publication"'));
	assert.ok(!html.includes('rel="site.standard.document"'));
});

test('posts are grouped by their own day, and future posts stay hidden', async function (t) {
	var site = helpers.makeSite();
	site.writePost('2999/1/1/future.md', '@@ Title=Future\n@@ Date=2999-01-01 09:00\n\nLater.\n');
	var server = await helpers.startServer(site);
	t.after(function () { server.stop(); site.remove(); });

	assert.strictEqual(await (await fetch(server.url + '/count')).text(),
		'2 articles, across 2 days that have at least one post.');
	assert.match(await (await fetch(server.url + '/2015')).text(), /Sample Link Post/);
	assert.match(await (await fetch(server.url + '/2014/5')).text(), /Test Post/);
});
