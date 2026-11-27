package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// Snippet is one saved piece of code.
type Snippet struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Language  string    `json:"language"`
	Code      string    `json:"code"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// SnippetMeta is what the sidebar list needs (no code body).
type SnippetMeta struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Language  string    `json:"language"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// SnippetInput holds the fields a client may set. Nil means "leave unchanged".
type SnippetInput struct {
	Title    *string `json:"title"`
	Language *string `json:"language"`
	Code     *string `json:"code"`
}

var (
	ErrNotFound  = errors.New("snippet not found")
	ErrInvalidID = errors.New("invalid snippet id")
	validID      = regexp.MustCompile(`^[a-f0-9]{1,64}$`)
)

const (
	maxTitleLen    = 200
	maxLanguageLen = 64
)

// Store keeps one JSON file per snippet inside dir.
type Store struct {
	dir string
	mu  sync.RWMutex
	now func() time.Time
}

func NewStore(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}
	return &Store{dir: dir, now: func() time.Time { return time.Now().UTC() }}, nil
}

func (s *Store) path(id string) (string, error) {
	if !validID.MatchString(id) {
		return "", ErrInvalidID
	}
	return filepath.Join(s.dir, id+".json"), nil
}

func newID() (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// truncate cuts s to at most n characters without splitting a UTF-8 rune.
func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}

func clean(in SnippetInput, sn *Snippet) {
	if in.Title != nil {
		sn.Title = truncate(strings.TrimSpace(*in.Title), maxTitleLen)
	}
	if in.Language != nil {
		sn.Language = truncate(strings.TrimSpace(*in.Language), maxLanguageLen)
	}
	if in.Code != nil {
		sn.Code = *in.Code
	}
	if sn.Title == "" {
		sn.Title = "Untitled"
	}
}

func (s *Store) Create(in SnippetInput) (*Snippet, error) {
	id, err := newID()
	if err != nil {
		return nil, err
	}
	now := s.now()
	sn := &Snippet{ID: id, Language: "Python", CreatedAt: now, UpdatedAt: now}
	clean(in, sn)

	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.write(sn); err != nil {
		return nil, err
	}
	return sn, nil
}

func (s *Store) Get(id string) (*Snippet, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.read(id)
}

func (s *Store) Update(id string, in SnippetInput) (*Snippet, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sn, err := s.read(id)
	if err != nil {
		return nil, err
	}
	clean(in, sn)
	sn.UpdatedAt = s.now()
	if err := s.write(sn); err != nil {
		return nil, err
	}
	return sn, nil
}

func (s *Store) Delete(id string) error {
	p, err := s.path(id)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.Remove(p); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return ErrNotFound
		}
		return err
	}
	return nil
}

// List returns metadata for all snippets, most recently updated first.
func (s *Store) List() ([]SnippetMeta, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, err
	}
	out := []SnippetMeta{}
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".json") {
			continue
		}
		sn, err := s.read(strings.TrimSuffix(name, ".json"))
		if err != nil {
			continue // skip stray or corrupt files rather than failing the whole list
		}
		out = append(out, SnippetMeta{ID: sn.ID, Title: sn.Title, Language: sn.Language, UpdatedAt: sn.UpdatedAt})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	return out, nil
}

// read and write assume the caller holds the lock.

func (s *Store) read(id string) (*Snippet, error) {
	p, err := s.path(id)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(p)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	var sn Snippet
	if err := json.Unmarshal(data, &sn); err != nil {
		return nil, fmt.Errorf("decode %s: %w", id, err)
	}
	return &sn, nil
}

func (s *Store) write(sn *Snippet) error {
	p, err := s.path(sn.ID)
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(sn, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(s.dir, ".tmp-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name()) // no-op after a successful rename
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), p)
}
