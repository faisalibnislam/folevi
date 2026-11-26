package supervisor

import "syscall"

// sysProcAttr puts each service in its own process group and stops it if folevid dies.
func sysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Setpgid: true, Pdeathsig: syscall.SIGTERM}
}
