#!/bin/sh
. "$(dirname "$0")/common.sh"
"$PKG_DIR/CONTROL/start-stop.sh" stop
exit 0
