# folevi_pre_update_backup <folevid> <data dir> <bundle dir>
# Shared by every package (copied into package scripts at build time; POSIX sh). Takes a "pre-update" backup
# with the version that is about to be replaced. "folevid backup" talks to a running folevid, so when the
# server is stopped (stores usually stop a package before upgrading it) this starts the old version briefly,
# waits until "folevid healthcheck" passes (up to 5 minutes), backs up and stops it again.
# Returns non-zero when no backup was made; callers log that and carry on (folevid also protects migrations).
folevi_pre_update_backup() {
  _fv="$1" _data="$2" _bundle="$3"
  [ -x "$_fv" ] && [ -d "$_data" ] || return 1
  if "$_fv" healthcheck --data "$_data" >/dev/null 2>&1; then
    "$_fv" backup --data "$_data"
    return $?
  fi
  "$_fv" run --data "$_data" --bundle "$_bundle" >/dev/null 2>&1 &
  _pid=$!
  _i=0
  until "$_fv" healthcheck --data "$_data" >/dev/null 2>&1; do
    if ! kill -0 "$_pid" 2>/dev/null || [ $_i -ge 150 ]; then
      kill -TERM "$_pid" 2>/dev/null; wait "$_pid" 2>/dev/null
      return 1
    fi
    _i=$((_i + 1)); sleep 2
  done
  "$_fv" backup --data "$_data"; _rc=$?
  kill -TERM "$_pid" 2>/dev/null; wait "$_pid" 2>/dev/null
  return $_rc
}
