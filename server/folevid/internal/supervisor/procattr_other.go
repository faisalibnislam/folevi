//go:build !linux

package supervisor

import "syscall"

// sysProcAttr puts each service in its own process group. macOS has no parent-death signal, so a local test
// server relies on folevid's own shutdown to stop its children.
func sysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Setpgid: true}
}
