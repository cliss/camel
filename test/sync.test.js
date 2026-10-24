// Runs scripts/standard-site-sync.js against an in-memory PDS.

var test = require('node:test');
var assert = require('node:assert');
var helpers = require('./helpers');

function syncEnv(pds, extra) {
	return Object.assign({ ATP_IDENTIFIER: 'test.example', ATP_APP_PASSWORD: 'app-password', ATP_SERVICE: pds.url }, extra);
}

async function setUp(t, siteOptions) {
	var site = helpers.makeSite(Object.assign({ publication: helpers.PUBLICATION_URI, siteRoot: 'https://blog.example' }, siteOptions));
	// The sample post's image is a remote URL; drop it so tests never touch the network.
	site.writePost('2014/5/1/sample-post.md', '@@ Title=Test Post\n@@ Date=2014-05 17:50\n' +
		'@@ Description=A "quoted" description.\n\nThis is a *test post* entitled "@@Title@@".\n');
	var pds = await helpers.startMockPds();
	t.after(function () { pds.stop(); site.remove(); });
	return { site: site, pds: pds };
}

function writes(pds) {
	return pds.calls.filter(function (call) {
		return /putRecord|createRecord|deleteRecord|uploadBlob/.test(call.method);
	});
}

test('skips quietly when no publication is configured', async function () {
	var site = helpers.makeSite();
	var result = await helpers.runSync(site, ['--release']);
	site.remove();
	assert.strictEqual(result.code, 0);
	assert.match(result.output, /StandardSitePublication is not set/);
});

test('validates posts without credentials', async function (t) {
	var env = await setUp(t);
	var result = await helpers.runSync(env.site);
	assert.strictEqual(result.code, 0);
	assert.match(result.output, /2 posts are valid/);
	assert.strictEqual(env.pds.calls.length, 0);
});

test('--init creates a publication record', async function (t) {
	var env = await setUp(t, { publication: '' });
	var result = await helpers.runSync(env.site, ['--init'], syncEnv(env.pds));
	assert.strictEqual(result.code, 0, result.output);
	assert.match(result.output, /@@ StandardSitePublication=at:\/\/did:plc:abcdefghijklmnopqrstuvwx\/site.standard.publication\//);
	var created = env.pds.calls.find(function (call) { return call.method === 'com.atproto.repo.createRecord'; });
	assert.deepStrictEqual(created.body.record, { $type: 'site.standard.publication', name: 'Sample Site', url: 'https://blog.example' });
});

test('--init refuses a localhost SiteRoot', async function (t) {
	var env = await setUp(t, { publication: '', siteRoot: 'http://localhost:5000' });
	var result = await helpers.runSync(env.site, ['--init'], syncEnv(env.pds));
	assert.strictEqual(result.code, 1);
	assert.match(result.output, /Set SiteRoot/);
	assert.strictEqual(env.pds.calls.length, 0);
});

test('creates records, then a rerun changes nothing', async function (t) {
	var env = await setUp(t);
	var first = await helpers.runSync(env.site, [], syncEnv(env.pds));
	assert.strictEqual(first.code, 0, first.output);
	assert.match(first.output, /2 created, 0 updated, 0 unchanged, 0 deleted/);

	var documents = env.pds.documents();
	assert.deepStrictEqual(documents.map(function (d) { return d.path; }).sort(), ['/2014/5/1/sample-post', '/2015/2/6/sample-link-post']);
	documents.forEach(function (d) { assert.strictEqual(d.site, helpers.PUBLICATION_URI); });
	var sample = documents.find(function (d) { return d.path === '/2014/5/1/sample-post'; });
	// Quotes survive Camel's HTML escaping, and metadata placeholders are filled in.
	assert.strictEqual(sample.description, 'A "quoted" description.');
	assert.strictEqual(sample.textContent, 'This is a test post entitled \u201cTest Post\u201d.');
	assert.strictEqual(sample.publishedAt, '2014-05-01T05:00:00.000Z');
	// The publication record was brought in line with the site.
	assert.strictEqual(env.pds.records['site.standard.publication/3lwafzkjqm25s'].url, 'https://blog.example');

	env.pds.calls.length = 0;
	var second = await helpers.runSync(env.site, [], syncEnv(env.pds));
	assert.match(second.output, /0 created, 0 updated, 2 unchanged, 0 deleted/);
	assert.deepStrictEqual(writes(env.pds), []);
});

test('updates an edited post and deletes a removed one', async function (t) {
	var env = await setUp(t);
	env.site.writePost('2016/3/4/extra.md', '@@ Title=Extra\n@@ Date=2016-03-04 10:00\n\nBody.\n');
	await helpers.runSync(env.site, [], syncEnv(env.pds));
	var extra = env.pds.documents().find(function (d) { return d.path === '/2016/3/4/extra'; });
	assert.ok(extra);

	env.site.writePost('2014/5/1/sample-post.md', '@@ Title=Renamed Post\n@@ Date=2014-05 17:50\n\nNew body.\n');
	require('fs').rmSync(require('path').join(env.site.dir, 'posts/2016/3/4/extra.md'));
	var result = await helpers.runSync(env.site, [], syncEnv(env.pds));
	assert.match(result.output, /0 created, 1 updated, 1 unchanged, 1 deleted/);

	var edited = env.pds.documents().find(function (d) { return d.path === '/2014/5/1/sample-post'; });
	assert.strictEqual(edited.title, 'Renamed Post');
	assert.ok(edited.updatedAt);
	assert.ok(!env.pds.documents().some(function (d) { return d.path === '/2016/3/4/extra'; }));
});

test('a second publication in the same account gets its own records', async function (t) {
	// As if --init were run again: same account and posts, new publication.
	var env = await setUp(t);
	await helpers.runSync(env.site, [], syncEnv(env.pds));
	var second = helpers.PUBLICATION_URI.replace(/[^/]+$/, '3lwafzkjqm26s');
	env.pds.records['site.standard.publication/3lwafzkjqm26s'] = { $type: 'site.standard.publication', name: 'Again', url: 'https://blog.example' };
	var tags = require('path').join(env.site.dir, 'templates', 'defaultTags.html');
	var fs = require('fs');
	fs.writeFileSync(tags, fs.readFileSync(tags, 'utf8').replace(helpers.PUBLICATION_URI, second));

	var result = await helpers.runSync(env.site, [], syncEnv(env.pds));
	assert.strictEqual(result.code, 0, result.output);
	assert.match(result.output, /2 created, 0 updated, 0 unchanged, 0 deleted/);
	var sites = env.pds.documents().map(function (d) { return d.site; });
	assert.strictEqual(sites.filter(function (s) { return s === helpers.PUBLICATION_URI; }).length, 2);
	assert.strictEqual(sites.filter(function (s) { return s === second; }).length, 2);
});

test('leaves records from other publications alone', async function (t) {
	var env = await setUp(t);
	env.pds.records['site.standard.document/3zzzzzzzzzzzz'] = {
		$type: 'site.standard.document', site: 'at://did:plc:other/site.standard.publication/x',
		title: 'Elsewhere', path: '/x', publishedAt: '2020-01-01T00:00:00Z'
	};
	await helpers.runSync(env.site, [], syncEnv(env.pds));
	assert.ok(env.pds.records['site.standard.document/3zzzzzzzzzzzz']);
});

test('uploads a cover image once and removes it with the @@ Image line', async function (t) {
	var env = await setUp(t);
	env.site.writeFile('public/images/cover.png', helpers.png(2000));
	env.site.writePost('2014/5/1/sample-post.md', '@@ Title=Test Post\n@@ Date=2014-05 17:50\n@@ Image=/images/cover.png\n\nBody.\n');

	await helpers.runSync(env.site, [], syncEnv(env.pds));
	var uploads = env.pds.calls.filter(function (c) { return c.method === 'com.atproto.repo.uploadBlob'; });
	assert.strictEqual(uploads.length, 1);
	var post = env.pds.documents().find(function (d) { return d.path === '/2014/5/1/sample-post'; });
	assert.deepStrictEqual(Object.keys(post.coverImage).sort(), ['$type', 'mimeType', 'ref', 'size']);
	assert.strictEqual(post.coverImage.mimeType, 'image/png');

	env.pds.calls.length = 0;
	await helpers.runSync(env.site, [], syncEnv(env.pds));
	assert.deepStrictEqual(writes(env.pds), [], 'an unchanged image must not be uploaded again');

	env.site.writePost('2014/5/1/sample-post.md', '@@ Title=Test Post\n@@ Date=2014-05 17:50\n\nBody.\n');
	await helpers.runSync(env.site, [], syncEnv(env.pds));
	post = env.pds.documents().find(function (d) { return d.path === '/2014/5/1/sample-post'; });
	assert.strictEqual(post.coverImage, undefined);
});

test('skips oversized and non-image covers with a warning', async function (t) {
	var env = await setUp(t);
	env.site.writeFile('public/images/huge.png', helpers.png(1200000));
	env.site.writeFile('public/images/fake.png', Buffer.from('not an image'));
	env.site.writePost('2016/1/1/huge.md', '@@ Title=Huge\n@@ Date=2016-01-01 10:00\n@@ Image=/images/huge.png\n\nBig.\n');
	env.site.writePost('2016/1/2/fake.md', '@@ Title=Fake\n@@ Date=2016-01-02 10:00\n@@ Image=/images/fake.png\n\nFake.\n');
	env.site.writePost('2016/1/3/escape.md', '@@ Title=Escape\n@@ Date=2016-01-03 10:00\n@@ Image=/../../etc/passwd\n\nNo.\n');

	var result = await helpers.runSync(env.site, [], syncEnv(env.pds));
	assert.strictEqual(result.code, 0, result.output);
	assert.match(result.output, /huge\.png is 1200000 bytes/);
	assert.match(result.output, /fake\.png is not a PNG, JPEG, GIF or WebP image/);
	assert.match(result.output, /is outside public\//);
	assert.ok(!env.pds.calls.some(function (c) { return c.method === 'com.atproto.repo.uploadBlob'; }));
});

test('an invalid post stops the sync before anything is written', async function (t) {
	var env = await setUp(t);
	env.site.writePost('2016/1/1/untitled.md', '@@ Title=\n@@ Date=2016-01-01 10:00\n\nNo title.\n');
	var result = await helpers.runSync(env.site, ['--release'], syncEnv(env.pds));
	assert.strictEqual(result.code, 1);
	assert.match(result.output, /untitled\.md: title must be a non-empty string/);
	assert.strictEqual(env.pds.calls.length, 0);
});

test('--release only warns when login or the PDS fails; a manual run fails', async function (t) {
	var env = await setUp(t);
	var release = await helpers.runSync(env.site, ['--release'], syncEnv(env.pds, { ATP_APP_PASSWORD: 'wrong' }));
	assert.strictEqual(release.code, 0, release.output);
	assert.match(release.output, /Warning: sync failed; deploying anyway/);

	var manual = await helpers.runSync(env.site, [], syncEnv(env.pds, { ATP_APP_PASSWORD: 'wrong' }));
	assert.strictEqual(manual.code, 1);
	assert.match(manual.output, /Invalid identifier or password/);
});

test('publishes posts whose folder day has arrived, like camel.js shows them', async function (t) {
	var env = await setUp(t);
	var pad = function (n) { return String(n).padStart(2, '0'); };
	var today = new Date();
	var tomorrow = new Date(today);
	tomorrow.setDate(today.getDate() + 1);
	var folder = function (d) { return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate(); };
	var stamp = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
	// Later today: camel.js already shows it, so it needs a record now.
	env.site.writePost(folder(today) + '/later-today.md', '@@ Title=Later\n@@ Date=' + stamp(today) + ' 23:59\n\nSoon.\n');
	env.site.writePost(folder(tomorrow) + '/tomorrow.md', '@@ Title=Tomorrow\n@@ Date=' + stamp(tomorrow) + ' 09:00\n\nLater.\n');
	await helpers.runSync(env.site, [], syncEnv(env.pds));
	var paths = env.pds.documents().map(function (d) { return d.path; });
	assert.ok(paths.includes('/' + folder(today) + '/later-today'));
	assert.ok(!paths.includes('/' + folder(tomorrow) + '/tomorrow'));
});

test('--release still fails on safety errors', async function (t) {
	// A publication owned by a different account than the one logging in.
	var env = await setUp(t, { publication: 'at://did:plc:someoneelse/site.standard.publication/3lwafzkjqm25s' });
	var mismatch = await helpers.runSync(env.site, ['--release'], syncEnv(env.pds));
	assert.strictEqual(mismatch.code, 1);
	assert.match(mismatch.output, /belongs to did:plc:someoneelse/);

	// Every post gone while records still exist: refuse to delete them all.
	var empty = await setUp(t);
	await helpers.runSync(empty.site, [], syncEnv(empty.pds));
	require('fs').rmSync(require('path').join(empty.site.dir, 'posts', '2014'), { recursive: true });
	require('fs').rmSync(require('path').join(empty.site.dir, 'posts', '2015'), { recursive: true });
	var guard = await helpers.runSync(empty.site, ['--release'], syncEnv(empty.pds));
	assert.strictEqual(guard.code, 1);
	assert.match(guard.output, /refusing to delete them all/);
	assert.strictEqual(empty.pds.documents().length, 2);
});

test('--dry-run writes nothing', async function (t) {
	var env = await setUp(t);
	var result = await helpers.runSync(env.site, ['--dry-run'], syncEnv(env.pds));
	assert.match(result.output, /Would create/);
	assert.deepStrictEqual(writes(env.pds), []);
});
