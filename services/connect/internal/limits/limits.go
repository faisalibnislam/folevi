// Package limits has the in-memory rate limiters: fixed windows per key. They reset on restart, which is fine
// for burst control; daily and monthly caps that must survive a restart live in the store's usage counters.
package limits

import (
	"sync"
	"time"
)

// Window allows Limit events per key in each Period.
type Window struct {
	Limit  int
	Period time.Duration
	Now    func() time.Time

	mu      sync.Mutex
	buckets map[string]*bucket
	sweep   time.Time
}

type bucket struct {
	start time.Time
	n     int
}

func NewWindow(limit int, period time.Duration) *Window {
	return &Window{Limit: limit, Period: period, Now: time.Now, buckets: map[string]*bucket{}}
}

// Allow counts one event for key and reports whether it is within the limit. A Limit of 0 or less allows all.
func (w *Window) Allow(key string) bool {
	if w.Limit <= 0 {
		return true
	}
	now := w.Now()
	w.mu.Lock()
	defer w.mu.Unlock()
	if now.Sub(w.sweep) > w.Period {
		for k, b := range w.buckets {
			if now.Sub(b.start) >= w.Period {
				delete(w.buckets, k)
			}
		}
		w.sweep = now
	}
	b, ok := w.buckets[key]
	if !ok || now.Sub(b.start) >= w.Period {
		b = &bucket{start: now}
		w.buckets[key] = b
	}
	if b.n >= w.Limit {
		return false
	}
	b.n++
	return true
}

// Counter counts concurrent things per key (open relay streams, for example).
type Counter struct {
	mu sync.Mutex
	m  map[string]int
}

func NewCounter() *Counter { return &Counter{m: map[string]int{}} }

// Acquire adds one for key if it stays at or under max, and reports whether it did.
func (c *Counter) Acquire(key string, max int) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if max > 0 && c.m[key] >= max {
		return false
	}
	c.m[key]++
	return true
}

func (c *Counter) Release(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.m[key] <= 1 {
		delete(c.m, key)
		return
	}
	c.m[key]--
}

func (c *Counter) Get(key string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.m[key]
}
