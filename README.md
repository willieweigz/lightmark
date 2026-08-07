# 轻阅 Markdown

一个面向 Windows 与 macOS 的轻量、原生、离线 Markdown 阅读编辑器。

轻阅专注于打开本地文档和文件夹、连续阅读、快速修改与安全预览。应用不依赖 Electron，不连接 CDN，也不会让 Markdown 文档执行不受信任脚本。

## 下载

不需要安装开发工具，请直接从 [GitHub Releases](https://github.com/willieweigz/lightmark/releases/latest) 下载最新版：

| 系统 | 下载 | 适用范围 |
| --- | --- | --- |
| Windows | [下载 Windows x64 安装版](https://github.com/willieweigz/lightmark/releases/latest/download/LightMark_Windows_x64_Setup.exe) | Windows 11 64 位 |
| macOS | [下载 macOS 通用版](https://github.com/willieweigz/lightmark/releases/latest/download/LightMark_macOS_Universal.zip) | macOS 13 及以上，Apple 芯片与 Intel 芯片 |

### Windows 安装

1. 下载 `LightMark_Windows_x64_Setup.exe` 并运行。
2. 安装完成后，从开始菜单打开“轻阅 Markdown”。
3. 也可以右键 `.md` 或 `.markdown` 文件，选择“打开方式 → 轻阅 Markdown”。

安装包目前没有商业代码签名。如果 Windows SmartScreen 提示“Windows 已保护你的电脑”，请确认文件来自本仓库，然后选择“更多信息 → 仍要运行”。

### macOS 安装

1. 下载并解压 `LightMark_macOS_Universal.zip`。
2. 将“轻阅 Markdown.app”拖入“应用程序”文件夹。
3. 首次运行时按住 Control 点击应用，选择“打开”，再确认一次“打开”。

macOS 包目前使用临时签名，没有 Apple Developer ID 签名与公证，因此首次打开需要上述确认。

## 平台

| 平台 | 桌面实现 | 系统渲染引擎 | 分发方式 |
| --- | --- | --- | --- |
| Windows 11 | Tauri 2 | WebView2 | NSIS `.exe` 安装包 |
| macOS | AppKit | WKWebView | 原生 `.app` |

两端共用 `Resources/` 中的 GFM 排版、marked 和 DOMPurify 离线渲染资源，同时保留各自的原生窗口、菜单、文件操作与系统主题体验。Windows 的界面交互位于 `src/`，macOS 的界面交互位于 `Sources/`；新增界面功能需要分别实现和验收，不会仅因共用渲染器而自动同步。

## 功能

- 阅读、编辑、实时分栏预览三种模式
- 分栏模式可一键交换编辑区与预览区；文档列表和中间分隔条均可拖动，并记住上次宽度与位置
- 分栏编辑可选择“自动锚点 / 手动校准 / 关闭同步”；手动移动预览后会保留位置差，也可随时“重新对齐”
- 长文档在普通窗口、Windows 最大化和全屏幕下都会占满可用内容高度
- 编辑工具栏提供浅黄色高光和红色文字笔；可先选中文字再点击，也可先开启画笔再拖选文字；编辑区也会直接显示标记效果，同时保留原始 Markdown 代码
- Windows 编辑工具栏可一键插入 `&emsp;&emsp;` 和 `<br><br>`，也可使用 `Alt+1`、`Alt+2`
- 编辑时输入 `<` 会出现受控的安全候选，可插入 `<br>`、`<br><br>`、黄色高光和红色文字格式
- Windows 提供 Markdown 原文、纯文本和富文本三种整篇复制；富文本可粘贴到 Word 等应用并保留排版
- Windows 支持工具栏或 F11 进入全屏幕，并用 Ctrl+F 查找当前文档文字
- 打开单个 `.md` / `.markdown`，或打开整个文件夹
- 自动列出同文件夹第一层 Markdown，按文件名自然排序
- 左侧可切换“文档 / 本文目录”；目录按标题层级缩进，点击即可在阅读或编辑位置跳转
- 可收起文档列表、当前文档高亮、顶部显示当前位置与总数
- 阅读模式使用 ← / → 连续翻阅；编辑模式方向键只移动光标
- 保存、另存为、未保存修改保护和拖放打开
- GFM：标题、粗体、斜体、删除线、列表、任务列表、表格、引用、行内代码、代码块、链接、自动链接、图片、分隔线和转义
- 相对路径本地图片、Obsidian `![[asset/图片.png|宽度]]` 图片、外部链接，以及可点击跳转的相对 Markdown 链接与 `[[Wiki Link]]`
- Obsidian Callout 全部内置类型与别名、自定义标题、默认展开或收起、多层嵌套
- YAML Frontmatter 折叠显示、`[[Wiki Link]]` 友好显示
- Markdown 语法速查提供可直接复制的格式模板，包含完整 Callout，以及只复制符号本身的 `&emsp;&emsp;`、两个全角空格、`<br>` 和 `<br><br>`
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
| 撤销 / 重做 | `Ctrl+Z` / `Ctrl+Y` | `⌘Z` / `⇧⌘Z` |
| 复制选中文字 | `Ctrl+C` | `⌘C` |
| 插入 `&emsp;&emsp;` | `Alt+1` | — |
| 插入 `<br><br>` | `Alt+2` | — |
| 复制整篇 Markdown 原文 | `Ctrl+Shift+C` | `⇧⌘C` |
| 复制纯文本 / 富文本 | 工具栏“复制”菜单 | — |
| 显示或隐藏文档列表 | `Ctrl+\` | `⌘\` |
| 查找当前文档 | `Ctrl+F` | — |
| 打开语法速查 | `Ctrl+/` | `⌘F` 或 `⌘/` |
| 进入或退出全屏幕 | `F11` | `⌃⌘F` |
| 阅读模式上一篇 / 下一篇 | `←` / `→` | `←` / `→` |

## 安全与离线

- Markdown 解析和净化库均存放在仓库与应用包内，运行时不依赖网络
- 渲染结果经过 DOMPurify 清理
- 禁止 Markdown 中的脚本和事件处理器执行
- 远程图片默认阻止；相对路径图片由应用从本地读取
- 外部链接交给系统默认浏览器打开

## 代码签名政策

Windows 开源代码签名的适用范围、发布审批、维护者角色、隐私和卸载说明见 [Code signing policy](CODE_SIGNING_POLICY.md)。项目正在申请 SignPath Foundation 的免费开源代码签名；在获批并接入发布流程以前，下载页会继续明确标注安装包尚未签名。

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

## 开源许可证

轻阅 Markdown 自身代码采用 [MIT License](LICENSE) 开源：任何人都可以免费使用、复制、修改和分发，也可以用于商业项目，但必须保留原作者的版权与许可证声明。软件按现状提供，作者不承诺适用于所有场景，也不对使用软件造成的损失承担担保责任。

应用内置第三方组件仍分别遵循各自的许可证，详情见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
