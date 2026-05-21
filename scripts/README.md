# PhD draft encryption

This folder holds the small Node script that turns plaintext PhD draft
pages into AES-256-GCM ciphertext blobs that the public site can serve
without exposing the content.

## The big picture

| Where | What lives there |
|---|---|
| `~/phd_drafts/<slug>/index.html` (+ `figures/`) | **Plaintext drafts. Local only. Never committed.** |
| `scripts/encrypt-drafts.js` | The encryption pipeline (committed). |
| `assets/private/<slug>.enc` | **Ciphertext blobs. Committed. Unreadable without the passphrase.** |
| `phd/<slug>.html` (rendered as `/phd/<slug>/`) | Public per-project page with the password gate (committed). |
| `_layouts/private.html` | The lock-screen layout + Web Crypto decryption (committed). |

The plaintext path (`~/phd_drafts/`) is **outside** the repo so that even
an accidental `git add .` cannot leak it. As a belt-and-braces measure,
`.gitignore` also excludes `phd_drafts/` and `*.draft.html` inside the
repo.

## How to add or update a draft

1. Drop a draft into `~/phd_drafts/<slug>/`:

   ```
   ~/phd_drafts/
   ├── project-a/
   │   ├── index.html        ← the page body (no <html>/<head> needed)
   │   └── figures/
   │       ├── multiplicity-correction.png
   │       └── …
   ├── project-b/
   │   └── index.html
   └── …
   ```

   Project slugs are exactly `project-a`, `project-b`, `project-c`,
   `project-d`. (Edit `PROJECTS` in `encrypt-drafts.js` if you add more.)

   The `index.html` is a fragment — just the body content. Use normal
   HTML: `<h2>`, `<p>`, `<ul>`, `<img src="figures/foo.png">`, `<blockquote>`,
   etc. Local `<img>` paths get inlined as base64 data URIs at encrypt time,
   so figures live entirely inside the encrypted blob.

2. Run the encryption (one passphrase for all four projects):

   ```bash
   PHD_PASS='correct horse battery staple' node scripts/encrypt-drafts.js
   ```

   …or pass it as an argument:

   ```bash
   node scripts/encrypt-drafts.js 'correct horse battery staple'
   ```

   Output goes into `assets/private/<slug>.enc`. Projects without a
   draft are skipped cleanly.

3. Commit only the ciphertext:

   ```bash
   git add assets/private/*.enc
   git commit -m "Update encrypted draft of project-a"
   git push
   ```

4. Share the passphrase with collaborators by Signal / email — **never**
   commit it, never paste it into the repo.

## Choosing a passphrase

Use a long passphrase. The encryption uses PBKDF2-SHA256 with 250 000
iterations and a random per-file salt, then AES-256-GCM. With a strong
passphrase that's well beyond brute-force, but a weak one (a single
dictionary word, a name + year) can be cracked offline against the
public ciphertext.

Recommended: a 5- or 6-word [diceware](https://theworld.com/~reinhold/diceware.html)
phrase, e.g. `tiger-mango-violet-canyon-zephyr-pine` — easy to share,
~64 bits of entropy.

## Threat model — read this

GitHub Pages is a static host: anything on the repo is publicly
readable. The encrypted `.enc` blobs are committed there, so:

- **Without the passphrase, the content is unreadable** (AES-256-GCM with
  PBKDF2-derived key — a strong passphrase makes brute-force infeasible).
- **The plaintext never enters the repo or its history** as long as you
  keep drafts in `~/phd_drafts/` and don't `--force` past `.gitignore`.
- **Anyone can download the ciphertext** and try passphrases offline at
  leisure. Strong passphrase = safe. Weak passphrase = compromised.
- **If a passphrase leaks**, rotate it: pick a new one, re-run
  `encrypt-drafts.js`, commit the new ciphertext. (Note: anyone who
  archived the old ciphertext can still read the old draft with the old
  passphrase — git history doesn't help here, but new commits go forward.)

For maximum confidentiality use a strong passphrase and rotate it after
any sharing event (e.g. after a conference where you gave it to many
people).

## Decryption flow (browser side)

The `_layouts/private.html` layout includes the decryption logic. The
`.enc` blob layout is:

```
[ 0..16 )  PBKDF2 salt   (16 random bytes)
[16..28 )  AES-GCM IV    (12 random bytes)
[28..-16)  ciphertext
[-16.. )   GCM auth tag  (16 bytes)
```

The browser does:

1. `fetch('/assets/private/<slug>.enc')`
2. `PBKDF2(passphrase, salt, 250 000, SHA-256, 32 bytes)` → AES key
3. `AES-GCM decrypt` (Web Crypto API treats `ct || tag` as the
   ciphertext input) — wrong passphrase throws `OperationError`
4. `innerHTML = decrypted` into the page
