# 轻阅 Markdown

一个原生、轻量、离线工作的 macOS Markdown 阅读与编辑器。

## 功能

- 阅读、编辑、分栏三种模式（⌘1 / ⌘2 / ⌘3）
- 自动识别同文件夹 Markdown；阅读模式按 ← / → 连续翻阅上一篇、下一篇
- 可直接打开 Markdown 文件夹，并在可收起的左侧列表中点击跳转
- GFM Markdown：标题、列表、任务列表、表格、引用、代码块、链接、图片
- Obsidian Callout：Note、Tip、Warning、Danger、Info 等
- YAML Frontmatter 折叠显示、`[[Wiki Link]]` 友好显示
- 拖放打开 `.md`，⌘O 打开文件，⇧⌘O 打开文件夹，⌘S 保存
- ⌘\\ 显示或隐藏文档列表，当前文档自动高亮
- 顶部“语法”按钮和帮助菜单提供 Markdown、Callout 常用写法速查
- 跟随系统浅色/深色外观
- Markdown 渲染和安全过滤库均打包在应用内，不依赖网络

## 构建

运行 `zsh build.sh`，应用会生成到 `dist/轻阅 Markdown.app`。仅需 macOS 自带 Swift 命令行工具，不要求完整 Xcode。

第三方组件：marked（MIT）与 DOMPurify（Apache-2.0 / MPL-2.0）。
