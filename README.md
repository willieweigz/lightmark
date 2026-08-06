# 轻阅 Markdown

一个面向 Windows 与 macOS 的轻量、原生、离线 Markdown 阅读编辑器。

轻阅专注于打开本地文档和文件夹、连续阅读、快速修改与安全预览。应用不依赖 Electron，不连接 CDN，也不会让 Markdown 文档执行不受信任脚本。

## 平台

| 平台 | 桌面实现 | 系统渲染引擎 | 分发方式 |
| --- | --- | --- | --- |
| Windows 11 | Tauri 2 | WebView2 | NSIS `.exe` 安装包 |
| macOS | AppKit | WKWebView | 原生 `.app` |

两端共用 `Resources/` 中的 GFM 排版、marked 和 DOMPurify 离线渲染资源，同时保留各自的原生窗口、菜单、文件操作与系统主题体验。

## 功能

- 阅读、编辑、实时分栏预览三种模式
- 打开单个 `.md` / `.markdown`，或打开整个文件夹
- 自动列出同文件夹第一层 Markdown，按文件名自然排序
- 可收起文档列表、当前文档高亮、顶部显示当前位置与总数
- 阅读模式使用 ← / → 连续翻阅；编辑模式方向键只移动光标
- 保存、另存为、未保存修改保护和拖放打开
- GFM：标题、列表、任务列表、表格、引用、代码块、链接和图片
- 相对路径本地图片与外部链接
- Obsidian Callout 全部内置类型与别名、自定义标题、默认展开或收起、多层嵌套
- YAML Frontmatter 折叠显示、`[[Wiki Link]]` 友好显示
- Markdown 语法速查与搜索
- 跟随系统浅色/深色外观；Windows 还可临时切换主题
- Windows 单实例运行，并注册 `.md` / `.markdown`“打开方式”
- marked 与 DOMPurify 随应用打包，全程离线渲染

## 快捷键

| 操作 | Windows | macOS |
| --- | --- | --- |
| 打开文件 | `Ctrl+O` | `⌘O` |
| 打开文件夹 | `Ctrl+Shift+O` | `⇧⌘O` |
| 保存 | `Ctrl+S` | `⌘S` |
| 另存为 | `Ctrl+Shift+S` | `⇧⌘S` |
| 显示或隐藏文档列表 | `Ctrl+\` | `⌘\` |
| 打开语法搜索 | `Ctrl+F` 或 `Ctrl+/` | `⌘F` 或 `⌘/` |
| 阅读模式上一篇 / 下一篇 | `←` / `→` | `←` / `→` |

## 安全与离线

- Markdown 解析和净化库均存放在仓库与应用包内，运行时不依赖网络
- 渲染结果经过 DOMPurify 清理
- 禁止 Markdown 中的脚本和事件处理器执行
- 远程图片默认阻止；相对路径图片由应用从本地读取
- 外部链接交给系统默认浏览器打开

## Windows 开发与构建

前置环境：

- Windows 11 与 WebView2 Runtime
- Microsoft C++ Build Tools（Desktop development with C++）
- Rust MSVC 工具链
- Node.js

```powershell
npm install
npm test
npm run tauri dev
npm run tauri build
```

生产构建会在 `src-tauri/target/release/bundle/nsis/` 生成当前用户安装的 `.exe`。安装器会注册 `.md` 与 `.markdown` 文件类型；如果目标电脑缺少 WebView2，安装器会调用微软官方引导程序安装系统运行时。

## macOS 开发与构建

```zsh
zsh build.sh
```

应用会生成到 `dist/轻阅 Markdown.app`。构建仅需要 macOS 自带的 Swift 命令行工具，不要求完整 Xcode。

## 目录结构

```text
Resources/          两端共用的离线 Markdown 渲染资源
Sources/            macOS AppKit / WKWebView 源码
src/                Windows 前端界面与交互
src-tauri/          Windows Tauri / Rust 原生能力与安装配置
Examples/           示例 Markdown 文档
build.sh            macOS 构建脚本
```

## 第三方组件

- [marked](https://github.com/markedjs/marked) — MIT
- [DOMPurify](https://github.com/cure53/DOMPurify) — Apache-2.0 / MPL-2.0
- [Tauri](https://tauri.app/) — Apache-2.0 / MIT
