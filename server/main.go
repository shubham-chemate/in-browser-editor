// Command server serves the snippet editor frontend and a small JSON API
// that stores snippets as files on disk.
package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

const maxBodyBytes = 1 << 20 // 1 MB per request

func main() {
	addr := env("ADDR", ":8080")

	// Tiny built-in health check so the distroless image (no shell, no curl)
	// can still be probed by Docker.
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		resp, err := http.Get("http://127.0.0.1" + addr + "/healthz")
		if err != nil || resp.StatusCode != http.StatusOK {
			os.Exit(1)
		}
		os.Exit(0)
	}

	store, err := NewStore(filepath.Join(env("DATA_DIR", "./data"), "snippets"))
	if err != nil {
		log.Fatal(err)
	}

	srv := &http.Server{
		Addr:              addr,
		Handler:           logRequests(newMux(store, env("STATIC_DIR", "./static"))),
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Printf("snippet editor listening on %s", addr)
	log.Fatal(srv.ListenAndServe())
}

func newMux(store *Store, staticDir string) *http.ServeMux {
	mux := http.NewServeMux()
	api := &api{store: store}

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok")) })
	mux.HandleFunc("GET /api/snippets", api.list)
	mux.HandleFunc("POST /api/snippets", api.create)
	mux.HandleFunc("GET /api/snippets/{id}", api.get)
	mux.HandleFunc("PUT /api/snippets/{id}", api.update)
	mux.HandleFunc("DELETE /api/snippets/{id}", api.remove)
	mux.Handle("/", http.FileServer(http.Dir(staticDir)))
	return mux
}

type api struct{ store *Store }

func (a *api) list(w http.ResponseWriter, r *http.Request) {
	items, err := a.store.List()
	respond(w, items, err)
}

func (a *api) get(w http.ResponseWriter, r *http.Request) {
	sn, err := a.store.Get(r.PathValue("id"))
	respond(w, sn, err)
}

func (a *api) create(w http.ResponseWriter, r *http.Request) {
	in, ok := decode(w, r)
	if !ok {
		return
	}
	sn, err := a.store.Create(in)
	if err == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(sn)
		return
	}
	respond(w, nil, err)
}

func (a *api) update(w http.ResponseWriter, r *http.Request) {
	in, ok := decode(w, r)
	if !ok {
		return
	}
	sn, err := a.store.Update(r.PathValue("id"), in)
	respond(w, sn, err)
}

func (a *api) remove(w http.ResponseWriter, r *http.Request) {
	if err := a.store.Delete(r.PathValue("id")); err != nil {
		respond(w, nil, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func decode(w http.ResponseWriter, r *http.Request) (SnippetInput, bool) {
	var in SnippetInput
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			httpError(w, http.StatusRequestEntityTooLarge, "snippet is larger than 1 MB")
		} else {
			httpError(w, http.StatusBadRequest, "invalid JSON body")
		}
		return in, false
	}
	return in, true
}

func respond(w http.ResponseWriter, v any, err error) {
	switch {
	case errors.Is(err, ErrInvalidID):
		httpError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, ErrNotFound):
		httpError(w, http.StatusNotFound, err.Error())
	case err != nil:
		log.Printf("error: %v", err)
		httpError(w, http.StatusInternalServerError, "internal error")
	default:
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(v)
	}
}

func httpError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		if r.URL.Path != "/healthz" {
			log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start).Round(time.Microsecond))
		}
	})
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
