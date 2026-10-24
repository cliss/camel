// Shared helpers for the tests: a throwaway copy of the site, a way to run
// the Camel server against it, and a minimal in-memory PDS.

var fs = require('fs');
var os = require('os');
var path = require('path');
var http = require('http');
var childProcess = require('child_process');
var standardSite = require('../lib/standard-site');

var repoRoot = path.join(__dirname, '..');
var PUBLICATION_DID = 'did:plc:abcdefghijklmnopqrstuvwx';
var PUBLICATION_URI = 'at://' + PUBLICATION_DID + '/site.standard.publication/3lwafzkjqm25s';

// Copies the parts of the repo Camel needs into a temp directory, so tests
// can add posts and change settings without touching the real site.
function makeSite(options) {
	options = options || {};
	var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'camel-test-'));
	['camel.js', 'package.json', 'lib', 'scripts', 'posts', 'templates', 'public'].forEach(function (name) {
		fs.cpSync(path.join(repoRoot, name), path.join(dir, name), { recursive: true });
	});
	fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(dir, 'node_modules'));

	var defaultTags = path.join(dir, 'templates', 'defaultTags.html');
	var tags = fs.readFileSync(defaultTags, 'utf8');
	if (options.publication) {
		tags = tags.replace(/^@@ StandardSitePublication=.*$/m, '@@ StandardSitePublication=' + options.publication);
	}
	if (options.siteRoot) {
		tags = tags.replace(/^@@ SiteRoot=.*$/m, '@@ SiteRoot=' + options.siteRoot);
	}
	fs.writeFileSync(defaultTags, tags);

	return {
		dir: dir,
		writePost: function (relativePath, text) {
			var file = path.join(dir, 'posts', relativePath);
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, text);
		},
		writeFile: function (relativePath, data) {
			var file = path.join(dir, relativePath);
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, data);
		},
		remove: function () {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	};
}

// Starts camel.js in the site directory on a free port.
function startServer(site) {
	return new Promise(function (resolve, reject) {
		var child = childProcess.spawn(process.execPath, ['camel.js'], {
			cwd: site.dir,
			env: Object.assign({}, process.env, { PORT: '0' }),
			stdio: ['ignore', 'pipe', 'pipe']
		});
		var output = '';
		child.stdout.on('data', function (chunk) {
			output += chunk;
			var match = /started on port (\d+)/.exec(output);
			if (match) {
				// Templates load asynchronously after listen; give them a moment.
				setTimeout(function () {
					resolve({
						url: 'http://127.0.0.1:' + match[1],
						stop: function () { child.kill(); }
					});
				}, 300);
			}
		});
		child.on('exit', function (code) {
			reject(new Error('camel.js exited with ' + code + ':\n' + output));
		});
	});
}

// Runs the sync script in the site directory. Resolves with its exit code and output.
function runSync(site, args, env) {
	return new Promise(function (resolve) {
		childProcess.execFile(process.execPath, ['scripts/standard-site-sync.js'].concat(args || []), {
			cwd: site.dir,
			env: Object.assign({}, process.env, { ATP_IDENTIFIER: '', ATP_APP_PASSWORD: '', ATP_SERVICE: '' }, env || {})
		}, function (error, stdout, stderr) {
			resolve({ code: error ? error.code : 0, output: stdout + stderr });
		});
	});
}

// An in-memory stand-in for a PDS that implements the XRPC calls the sync uses.
function startMockPds() {
	var records = {};
	var calls = [];
	records['site.standard.publication/3lwafzkjqm25s'] = {
		$type: 'site.standard.publication', name: 'Old name', url: 'http://localhost:5000'
	};
	var cid = 'bafyreigbtj4x7ip5legnfznufuopl4sg4knzc2cof6duas4b3q2fy6swua';

	var server = http.createServer(function (request, response) {
		var chunks = [];
		request.on('data', function (chunk) { chunks.push(chunk); });
		request.on('end', function () {
			var raw = Buffer.concat(chunks);
			var url = new URL(request.url, 'http://localhost');
			var method = url.pathname.replace('/xrpc/', '');
			var send = function (body) {
				response.setHeader('content-type', 'application/json');
				response.end(JSON.stringify(body));
			};
			if (method === 'com.atproto.repo.uploadBlob') {
				calls.push({ method: method, size: raw.length });
				return send({ blob: {
					$type: 'blob', ref: { $link: standardSite.blobCid(raw) },
					mimeType: request.headers['content-type'], size: raw.length
				} });
			}
			var body = raw.length ? JSON.parse(raw) : {};
			calls.push({ method: method, rkey: body.rkey || url.searchParams.get('rkey'), body: body });
			var key = function (collection, rkey) { return collection + '/' + rkey; };
			switch (method) {
			case 'com.atproto.server.createSession':
				if (body.password === 'wrong') {
					response.statusCode = 401;
					return send({ error: 'AuthenticationRequired', message: 'Invalid identifier or password' });
				}
				return send({ did: PUBLICATION_DID, handle: 'test.example', accessJwt: 'a', refreshJwt: 'r', active: true });
			case 'com.atproto.repo.getRecord':
				var getKey = key(url.searchParams.get('collection'), url.searchParams.get('rkey'));
				if (!records[getKey]) {
					response.statusCode = 400;
					return send({ error: 'RecordNotFound' });
				}
				return send({ uri: 'at://' + PUBLICATION_DID + '/' + getKey, cid: cid, value: records[getKey] });
			case 'com.atproto.repo.listRecords':
				var collection = url.searchParams.get('collection');
				return send({ records: Object.keys(records).filter(function (k) {
					return k.startsWith(collection + '/');
				}).map(function (k) {
					return { uri: 'at://' + PUBLICATION_DID + '/' + k, cid: cid, value: records[k] };
				}) });
			case 'com.atproto.repo.createRecord':
				var rkey = standardSite.encodeTid(Date.now() * 1000, 0);
				records[key(body.collection, rkey)] = body.record;
				return send({ uri: 'at://' + PUBLICATION_DID + '/' + key(body.collection, rkey), cid: cid });
			case 'com.atproto.repo.putRecord':
				// Like a real PDS: swapRecord null means "only if it doesn't exist yet".
				if (body.swapRecord === null && records[key(body.collection, body.rkey)]) {
					response.statusCode = 400;
					return send({ error: 'InvalidSwap', message: 'Record was at ' + cid });
				}
				records[key(body.collection, body.rkey)] = body.record;
				return send({ uri: 'at://' + PUBLICATION_DID + '/' + key(body.collection, body.rkey), cid: cid });
			case 'com.atproto.repo.deleteRecord':
				delete records[key(body.collection, body.rkey)];
				return send({});
			default:
				response.statusCode = 404;
				return send({ error: 'MethodNotImplemented' });
			}
		});
	});

	return new Promise(function (resolve) {
		server.listen(0, '127.0.0.1', function () {
			resolve({
				url: 'http://127.0.0.1:' + server.address().port,
				records: records,
				calls: calls,
				documents: function () {
					return Object.keys(records).filter(function (k) {
						return k.startsWith('site.standard.document/');
					}).map(function (k) { return Object.assign({ rkey: k.split('/')[1] }, records[k]); });
				},
				stop: function () { server.close(); }
			});
		});
	});
}

// The smallest valid PNG header, padded to the given size.
function png(size) {
	var bytes = Buffer.alloc(size);
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
	return bytes;
}

module.exports = {
	PUBLICATION_DID: PUBLICATION_DID,
	PUBLICATION_URI: PUBLICATION_URI,
	makeSite: makeSite,
	startServer: startServer,
	runSync: runSync,
	startMockPds: startMockPds,
	png: png
};
