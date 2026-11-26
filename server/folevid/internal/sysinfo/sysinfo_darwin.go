package sysinfo

import (
	"encoding/binary"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
)

// memory reads hw.memsize, and estimates available memory from vm_stat's free, inactive and purgeable pages.
func memory() (total, available uint64) {
	if s, err := syscall.Sysctl("hw.memsize"); err == nil {
		b := []byte(s)
		for len(b) < 8 {
			b = append(b, 0) // Sysctl trims a trailing zero byte
		}
		total = binary.LittleEndian.Uint64(b[:8])
	}
	out, err := exec.Command("vm_stat").Output()
	if err != nil {
		return total, 0
	}
	pageSize := uint64(16384)
	var pages uint64
	for _, line := range strings.Split(string(out), "\n") {
		if strings.Contains(line, "page size of") {
			for _, f := range strings.Fields(line) {
				if v, err := strconv.ParseUint(f, 10, 64); err == nil {
					pageSize = v
				}
			}
			continue
		}
		k, v, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		switch strings.TrimSpace(k) {
		case "Pages free", "Pages inactive", "Pages purgeable", "Pages speculative":
			n, _ := strconv.ParseUint(strings.TrimSuffix(strings.TrimSpace(v), "."), 10, 64)
			pages += n
		}
	}
	return total, pages * pageSize
}

// rss asks ps for the resident size (in KiB).
func rss(pid int) uint64 {
	out, err := exec.Command("ps", "-o", "rss=", "-p", strconv.Itoa(pid)).Output()
	if err != nil {
		return 0
	}
	v, _ := strconv.ParseUint(strings.TrimSpace(string(out)), 10, 64)
	return v * 1024
}
