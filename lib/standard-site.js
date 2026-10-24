// Helpers for publishing posts as standard.site records on AT Protocol.
// https://standard.site
//
// Shared by camel.js (which serves the verification <link> tags and the
// /.well-known endpoint) and scripts/standard-site-sync.js (which writes the
// records). Both must agree on each post's record key, so the key is derived
// from the post itself rather than stored anywhere.

var crypto = require('crypto');
require('sugar');

var PUBLICATION_COLLECTION = 'site.standard.publication';
var DOCUMENT_COLLECTION = 'site.standard.document';
var TID_ALPHABET = '234567abcdefghijklmnopqrstuvwxyz';
var TID_REGEX = /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/;
var FULL_DATE_REGEX = /^\s*\d{4}-\d{1,2}-\d{1,2}(\s|T|$)/;
var POST_DATE_REGEX = /posts\/(\d{4})\/(\d{1,2})\/(\d{1,2})\//;
var MAX_BLOB_SIZE = 1000000;
// A DID as atproto's syntax allows it: percent signs only in %XX escapes, and
// no trailing colon.
var DID_PATTERN = 'did:[a-z]+:(?:[a-zA-Z0-9._:-]|%[0-9A-Fa-f]{2})*(?:[a-zA-Z0-9._-]|%[0-9A-Fa-f]{2})';

// Parses "at://did/collection/rkey". Returns null if it isn't one.
function parseAtUri(uri) {
	var match = new RegExp('^at://(' + DID_PATTERN + ')/([a-zA-Z0-9.-]+)/([a-zA-Z0-9._:~-]+)$').exec((uri || '').trim());
	if (!match) {
		return null;
	}
	return { did: match[1], collection: match[2], rkey: match[3] };
}

// Encodes a TID: 53 bits of microseconds since the epoch, then a 10-bit
// clock id, written in base32-sortable.
function encodeTid(microseconds, clockId) {
	var n = (BigInt(microseconds) << 10n) | BigInt(clockId & 0x3ff);
	var retVal = '';
	for (var i = 0; i < 13; i++) {
		retVal = TID_ALPHABET[Number(n & 31n)] + retVal;
		n >>= 5n;
	}
	return retVal;
}

// The record key for a post. It's a TID whose timestamp is the publish date,
// with the sub-millisecond digits and clock id taken from a hash of the
// publication and path, so two posts published in the same minute still get
// distinct keys, and so do two publications in one account (say, after
// re-running --init). Changing a post's date or path changes its key.
function documentRkey(publicationUri, publishedAt, path) {
	var hash = crypto.createHash('sha256').update(publicationUri.trim() + ' ' + path).digest();
	var microseconds = publishedAt.getTime() * 1000 + (hash.readUInt16BE(0) % 1000);
	return encodeTid(microseconds, hash.readUInt16BE(2));
}

function documentUri(publicationUri, publishedAt, path) {
	var publication = parseAtUri(publicationUri);
	if (!publication) {
		return null;
	}
	return 'at://' + publication.did + '/' + DOCUMENT_COLLECTION + '/' + documentRkey(publicationUri, publishedAt, path);
}

// Whether a post's folder day (local midnight) has arrived. camel.js hides
// posts from listings until then, so they get no record and no <link> tag.
function folderDayHasArrived(file, now) {
	var parts = POST_DATE_REGEX.exec(file);
	return !!parts && new Date(parts[1], parts[2] - 1, parts[3]) <= (now || new Date());
}

// When a post was published. Uses the post's Date metadata when it's a full
// date, otherwise the date in the post's folder. Parsed as UTC and then
// shifted by utcOffset, matching how camel.js dates RSS items, so the result
// (and the record key) doesn't depend on the machine's time zone.
function publishedAtFor(metadata, file, utcOffset) {
	var date = null;
	if (typeof(metadata.Date) === 'string' && FULL_DATE_REGEX.test(metadata.Date)) {
		date = Date.utc.create(metadata.Date);
	}
	if (date === null || !date.isValid()) {
		var parts = POST_DATE_REGEX.exec(file);
		if (!parts) {
			return null;
		}
		date = new Date(Date.UTC(parts[1], parts[2] - 1, parts[3]));
	}
	return new Date(date.getTime() + utcOffset * 3600000);
}

function escapeAttribute(value) {
	return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// The <link> tags for a page's <head>. The publication tag goes on every page;
// the document tag only on posts.
function linkTags(publicationUri, docUri) {
	if (!parseAtUri(publicationUri)) {
		return '';
	}
	var retVal = '<link rel="site.standard.publication" href="' + escapeAttribute(publicationUri.trim()) + '" />';
	if (docUri) {
		retVal += '\n        <link rel="site.standard.document" href="' + escapeAttribute(docUri) + '" />';
	}
	return retVal;
}

function decodeEntities(text) {
	var named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…' };
	return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, function (entity, code) {
		if (code[0] === '#') {
			var number = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
			return isNaN(number) ? entity : String.fromCodePoint(number);
		}
		return Object.prototype.hasOwnProperty.call(named, code) ? named[code] : entity;
	});
}

// Rendered post HTML to plain text for textContent.
function htmlToText(html) {
	var text = html
		.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|h[1-6]|li|blockquote|pre|tr|section|ol|ul)>/gi, '\n')
		.replace(/<[^>]+>/g, '');
	return decodeEntities(text)
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

// Builds a site.standard.document record. Optional fields are left out when empty.
function buildDocument(post) {
	var record = {
		$type: DOCUMENT_COLLECTION,
		site: post.publicationUri,
		title: post.title,
		path: post.path,
		publishedAt: post.publishedAt.toISOString()
	};
	if (post.description) {
		record.description = post.description;
	}
	if (post.contributors && post.contributors.length > 0) {
		record.contributors = post.contributors.map(function (did) { return { did: did }; });
	}
	record.textContent = htmlToText(post.html);
	record.content = {
		$type: 'at.markpub.markdown',
		text: { markdown: post.markdown },
		flavor: 'commonmark',
		renderingRules: 'markdown-it'
	};
	return record;
}

function buildPublication(name, url) {
	return {
		$type: PUBLICATION_COLLECTION,
		name: name,
		url: url.replace(/\/+$/, '')
	};
}

// The CID a PDS assigns to an uploaded blob: CIDv1, raw codec, sha256,
// written as base32. Lets the sync skip re-uploading unchanged images.
function blobCid(bytes) {
	var digest = crypto.createHash('sha256').update(bytes).digest();
	var cid = Buffer.concat([Buffer.from([0x01, 0x55, 0x12, 0x20]), digest]);
	var alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
	var retVal = 'b';
	var bits = 0;
	var value = 0;
	for (var i = 0; i < cid.length; i++) {
		value = (value << 8) | cid[i];
		bits += 8;
		while (bits >= 5) {
			retVal += alphabet[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) {
		retVal += alphabet[(value << (5 - bits)) & 31];
	}
	return retVal;
}

// The image type from a file's first bytes, or null if it isn't a known image.
function sniffImageType(bytes) {
	if (bytes.length >= 8 && bytes.readUInt32BE(0) === 0x89504e47) {
		return 'image/png';
	}
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return 'image/jpeg';
	}
	if (bytes.length >= 6 && bytes.toString('ascii', 0, 4) === 'GIF8') {
		return 'image/gif';
	}
	if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
		return 'image/webp';
	}
	return null;
}

var segmenter = new Intl.Segmenter();

function checkString(errors, record, field, maxBytes, maxGraphemes, required) {
	var value = record[field];
	if (typeof(value) === 'undefined') {
		if (required) {
			errors.push(field + ' is required');
		}
		return;
	}
	if (typeof(value) !== 'string' || (required && value.trim().length === 0)) {
		errors.push(field + ' must be a non-empty string');
		return;
	}
	if (maxBytes && Buffer.byteLength(value, 'utf8') > maxBytes) {
		errors.push(field + ' is longer than ' + maxBytes + ' bytes');
	}
	if (maxGraphemes && Array.from(segmenter.segment(value)).length > maxGraphemes) {
		errors.push(field + ' is longer than ' + maxGraphemes + ' characters');
	}
}

// PDSes don't know the site.standard.* lexicons, so they store these records
// without checking them. Check them here instead. Returns a list of problems.
function validateDocument(record, rkey) {
	var errors = [];
	if (!TID_REGEX.test(rkey)) {
		errors.push('record key ' + rkey + ' is not a TID');
	}
	checkString(errors, record, 'title', 5000, 500, true);
	checkString(errors, record, 'description', 30000, 3000, false);
	checkString(errors, record, 'textContent', null, null, false);
	if (!parseAtUri(record.site) || parseAtUri(record.site).collection !== PUBLICATION_COLLECTION) {
		errors.push('site must be a ' + PUBLICATION_COLLECTION + ' at:// URI');
	}
	if (typeof(record.path) !== 'string' || record.path[0] !== '/' || (record.path.length > 1 && record.path.endsWith('/'))) {
		errors.push('path must start with "/" and not end with one');
	}
	if (typeof(record.publishedAt) !== 'string' || isNaN(Date.parse(record.publishedAt))) {
		errors.push('publishedAt must be a datetime');
	} else if (Date.parse(record.publishedAt) < 0 || Date.parse(record.publishedAt) * 1000 >= Math.pow(2, 53)) {
		// The record key is a TID, which holds microseconds since 1970 in 53 bits.
		errors.push('publishedAt ' + record.publishedAt + ' is outside 1970 to 2255, which a record key can\'t hold; check the post\'s Date');
	}
	(record.contributors || []).forEach(function (contributor) {
		if (!new RegExp('^' + DID_PATTERN + '$').test(contributor.did)) {
			errors.push('contributor ' + contributor.did + ' is not a DID');
		}
	});
	if (!record.content || !record.content.text || typeof(record.content.text.markdown) !== 'string') {
		errors.push('content.text.markdown is required');
	}
	return errors;
}

module.exports = {
	PUBLICATION_COLLECTION: PUBLICATION_COLLECTION,
	MAX_BLOB_SIZE: MAX_BLOB_SIZE,
	blobCid: blobCid,
	sniffImageType: sniffImageType,
	DOCUMENT_COLLECTION: DOCUMENT_COLLECTION,
	parseAtUri: parseAtUri,
	encodeTid: encodeTid,
	documentRkey: documentRkey,
	documentUri: documentUri,
	publishedAtFor: publishedAtFor,
	folderDayHasArrived: folderDayHasArrived,
	linkTags: linkTags,
	htmlToText: htmlToText,
	buildDocument: buildDocument,
	buildPublication: buildPublication,
	validateDocument: validateDocument
};
