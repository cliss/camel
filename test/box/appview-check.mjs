// Runs Bluesky's own standard.site checks on the published records. This is
// the code the AppView uses to decide whether a link gets an enhanced card.
// box-test.sh copies it into the AppView container (/app/packages/bsky) so it
// can import that code. Usage: node appview-check.mjs <did> <pds url> <blog url>
//
// The box's local dataplane returns nothing for non-Bluesky records, so asking
// its AppView for a card always comes back empty; calling the checks directly
// is the closest test available outside Bluesky's production network.
import { getStandardSiteRecordsForUri, validateStandardSiteRecordsForUrl } from './dist/util/external/standard-site.js'
import { jsonToLex } from '@atproto/lex'

const [did, pds, blog] = process.argv.slice(2)
let failures = 0
const check = (ok, label) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + label)
  if (!ok) failures++
}

const records = new Map()
for (const collection of ['site.standard.publication', 'site.standard.document']) {
  let cursor = ''
  do {
    const res = await (await fetch(`${pds}/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=${collection}&limit=100${cursor ? `&cursor=${cursor}` : ''}`)).json()
    for (const r of res.records) records.set(r.uri, { record: jsonToLex(r.value), cid: r.cid })
    cursor = res.cursor
  } while (cursor)
}

for (const [uri, info] of records) {
  if (!uri.includes('/site.standard.document/')) continue
  const url = blog + info.record.path
  const selection = getStandardSiteRecordsForUri(uri, records)
  check(!!selection.document, info.record.path + ': document passes the AppView lexicon check')
  check(!!selection.publication, info.record.path + ': publication passes the AppView lexicon check')
  check(validateStandardSiteRecordsForUrl(selection.document, selection.publication, url),
    info.record.path + ': records back ' + url)
  check(!validateStandardSiteRecordsForUrl(selection.document, selection.publication, url + '-wrong'),
    info.record.path + ': a different URL is rejected')
}
process.exit(failures ? 1 : 0)
