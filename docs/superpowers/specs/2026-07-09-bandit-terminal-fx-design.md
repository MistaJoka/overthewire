# Bandit Walkthrough — In-Browser Terminal Emulator + FX Layer

**Date:** 2026-07-09
**Status:** Approved

## Goal

Make the Bandit walkthrough more fun and high-tech by adding (1) a real in-page
terminal emulator where levels 0–12 can be genuinely solved in the browser, and
(2) a purposeful, reactive visual-effects layer (CRT mode, generative background,
celebration animations). No gimmicks: every animation communicates state or
responds to user action.

## Decisions made during brainstorming

- **Real emulation**, not a scripted recognizer: commands actually operate on a
  virtual filesystem; wrong commands give realistic errors.
- **Coverage: levels 0–12 first.** Later levels (networking, git, cron, setuid)
  keep the current guide-only format; coverage may extend in a later pass.
- **Zero dependencies, no build step.** Hand-rolled terminal in vanilla JS.
  Everything works from GitHub Pages and from `file://`.
- **Multi-file split** via plain `<script src>` tags (no ES modules, which break
  on `file://`).
- **Animations:** purposeful, reactive, and generative — no scripted cinematic
  cutscenes.

## Architecture & file layout

```
bandit-walkthrough.html   markup + CSS (styles stay inline in this file)
js/data.js                LEVELS + TOOLS content (moved verbatim from the HTML)
js/vfs.js                 virtual filesystem snapshots for levels 0–12
js/shell.js               tokenizer, pipes/quotes/globs, command implementations
js/term.js                terminal UI: prompt, history, tab-complete, typed output
js/fx.js                  CRT overlay, generative canvas, celebration animations
js/app.js                 existing app logic (views, drill, persistence) + wiring
tests/                    Node-run test harness (see Testing)
```

Script files are written to work in both the browser (globals) and Node
(`typeof module !== 'undefined'` export guard) so the shell can be tested
headlessly.

`index.html` redirect and GitHub Pages deployment are unchanged.

## Component 1 — Virtual filesystem (`js/vfs.js`)

- One JSON snapshot per level (0–12): tree of directories and files with
  content, permissions, owner/group, and size.
- Faithfully reproduces each level's traps: the `-` filename (level 1),
  spaces in filenames (level 2), hidden dotfiles (level 3), the `inhere/`
  candidate sets (levels 4–5), other-user files that return
  `Permission denied` (level 6's server-wide search), `data.txt` corpora
  (levels 7–10), rot13 content (11), and the compression onion (12).
- Level 12's file is modeled as **layered file objects**: each layer records
  its encoding (hexdump / gzip / bzip2 / tar) and payload, so `xxd -r`,
  `gzip -d`, `bzip2 -d`, and `tar xf` peel real layers and `file` reports the
  true type at every stage.
- **Passwords are realistic fakes** (32-char alphanumeric). Real OTW passwords
  rotate and should not be published; the find-and-use loop is identical.
- API: `vfsForLevel(n)` returns a fresh deep-copied filesystem; mutations live
  only in the terminal session.

## Component 2 — Shell interpreter (`js/shell.js`)

- **Tokenizer:** whitespace splitting with single/double quotes and backslash
  escapes; `|` pipe operator; `*`/`?` glob expansion against the cwd; minimal
  redirection — `>`, `>>`, and `2>/dev/null` — plus `&&` chaining, because the
  documented level 6 and 12 solutions use them verbatim.
  Out of scope: subshells, variables, `;`, `<`, full fd semantics.
- **Pipes** are required — `sort data.txt | uniq -u` is the real level 8
  solution and must work verbatim. Each command reads stdin (string) and
  returns `{stdout, stderr, code}`.
- **Command set:** `ls` (-l -a -h), `cd`, `pwd`, `cat`, `file`, `find`
  (-type -name -size -user -group -readable), `grep` (-i, file args or stdin),
  `sort` (-n -r), `uniq` (-u -c -d), `strings`, `base64` (-d), `tr`, `xxd`
  (-r), `gzip`/`gunzip`, `bzip2`/`bunzip2`, `tar` (xf/tf), `du` (-b -a), `head`/`tail`
  (-n), `wc` (-l -c), `mkdir`, `cp`, `mv`, `echo`, `man`/`help`, `clear`,
  `whoami`, `hostname`, `reset`, `exit`, and `ssh` (special, below).
  Flags beyond these are accepted where harmless or produce the real error.
- **Errors mirror real coreutils:** `bash: foo: command not found`,
  `cat: foo: No such file or directory`, `cat: foo: Permission denied`, etc.
- Every documented solution for levels 0–12 must run **verbatim** and produce
  the level's password.

## Component 3 — Terminal UI (`js/term.js`)

- Rendered DOM terminal (not canvas): prompt line
  `bandit{N}@bandit:~$`, blinking block cursor, scrollback.
- Input: hidden focused `<input>` (mobile keyboards work), ↑/↓ history,
  Tab completion for commands and paths, Ctrl+C (cancel line), Ctrl+L (clear).
- Output "types" in with realistic latency (a few ms per chunk, instant on
  `prefers-reduced-motion` or when fx is off).
- Command history persists per level in localStorage
  (`bandit_termhist_v1`); **filesystem mutations reset on reload** —
  deliberate simplicity, `reset` restores the snapshot at any time.

## Component 4 — Level integration & flag capture (`js/app.js`)

- Emulated levels (0–12) get a second tab beside the guide: **terminal**.
- Opening it plays a brief SSH handshake: connection line, OTW-style banner
  and motd, then the prompt. Quick (<1.5s), skippable by keypress.
- Advancing is authentic: `ssh bandit{n+1}@localhost` prompts for a password
  (input hidden) and validates against the level's fake password.
- On success: flag-capture animation in the terminal, the level auto-marks
  done (same persistence as the existing checkbox), a green cascade runs
  through the sidebar, the next level's dot pulses, and the terminal
  transitions into the next level's session.
- Existing guide, drill mode, notes, search, and themes are untouched.

## Component 5 — FX layer (`js/fx.js`)

- **CRT mode** — sidebar toggle, persisted (`bandit_fx_v1`): scanlines,
  vignette, phosphor glow, faint flicker. Pure CSS overlay + filters.
  Default ON in dark theme, OFF in light.
- **Generative background** — full-page low-opacity canvas behind content:
  one drifting node per level connected in a loose mesh; completed levels
  glow green; a completion pulse ripples through the mesh when a flag is
  captured. Capped ~30fps, pauses on `visibilitychange`, skipped entirely
  under `prefers-reduced-motion`.
- **Reactive micro-animations:** keystroke glow at the terminal cursor,
  particle fill on the sidebar progress bar, smooth level-transition wipes.
- Single **fx kill-switch** toggle disables everything at once; all motion
  respects `prefers-reduced-motion`.

## Error handling

- Unknown commands / bad flags → realistic bash/coreutils errors, never a
  broken UI.
- localStorage failures already soft-fail via the existing `store` wrapper;
  new keys use the same wrapper.
- Canvas/FX failures degrade silently (try/catch around init); the guide and
  terminal never depend on fx.js having loaded.

## Testing

- `tests/` contains a Node test runner (`node tests/run.js`, no deps) loading
  `vfs.js` + `shell.js` directly.
- **Unit tests:** tokenizer (quotes, escapes, globs), pipe plumbing, and each
  command's core flags.
- **Golden-path tests:** for each level 0–12, the documented solution command
  sequence is fed through the interpreter and the assertion is that the next
  level's password appears in the output. This is the acceptance bar.
- **Trap tests:** `cat -` behavior, spaces-in-filename handling, permission
  denials on level 6 decoys.
- Browser preview verification for the UI/FX (handshake, capture cascade,
  CRT toggle, reduced-motion, mobile viewport).

## Out of scope (this pass)

- Levels 13–33 emulation (networking, git, cron, setuid).
- Shell variables, subshells, `;`, `<`, full fd semantics, job control
  (only `>`, `>>`, `2>/dev/null`, and `&&` are supported).
- Persisting filesystem mutations across reloads.
- Sound.
