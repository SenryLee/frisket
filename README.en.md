<p align="center">
  <img src="brand/frisket-card.svg" width="560" alt="Frisket">
</p>

<p align="center">
  <strong>A Markdown editor that does enough, then stops.</strong><br>
  做一个适可而止的 Markdown 编辑器。
</p>

<p align="center">
  <a href="README.md">中文</a>
  &nbsp;·&nbsp;
  <a href="#try-it">Try it</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/SenryLee/frisket/releases/tag/v1.1.0">Release</a>
</p>

<p align="center">
  <img alt="macOS 13 or later" src="https://img.shields.io/badge/macOS-13%2B-D97757">
  <img alt="Apple silicon" src="https://img.shields.io/badge/Apple_Silicon-arm64-1A1816">
  <img alt="Version 1.1.0" src="https://img.shields.io/badge/release-v1.1.0-D97757">
  <img alt="MIT" src="https://img.shields.io/badge/license-MIT-8C847C">
</p>

---

## Try it

This build is for a Mac with **Apple silicon**, on **macOS 13** or later. The disk image is not signed by Apple, so the first open needs a manual allow.

<p align="center">
  <a href="https://github.com/SenryLee/frisket/releases/download/v1.1.0/Frisket_1.1.0_aarch64.dmg"><strong>Download Frisket 1.1.0</strong></a>
  <br>
  <sub><code>Frisket_1.1.0_aarch64.dmg</code> · or open the <a href="https://github.com/SenryLee/frisket/releases/tag/v1.1.0">Releases</a> page</sub>
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

macOS 26 and later use liquid glass. Earlier releases use the HUD material. The title bar is transparent and drags the window. If the glass turns white or the edges slip, turn transparency off in Settings. The surface becomes opaque, and the app does not need a restart.

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

The repository holds the source needed to build the app again. The column on the right of GitHub’s file list is the latest commit title, not a description of that file. What each path does is written here.

### Root

| Path | What it does |
|---|---|
| `.githooks/` | A secret check before each commit. `pre-commit` looks through staged text for key prefixes and private-key blocks. Turn it on with `git config core.hooksPath .githooks`. |
| `brand/` | The product art: the mark, the wordmark, and the light card used in this page. |
| `public/` | The browser-tab icon used while developing. `favicon.svg` points at the mark. The icon inside the Mac app comes from `src-tauri/icons/`, not from here. |
| `src/` | The interface and the editor, in Vue 3 and TypeScript. |
| `src-tauri/` | The window, files, Keychain, and AI requests, in Rust. |
| `tests/` | Checks that run without the installer: unit tests, plus browser checks for layout and input. |
| `.gitignore` | Dependencies, build output, keys, local notes, and design notes. None of these enter git. |
| `LICENSE` | The full MIT license. |
| `README.md` | This guide in Chinese. GitHub shows it on the repository home. |
| `README.en.md` | The same guide in English. |
| `index.html` | The page loaded inside the desktop window. Vite mounts `src/main.ts` from here. |
| `gate.html` | A page that mounts only the editor kernel. In development it is `/gate.html`, used to check layout and input. It is not the writing screen. |
| `package.json` | Frontend dependencies and commands. `npm test` runs the unit tests, `npm run app:dev` opens the window, and `npm run app:build` makes the installer. The version is 1.1.0. |
| `package-lock.json` | The exact npm lock. After a clone, `npm install` uses it to fetch the same set. |
| `tsconfig.json` | TypeScript options, and the `@/` alias that points at `src/`. |
| `vite.config.ts` | The dev server and the frontend bundle. Editor packages go into one `editor` chunk. |
| `vitest.config.ts` | The unit-test scope. It runs `tests/unit` only. |
| `playwright.config.ts` | The browser checks for layout shift and for dropped input-method characters. |

### `brand/`

| File | What it does |
|---|---|
| `frisket-mark.svg` | The mark: two rounded squares overlapping. The app icon is generated from it. |
| `frisket-lockup.svg` | The mark plus the Frisket wordmark, on a transparent background. |
| `frisket-card.svg` | The same art on a light rounded card. This page uses it, so the word stays readable on a dark background. |

### `src/`

| Path | What it does |
|---|---|
| `App.vue` | The three columns: sidebar, editor, and the AI pane. It also handles ⌘N, ⌘O, ⌘S, ⌘J, and ⌘\\. |
| `main.ts` | Mounts Vue. There is no router, so a transparent window does not leave a ghost when a page would have changed. |
| `env.d.ts` | Types for Vite and for Vue single-file components. |
| `components/` | The visible controls: toolbar, sidebar, folder tree, title bar, settings, the following bar, the AI pane, and the save-folder picker. |
| `core/` | Rules kept apart from the screen: formatting, Return, filenames, pinned folders, the last five save folders, the AI session, and the provider list. |
| `editor/` | CodeMirror 6. Live typesetting, shortcuts, and color. The document stays plain Markdown. |
| `store/` | UI state: theme, history, autosave, sidebar folders, skin, wallpaper, and AI. The document text does not live here. |
| `ipc/commands.ts` | The command names the interface sends to Rust. Both sides share one list. |
| `styles/` | The four appearances, the glass, the sidebar, and type size. |
| `test-utils/` | A small helper that measures line height in tests. It is not in the installer. |

### `src-tauri/`

| Path | What it does |
|---|---|
| `src/main.rs` | The process entry. |
| `src/lib.rs` | Registers commands and the window. On the first launch it copies history and API settings from an older Slate folder when that folder is still on the Mac. |
| `src/files.rs` | Open, save, rename, list Markdown in a folder, and reveal a file in Finder. |
| `src/ai.rs` | Sends a conversation to the endpoint the user configured. The key is read from the Keychain. The page cannot read it. |
| `src/glass/` | Picks liquid glass, the HUD material, or a fully opaque surface from the system version. |
| `tauri.conf.json` | Window size, the transparent title bar, macOS 13 as the minimum, and the `.app` and `.dmg` bundles. |
| `Cargo.toml`, `Cargo.lock` | Rust dependencies, locked to exact versions. |
| `capabilities/default.json` | Which system capabilities this window may use. |
| `build.rs` | Tauri’s build script. |
| `icons/` | Icons at the sizes each platform asks for. The Mac installer uses `icon.icns`. |

### `tests/`

| Path | What it does |
|---|---|
| `unit/` | Formatting, Return, the folder tree, and render checks. No window. |
| `e2e/` | Playwright checks for layout shift and for dropped input-method characters. |
| `fixtures/` | Sample Markdown used by those checks. |
| `README.md` | How to run the checks. |

### Left out of git

These stay on the machine that builds Frisket, or they live only on the Release. A finished installer still opens, writes, and saves when they are absent.

| Left out | Why |
|---|---|
| `docs/` | Design notes: the spec, the architecture, and the glass checklist. They are for writing the app. The running app does not read them. |
| `node_modules/` | Restored with `npm install`. |
| `dist/` | The frontend build. It is produced again at package time and written into the installer. |
| `src-tauri/target/` | The Rust build cache, measured in gigabytes. |
| `src-tauri/gen/` | Schemas Tauri generates again during a build. |
| `.env`, keys, certificates | Keys stay in the Keychain. The repository contains nobody’s key. |
| Test reports, Playwright browsers, editor scratch files | Local caches. |
| `.workbuddy/`, `.verify/` | Local notes and a temporary comparison test. |
| The `.dmg` and `.app` | Attached to [Releases](https://github.com/SenryLee/frisket/releases/tag/v1.1.0). That one file is enough to use the app. Cloning the repository is not required. |

## License

[MIT](LICENSE)
