package ai

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type memUsage struct {
	mu sync.Mutex
	m  map[string]int64
}

func (u *memUsage) AddUsage(_ context.Context, id, kind, period string, n int64) (int64, error) {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.m[id+"|"+kind] += n
	return u.m[id+"|"+kind], nil
}

func (u *memUsage) GetUsage(_ context.Context, id, kind, period string) (int64, error) {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.m[id+"|"+kind], nil
}

func TestStreamingPassthroughAndMetering(t *testing.T) {
	gate := make(chan struct{})
	var gotBody map[string]any
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer folevi-gemini-key" {
			w.WriteHeader(401)
			return
		}
		b, _ := io.ReadAll(r.Body)
		gotBody = nil
		_ = json.Unmarshal(b, &gotBody)
		switch r.URL.Path {
		case "/openai/chat/completions":
			if gotBody["stream"] != true {
				_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"hi"}}],"usage":{"prompt_tokens":3,"completion_tokens":4,"total_tokens":7}}`))
				return
			}
			w.Header().Set("Content-Type", "text/event-stream")
			fl := w.(http.Flusher)
			fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n")
			fl.Flush()
			<-gate // the client must see the first chunk before the rest is even produced
			fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\n")
			fmt.Fprint(w, "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":5,\"total_tokens\":15}}\n\n")
			fmt.Fprint(w, "data: [DONE]\n\n")
		case "/openai/embeddings":
			_, _ = w.Write([]byte(`{"data":[{"embedding":[0.1,0.2]}],"usage":{"prompt_tokens":9,"total_tokens":9}}`))
		}
	}))
	defer upstream.Close()
	usage := &memUsage{m: map[string]int64{}}
	g := &Gateway{BaseURL: upstream.URL + "/openai/", APIKey: "folevi-gemini-key", ChatModel: "gemini-default", EmbeddingModel: "embed-default",
		AllowedModels: map[string]bool{"gemini-lite": true}, Client: upstream.Client(), Usage: usage, Limits: StaticLimits{Tokens: 100}, MaxRequestBytes: 1 << 20}
	front := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		kind := Chat
		if strings.HasSuffix(r.URL.Path, "embeddings") {
			kind = Embeddings
		}
		g.Handle(w, r, kind, "srv1", "owner1")
	}))
	defer front.Close()

	req, _ := http.NewRequest("POST", front.URL+"/chat", strings.NewReader(`{"model":"gpt-4o","stream":true,"messages":[{"role":"user","content":"hello"}]}`))
	req.Header.Set("Authorization", "Bearer client-should-not-pass")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.Header.Get("Content-Type") != "text/event-stream" {
		t.Fatalf("content type %q", res.Header.Get("Content-Type"))
	}
	br := bufio.NewReader(res.Body)
	first, _ := br.ReadString('\n')
	if !strings.Contains(first, "Hel") {
		t.Fatalf("first line %q", first)
	}
	close(gate)
	rest, _ := io.ReadAll(br)
	res.Body.Close()
	if !strings.Contains(string(rest), `"lo"`) || !strings.Contains(string(rest), "[DONE]") {
		t.Fatalf("rest %q", rest)
	}
	if gotBody["model"] != "gemini-default" {
		t.Fatalf("model not replaced: %v", gotBody["model"])
	}
	if so, _ := gotBody["stream_options"].(map[string]any); so["include_usage"] != true {
		t.Fatal("include_usage not requested")
	}
	time.Sleep(50 * time.Millisecond)
	if n, _ := usage.GetUsage(context.Background(), "srv1", UsageKind, ""); n != 15 {
		t.Fatalf("usage %d, want 15", n)
	}

	res, _ = http.Post(front.URL+"/chat", "application/json", strings.NewReader(`{"model":"gemini-lite","messages":[]}`))
	b, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 200 || !strings.Contains(string(b), `"hi"`) || gotBody["model"] != "gemini-lite" {
		t.Fatalf("non-stream %d %s %v", res.StatusCode, b, gotBody["model"])
	}
	res, _ = http.Post(front.URL+"/embeddings", "application/json", strings.NewReader(`{"input":"abc"}`))
	res.Body.Close()
	if n, _ := usage.GetUsage(context.Background(), "srv1", UsageKind, ""); n != 31 || gotBody["model"] != "embed-default" {
		t.Fatalf("usage %d model %v", n, gotBody["model"])
	}

	// Over the limit: refused before reaching upstream, in OpenAI's error shape.
	usage.AddUsage(context.Background(), "srv1", UsageKind, "", 100)
	res, _ = http.Post(front.URL+"/chat", "application/json", strings.NewReader(`{"messages":[]}`))
	b, _ = io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 429 || !strings.Contains(string(b), "monthly_limit") {
		t.Fatalf("limit %d %s", res.StatusCode, b)
	}
}
