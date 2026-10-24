// Checks that the blog's verification links and the records on the PDS agree.
// Runs inside the box network. Usage: node verify.mjs <expected document count>
const pds = process.env.ATP_SERVICE;
const blog = process.env.BLOG_URL;
const expected = Number(process.argv[2]);
let failures = 0;
const check = (ok, label) => {
	console.log((ok ? 'PASS ' : 'FAIL ') + label);
	if (!ok) failures++;
};

const pubUri = (await (await fetch(blog + '/.well-known/site.standard.publication')).text()).trim();
const [did, , pubRkey] = pubUri.replace('at://', '').split('/');
check(pubUri.startsWith('at://did:'), '.well-known returns ' + pubUri);

const pub = await (await fetch(`${pds}/xrpc/com.atproto.repo.getRecord?repo=${did}&collection=site.standard.publication&rkey=${pubRkey}`)).json();
check(pub.value?.url === blog, 'publication.url is ' + pub.value?.url);

const list = { records: [] };
let cursor = '';
do {
	const page = await (await fetch(`${pds}/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=site.standard.document&limit=100${cursor ? `&cursor=${cursor}` : ''}`)).json();
	list.records.push(...page.records);
	cursor = page.cursor;
} while (cursor);
// Earlier runs with the same account leave records under other publications.
list.records = list.records.filter((rec) => rec.value.site === pubUri);
check(list.records.length === expected, list.records.length + ' document records on the PDS (expected ' + expected + ')');

for (const rec of list.records) {
	const html = await (await fetch(blog + rec.value.path)).text();
	const docLink = html.match(/<link rel="site.standard.document" href="([^"]+)"/)?.[1];
	const pubLink = html.match(/<link rel="site.standard.publication" href="([^"]+)"/)?.[1];
	check(docLink === rec.uri && pubLink === pubUri, rec.value.path + ': <link> tags point at this record');
	check(rec.value.site === pubUri, rec.value.path + ': record belongs to the publication');
	if (rec.value.coverImage) {
		const cid = rec.value.coverImage.ref.$link;
		const blob = await fetch(`${pds}/xrpc/com.atproto.sync.getBlob?did=${did}&cid=${cid}`);
		const size = blob.ok ? (await blob.arrayBuffer()).byteLength : -1;
		check(size === rec.value.coverImage.size, rec.value.path + ': cover image downloadable (' + size + ' bytes)');
	}
}
process.exit(failures ? 1 : 0);
