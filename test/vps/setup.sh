#!/usr/bin/env bash
# Sets up a throwaway Camel site on a fresh Ubuntu 24.04 server (for example a
# Linode Nanode), publishes it as standard.site records with a test Bluesky
# account, and asks Bluesky's AppView whether a post gets an enhanced card.
#
# Run as root on the new server:
#   curl -fsSL https://raw.githubusercontent.com/cliss/camel/master/test/vps/setup.sh -o setup.sh
#   bash setup.sh
#
# To test a fork or branch instead, fetch setup.sh from it and set REPO and
# BRANCH, for example REPO=https://github.com/you/camel.git BRANCH=my-branch.
#
# It asks for the test account's handle and app password and stores them in
# /opt/camel/.env (mode 600). Re-running it is safe.
#
# Environment:
#   SITE_HOST  public host name (default: <ip>.sslip.io, which points at this server)
#   REPO       repository to deploy (default https://github.com/cliss/camel.git)
#   BRANCH     branch to deploy (default master)

set -euo pipefail

REPO=${REPO:-https://github.com/cliss/camel.git}
BRANCH=${BRANCH:-master}
DIR=/opt/camel
IP=$(hostname -I | awk '{print $1}')
SITE_HOST=${SITE_HOST:-${IP//./-}.sslip.io}
SITE=https://$SITE_HOST

step() { printf '\n== %s\n' "$1"; }

step "Installing Node 22, Caddy and git"
export DEBIAN_FRONTEND=noninteractive
# 22.2 is the first release with zlib.crc32, which the cover image below uses.
if ! node -e 'var v = process.versions.node.split(".").map(Number); process.exit(v[0] > 22 || (v[0] === 22 && v[1] >= 2) ? 0 : 1)' 2>/dev/null; then
	curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
	apt-get install -y nodejs
fi
apt-get install -y git caddy

step "Fetching Camel ($BRANCH)"
if [ -d "$DIR/.git" ]; then
	git -C "$DIR" remote set-url origin "$REPO"
	git -C "$DIR" fetch -q origin "$BRANCH"
	git -C "$DIR" checkout -q -- templates/defaultTags.html posts/2014/5/1/sample-post.md
	git -C "$DIR" checkout -q -B "$BRANCH" "origin/$BRANCH"
else
	git clone -q -b "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR"
npm ci --omit=dev --no-audit --no-fund

step "Configuring the site for $SITE"
PUBLICATION=$(grep -o 'at://[^ ]*site.standard.publication/[^ ]*' "$DIR/.publication" 2>/dev/null | tail -1 || true)
sed -i "s|^@@ SiteRoot=.*|@@ SiteRoot=$SITE|; s|^@@ SiteTitle=.*|@@ SiteTitle=Camel Card Test|; s|^@@ StandardSitePublication=.*|@@ StandardSitePublication=$PUBLICATION|" templates/defaultTags.html
# The sample post's image is a placeholder that doesn't exist.
sed -i '/^@@ Image=/d' posts/2014/5/1/sample-post.md

# A post dated today, with a cover image.
FOLDER=posts/$(date +%Y/%-m/%-d)
POST_URL=$SITE/$(date +%Y/%-m/%-d)/card-test
mkdir -p "$FOLDER" public/images
cat > "$FOLDER/card-test.md" <<EOF
@@ Title=Testing standard.site cards from Camel
@@ Date=$(date +'%Y-%m-%d %H:%M')
@@ Description=A throwaway post that checks whether Bluesky shows an enhanced card for a Camel blog.
@@ Image=/images/card-test.png

This post was published as a **site.standard.document** record by Camel's sync script.
EOF
node -e '
const zlib = require("zlib");
const w = 1200, h = 630;
const row = Buffer.alloc(1 + w * 3);
for (let x = 0; x < w; x++) row.set([40 + (x * 150 / w) | 0, 90, 160], 1 + x * 3);
const raw = Buffer.concat(Array.from({ length: h }, () => row));
const chunk = (type, data) => {
	const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
	const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type), data])) >>> 0);
	return Buffer.concat([len, Buffer.from(type), data, crc]);
};
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
process.stdout.write(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]));
' > public/images/card-test.png

step "Test account"
if [ ! -f .env ]; then
	read -r -p "Test account handle (e.g. camel-test.bsky.social): " HANDLE < /dev/tty
	read -r -s -p "App password (not shown): " APP_PASSWORD < /dev/tty
	echo
	umask 077
	printf 'ATP_IDENTIFIER=%s\nATP_APP_PASSWORD=%s\n' "$HANDLE" "$APP_PASSWORD" > .env
	umask 022
fi
chmod 600 .env
echo "Using $(grep '^ATP_IDENTIFIER=' .env | cut -d= -f2) (stored in $DIR/.env)"

step "Starting Camel behind Caddy (HTTPS for $SITE_HOST)"
cat > /etc/systemd/system/camel.service <<EOF
[Unit]
Description=Camel blog
After=network.target

[Service]
WorkingDirectory=$DIR
Environment=PORT=5000
ExecStart=$(command -v node) camel.js
Restart=always

[Install]
WantedBy=multi-user.target
EOF
printf '%s {\n\treverse_proxy localhost:5000\n}\n' "$SITE_HOST" > /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable -q --now camel
systemctl restart camel caddy
for i in $(seq 1 30); do
	curl -fsS -o /dev/null "$SITE/" 2>/dev/null && break
	sleep 3
done
curl -fsS -o /dev/null "$SITE/" || { echo "FAIL $SITE is not reachable over HTTPS yet; check: journalctl -u caddy"; exit 1; }
echo "$SITE is up"

if [ -z "$PUBLICATION" ]; then
	step "Creating the publication record"
	node scripts/standard-site-sync.js --init | tee "$DIR/.publication"
	PUBLICATION=$(grep -o 'at://[^ ]*site.standard.publication/[^ ]*' "$DIR/.publication" | tail -1)
	[ -n "$PUBLICATION" ] || { echo "FAIL --init printed no publication"; exit 1; }
	sed -i "s|^@@ StandardSitePublication=.*|@@ StandardSitePublication=$PUBLICATION|" templates/defaultTags.html
	systemctl restart camel
	sleep 3
fi
echo "Publication: $PUBLICATION"

step "Publishing the posts"
node scripts/standard-site-sync.js

step "Asking Bluesky for the card (after 30 seconds for indexing)"
sleep 30
node test/card-check.mjs "$POST_URL" || echo "Not yet. Indexing can take a minute; re-run: cd $DIR && node test/card-check.mjs $POST_URL"

echo
echo "Post URL: $POST_URL"
echo "Paste it into a new Bluesky post (don't send it) to see the card in the composer."
