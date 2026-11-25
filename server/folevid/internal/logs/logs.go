// Package logs writes folevid's and the children's logs to rotated files with secrets redacted.
package logs

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
)

const (
	DefaultMaxBytes = 10 << 20 // 10 MB per file
	DefaultFiles    = 5        // the live file plus 4 older ones
)

// Redactor replaces known secret values and secret-looking patterns with [redacted].
type Redactor struct {
	mu     sync.RWMutex
	values []string
}

var patterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)(authorization:\s*(?:bearer|convex|basic)\s+)\S+`),
	regexp.MustCompile(`(?i)(\bbearer\s+)[A-Za-z0-9._~+/=-]{8,}`),
	regexp.MustCompile(`(?i)(--instance-secret[= ])\S+`),
	regexp.MustCompile(`(?i)((?:secret|token|password|api[_-]?key|admin[_-]?key|private[_-]?key)"?\s*[:=]\s*"?)[^\s",}]{6,}`),
	// Convex admin keys look like "<instance-name>|<hex>".
	regexp.MustCompile(`([a-z0-9-]+\|)[0-9a-f]{40,}`),
	regexp.MustCompile(`-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----`),
}

// NewRedactor returns a redactor for these secret values.
func NewRedactor(values ...string) *Redactor {
	r := &Redactor{}
	r.Set(values)
	return r
}

// Set replaces the list of secret values. Values shorter than 6 characters are ignored (too many false hits).
func (r *Redactor) Set(values []string) {
	var vs []string
	for _, v := range values {
		v = strings.TrimSpace(v)
		if len(v) >= 6 {
			vs = append(vs, v)
		}
	}
	// Longest first, so a secret that contains another is replaced whole.
	sort.Slice(vs, func(i, j int) bool { return len(vs[i]) > len(vs[j]) })
	r.mu.Lock()
	r.values = vs
	r.mu.Unlock()
}

// Add appends secret values.
func (r *Redactor) Add(values ...string) {
	r.mu.RLock()
	all := append(append([]string(nil), r.values...), values...)
	r.mu.RUnlock()
	r.Set(all)
}

// Redact returns s with secrets replaced.
func (r *Redactor) Redact(s string) string {
	if r == nil {
		return s
	}
	r.mu.RLock()
	for _, v := range r.values {
		if strings.Contains(s, v) {
			s = strings.ReplaceAll(s, v, "[redacted]")
		}
	}
	r.mu.RUnlock()
	for i, p := range patterns {
		if i == len(patterns)-1 {
			s = p.ReplaceAllString(s, "[redacted private key]")
			continue
		}
		s = p.ReplaceAllString(s, "${1}[redacted]")
	}
	return s
}

// RotatingFile is an io.Writer that rotates at MaxBytes, keeping Files files (name, name.1 ... name.N-1).
type RotatingFile struct {
	Path     string
	MaxBytes int64
	Files    int

	mu   sync.Mutex
	f    *os.File
	size int64
}

// OpenRotating opens (or creates) a rotating log file.
func OpenRotating(path string, maxBytes int64, files int) (*RotatingFile, error) {
	if maxBytes <= 0 {
		maxBytes = DefaultMaxBytes
	}
	if files <= 0 {
		files = DefaultFiles
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return nil, err
	}
	r := &RotatingFile{Path: path, MaxBytes: maxBytes, Files: files}
	if err := r.open(); err != nil {
		return nil, err
	}
	return r, nil
}

func (r *RotatingFile) open() error {
	f, err := os.OpenFile(r.Path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o640)
	if err != nil {
		return err
	}
	st, err := f.Stat()
	if err != nil {
		f.Close()
		return err
	}
	r.f, r.size = f, st.Size()
	return nil
}

func (r *RotatingFile) rotate() error {
	if r.f != nil {
		r.f.Close()
		r.f = nil
	}
	_ = os.Remove(fmt.Sprintf("%s.%d", r.Path, r.Files-1))
	for i := r.Files - 2; i >= 1; i-- {
		_ = os.Rename(fmt.Sprintf("%s.%d", r.Path, i), fmt.Sprintf("%s.%d", r.Path, i+1))
	}
	if r.Files > 1 {
		_ = os.Rename(r.Path, r.Path+".1")
	} else {
		_ = os.Remove(r.Path)
	}
	return r.open()
}

// Write writes p, rotating first when it would pass MaxBytes.
func (r *RotatingFile) Write(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.f == nil {
		if err := r.open(); err != nil {
			return 0, err
		}
	}
	if r.size > 0 && r.size+int64(len(p)) > r.MaxBytes {
		if err := r.rotate(); err != nil {
			return 0, err
		}
	}
	n, err := r.f.Write(p)
	r.size += int64(n)
	return n, err
}

// Close closes the file.
func (r *RotatingFile) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.f == nil {
		return nil
	}
	err := r.f.Close()
	r.f = nil
	return err
}

// LineWriter splits what a child process writes into lines, redacts each one and writes it to Out.
type LineWriter struct {
	Out      io.Writer
	Redactor *Redactor
	Prefix   string

	mu  sync.Mutex
	buf []byte
}

const maxLine = 64 << 10

// Write implements io.Writer.
func (w *LineWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.buf = append(w.buf, p...)
	for {
		i := bytes.IndexByte(w.buf, '\n')
		if i < 0 {
			if len(w.buf) > maxLine {
				w.emit(w.buf)
				w.buf = w.buf[:0]
			}
			break
		}
		w.emit(w.buf[:i])
		w.buf = w.buf[i+1:]
	}
	return len(p), nil
}

// Flush writes a pending partial line.
func (w *LineWriter) Flush() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if len(w.buf) > 0 {
		w.emit(w.buf)
		w.buf = w.buf[:0]
	}
}

func (w *LineWriter) emit(line []byte) {
	s := strings.TrimRight(string(line), "\r")
	_, _ = io.WriteString(w.Out, w.Prefix+w.Redactor.Redact(s)+"\n")
}

// Tail returns up to n last lines of the log at path, reading older rotated files when the live one is short.
// Lines are redacted again on the way out, in case a secret was added after they were written.
func Tail(path string, n int, red *Redactor) ([]string, error) {
	if n <= 0 {
		return []string{}, nil
	}
	var lines []string
	files := []string{path}
	for i := 1; i < 10; i++ {
		files = append(files, fmt.Sprintf("%s.%d", path, i))
	}
	for _, f := range files {
		ls, err := readLines(f)
		if err != nil {
			if os.IsNotExist(err) {
				break
			}
			return nil, err
		}
		lines = append(ls, lines...)
		if len(lines) >= n {
			break
		}
	}
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	out := make([]string, len(lines))
	for i, l := range lines {
		out[i] = red.Redact(l)
	}
	return out, nil
}

func readLines(path string) ([]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var out []string
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 64<<10), maxLine*2)
	for sc.Scan() {
		out = append(out, sc.Text())
	}
	return out, sc.Err()
}
