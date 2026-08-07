# 轻阅 Markdown 后续计划

本文件记录已落实的讨论结果和仍需后续处理的平台工作。具体发布版本号以 Release 为准。

## 当前 Windows 开发分支已完成

- 分栏滚动提供“自动锚点 / 手动校准 / 关闭同步”三种状态；手动校准会持续保留位置差，并可用“重新对齐”清除。
- 语法速查直接显示 `&emsp;&emsp;`、两个中文全角空格、`<br>`、`<br><br>`，复制按钮只写入符号本身，不附带示例文字。
- 编辑模式输入 `<` 会显示受控候选：`<br>`、`<br><br>`、`<mark>高光文字</mark>`、`<span class="text-red">红色文字</span>`；支持鼠标、方向键、Enter、Tab 和 Esc。
- 修复长文档在普通窗口、Windows 最大化及全屏幕时只占顶部一小块的问题。
- 安全边界不变：不开放任意 HTML 候选，所有渲染仍经过 DOMPurify。

上述功能已经用长文档和 Examples 三篇文档完成 Windows WebView2 回归；合并、发布状态以 GitHub Pull Request 和 Releases 为准。

## 后续候选

### macOS 原生界面对齐

Windows 界面位于 `src/`，macOS 原生界面位于 `Sources/LightMark/main.swift`。共用 `Resources/` 会同步 Markdown 渲染能力，但滚动同步选择器、尖括号候选和语法复制按钮仍需在 macOS 原生代码中单独实现，并在 Mac 上完成编译和真实界面验收。

### 后续验收重点

- 在包含大量图片、超长表格和混合字号的文档中继续观察自动锚点精度。
- 在 macOS 完成对应功能后，验证其快捷键、系统剪贴板、窗口缩放和未保存保护没有回归。
- 发布新版本时同时更新 Windows 与 macOS 下载包，并在 Release Notes 中写明两端功能差异。
