#!/usr/bin/env bash
# End-to-end test of standard.site publishing against a local AT Protocol
# network from Atmosphere in a Box (https://tangled.org/kandake.africa/atmosphereinabox).
#
# Runs Camel inside the box, publishes a copy of this site to the box's PDS
# with the real sync script, then checks the records, the verification links
# and Bluesky's own AppView validation. See test/box/README.md.
#
# Usage: BOX_DIR=/path/to/atmosphereinabox test/box/box-test.sh
#
# Environment:
#   BOX_DIR      the Atmosphere in a Box checkout, already running the
#                full-stack preset (required)
#   BOX_HANDLE   test account to use (default user2.pds1.atmosbox.test);
#                its password is read from the box's state/accounts.json
#   BOX_PROJECT  Docker Compose project name (default atproto-sandbox)

set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
: "${BOX_DIR:?Set BOX_DIR to your Atmosphere in a Box checkout}"
BOX_DIR=$(cd "$BOX_DIR" && pwd)
PROJECT=${BOX_PROJECT:-atproto-sandbox}
HANDLE=${BOX_HANDLE:-user2.pds1.atmosbox.test}
PDS_HOST=${HANDLE#*.}
PDS=https://$PDS_HOST
BLOG=https://blog.atmosbox.test
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

step() { printf '\n== %s\n' "$1"; }
fail() { echo "FAIL $1"; exit 1; }

# Runs a command in a throwaway Node container on the box network, with the
# box's CA trusted and the test site at /app.
in_box() {
	docker run --rm -i --network "${PROJECT}_atmosinabox" --dns "${SANDBOX_DNS_IP:-172.30.249.3}" \
		-v "${PROJECT}_public-ca:/ca:ro" -v "$WORK/site:/app" -v "$REPO/node_modules:/app/node_modules:ro" \
		-v "$HERE:/box:ro" -w /app -e NODE_EXTRA_CA_CERTS=/ca/root.crt --env-file "$WORK/atp.env" \
		-e "BLOG_URL=$BLOG" node:24-bookworm-slim "$@"
}

sync_site() {
	in_box node scripts/standard-site-sync.js "$@" 2>&1 | sed '/dotenv/d' | tee "$WORK/sync.out"
}

expect_sync() {
	grep -q "$1" "$WORK/sync.out" || fail "expected sync to report: $1"
	echo "PASS sync reported: $1"
}

step "Preparing a copy of the site"
mkdir -p "$WORK/site"
git -C "$REPO" archive HEAD | tar -x -C "$WORK/site"
cd "$WORK/site"
sed -i "s|^@@ SiteRoot=.*|@@ SiteRoot=$BLOG|; s|^@@ SiteTitle=.*|@@ SiteTitle=Camel Box Test|" templates/defaultTags.html
# The sample post's image is a placeholder on the public internet.
sed -i '/^@@ Image=/d' posts/2014/5/1/sample-post.md
mkdir -p posts/2026/1/2 public/images
printf '@@ Title=Hello from the box\n@@ Date=2026-01-02 09:00\n@@ Description=A post published as a standard.site record.\n@@ Image=/images/cover.png\n\nThis post should become an **enhanced card**.\n' \
	> posts/2026/1/2/hello-box.md
node -e '
const zlib = require("zlib");
const w = 64, h = 64;
const raw = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 120)])));
const chunk = (type, data) => {
	const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
	const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type), data])) >>> 0);
	return Buffer.concat([len, Buffer.from(type), data, crc]);
};
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
process.stdout.write(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
' > public/images/cover.png
POSTS=3

step "Starting Camel inside the box"
CAMEL_SITE="$WORK/site" CAMEL_MODULES="$REPO/node_modules" CAMEL_BOX_FILES="$HERE" \
	docker compose --project-directory "$BOX_DIR" -f "$BOX_DIR/compose.yaml" -f "$HERE/overlay.yaml" \
	up -d --no-deps --force-recreate blog gateway dns
sleep 5

step "Creating the test account $HANDLE"
PASSWORD=$(node -e 'const a = require(process.argv[1]).accounts[process.argv[2]]; if (!a) process.exit(1); process.stdout.write(a.password)' \
	"$BOX_DIR/state/accounts.json" "$HANDLE") || fail "$HANDLE is not in $BOX_DIR/state/accounts.json"
umask 077
printf 'ATP_IDENTIFIER=%s\nATP_APP_PASSWORD=%s\nATP_SERVICE=%s\n' "$HANDLE" "$PASSWORD" "$PDS" > "$WORK/atp.env"
in_box node -e '
(async () => {
	const r = await fetch(process.env.ATP_SERVICE + "/xrpc/com.atproto.server.createAccount", {
		method: "POST", headers: { "content-type": "application/json" },
		body: JSON.stringify({ handle: process.env.ATP_IDENTIFIER, email: process.env.ATP_IDENTIFIER.replace(".", "@"), password: process.env.ATP_APP_PASSWORD }) });
	const body = await r.json();
	console.log(r.ok ? "created " + body.did : "already exists (" + body.error + ")");
})()'

step "Creating the publication"
sync_site --init
PUBLICATION=$(grep -o 'at://[^ ]*site.standard.publication/[^ ]*' "$WORK/sync.out" | tail -1)
[ -n "$PUBLICATION" ] || fail "--init printed no publication URI"
DID=$(printf '%s' "$PUBLICATION" | cut -d/ -f3)
sed -i "s|^@@ StandardSitePublication=.*|@@ StandardSitePublication=$PUBLICATION|" templates/defaultTags.html
docker restart "${PROJECT}-blog-1" > /dev/null
sleep 3

step "Publishing (Heroku release mode)"
sync_site --release
expect_sync "$POSTS created, 0 updated, 0 unchanged, 0 deleted"

step "Re-running the sync"
sync_site
expect_sync "0 created, 0 updated, $POSTS unchanged, 0 deleted"

step "Checking records and verification links"
in_box node /box/verify.mjs "$POSTS"

step "Running Bluesky's AppView checks on the records"
APPVIEW="${PROJECT}-full-stack-appview-1"
docker cp "$HERE/appview-check.mjs" "$APPVIEW:/app/packages/bsky/camel-appview-check.mjs"
docker exec -w /app/packages/bsky -e NODE_EXTRA_CA_CERTS=/ca/root.crt "$APPVIEW" \
	node camel-appview-check.mjs "$DID" "$PDS" "$BLOG" | sed 's/^/  /' || fail "AppView checks"
docker exec -u 0 "$APPVIEW" rm -f /app/packages/bsky/camel-appview-check.mjs

step "Editing one post and deleting another"
sed -i 's/^@@ Title=Test Post$/@@ Title=Edited Test Post/' posts/2014/5/1/sample-post.md
rm posts/2015/2/6/sample-link-post.md
sync_site
expect_sync "0 created, 1 updated, 1 unchanged, 1 deleted"
in_box node /box/verify.mjs "$((POSTS - 1))"

echo
echo "All box tests passed."
