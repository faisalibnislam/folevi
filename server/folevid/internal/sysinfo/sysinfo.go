// Package sysinfo reads memory, disk and process numbers from Linux, and finds the LAN address.
package sysinfo

import (
	"bufio"
	"io/fs"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
)

// Memory is total and available RAM in bytes (from /proc/meminfo). Zero when unknown.
func Memory() (total, available uint64) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0, 0
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) < 2 {
			continue
		}
		v, _ := strconv.ParseUint(fields[1], 10, 64)
		switch fields[0] {
		case "MemTotal:":
			total = v * 1024
		case "MemAvailable:":
			available = v * 1024
		}
	}
	return total, available
}

// RSS is a process's resident memory in bytes, 0 when unknown.
func RSS(pid int) uint64 {
	if pid <= 0 {
		return 0
	}
	b, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/status")
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(line, "VmRSS:") {
			f := strings.Fields(line)
			if len(f) >= 2 {
				v, _ := strconv.ParseUint(f[1], 10, 64)
				return v * 1024
			}
		}
	}
	return 0
}

// Free returns the bytes free for an unprivileged user on the file system holding path.
func Free(path string) uint64 {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return 0
	}
	return st.Bavail * uint64(st.Bsize)
}

// DirSize adds up the sizes of the regular files under dir.
func DirSize(dir string) uint64 {
	var total uint64
	_ = filepath.WalkDir(dir, func(_ string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.Type().IsRegular() {
			if info, err := d.Info(); err == nil {
				total += uint64(info.Size())
			}
		}
		return nil
	})
	return total
}

// LANIPs lists the machine's private IPv4 addresses, the most likely home address first
// (192.168.x before 10.x before 172.16-31.x; container bridges like docker0 are skipped).
func LANIPs() []net.IP {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	var ips []net.IP
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		name := ifc.Name
		if strings.HasPrefix(name, "docker") || strings.HasPrefix(name, "br-") || strings.HasPrefix(name, "veth") ||
			strings.HasPrefix(name, "virbr") || strings.HasPrefix(name, "lxc") || strings.HasPrefix(name, "tailscale") ||
			strings.HasPrefix(name, "zt") {
			continue
		}
		addrs, err := ifc.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			ipn, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			ip4 := ipn.IP.To4()
			if ip4 != nil && ip4.IsPrivate() {
				ips = append(ips, ip4)
			}
		}
	}
	sort.SliceStable(ips, func(i, j int) bool { return rank(ips[i]) < rank(ips[j]) })
	return ips
}

func rank(ip net.IP) int {
	switch {
	case ip[0] == 192 && ip[1] == 168:
		return 0
	case ip[0] == 10:
		return 1
	default:
		return 2
	}
}

// PrimaryLANIP is the best guess for the home address: the private address of the interface that routes to
// the internet, else the first private address, else 127.0.0.1. No packet is sent.
func PrimaryLANIP() string {
	if c, err := net.Dial("udp4", "192.0.2.1:9"); err == nil {
		ip := c.LocalAddr().(*net.UDPAddr).IP.To4()
		c.Close()
		if ip != nil && ip.IsPrivate() {
			return ip.String()
		}
	}
	if ips := LANIPs(); len(ips) > 0 {
		return ips[0].String()
	}
	return "127.0.0.1"
}
