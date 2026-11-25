#!/bin/sh
# Runs DigitalOcean's own image validation (the Marketplace requires it to pass). It is fetched at build time,
# not vendored, so it is always DigitalOcean's current version.
set -eu
curl -fsSL https://raw.githubusercontent.com/digitalocean/marketplace-partners/master/scripts/99-img-check.sh -o /tmp/99-img-check.sh
bash /tmp/99-img-check.sh
rm -f /tmp/99-img-check.sh
