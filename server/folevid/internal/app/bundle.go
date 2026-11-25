package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

// Bundle is the unpacked server bundle (CONTRACT §10).
type Bundle struct {
	Dir string
}

// Manifest is manifest.json, written by server/bundle/build-bundle.sh.
type Manifest struct {
	Name          string            `json:"name"`
	Version       string            `json:"version"`
	Arch          string            `json:"arch"`
	FunctionsHash string            `json:"functionsHash"`
	Files         map[string]string `json:"files"`
}

func (b Bundle) Path(parts ...string) string {
	return filepath.Join(append([]string{b.Dir}, parts...)...)
}

// Backend is bin/convex-backend.
func (b Bundle) Backend() string { return b.Path("bin", "convex-backend") }

// NodeBinDir is runtime/node/bin.
func (b Bundle) NodeBinDir() string { return b.Path("runtime", "node", "bin") }

// Node is the bundled node, or node from PATH when the bundle has none (development).
func (b Bundle) Node() string {
	p := filepath.Join(b.NodeBinDir(), "node")
	if _, err := os.Stat(p); err == nil {
		return p
	}
	if p, err := exec.LookPath("node"); err == nil {
		return p
	}
	return p
}

// HasBundledNode reports whether runtime/node/bin/node exists.
func (b Bundle) HasBundledNode() bool {
	_, err := os.Stat(filepath.Join(b.NodeBinDir(), "node"))
	return err == nil
}

// LibDir is runtime/lib.
func (b Bundle) LibDir() string { return b.Path("runtime", "lib") }

// Loader returns runtime/lib/ld-linux-* when the bundle carries a private glibc, else "".
func (b Bundle) Loader() string {
	m, _ := filepath.Glob(filepath.Join(b.LibDir(), "ld-linux-*"))
	sort.Strings(m)
	if len(m) == 0 {
		return ""
	}
	return m[0]
}

// Wrap turns a program and its arguments into the command to run: unchanged, or through the private loader
// (`ld-linux --library-path runtime/lib program args...`) when the bundle has one.
func (b Bundle) Wrap(program string, args ...string) (string, []string) {
	if l := b.Loader(); l != "" {
		return l, append([]string{"--library-path", b.LibDir(), program}, args...)
	}
	return program, args
}

// Version reads VERSION ("" when missing).
func (b Bundle) Version() string {
	v, err := os.ReadFile(b.Path("VERSION"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(v))
}

// Manifest reads manifest.json (zero value when missing).
func (b Bundle) Manifest() Manifest {
	var m Manifest
	if data, err := os.ReadFile(b.Path("manifest.json")); err == nil {
		_ = json.Unmarshal(data, &m)
	}
	return m
}

// FunctionsHash is the manifest's hash of functions/, or one computed from functions/convex when the
// manifest has none.
func (b Bundle) FunctionsHash() string {
	if h := b.Manifest().FunctionsHash; h != "" {
		return h
	}
	return TreeHash(b.Path("functions", "convex"))
}

// TreeHash hashes the relative paths and contents of the regular files under dir (skipping _generated).
func TreeHash(dir string) string {
	h := sha256.New()
	var files []string
	_ = filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() && (d.Name() == "node_modules" || d.Name() == "_generated") {
			return filepath.SkipDir
		}
		if d.Type().IsRegular() {
			files = append(files, p)
		}
		return nil
	})
	sort.Strings(files)
	for _, f := range files {
		rel, _ := filepath.Rel(dir, f)
		data, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		sum := sha256.Sum256(data)
		fmt.Fprintf(h, "%s %x\n", rel, sum)
	}
	return hex.EncodeToString(h.Sum(nil))
}

// nodeShim makes <dir>/node, a tiny script that runs the bundled node through the private loader, so the
// backend's own `node` child (found on PATH) also gets the private libraries.
func (b Bundle) nodeShim(dir string) (string, error) {
	loader := b.Loader()
	if loader == "" {
		return "", nil
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	script := fmt.Sprintf("#!/bin/sh\nexec %q --library-path %q %q \"$@\"\n", loader, b.LibDir(), filepath.Join(b.NodeBinDir(), "node"))
	p := filepath.Join(dir, "node")
	if err := os.WriteFile(p, []byte(script), 0o755); err != nil {
		return "", err
	}
	return dir, nil
}
