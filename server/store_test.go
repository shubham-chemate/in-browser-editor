package main

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func ptr(s string) *string { return &s }

func newTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestCRUD(t *testing.T) {
	s := newTestStore(t)

	sn, err := s.Create(SnippetInput{Title: ptr("  hello  "), Language: ptr("go"), Code: ptr("package main")})
	if err != nil {
		t.Fatal(err)
	}
	if sn.Title != "hello" || sn.Language != "go" || sn.Code != "package main" {
		t.Fatalf("unexpected snippet: %+v", sn)
	}

	got, err := s.Get(sn.ID)
	if err != nil || got.Code != "package main" {
		t.Fatalf("get: %v %+v", err, got)
	}

	upd, err := s.Update(sn.ID, SnippetInput{Code: ptr("package x")})
	if err != nil {
		t.Fatal(err)
	}
	if upd.Code != "package x" || upd.Title != "hello" || upd.Language != "go" {
		t.Fatalf("partial update clobbered fields: %+v", upd)
	}

	if err := s.Delete(sn.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get(sn.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound after delete, got %v", err)
	}
	if err := s.Delete(sn.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound deleting twice, got %v", err)
	}
}

func TestDefaults(t *testing.T) {
	s := newTestStore(t)
	sn, err := s.Create(SnippetInput{})
	if err != nil {
		t.Fatal(err)
	}
	if sn.Title != "Untitled" || sn.Language != "Python" {
		t.Fatalf("unexpected defaults: %+v", sn)
	}
	sn, _ = s.Update(sn.ID, SnippetInput{Title: ptr("   ")})
	if sn.Title != "Untitled" {
		t.Fatalf("blank title should fall back to Untitled, got %q", sn.Title)
	}
}

func TestTitleTruncationKeepsRunesIntact(t *testing.T) {
	s := newTestStore(t)
	sn, err := s.Create(SnippetInput{Title: ptr(strings.Repeat("é", 500))})
	if err != nil {
		t.Fatal(err)
	}
	if n := len([]rune(sn.Title)); n != maxTitleLen {
		t.Fatalf("title has %d runes, want %d", n, maxTitleLen)
	}
}

func TestListSortedAndSkipsJunk(t *testing.T) {
	s := newTestStore(t)
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	tick := 0
	s.now = func() time.Time { tick++; return base.Add(time.Duration(tick) * time.Minute) }

	a, _ := s.Create(SnippetInput{Title: ptr("a")})
	b, _ := s.Create(SnippetInput{Title: ptr("b")})
	s.Update(a.ID, SnippetInput{Code: ptr("touched")}) // a is now newest

	os.WriteFile(filepath.Join(s.dir, "deadbeef.json"), []byte("{not json"), 0o644)
	os.WriteFile(filepath.Join(s.dir, "notes.txt"), []byte("hi"), 0o644)

	list, err := s.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 || list[0].ID != a.ID || list[1].ID != b.ID {
		t.Fatalf("unexpected list order/content: %+v", list)
	}
}

func TestInvalidIDs(t *testing.T) {
	s := newTestStore(t)
	for _, id := range []string{"", "../etc/passwd", "ABC", "abc/def", "abc.json", strings.Repeat("a", 65)} {
		if _, err := s.Get(id); !errors.Is(err, ErrInvalidID) {
			t.Errorf("Get(%q): expected ErrInvalidID, got %v", id, err)
		}
		if err := s.Delete(id); !errors.Is(err, ErrInvalidID) {
			t.Errorf("Delete(%q): expected ErrInvalidID, got %v", id, err)
		}
	}
}

func TestAPI(t *testing.T) {
	s := newTestStore(t)
	srv := httptest.NewServer(newMux(s, t.TempDir()))
	defer srv.Close()

	do := func(method, path, body string) int {
		req, _ := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}

	sn, _ := s.Create(SnippetInput{Title: ptr("x")})
	cases := []struct {
		method, path, body string
		want               int
	}{
		{"GET", "/healthz", "", 200},
		{"GET", "/api/snippets", "", 200},
		{"POST", "/api/snippets", `{"title":"new","language":"json","code":"{}"}`, 201},
		{"POST", "/api/snippets", `{bad`, 400},
		{"GET", "/api/snippets/" + sn.ID, "", 200},
		{"GET", "/api/snippets/ffffffff", "", 404},
		{"GET", "/api/snippets/NOT-VALID", "", 400},
		{"PUT", "/api/snippets/" + sn.ID, `{"code":"print(1)"}`, 200},
		{"PUT", "/api/snippets/" + sn.ID, `{"code":"` + strings.Repeat("a", maxBodyBytes) + `"}`, 413},
		{"DELETE", "/api/snippets/" + sn.ID, "", 204},
		{"DELETE", "/api/snippets/" + sn.ID, "", 404},
	}
	for _, c := range cases {
		if got := do(c.method, c.path, c.body); got != c.want {
			t.Errorf("%s %s: got %d, want %d", c.method, c.path, got, c.want)
		}
	}
}
