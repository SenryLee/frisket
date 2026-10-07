<p align="center">
  <img src="brand/frisket-mark.svg" width="88" alt="Frisket mark">
</p>

<p align="center">
  <img src="brand/frisket-card.svg" width="560" alt="Frisket">
</p>

<p align="center">
  <strong>The page is set type. The file stays plain Markdown.</strong><br>
  屏幕上是排好的正文。文件里始终是纯 Markdown。
</p>

<p align="center">
  <a href="README.md">中文</a>
  &nbsp;·&nbsp;
  <a href="#try-it">Try it</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/SenryLee/frisket/releases/tag/v1.0.0">Release</a>
</p>

<p align="center">
  <img alt="macOS 13 or later" src="https://img.shields.io/badge/macOS-13%2B-D97757">
  <img alt="Apple silicon" src="https://img.shields.io/badge/Apple_Silicon-arm64-1A1816">
  <img alt="Version 1.0.0" src="https://img.shields.io/badge/release-v1.0.0-D97757">
  <img alt="MIT" src="https://img.shields.io/badge/license-MIT-8C847C">
</p>

---

## Try it

This build is for a Mac with **Apple silicon**, on **macOS 13** or later. The disk image is not signed by Apple, so the first open needs a manual allow.

<p align="center">
  <a href="https://github.com/SenryLee/frisket/releases/download/v1.0.0/Frisket_1.0.0_aarch64.dmg"><strong>Download Frisket 1.0.0</strong></a>
  <br>
  <sub><code>Frisket_1.0.0_aarch64.dmg</code> · or open the <a href="https://github.com/SenryLee/frisket/releases/tag/v1.0.0">Releases</a> page</sub>
</p>

1. Open the disk image and drag **Frisket** into Applications.
2. If macOS says the developer cannot be verified, or that the app is damaged, leave the app in place.
3. In Applications, **Control-click** Frisket, choose Open, and confirm the dialog.
4. If it is still blocked, open System Settings → Privacy & Security and choose Open Anyway.
5. Or clear the download quarantine, then open the app:

```bash
xattr -cr /Applications/Frisket.app
```

Files stay on this Mac. There is no account and no cloud sync. An AI key, if you want one, stays in the macOS Keychain.

An Intel Mac cannot run this disk image. Build it there with the steps at the end.

## What it does

Markers stay hidden while you write. They appear when the caret sits inside `#`, `**`, `` ` ``, and the other marks. Away from the caret, the page stays set. The file on disk is ordinary Markdown the whole time.

Pressing Return beside a marker puts the new line outside the whole span, so a style is not split in half.

| | |
|---|---|
| Blocks | Headings 1–6, quotes, a horizontal rule, a hard break, clear formatting |
| Text | Bold, italic, strikethrough, inline code |
| Lists | Bullets, numbers, tasks, and indent |
| Insert | Links, images, tables |
| Align | Left, center, right, justify |
| Color | Text color and highlight. Both colors share one mark. The same color a second time removes it |
| Painter | Capture a formatted span, then apply it to another. Right-click cancels |

## Where files live

A new document asks which folder to use and offers the last five. After that, edits save on their own. Cancelling the folder picker leaves the current document as it was.

The sidebar has two panes and one Open button:

| Pane | Open and ⌘O |
|---|---|
| History | Opens one Markdown file |
| Folders | Picks one folder, pins it, and expands it |

Pinned folders fold level by level. Removing one from the list leaves the files on disk. The name in the title bar can be edited in place. The sidebar can also rename a file, reveal it in Finder, or copy its path.

## Appearance

Four appearances: Ink, Graphite, Sepia, and Neon Glass. Ink and Graphite can follow the system light and dark setting. Settings also change type size, foreground color, glass opacity, and the wallpaper.

macOS 26 and later use liquid glass. Earlier releases use the HUD material. The title bar is transparent and drags the window. If the glass turns white or the edges slip, turn transparency off in Settings. The checks are in [`docs/GLASS-CHECKLIST.md`](docs/GLASS-CHECKLIST.md).

Typewriter mode keeps the line you are writing in the middle of the view. It scrolls. It does not change the Markdown.

## AI

The first selection after a document is opened makes room for a conversation pane on the right. The text stays where it was. Closing that pane during this open keeps it from opening again on its own. The AI control in the title bar stays put. Selecting text does not send it to a model.

The default is xAI, model `grok-4.7`. Settings can switch to OpenAI, Anthropic, DeepSeek, Kimi, Qwen, GLM, Gemini, Doubao, Ollama, or a compatible address of your own. Requests leave from this machine. The page has no command that can read the key.

## Shortcuts

| Action | Keys |
|---|---|
| New | ⌘N |
| Open | ⌘O |
| Save | ⌘S |
| Toggle the sidebar | ⌘\ |
| Toggle AI | ⌘J |
| Undo / redo | ⌘Z / ⇧⌘Z |
| Bold / italic | ⌘B / ⌘I |
| Strike / inline code | ⇧⌘X / ⌘E |
| Headings 1–6 | ⌥⌘1 … ⌥⌘6 |
| Bullet / numbered / quote | ⇧⌘8 / ⇧⌘7 / ⇧⌘9 |

## Data stays local

App data lives here:

```text
~/Library/Application Support/com.frisket.md
```

The first launch copies history and API settings from an older Slate install when that folder is still on the Mac. The Keychain service is `com.frisket.md`.

## Build from source

Node.js 20 or newer, Rust 1.77 or newer, and the Xcode command-line tools.

```bash
git clone https://github.com/SenryLee/frisket.git
cd frisket
git config core.hooksPath .githooks
npm install
npm test
npm run app:dev
npm run app:build
```

`npm run dev` shows the interface in a browser, without file dialogs or the Keychain. The installer lands in `src-tauri/target/release/bundle/`.

The commit hook stops a change that looks like a secret. A false positive can use `SKIP_SECRET_CHECK=1 git commit`. A real key belongs in the Keychain.

## What is in the repository

The repository holds what you need to build the app again.

| Path | What it holds |
|---|---|
| `brand/` | The mark, the wordmark, and the light card used in this README |
| `src/` | The interface, the editor, and UI state |
| `src-tauri/` | The window, files, history, Keychain, AI requests, and the app icon |
| `docs/` | The spec, the architecture notes, and the glass checklist |
| `tests/` | Unit tests, plus browser checks for layout and input |
| `public/` | The page icon |

These stay out of git:

| Left out | Why |
|---|---|
| `node_modules/` | Restored with `npm install` |
| `dist/` | The frontend build, produced again at package time |
| `src-tauri/target/` | The Rust build cache, measured in gigabytes |
| `src-tauri/gen/` | Schemas generated by Tauri |
| `.env`, keys, certificates | Keys stay in the Keychain |
| Test reports, Playwright browsers, editor scratch files | Local caches |
| The `.dmg` and `.app` | Attached to [Releases](https://github.com/SenryLee/frisket/releases/tag/v1.0.0), not stored in git history |

Further reading:

- [`docs/SPEC.md`](docs/SPEC.md)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/GLASS-CHECKLIST.md`](docs/GLASS-CHECKLIST.md)

## License

[MIT](LICENSE)
