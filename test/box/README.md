# End-to-end test with Atmosphere in a Box

`npm test` checks the standard.site code against a fake, in-memory PDS. This
test runs it against real AT Protocol software instead: the official PDS, a
relay and Bluesky's AppView, all running locally in
[Atmosphere in a Box](https://tangled.org/kandake.africa/atmosphereinabox).
Nothing touches the public network or your real account.

`box-test.sh`:

1. Copies this site, adds a post with a cover image, and runs it inside the
   box at `https://blog.atmosbox.test`.
2. Creates a test account on the box's PDS and runs `--init`.
3. Syncs with `--release` (all posts created), then syncs again (nothing changes).
4. Checks the records against the blog: `/.well-known`, every `<link>` tag,
   and that cover images can be downloaded.
5. Runs Bluesky's own AppView standard.site checks on the records: the
   lexicon check, and whether the records back each post's URL.
6. Edits one post and deletes another, then syncs (1 updated, 1 deleted).

It exits non-zero on the first failure.

## Running it

You need Docker with Compose, Deno 2.8 and Node 22 or newer.

```sh
# Once: set up the box with the full-stack preset.
git clone https://tangled.org/kandake.africa/atmosphereinabox
cd atmosphereinabox
deno task install
deno task sandbox create --pds 1 --users-per-pds 2 --preset full-stack
deno task sandbox check
deno task sandbox up --build

# Each run, from this repository:
npm install
BOX_DIR=/path/to/atmosphereinabox test/box/box-test.sh
```

The script creates its own test account (`user2.pds1.atmosbox.test` by default),
so `sandbox seed` isn't needed. Set `BOX_HANDLE` to use a different account from
the box's `state/accounts.json`. Running it again with the same account is fine:
each run creates a new publication.

## Limits

- **No live card.** The box's local dataplane returns nothing for
  non-Bluesky records, so its AppView can't build an enhanced card for any
  site. The script instead calls the AppView's validation code directly,
  which is what decides whether a card is shown. Seeing the card in the
  Bluesky app needs a real account on the public network.
- **Default subnet.** `blog.server` and the overlay assume the box's default
  `172.30.249.0/24` subnet. If you created the box with `--subnet auto`, set
  `SANDBOX_DNS_IP` and change the gateway address in `blog.server`.
