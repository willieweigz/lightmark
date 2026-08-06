# 轻阅 Markdown

一个轻量、离线工作的 Windows 与 macOS Markdown 阅读编辑器。

- Windows：Tauri 2 + 系统 WebView2，不使用 Electron。
- macOS：原生 AppKit + WKWebView。
- 两端复用 `Resources/` 中的 GFM 排版、marked 与 DOMPurify 离线渲染资源。

## 功能

- 阅读、编辑、实时分栏预览三种模式
- 自动识别同文件夹 Markdown；阅读模式按 ← / → 连续翻阅上一篇、下一篇
- 可直接打开 Markdown 文件夹，并在可收起的左侧列表中点击跳转
- 文档按文件名自然排序，当前文档高亮，顶部显示当前位置与总数
- GFM Markdown：标题、列表、任务列表、表格、引用、代码块、链接、图片
- 完整 Obsidian Callout 类型与别名；支持 `[!type]-` 默认收起、`[!type]+` 默认展开和多层嵌套
- YAML Frontmatter 折叠显示、`[[Wiki Link]]` 友好显示
- 拖放打开 `.md`，支持打开文件、打开文件夹、保存、另存为和未保存修改保护
- Windows 支持 Ctrl+O、Ctrl+Shift+O、Ctrl+S、Ctrl+Shift+S 与 Ctrl+\\
- macOS 支持 ⌘O、⇧⌘O、⌘S、⇧⌘S 与 ⌘\\
- 顶部“语法”按钮提供标题、文字、列表、链接、图片、代码、表格、Callout、Wiki Link 与 Frontmatter 速查
- 跟随系统浅色/深色外观，Windows 版还可临时切换浅色或深色主题
- Markdown 渲染和安全过滤库均打包在应用内，不依赖 CDN 或网络

## Windows 开发与构建

前置环境：Microsoft C++ Build Tools（Desktop development with C++）、Rust MSVC 工具链、Node.js，以及 Windows 11 自带的 WebView2 Runtime。

```powershell
npm install
npm test
npm run tauri dev
npm run tauri build
```

生产构建会在 `src-tauri/target/release/bundle/nsis/` 生成当前用户安装的 `.exe`，安装器会注册 `.md` 与 `.markdown` 文件关联。应用本身完全离线渲染；安装器仅在目标电脑缺少 WebView2 时使用微软官方引导程序安装系统运行时。

## macOS 构建

运行 `zsh build.sh`，应用会生成到 `dist/轻阅 Markdown.app`。仅需 macOS 自带 Swift 命令行工具，不要求完整 Xcode。

第三方组件：marked（MIT）与 DOMPurify（Apache-2.0 / MPL-2.0）。
