//go:build !linux && !darwin

package sysinfo

func memory() (total, available uint64) { return 0, 0 }

func rss(int) uint64 { return 0 }
