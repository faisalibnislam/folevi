package logs

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRedact(t *testing.T) {
	r := NewRedactor("s3cr3t-value-123", "abc") // "abc" is too short to redact
	cases := []struct{ in, mustNot, must string }{
		{"key s3cr3t-value-123 used", "s3cr3t-value-123", "[redacted]"},
		{"Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload", "eyJhbGci", "[redacted]"},
		{"authorization: Convex folevi-server|0123abcd", "0123abcd", "[redacted]"},
		{"run --instance-secret deadbeefdeadbeef --port 1", "deadbeef", "--port 1"},
		{`{"password":"hunter22hunter"}`, "hunter22", "[redacted]"},
		{"token=abcdefghijk&x=1", "abcdefghijk", "[redacted]"},
		{"admin folevi-server|" + strings.Repeat("ab", 40), strings.Repeat("ab", 40), "folevi-server|[redacted]"},
		{"-----BEGIN EC PRIVATE KEY-----\nMHcCAQEE\n-----END EC PRIVATE KEY-----", "MHcCAQEE", "[redacted private key]"},
	}
	for _, c := range cases {
		got := r.Redact(c.in)
		if strings.Contains(got, c.mustNot) || !strings.Contains(got, c.must) {
			t.Errorf("Redact(%q) = %q", c.in, got)
		}
	}
	if got := r.Redact("abc is fine"); got != "abc is fine" {
		t.Errorf("short value redacted: %q", got)
	}
	r.Add("later-secret-xyz")
	if strings.Contains(r.Redact("x later-secret-xyz"), "later-secret") {
		t.Error("added secret not redacted")
	}
}

func TestRotatingFile(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "x.log")
	f, err := OpenRotating(p, 100, 3)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 20; i++ {
		fmt.Fprintf(f, "line %02d %s\n", i, strings.Repeat("-", 20))
	}
	f.Close()
	files, _ := filepath.Glob(p + "*")
	if len(files) != 3 {
		t.Fatalf("want 3 files, got %v", files)
	}
	for _, fn := range files {
		st, _ := os.Stat(fn)
		if st.Size() > 100 {
			t.Fatalf("%s is %d bytes", fn, st.Size())
		}
	}
	lines, err := Tail(p, 5, NewRedactor())
	if err != nil {
		t.Fatal(err)
	}
	if len(lines) != 5 || !strings.HasPrefix(lines[4], "line 19") || !strings.HasPrefix(lines[0], "line 15") {
		t.Fatalf("tail: %q", lines)
	}
	// Reaches into rotated files when the live one is short.
	all, _ := Tail(p, 100, NewRedactor())
	if len(all) < 6 {
		t.Fatalf("tail across files: %d", len(all))
	}
}

func TestLineWriter(t *testing.T) {
	var buf bytes.Buffer
	w := &LineWriter{Out: &buf, Redactor: NewRedactor("topsecretvalue"), Prefix: "> "}
	fmt.Fprint(w, "first topsecret")
	fmt.Fprint(w, "value here\nsecond\r\nthird")
	if got := buf.String(); got != "> first [redacted] here\n> second\n" {
		t.Fatalf("got %q", got)
	}
	w.Flush()
	if !strings.HasSuffix(buf.String(), "> third\n") {
		t.Fatalf("flush: %q", buf.String())
	}
}
