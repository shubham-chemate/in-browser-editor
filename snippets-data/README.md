# ⚠️ Snippet storage: managed by the app, don't edit by hand

Everything you save in Snippet Editor lives in this folder:

```
snippets-data/
└── snippets/
    └── <id>.json    one file per snippet: title, language, code, timestamps
```

- **Don't edit, rename or delete files here while the app is running.**
  - The app writes these files itself, so manual changes can be overwritten or leave a snippet unreadable.
  - To change a snippet, use the app at http://code-editor.localhost.
- **These files aren't committed to git.** `.gitignore` excludes everything in this folder except this README, so your snippets never end up on GitHub.
- **Back up** by copying the `snippets/` folder somewhere safe.
- **Restore** by stopping the app (`docker compose stop`), copying the `.json` files back into `snippets/`, then running `docker compose start`.
- **Start fresh** by stopping the app and emptying `snippets/`. The app creates a Welcome snippet on its next start.

The app container mounts this folder at `/data` (see `docker-compose.yml`).
