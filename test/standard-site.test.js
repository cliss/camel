// Unit tests for lib/standard-site.js.

var test = require('node:test');
var assert = require('node:assert');
var childProcess = require('child_process');
var path = require('path');
var standardSite = require('../lib/standard-site');
var helpers = require('./helpers');

var TID_ALPHABET = '234567abcdefghijklmnopqrstuvwxyz';

function decodeTid(tid) {
	var n = 0n;
	for (var i = 0; i < tid.length; i++) {
		n = (n << 5n) | BigInt(TID_ALPHABET.indexOf(tid[i]));
	}
	return { microseconds: Number(n >> 10n), clockId: Number(n & 0x3ffn) };
}

test('encodeTid round-trips its timestamp and clock id', function () {
	var tid = standardSite.encodeTid(1704067200000000, 513);
	assert.match(tid, /^[234567abcdefghij][234567a-z]{12}$/);
	assert.deepStrictEqual(decodeTid(tid), { microseconds: 1704067200000000, clockId: 513 });
});

test('documentRkey is stable, timestamped by the publish date, and differs by path and publication', function () {
	var date = new Date('2024-01-01T12:00:00Z');
	var pub = helpers.PUBLICATION_URI;
	var a = standardSite.documentRkey(pub, date, '/2024/1/1/one');
	assert.strictEqual(a, standardSite.documentRkey(pub, date, '/2024/1/1/one'));
	assert.notStrictEqual(a, standardSite.documentRkey(pub, date, '/2024/1/1/two'));
	// A second publication in the same account must not reuse the first one's keys.
	assert.notStrictEqual(a, standardSite.documentRkey(pub.replace(/[^/]+$/, '3lwafzkjqm26s'), date, '/2024/1/1/one'));
	// The timestamp part is the publish date, give or take the sub-millisecond digits.
	assert.strictEqual(Math.floor(decodeTid(a).microseconds / 1000), date.getTime());
});

test('publishedAtFor does not depend on the machine time zone', function () {
	var script = 'var s = require(' + JSON.stringify(path.join(__dirname, '..', 'lib', 'standard-site')) + ');' +
		'process.stdout.write(s.publishedAtFor({ Date: "2015-02-06 12:00" }, "./posts/2015/2/6/x.md", 5).toISOString())';
	var results = ['UTC', 'America/Los_Angeles', 'Asia/Tokyo'].map(function (tz) {
		return childProcess.execFileSync(process.execPath, ['-e', script], { env: Object.assign({}, process.env, { TZ: tz }) }).toString();
	});
	assert.deepStrictEqual(results, ['2015-02-06T17:00:00.000Z', '2015-02-06T17:00:00.000Z', '2015-02-06T17:00:00.000Z']);
});

test('publishedAtFor falls back to the folder date when Date is missing or partial', function () {
	// "2014-05 17:50" has no day; parsing it would depend on today's date.
	var date = standardSite.publishedAtFor({ Date: '2014-05 17:50' }, './posts/2014/5/1/sample-post.md', 5);
	assert.strictEqual(date.toISOString(), '2014-05-01T05:00:00.000Z');
	assert.strictEqual(standardSite.publishedAtFor({}, './posts/2014/5/1/x.md', 0).toISOString(), '2014-05-01T00:00:00.000Z');
});

test('blobCid matches the known CID of an empty raw block', function () {
	assert.strictEqual(standardSite.blobCid(Buffer.alloc(0)), 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku');
});

test('sniffImageType recognizes common images and rejects other files', function () {
	assert.strictEqual(standardSite.sniffImageType(helpers.png(16)), 'image/png');
	assert.strictEqual(standardSite.sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
	assert.strictEqual(standardSite.sniffImageType(Buffer.from('GIF89a')), 'image/gif');
	assert.strictEqual(standardSite.sniffImageType(Buffer.from('RIFF....WEBP')), 'image/webp');
	assert.strictEqual(standardSite.sniffImageType(Buffer.from('<html>')), null);
});

test('parseAtUri accepts at:// URIs and rejects anything else', function () {
	assert.deepStrictEqual(standardSite.parseAtUri(helpers.PUBLICATION_URI), {
		did: helpers.PUBLICATION_DID, collection: 'site.standard.publication', rkey: '3lwafzkjqm25s'
	});
	assert.strictEqual(standardSite.parseAtUri(''), null);
	assert.strictEqual(standardSite.parseAtUri('https://example.com'), null);
	assert.ok(standardSite.parseAtUri('at://did:web:localhost%3A3000/site.standard.publication/3lwafzkjqm25s'));
	['did:plc:abc:', 'did:plc:abc%', 'did:plc:a%zz'].forEach(function (did) {
		assert.strictEqual(standardSite.parseAtUri('at://' + did + '/site.standard.publication/3lwafzkjqm25s'), null, did);
	});
});

test('linkTags emits nothing until a publication is configured', function () {
	assert.strictEqual(standardSite.linkTags(''), '');
	var tags = standardSite.linkTags(helpers.PUBLICATION_URI, 'at://did:plc:x/site.standard.document/3abc');
	assert.match(tags, /<link rel="site.standard.publication" href="at:\/\/did:plc:abcdefghijklmnopqrstuvwx\/site.standard.publication\/3lwafzkjqm25s" \/>/);
	assert.match(tags, /<link rel="site.standard.document" href="at:\/\/did:plc:x\/site.standard.document\/3abc" \/>/);
});

test('htmlToText strips markup, scripts and entities', function () {
	var text = standardSite.htmlToText('<p>Hello <em>there</em> &amp; welcome&#8230;</p><script>alert(1)</script><ul><li>One</li><li>Two</li></ul>');
	assert.strictEqual(text, 'Hello there & welcome…\nOne\nTwo');
});

test('buildDocument and validateDocument agree on a well-formed post', function () {
	var record = standardSite.buildDocument({
		publicationUri: helpers.PUBLICATION_URI,
		title: 'A post',
		path: '/2024/1/1/a-post',
		publishedAt: new Date('2024-01-01T00:00:00Z'),
		description: '',
		contributors: ['did:plc:coauthor'],
		markdown: 'Some *text*.',
		html: '<p>Some <em>text</em>.</p>'
	});
	assert.strictEqual(record.textContent, 'Some text.');
	assert.strictEqual(record.description, undefined);
	assert.deepStrictEqual(record.contributors, [{ did: 'did:plc:coauthor' }]);
	assert.strictEqual(record.content.$type, 'at.markpub.markdown');
	assert.deepStrictEqual(standardSite.validateDocument(record, '3khuwc44cas67'), []);
});

test('validateDocument reports each broken field', function () {
	var errors = standardSite.validateDocument({
		site: 'https://example.com', title: '', path: 'no-slash/', publishedAt: 'never',
		contributors: [{ did: 'bob' }], content: { text: {} }
	}, 'not-a-tid');
	assert.deepStrictEqual(errors, [
		'record key not-a-tid is not a TID',
		'title must be a non-empty string',
		'site must be a site.standard.publication at:// URI',
		'path must start with "/" and not end with one',
		'publishedAt must be a datetime',
		'contributor bob is not a DID',
		'content.text.markdown is required'
	]);
});

test('validateDocument reports missing content instead of throwing', function () {
	var base = { site: helpers.PUBLICATION_URI, title: 'T', path: '/a', publishedAt: '2024-01-01T00:00:00Z' };
	[undefined, {}, { text: null }].forEach(function (content) {
		assert.deepStrictEqual(standardSite.validateDocument(Object.assign({ content: content }, base), '3khuwc44cas67'),
			['content.text.markdown is required']);
	});
});

test('validateDocument explains a Date that a record key cannot hold', function () {
	['2999-05-01T00:00:00.000Z', '1014-05-01T00:00:00.000Z'].forEach(function (date) {
		var rkey = standardSite.documentRkey(helpers.PUBLICATION_URI, new Date(date), '/a');
		var errors = standardSite.validateDocument({
			site: helpers.PUBLICATION_URI, title: 'T', path: '/a', publishedAt: date,
			content: { $type: 'at.markpub.markdown', text: { markdown: '' } }
		}, rkey);
		assert.ok(errors.some(function (error) { return error.indexOf(date + ' is outside 1970 to 2255') !== -1; }), errors.join('; '));
	});
	assert.deepStrictEqual(standardSite.validateDocument({
		site: helpers.PUBLICATION_URI, title: 'T', path: '/a', publishedAt: '2255-01-01T00:00:00.000Z',
		content: { $type: 'at.markpub.markdown', text: { markdown: '' } }
	}, '3khuwc44cas67'), []);
});

test('validateDocument enforces the lexicon length limits', function () {
	var record = standardSite.buildDocument({
		publicationUri: helpers.PUBLICATION_URI, title: 'x'.repeat(501), path: '/a',
		publishedAt: new Date(), markdown: '', html: ''
	});
	assert.deepStrictEqual(standardSite.validateDocument(record, '3khuwc44cas67'), ['title is longer than 500 characters']);
});
