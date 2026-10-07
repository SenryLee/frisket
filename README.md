<p align="center">
  <img src="brand/frisket-card.svg" width="560" alt="Frisket">
</p>

<p align="center">
  <strong>做一个适可而止的 Markdown 编辑器。</strong><br>
  A Markdown editor that does enough, then stops.
</p>

<p align="center">
  <a href="README.en.md">English</a>
  &nbsp;·&nbsp;
  <a href="#下载试用">下载试用</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/SenryLee/frisket/releases/tag/v1.1.1">Release</a>
</p>

<p align="center">
  <img alt="macOS 13 及以上" src="https://img.shields.io/badge/macOS-13%2B-D97757">
  <img alt="Apple 芯片" src="https://img.shields.io/badge/Apple_Silicon-arm64-1A1816">
  <img alt="版本 1.1.1" src="https://img.shields.io/badge/release-v1.1.1-D97757">
  <img alt="MIT" src="https://img.shields.io/badge/license-MIT-8C847C">
</p>

---

## 下载试用

这一版给 **Apple 芯片** 的 Mac。系统需要 **macOS 13** 或更高。安装包没有经过 Apple 签名，第一次打开要手动放行。

<p align="center">
  <a href="https://github.com/SenryLee/frisket/releases/download/v1.1.1/Frisket_1.1.1_aarch64.dmg"><strong>下载 Frisket 1.1.1</strong></a>
  <br>
  <sub><code>Frisket_1.1.1_aarch64.dmg</code> · 也可到 <a href="https://github.com/SenryLee/frisket/releases/tag/v1.1.1">Releases</a> 页面下载</sub>
</p>

1. 打开下载的磁盘映像，把 **Frisket** 拖进「应用程序」。不要在映像窗口里直接双击 Frisket。
2. 第一次打开时，在「应用程序」里对 Frisket **按住 Control 再点**，选择「打开」。如果系统提示「无法验证开发者」，确认一次即可。不要把应用删掉。
3. 若仍被拦住，打开「系统设置 → 隐私与安全性」，在页面下方点「仍要打开」。
4. 也可以在终端执行下面这一行，清掉下载隔离标记后再打开：

```bash
xattr -cr /Applications/Frisket.app
```

文档留在你自己的磁盘上。没有账号，也没有云同步。AI 要用自己的密钥，密钥放在 macOS 钥匙串里。

Intel 芯片的 Mac 不能直接用这个安装包。需要的话，在那台机器上按文末的步骤自己编译。

## 它做什么

写的时候标记藏起来。光标停进 `#`、`**`、`` ` `` 这些符号里，符号才出现。正文离开光标之后，屏幕上仍是排好的字。磁盘上的文件从头到尾是普通 Markdown，可以用任何编辑器打开。

回车落在标记边上时，新的一行写在整段标记外面，一行格式不会被切成两截。

| | |
|---|---|
| 段落 | 标题 1–6、引用、分割线、硬换行、清除格式 |
| 文字 | 加粗、斜体、删除线、行内代码 |
| 列表 | 无序、有序、任务，以及缩进 |
| 插入 | 链接、图片、表格 |
| 对齐 | 左对齐、居中、右对齐、两端对齐 |
| 颜色 | 文字颜色、高亮。两种颜色写进同一个标记，再点一次同色会取消 |
| 格式刷 | 先选中一段带格式的文字拿起格式，再选目标放下。右键取消 |

## 文件放在哪

新建时先问保存位置。最近用过的五个文件夹会列出来，选好之后按键自动保存。取消选择时，当前文档保持原样。

侧栏有两页，共用同一个「打开」：

| 当前这一页 | 「打开」和 ⌘O |
|---|---|
| 历史 | 只打开一篇 Markdown |
| 文件夹 | 只选一个文件夹，钉进侧栏并展开 |

钉住的文件夹可以逐层折叠。移出名单只改侧栏，不删除磁盘上的文件。文件名可以在标题栏上点改，也可以在侧栏里右键重命名、在 Finder 中显示、复制路径。

打开过一次 Frisket 之后，在 Finder 里双击 `.md` 会用它打开。如果原来有别的默认编辑器，这一次会改过来；之后可以在文件的「显示简介」里再改回去。

## 外观

四种外观：墨纸、石墨、暖米、霓虹玻璃。墨纸和石墨可以跟着系统的浅色和深色走。设置里还能改字号、字色、玻璃透度和壁纸。

macOS 26 及以上用液态玻璃，更早的系统用 HUD 毛玻璃。标题栏是透明的，可以拖动窗口。玻璃发白或边缘错位时，到设置里关掉透明，界面会改成不透明的底，不用重启。

打字机模式把正在写的那一行留在画面中间。它只滚动视图，不改 Markdown。

## AI

划选文字后，这份文档第一次打开会在右侧让出一块对话区，正文仍留在原来的位置。这一次打开里如果把面板关掉，就不会再自动打开。顶部的 AI 是一个常驻开关。选中文字本身不会把内容发给模型。

默认接 xAI，模型是 `grok-4.7`。设置里也可以换成 OpenAI、Anthropic、DeepSeek、Kimi、通义千问、智谱、Gemini、豆包、Ollama，或一个自己的兼容地址。请求从本机发出。页面里没有读取密钥的通道。

## 快捷键

| 动作 | 按键 |
|---|---|
| 新建 | ⌘N |
| 打开 | ⌘O |
| 保存 | ⌘S |
| 折叠侧栏 | ⌘\ |
| 开关 AI | ⌘J |
| 撤销 / 重做 | ⌘Z / ⇧⌘Z |
| 加粗 / 斜体 | ⌘B / ⌘I |
| 删除线 / 行内代码 | ⇧⌘X / ⌘E |
| 标题 1–6 | ⌥⌘1 … ⌥⌘6 |
| 无序 / 有序 / 引用 | ⇧⌘8 / ⇧⌘7 / ⇧⌘9 |

## 数据留在本机

应用数据在：

```text
~/Library/Application Support/com.frisket.md
```

如果这台电脑上还留着以前 Slate 的历史和接口设置，第一次打开 Frisket 时会复制一份过来。钥匙串服务是 `com.frisket.md`。

## 从源码构建

需要 Node.js 20 或更高、Rust 1.77 或更高，以及 Xcode 命令行工具。

```bash
git clone https://github.com/SenryLee/frisket.git
cd frisket
git config core.hooksPath .githooks
npm install
npm test
npm run app:dev
npm run app:build
```

`npm run dev` 只在浏览器里看界面，没有文件对话框和钥匙串。安装包出现在 `src-tauri/target/release/bundle/`。

提交前的钩子会拦下疑似密钥。误报时用 `SKIP_SECRET_CHECK=1 git commit` 跳过。真实密钥只进钥匙串。

## 仓库里有什么

进仓库的是重新做出这个应用所需要的源码。文件列表中间那一列是 GitHub 自动填上的最近一次提交标题，不是文件简介，也不能按路径单独改写。每个路径做什么，写在下面。

### 根目录

| 路径 | 做什么 |
|---|---|
| `.githooks/` | 提交前跑的脚本，目前只有 `pre-commit`。它检查暂存文本里有没有密钥前缀或私钥；克隆后要执行 `git config core.hooksPath .githooks` 才会启用。 |
| `brand/` | 标志的源文件：叠在一起的两块圆角方形、带字的字标，以及这份说明顶部的浅色卡片。各尺寸的应用图标不放在这里，由标志生成后放进 `src-tauri/icons/`。 |
| `public/` | 开发时浏览器标签用的 `favicon.svg`，图形和标志相同。安装包里的 Mac 图标不从这里取。 |
| `src/` | 窗口里的界面和编辑器，用 Vue 3 与 TypeScript 写。侧栏、工具栏、左侧目录、正文排版和四套外观都从这里打进安装包。 |
| `src-tauri/` | 桌面外壳，用 Rust 写。负责开窗口、读写文件、读钥匙串，以及替页面向外发送 AI 请求。页面自己接触不到密钥。 |
| `tests/` | 不启动安装包也能做的检查。`unit/` 在 Node 里核对格式和目录，`e2e/` 在浏览器里看排版会不会跳、输入法会不会丢字。 |
| `.gitignore` | 列出不进 git 的路径：依赖、编译结果、密钥、本机笔记，以及 `docs/` 里的设计文档。 |
| `LICENSE` | MIT 许可的全文。使用、修改和再发布都可以，需要保留这份许可。 |
| `README.md` | 这份中文说明。仓库首页默认显示它，下载步骤和这张路径表都在这里。 |
| `README.en.md` | 同一份说明的英文版，功能和路径与中文对齐，不另写一套。 |
| `index.html` | 桌面窗口实际加载的页面。Vite 从这里挂上 `src/main.ts`，写作界面从这一页进来。 |
| `gate.html` | 只挂编辑内核的检查页，开发时打开 `/gate.html`。用来看排版和输入法，不是日常写作的窗口。 |
| `package.json` | 前端依赖和命令。`npm test` 跑单元测试，`npm run app:dev` 开窗口，`npm run app:build` 打安装包。当前版本是 1.1.1。 |
| `package-lock.json` | npm 的精确版本锁。克隆之后 `npm install` 按它装到同一套依赖，避免各台机器上的包版本不一致。 |
| `tsconfig.json` | TypeScript 的编译选项。`@/` 指向 `src/`。这里只做类型检查，不另产出一份 js。 |
| `vite.config.ts` | 开发服务器和前端打包。`@codemirror` 与 `@lezer` 打进同一个 `editor` 块，避免安装包打开后白屏。 |
| `vitest.config.ts` | 单元测试的范围，只跑 `tests/unit`。浏览器里的排版检查不从这里启动。 |
| `playwright.config.ts` | 浏览器检查的配置。覆盖标记显隐时行高会不会变，以及输入法组合会不会丢字。 |

### `brand/`

| 文件 | 做什么 |
|---|---|
| `frisket-mark.svg` | 标志，两块叠在一起的圆角方形。应用图标从它生成。 |
| `frisket-lockup.svg` | 标志加上 Frisket 字标，底是透明的。 |
| `frisket-card.svg` | 同一套图形放在浅色圆角底上。这份说明用它，深色页面里字仍然看得见。 |

### `src/`

| 路径 | 做什么 |
|---|---|
| `App.vue` | 把窗口分成标题栏、左侧文件栏、编辑区和右侧 AI。⌘N、⌘O、⌘S、⌘J 和 ⌘\ 从这里接进对应动作。 |
| `main.ts` | 把 Vue 挂到页面上。没有路由，透明窗口不会在换页时留下一层残影。 |
| `env.d.ts` | 补上 Vite 和 Vue 单文件组件的类型，让 `.vue` 文件能通过类型检查。 |
| `components/` | 看得到的控件。每个文件只做一块：工具栏、侧栏、文件夹、目录、标题栏、设置、跟随条、AI 面板、保存位置。 |
| `core/` | 不碰界面的规则。格式怎么包、回车落在哪里、目录怎么从标题长出来、历史怎么剔除、按钮怎么一次点中，都在这里。 |
| `editor/` | CodeMirror 6。光标外隐藏标记，标题和强调分色，图片画成预览。磁盘上的正文始终是纯 Markdown。 |
| `store/` | 界面状态：主题、历史、自动保存、侧栏文件夹、皮肤、壁纸和 AI。正文不放在这里，编辑器自己持有。 |
| `ipc/commands.ts` | 前端叫 Rust 时使用的命令名。打开、保存、重命名、列目录、删历史和 AI 请求两边认同一份名单。 |
| `styles/` | 四套外观的颜色、玻璃、侧栏、目录和字号。换主题只改页面上的 `data-theme`。 |
| `test-utils/` | 测试里量行高、接编辑器的小工具。不打进安装包。 |

### `src/components/`

| 文件 | 做什么 |
|---|---|
| `Toolbar.vue` | 顶部格式栏。标题、颜色、链接、图片和表格从这里弹出。按下时保住正文选区，按钮一次就生效。 |
| `FollowingBar.vue` | 选中文字后出现在选区旁的小格式栏，和顶栏共用同一套写法和同一把格式刷。 |
| `Sidebar.vue` | 左侧文件栏，分成历史和文件夹两页，共用一个「打开」。历史可以右键勾选后批量移除，只改名单，不删文件。 |
| `LibraryFolders.vue` | 文件夹那一页。钉住的目录逐层折叠，移出名单不碰磁盘上的文件。 |
| `OutlineDrawer.vue` | 当前文档的标题目录。鼠标停在「目录」上会滑出，点击才固定；固定后可拖宽度，并占左侧一列。 |
| `AppTitleBar.vue` | 透明标题栏。拖拽层铺在按钮后面，文件名、设置、主题和 AI 开关都在这一条上。 |
| `SettingsPanel.vue` | 设置页。外观、字号、玻璃和壁纸在这里改；接口密钥提交后输入框清空，页面只记住有没有密钥。 |
| `FolderPicker.vue` | 新建或第一次保存时选文件夹。最近用过的五个可以直接点。 |
| `AiPanel.vue` | 右侧对话的内容。划选文字不会自动发给模型。 |
| `AiPanelShell.vue` | AI 面板的外壳，只负责位置、玻璃和折叠。对话内容放在里面，不和布局写在一起。 |
| `StatusBar.vue` | 窗口底部的字数和状态。数字来自编辑器统计，不自己读正文。 |
| `toolbarActions.ts` | 顶栏和跟随栏共用的写操作。同一种格式只有一种写法，格式刷的状态也放在这里。 |
| `inkPreview.ts` | 让颜色按钮跟着当前选区变化。选区长度不变时也要能更新。 |
| `types.ts` | 控件之间传递的动作类型。工具栏只表达意图，不直接改文档。 |

### `src-tauri/`

| 路径 | 做什么 |
|---|---|
| `src/main.rs` | 程序入口。 |
| `src/lib.rs` | 登记命令和窗口。第一次打开时，如果本机还有以前 Slate 的历史和接口设置，从那里复制一份。 |
| `src/files.rs` | 打开、保存、重命名、列出文件夹里的 Markdown、在 Finder 中显示，以及从历史名单里去掉记录。不删除用户的文件。 |
| `src/ai.rs` | 把对话发到用户自己配置的接口。密钥从钥匙串读取，页面读不到。 |
| `src/glass/` | 按系统版本选用液态玻璃、HUD 毛玻璃，或完全不透明。 |
| `tauri.conf.json` | 窗口大小、透明标题栏、最低 macOS 13，以及打成 `.app` 和 `.dmg`。 |
| `Cargo.toml`、`Cargo.lock` | Rust 依赖，以及锁住的精确版本。 |
| `capabilities/default.json` | 这个窗口被允许使用的系统能力。 |
| `build.rs` | Tauri 的构建脚本。 |
| `icons/` | 各尺寸图标。macOS 安装包使用其中的 `icon.icns`。 |

### `tests/`

| 路径 | 做什么 |
|---|---|
| `unit/` | 在 Node 里核对格式、回车、目录、图片地址、历史剔除和渲染结果。不打开窗口。 |
| `e2e/` | 用 Playwright 看标记显隐时行高会不会变、输入法会不会丢字，以及长文滚动。 |
| `fixtures/` | 这些检查用的样例 Markdown，包括 CommonMark 和 GFM 语料。 |
| `README.md` | 这些检查怎么跑，以及每道门禁当时的结果。 |

### 不进仓库

这些留在本机或只出现在 Release 里。缺了它们，已经打好的安装包仍然能打开、能写、能保存。

| 不入库 | 原因 |
|---|---|
| `docs/` | 设计笔记，包括方案、架构和玻璃排查。给编写时对照，应用运行时不读。 |
| `node_modules/` | 用 `npm install` 装回来。 |
| `dist/` | 前端构建结果。打包时重新生成，并写进安装包。 |
| `src-tauri/target/` | Rust 编译缓存，体积以 GB 计。 |
| `src-tauri/gen/` | Tauri 生成的模式文件，构建时会再生。 |
| `.env`、密钥、证书 | 密钥只留在钥匙串。仓库里没有任何人的密钥。 |
| 测试报告、Playwright 浏览器、编辑器临时文件 | 本机缓存。 |
| `.workbuddy/`、`.verify/` | 本机笔记和临时对照测试。 |
| 安装包 `.dmg` / `.app` | 放在 [Releases](https://github.com/SenryLee/frisket/releases/tag/v1.1.1)。下载那一个文件就能用，不需要再克隆仓库。 |

## 许可

[MIT](LICENSE)
