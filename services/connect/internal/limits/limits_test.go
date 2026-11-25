package limits

import (
	"testing"
	"time"
)

func TestWindow(t *testing.T) {
	now := time.Unix(0, 0)
	w := NewWindow(2, time.Minute)
	w.Now = func() time.Time { return now }
	if !w.Allow("a") || !w.Allow("a") || w.Allow("a") {
		t.Fatal("limit of 2 not enforced")
	}
	if !w.Allow("b") {
		t.Fatal("keys are separate")
	}
	now = now.Add(time.Minute)
	if !w.Allow("a") {
		t.Fatal("window did not reset")
	}
}

func TestCounter(t *testing.T) {
	c := NewCounter()
	if !c.Acquire("s", 1) || c.Acquire("s", 1) {
		t.Fatal("max not enforced")
	}
	c.Release("s")
	if c.Get("s") != 0 || !c.Acquire("s", 1) {
		t.Fatal("release")
	}
}
