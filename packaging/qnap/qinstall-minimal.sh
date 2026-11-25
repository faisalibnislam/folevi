#!/bin/sh
# Minimal QPKG installer, used ONLY when build.sh assembles the .qpkg without QNAP's QDK (see README.md,
# "Package format"). QDK's own qinstall.sh does much more (upgrades in place, volume migration, App Center
# notifications); release builds use QDK. Unverified on real QTS: test before relying on it.
CONF=/etc/config/qpkg.conf
. ./qpkg.cfg
err_log() { /bin/echo "$1"; /sbin/log_tool -t2 -uSystem -p127.0.0.1 -mlocalhost -a "[App Center] $QPKG_DISPLAY_NAME: $1" 2>/dev/null; exit 1; }
CMD_ECHO=/bin/echo
CMD_CHMOD=/bin/chmod
. ./package_routines

public="$(/sbin/getcfg Public path -f /etc/config/smb.conf)"
[ -n "$public" ] || err_log "the Public shared folder was not found"
base="$(dirname "$public")"
SYS_QPKG_DIR="$(/sbin/getcfg "$QPKG_NAME" Install_Path -f $CONF)"
[ -n "$SYS_QPKG_DIR" ] && [ -d "$SYS_QPKG_DIR" ] || SYS_QPKG_DIR="$base/.qpkg/$QPKG_NAME"

type pkg_check_requirement >/dev/null 2>&1 && pkg_check_requirement
type pkg_pre_install >/dev/null 2>&1 && pkg_pre_install
/bin/mkdir -p "$SYS_QPKG_DIR"
# Replace the program, keep anything else in the folder (for example data/ when no shared folder is used).
/bin/rm -rf "$SYS_QPKG_DIR/bundle"
/bin/tar -xzf ./data.tar.gz -C "$SYS_QPKG_DIR" || err_log "could not unpack the program files"
type pkg_post_install >/dev/null 2>&1 && pkg_post_install

set_field() { [ -n "$2" ] && /sbin/setcfg "$QPKG_NAME" "$1" "$2" -f $CONF; }
set_field Name "$QPKG_NAME"
set_field Display_Name "$QPKG_DISPLAY_NAME"
set_field Version "$QPKG_VER"
set_field Author "$QPKG_AUTHOR"
set_field Date "$(/bin/date +%F)"
set_field QPKG_File "$QPKG_NAME.qpkg"
set_field Install_Path "$SYS_QPKG_DIR"
set_field Shell "$SYS_QPKG_DIR/$QPKG_SERVICE_PROGRAM"
set_field Service_Port "$QPKG_SERVICE_PORT"
set_field Pid_File "$QPKG_SERVICE_PIDFILE"
set_field WebUI "$QPKG_WEBUI"
set_field Web_Port "$QPKG_WEB_PORT"
set_field Desktop "$QPKG_DESKTOP_APP"
set_field Visible "$QPKG_VISIBLE"
set_field RC_Number "$QPKG_RC_NUM"
set_field Timeout "$QPKG_TIMEOUT"
set_field FW_Ver_Min "$QTS_MINI_VERSION"
set_field Enable TRUE

/bin/ln -sf "$SYS_QPKG_DIR/$QPKG_SERVICE_PROGRAM" "/etc/init.d/$QPKG_SERVICE_PROGRAM"
for f in .qpkg_icon.gif .qpkg_icon_80.gif .qpkg_icon_gray.gif; do
  [ -f "$SYS_QPKG_DIR/$f" ] && /bin/cp -f "$SYS_QPKG_DIR/$f" "/home/httpd/RSS/images/${QPKG_NAME}${f#.qpkg_icon}" 2>/dev/null
done

# Removal script that QTS runs on uninstall.
/bin/cat > "$SYS_QPKG_DIR/.uninstall.sh" <<UNINST
#!/bin/sh
SYS_QPKG_DIR="$SYS_QPKG_DIR"
$PKG_PRE_REMOVE
/bin/rm -f /etc/init.d/$QPKG_SERVICE_PROGRAM
/bin/rm -rf "\$SYS_QPKG_DIR/bundle" "\$SYS_QPKG_DIR/$QPKG_SERVICE_PROGRAM"
/sbin/rmcfg $QPKG_NAME -f $CONF
$PKG_POST_REMOVE
UNINST
/bin/chmod 755 "$SYS_QPKG_DIR/.uninstall.sh"

"$SYS_QPKG_DIR/$QPKG_SERVICE_PROGRAM" start
/bin/echo "$QPKG_DISPLAY_NAME $QPKG_VER installed in $SYS_QPKG_DIR"
