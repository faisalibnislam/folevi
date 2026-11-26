// Package ai is Folevi AI for servers: an OpenAI-compatible gateway (chat completions and embeddings, streaming
// passed through as it arrives) in front of Gemini's OpenAI-compatible endpoint, with Folevi's key. Tokens are
// counted per month against the owner's account (every server linked to one account shares one allowance; a
// server with no owner has its own) and checked against a limit that, later, comes from the owner's plan.
// Prompts and answers are never logged or stored.
package ai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"
)

// Usage is where tokens are counted (the store implements it).
type Usage interface {
	AddUsage(ctx context.Context, serverID, kind, period string, n int64) (int64, error)
	GetUsage(ctx context.Context, serverID, kind, period string) (int64, error)
}

// UsageKind is the monthly token counter.
const UsageKind = "ai_tokens"

// DefaultUpstreamTimeout bounds one upstream request, including reading the rest of an answer for its usage
// after the client has gone.
const DefaultUpstreamTimeout = 5 * time.Minute

// UsageKey is the key tokens are counted under: the owner's account when the server is linked, so registering
// more servers does not buy more allowance, else the server itself.
func UsageKey(serverID, owner string) string {
	if owner != "" {
		return "owner:" + owner
	}
	return serverID
}

// Limits says how many tokens a server may use this month. It is the hook for the owner's plan (entitlements from
// Folevi Cloud); a negative answer means no limit.
type Limits interface {
	MonthlyTokens(ctx context.Context, serverID, ownerAccount string) (int64, error)
}

// StaticLimits gives every server the same monthly budget.
type StaticLimits struct{ Tokens int64 }

func (s StaticLimits) MonthlyTokens(context.Context, string, string) (int64, error) {
	return s.Tokens, nil
}

// Gateway forwards requests upstream.
type Gateway struct {
	BaseURL         string // "https://generativelanguage.googleapis.com/v1beta/openai/"
	APIKey          string // never logged
	ChatModel       string
	EmbeddingModel  string
	AllowedModels   map[string]bool // models a server may ask for by name; others get the default
	Client          *http.Client
	Usage           Usage
	Limits          Limits
	MaxRequestBytes int64
	// UpstreamTimeout bounds one upstream request (DefaultUpstreamTimeout when zero).
	UpstreamTimeout time.Duration
	Now             func() time.Time
}

// Kind is which endpoint a request is for.
type Kind string

const (
	Chat       Kind = "chat/completions"
	Embeddings Kind = "embeddings"
)

func writeError(w http.ResponseWriter, status int, typ, code, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"message": msg, "type": typ, "code": code}})
}

func month(t time.Time) string { return t.UTC().Format("2006-01") }

// Handle serves one request for serverID (already authenticated).
func (g *Gateway) Handle(w http.ResponseWriter, r *http.Request, kind Kind, serverID, owner string) {
	if g.APIKey == "" {
		writeError(w, http.StatusServiceUnavailable, "server_error", "ai_unavailable", "Folevi AI is not available right now.")
		return
	}
	now := time.Now()
	if g.Now != nil {
		now = g.Now()
	}
	limit, err := g.Limits.MonthlyTokens(r.Context(), serverID, owner)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "server_error", "limits_unavailable", "Folevi AI could not check this server's plan.")
		return
	}
	account := UsageKey(serverID, owner)
	if limit >= 0 {
		used, err := g.Usage.GetUsage(r.Context(), account, UsageKind, month(now))
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, "server_error", "usage_unavailable", "Folevi AI could not check usage.")
			return
		}
		if used >= limit {
			writeError(w, http.StatusTooManyRequests, "insufficient_quota", "monthly_limit", "This server has used this month's Folevi AI allowance.")
			return
		}
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, g.MaxRequestBytes))
	if err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, "invalid_request_error", "too_large", "The request is too large.")
		return
	}
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil || body == nil {
		writeError(w, http.StatusBadRequest, "invalid_request_error", "invalid_json", "The request is not a JSON object.")
		return
	}
	def := g.ChatModel
	if kind == Embeddings {
		def = g.EmbeddingModel
	}
	if m, _ := body["model"].(string); m == "" || !g.AllowedModels[m] {
		body["model"] = def
	}
	stream := false
	if kind == Chat {
		stream, _ = body["stream"].(bool)
		if stream {
			opts, _ := body["stream_options"].(map[string]any)
			if opts == nil {
				opts = map[string]any{}
			}
			opts["include_usage"] = true // so the stream ends with a usage chunk to count
			body["stream_options"] = opts
		}
	}
	out, err := json.Marshal(body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request_error", "invalid_json", "The request could not be read.")
		return
	}
	// The upstream request does not end when the client goes away: a client that hangs up before the usage
	// chunk would otherwise use Folevi's key without being counted. It has its own time limit instead.
	timeout := g.UpstreamTimeout
	if timeout <= 0 {
		timeout = DefaultUpstreamTimeout
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(g.BaseURL, "/")+"/"+string(kind), bytes.NewReader(out))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "request", "Folevi AI could not make the request.")
		return
	}
	req.Header.Set("Authorization", "Bearer "+g.APIKey)
	req.Header.Set("Content-Type", "application/json")
	if stream {
		req.Header.Set("Accept", "text/event-stream")
	}
	res, err := g.Client.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, "server_error", "upstream_unreachable", "Folevi AI is not reachable right now.")
		return
	}
	defer res.Body.Close()

	var tokens int64
	if stream && res.StatusCode == http.StatusOK && strings.HasPrefix(res.Header.Get("Content-Type"), "text/event-stream") {
		var streamed int64
		tokens, streamed = g.passStream(w, res)
		if tokens == 0 {
			// No usage chunk (the upstream broke off or left it out): estimate from what went both ways.
			tokens = estimateTokens(int64(len(raw)) + streamed)
		}
	} else {
		data, err := io.ReadAll(io.LimitReader(res.Body, 64<<20))
		if err != nil {
			writeError(w, http.StatusBadGateway, "server_error", "upstream_read", "Folevi AI's answer was cut off.")
			return
		}
		ct := res.Header.Get("Content-Type")
		if ct == "" {
			ct = "application/json"
		}
		w.Header().Set("Content-Type", ct)
		w.WriteHeader(res.StatusCode)
		_, _ = w.Write(data)
		if res.StatusCode == http.StatusOK {
			tokens = usageTokens(data)
			if tokens == 0 {
				tokens = estimateTokens(int64(len(raw)) + int64(len(data))) // no usage reported: estimate from the sizes
			}
		}
	}
	if tokens > 0 {
		// Counted even if the client went away: the upstream work was done.
		_, _ = g.Usage.AddUsage(context.WithoutCancel(r.Context()), account, UsageKind, month(now), tokens)
	}
}

// estimateTokens is the count used when the upstream reported no usage: about one token per four bytes.
func estimateTokens(bytes int64) int64 { return bytes/4 + 1 }

// passStream copies server-sent events line by line, flushing at each event, and returns the tokens the last
// usage chunk reported and the bytes the upstream sent. When the client goes away it stops writing but keeps
// reading to the end of the answer, so the usage chunk (the last one) is still counted.
func (g *Gateway) passStream(w http.ResponseWriter, res *http.Response) (tokens, streamed int64) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher, _ := w.(http.Flusher)
	rc := http.NewResponseController(w)
	br := bufio.NewReaderSize(res.Body, 64<<10)
	gone := false
	for {
		line, err := br.ReadBytes('\n')
		if len(line) > 0 {
			streamed += int64(len(line))
			if payload, ok := bytes.CutPrefix(bytes.TrimRight(line, "\r\n"), []byte("data:")); ok {
				if t := usageTokens(bytes.TrimSpace(payload)); t > 0 {
					tokens = t
				}
			}
			if !gone {
				if _, werr := w.Write(line); werr != nil {
					gone = true
				} else if len(bytes.TrimSpace(line)) == 0 {
					if flusher != nil {
						flusher.Flush()
					} else {
						_ = rc.Flush()
					}
				}
			}
		}
		if err != nil {
			if flusher != nil && !gone {
				flusher.Flush()
			}
			return tokens, streamed // io.EOF, the upstream broke off mid-stream, or the time limit
		}
	}
}

func usageTokens(data []byte) int64 {
	var b struct {
		Usage *struct {
			TotalTokens  int64 `json:"total_tokens"`
			PromptTokens int64 `json:"prompt_tokens"`
		} `json:"usage"`
	}
	if json.Unmarshal(data, &b) != nil || b.Usage == nil {
		return 0
	}
	if b.Usage.TotalTokens > 0 {
		return b.Usage.TotalTokens
	}
	return b.Usage.PromptTokens
}
