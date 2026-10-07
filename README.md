<p align="center">
  <img src="brand/frisket-mark.svg" width="88" alt="Frisket 标志">
</p>

<p align="center">
  <img src="brand/frisket-card.svg" width="560" alt="Frisket">
</p>

<p align="center">
  <strong>屏幕上是排好的正文。文件里始终是纯 Markdown。</strong><br>
  A macOS editor. The page is set type. The file stays plain Markdown.
</p>

<p align="center">
  <a href="README.en.md">English</a>
  &nbsp;·&nbsp;
  <a href="#下载试用">下载试用</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/SenryLee/frisket/releases/tag/v1.0.0">Release</a>
</p>

<p align="center">
  <img alt="macOS 13 及以上" src="https://img.shields.io/badge/macOS-13%2B-D97757">
  <img alt="Apple 芯片" src="https://img.shields.io/badge/Apple_Silicon-arm64-1A1816">
  <img alt="版本 1.0.0" src="https://img.shields.io/badge/release-v1.0.0-D97757">
  <img alt="MIT" src="https://img.shields.io/badge/license-MIT-8C847C">
</p>

---

## 下载试用

这一版给 **Apple 芯片** 的 Mac。系统需要 **macOS 13** 或更高。安装包没有经过 Apple 签名，第一次打开要手动放行。

<p align="center">
  <a href="https://github.com/SenryLee/frisket/releases/download/v1.0.0/Frisket_1.0.0_aarch64.dmg"><strong>下载 Frisket 1.0.0</strong></a>
  <br>
  <sub><code>Frisket_1.0.0_aarch64.dmg</code> · 也可到 <a href="https://github.com/SenryLee/frisket/releases/tag/v1.0.0">Releases</a> 页面下载</sub>
</p>

1. 打开下载的磁盘映像，把 **Frisket** 拖进「应用程序」。
2. 第一次打开时，如果系统提示「无法验证开发者」或「已损坏」，先不要把应用删掉。
3. 在「应用程序」里对 Frisket **按住 Control 再点**，选择「打开」，再在对话框里确认一次。
4. 若仍被拦住，打开「系统设置 → 隐私与安全性」，在页面下方点「仍要打开」。
5. 也可以在终端执行下面这一行，清掉下载隔离标记后再打开：

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

## 外观

四种外观：墨纸、石墨、暖米、霓虹玻璃。墨纸和石墨可以跟着系统的浅色和深色走。设置里还能改字号、字色、玻璃透度和壁纸。

macOS 26 及以上用液态玻璃，更早的系统用 HUD 毛玻璃。标题栏是透明的，可以拖动窗口。玻璃发白或边缘错位时，到设置里关掉透明。排查步骤在 [`docs/GLASS-CHECKLIST.md`](docs/GLASS-CHECKLIST.md)。

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

进仓库的是能重新做出这个应用的东西。

| 路径 | 内容 |
|---|---|
| `brand/` | 标志、字标，以及 README 用的浅色底卡片 |
| `src/` | 界面、编辑器、状态 |
| `src-tauri/` | 窗口、文件、历史、钥匙串、AI 请求、应用图标 |
| `docs/` | 技术方案、架构、玻璃排查 |
| `tests/` | 单元测试，以及浏览器里的排版和输入检查 |
| `public/` | 页面图标 |

这些不进仓库，也不该进：

| 不入库 | 原因 |
|---|---|
| `node_modules/` | 用 `npm install` 装回来 |
| `dist/` | 前端构建结果，打包时重新生成 |
| `src-tauri/target/` | Rust 编译缓存，体积以 GB 计 |
| `src-tauri/gen/` | Tauri 生成的模式文件 |
| `.env`、密钥、证书 | 密钥只留在钥匙串 |
| 测试报告、Playwright 浏览器、编辑器临时文件 | 本机缓存 |
| 安装包 `.dmg` / `.app` | 放在 [Releases](https://github.com/SenryLee/frisket/releases/tag/v1.0.0)，不放进 git 历史 |

更细的说明：

- [`docs/SPEC.md`](docs/SPEC.md)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/GLASS-CHECKLIST.md`](docs/GLASS-CHECKLIST.md)

## 许可

[MIT](LICENSE)
