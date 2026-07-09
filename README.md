# OverTheWire — Bandit Walkthrough

An interactive, single-page walkthrough for the [OverTheWire **Bandit**](https://overthewire.org/wargames/bandit/) wargame — plus a **playable in-browser terminal** that genuinely solves levels 0–12 against a simulated filesystem. No build step, no dependencies, no network.

## What's inside

- **Guide** for all 33 level transitions (0→1 … 32→33): objective, progressive hints, a revealable step-by-step walkthrough, the concept behind each technique, common gotchas, and per-level notes that persist.
- **Playable terminal** on levels 0–12 (the `terminal` tab). A real command interpreter runs against a per-level virtual filesystem — pipes, quoting, and globs all work, so the actual documented solutions run verbatim:
  - `ls cat file find grep sort uniq strings base64 tr xxd head tail wc mkdir cp mv echo` and more
  - piping (`sort data.txt | uniq -u`), redirection (`>`, `>>`), `&&`, tab-completion, command history
  - the level-12 decompression onion (`xxd -r` → `gunzip`/`bunzip2`/`tar` layers) peels for real
  - a realistic permission model (other-user files give `Permission denied`; `find … 2>/dev/null` hides traversal errors)
- **Authentic advance flow.** You capture a flag the real way — `ssh bandit1@localhost`, enter the password you found, and you're advanced in place to the next level, just like the actual game.
- **Commands reference** tab and a **drill** (flashcard) practice mode.
- **High-tech FX** (the `⚡ fx` toggle): CRT scanline/vignette/phosphor mode, a living generative node-mesh background that lights up green as you clear levels, and a capture cascade on solve. Respects `prefers-reduced-motion` and pauses when the tab is hidden.

> **Note on passwords:** the in-browser terminal uses **realistic fake passwords**, not the real OverTheWire secrets (those rotate and shouldn't be republished). The find-it-then-use-it loop is identical to the real game; only the strings differ.

## Running it

It's a static page — just open it:

```sh
open bandit-walkthrough.html          # straight from disk (file://)
# or serve it:
python3 -m http.server 8765           # then visit http://localhost:8765/bandit-walkthrough.html
```

Works from `file://`, a local server, or GitHub Pages — everything is self-contained (relative `<script>` tags, no ES modules, no fetch). Progress, notes, theme, and FX state persist via `localStorage`.

## Project layout

```
bandit-walkthrough.html   markup + CSS + CRT/canvas overlay
index.html                landing redirect
js/data.js                level + command-reference content
js/vfs.js                 per-level virtual filesystems (levels 0–12)
js/shell.js               tokenizer, pipes/quotes/globs, command implementations
js/term.js                terminal UI: prompt, history, tab-complete, ssh advance
js/fx.js                  CRT mode, generative background, capture cascade
js/app.js                 views, drill, persistence, wiring
tests/                    Node test suite
```

## Tests

The shell interpreter and every level 0–12 solution are covered by a Node test suite (built-in `node:test`, no dependencies):

```sh
bash tests/run.sh
```

This runs unit tests for the tokenizer/pipes/commands/decompression **and** a golden-path acceptance suite: every documented solution for levels 0–12, fed through the interpreter, must produce the next level's password.
