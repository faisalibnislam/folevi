package mail

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFromHeader(t *testing.T) {
	cases := map[string]string{
		"Smith family":                     `"Folevi Server (Smith family)" <no-reply@folevi.app>`,
		"Evil\" <boss@bank.com>\r\nBcc: x": `"Folevi Server (Evil bossbank.com Bcc x)" <no-reply@folevi.app>`,
		"   ":                              `"Folevi Server" <no-reply@folevi.app>`,
		"folevi server":                    `"Folevi Server" <no-reply@folevi.app>`,
		// The name can't close the brackets to pose as something else, and is cut at 40 characters.
		"Home) Folevi Security (alert":                        `"Folevi Server (Home Folevi Security alert)" <no-reply@folevi.app>`,
		"PayPal Security Team [urgent] 0123456789 0123456789": `"Folevi Server (PayPal Security Team urgent 0123456789 0)" <no-reply@folevi.app>`,
	}
	for in, want := range cases {
		if got := FromHeader(in, "no-reply@folevi.app"); got != want {
			t.Errorf("FromHeader(%q) = %s, want %s", in, got, want)
		}
	}
}

func TestResend(t *testing.T) {
	var got resendBody
	status := 200
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/emails" || r.Header.Get("Authorization") != "Bearer re_test" {
			w.WriteHeader(401)
			return
		}
		_ = json.NewDecoder(r.Body).Decode(&got)
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"id":"re-123"}`))
	}))
	defer srv.Close()
	r := NewResend("re_test")
	r.BaseURL = srv.URL
	id, err := r.Send(context.Background(), Message{From: `"A" <no-reply@folevi.app>`, To: "x@example.com", Subject: "S", Text: "T", ReplyTo: "o@example.com", Tag: "invite"})
	if err != nil || id != "re-123" || got.To[0] != "x@example.com" || got.ReplyTo != "o@example.com" || got.Tags[0].Value != "invite" {
		t.Fatalf("%q %v %+v", id, err, got)
	}
	status = 429
	if _, err := r.Send(context.Background(), Message{To: "x@example.com"}); !errors.Is(err, ErrBusy) {
		t.Fatalf("want ErrBusy, got %v", err)
	}
	status = 422
	if _, err := r.Send(context.Background(), Message{To: "x@example.com"}); err == nil || errors.Is(err, ErrBusy) {
		t.Fatalf("want refusal, got %v", err)
	}
}
