// fakebackend stands in for convex-backend in folevid's integration test. It answers keygen, serves /version,
// the env-var admin API and a JWKS, and writes its arguments and environment to $FAKE_BACKEND_RECORD.
package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
)

func main() {
	args := os.Args[1:]
	if len(args) > 0 && args[0] == "keygen" {
		fmt.Println("folevi-server|" + strings.Repeat("ab", 40))
		return
	}
	flag := func(name string) string {
		for i, a := range args {
			if a == name && i+1 < len(args) {
				return args[i+1]
			}
		}
		return ""
	}
	if rec := os.Getenv("FAKE_BACKEND_RECORD"); rec != "" {
		b, _ := json.Marshal(map[string]any{"args": args, "env": os.Environ()})
		_ = os.WriteFile(rec, b, 0o600)
	}
	adminKey := "Convex folevi-server|" + strings.Repeat("ab", 40)
	var mu sync.Mutex
	env := map[string]string{}
	if b, err := os.ReadFile("fake-env.json"); err == nil {
		_ = json.Unmarshal(b, &env)
	}
	save := func() { b, _ := json.Marshal(env); _ = os.WriteFile("fake-env.json", b, 0o600) }

	api := http.NewServeMux()
	api.HandleFunc("/version", func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "fake") })
	api.HandleFunc("/api/update_environment_variables", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != adminKey {
			http.Error(w, "bad admin key", 401)
			return
		}
		var body struct {
			Changes []struct {
				Name  string  `json:"name"`
				Value *string `json:"value"`
			} `json:"changes"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		mu.Lock()
		for _, c := range body.Changes {
			if c.Value == nil {
				delete(env, c.Name)
			} else {
				env[c.Name] = *c.Value
			}
		}
		save()
		mu.Unlock()
		fmt.Fprint(w, "{}")
	})
	api.HandleFunc("/api/query", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != adminKey {
			http.Error(w, "bad admin key", 401)
			return
		}
		var body struct {
			Args struct {
				Name string `json:"name"`
			} `json:"args"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		mu.Lock()
		v, ok := env[body.Args.Name]
		mu.Unlock()
		if !ok {
			fmt.Fprint(w, `{"status":"success","value":null}`)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "success", "value": map[string]string{"name": body.Args.Name, "value": v}})
	})
	site := http.NewServeMux()
	site.HandleFunc("/api/auth/convex/jwks", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{ "keys": [ {"kty":"RSA","kid":"k1","n":"abc","e":"AQAB"} ] }`)
	})
	go func() { _ = http.ListenAndServe("127.0.0.1:"+flag("--port"), api) }()
	go func() { _ = http.ListenAndServe("127.0.0.1:"+flag("--site-proxy-port"), site) }()
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)
	<-sig
}
