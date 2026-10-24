// Asks Bluesky's production AppView whether a post URL gets an enhanced
// standard.site card. It does what the Bluesky composer does: reads the
// page's <link rel="site.standard.document">, then calls
// app.bsky.embed.getEmbedExternalView with it.
//
// Usage: node test/card-check.mjs <post url> [<post url> ...]
// Set APPVIEW to use another AppView (default https://public.api.bsky.app).
const appview = process.env.APPVIEW || 'https://public.api.bsky.app';
let failures = 0;
const check = (ok, label) => {
	console.log((ok ? 'PASS ' : 'FAIL ') + label);
	if (!ok) failures++;
};

const urls = process.argv.slice(2);
if (!urls.length) {
	console.error('Usage: node test/card-check.mjs <post url> [<post url> ...]');
	process.exit(2);
}

for (const url of urls) {
	console.log('== ' + url);
	const page = await fetch(url);
	check(page.ok, 'page answered ' + page.status);
	if (!page.ok) continue;
	const html = await page.text();
	const canonicalUri = html.match(/<link rel="site.standard.document" href="([^"]+)"/)?.[1];
	check(!!canonicalUri, 'page links its document record: ' + canonicalUri);
	if (!canonicalUri) continue;

	const query = new URLSearchParams({ url, canonicalUri });
	const res = await fetch(appview + '/xrpc/app.bsky.embed.getEmbedExternalView?' + query);
	const body = await res.json();
	check(res.ok, 'AppView answered ' + res.status + (body.message ? ' (' + body.message + ')' : ''));
	check(!!body.associatedRefs?.length, 'records validated for this URL'
		+ (body.unverifiedAssociatedRefs?.length ? ' (found, but they do not match the URL)' : ''));
	const card = body.view?.external;
	check(!!card?.source, 'enhanced card: "' + card?.title + '" from ' + (card?.source?.title ?? 'no publication'));
	if (card?.thumb) console.log('     cover: ' + card.thumb);
}
process.exit(failures ? 1 : 0);
