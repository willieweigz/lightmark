import AppKit
import UniformTypeIdentifiers
import WebKit

private let markdownExtensions: Set<String> = ["md", "markdown"]
private let directlyReadableTextExtensions: Set<String> = ["md", "markdown", "txt"]
private let imageExtensions: Set<String> = ["png", "jpg", "jpeg", "webp", "gif", "bmp"]

private func isMarkdownURL(_ url: URL) -> Bool {
    markdownExtensions.contains(url.pathExtension.lowercased())
}

private func isImageURL(_ url: URL) -> Bool {
    imageExtensions.contains(url.pathExtension.lowercased())
}

private func isSupportedContentURL(_ url: URL) -> Bool {
    directlyReadableTextExtensions.contains(url.pathExtension.lowercased()) || isImageURL(url)
}

private enum ContentKind {
    case markdown
    case image
}

private enum ViewMode: Int {
    case reading = 0
    case editing = 1
    case split = 2
}

private enum SidebarMode: Int {
    case images = 0
    case documents = 1
    case outline = 2
}

private enum ImageZoomMode: String {
    case fit
    case actual
    case custom
}

private struct DocumentHeading {
    let level: Int
    let title: String
    let range: NSRange
}

private enum InlineFormatTool: Equatable {
    case highlight
    case redText

    var opening: String {
        switch self {
        case .highlight: return "<mark>"
        case .redText: return "<span class=\"text-red\">"
        }
    }

    var closing: String {
        switch self {
        case .highlight: return "</mark>"
        case .redText: return "</span>"
        }
    }

    var label: String {
        switch self {
        case .highlight: return "黄色高光笔"
        case .redText: return "红色笔"
        }
    }
}

private final class ImageCanvasView: NSView {
    let imageView = NSImageView()
    weak var hostingScrollView: NSScrollView?
    private var dragStartLocation: NSPoint?
    private var dragStartOrigin: NSPoint?
    private var cursorPushed = false
    private(set) var naturalSize = NSSize.zero
    private(set) var scale: CGFloat = 1

    override var isFlipped: Bool { true }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        imageView.imageAlignment = .alignCenter
        imageView.imageScaling = .scaleAxesIndependently
        imageView.animates = true
        imageView.isEditable = false
        addSubview(imageView)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func setImage(_ image: NSImage?, naturalSize: NSSize = .zero) {
        imageView.image = image
        self.naturalSize = naturalSize
        needsLayout = true
        window?.invalidateCursorRects(for: self)
    }

    func updateScale(_ scale: CGFloat, viewportSize: NSSize) {
        self.scale = scale
        let imageWidth = max(1, naturalSize.width * scale)
        let imageHeight = max(1, naturalSize.height * scale)
        let canvasWidth = max(viewportSize.width, imageWidth + 48)
        let canvasHeight = max(viewportSize.height, imageHeight + 48)
        frame = NSRect(x: 0, y: 0, width: canvasWidth, height: canvasHeight)
        imageView.frame = NSRect(
            x: max(24, (canvasWidth - imageWidth) / 2),
            y: max(24, (canvasHeight - imageHeight) / 2),
            width: imageWidth,
            height: imageHeight
        )
    }

    override func resetCursorRects() {
        super.resetCursorRects()
        addCursorRect(bounds, cursor: .openHand)
    }

    override func mouseDown(with event: NSEvent) {
        guard let scrollView = hostingScrollView else { return }
        dragStartLocation = event.locationInWindow
        dragStartOrigin = scrollView.contentView.bounds.origin
        NSCursor.closedHand.push()
        cursorPushed = true
    }

    override func mouseDragged(with event: NSEvent) {
        guard let scrollView = hostingScrollView,
              let dragStartLocation,
              let dragStartOrigin else { return }
        let deltaX = event.locationInWindow.x - dragStartLocation.x
        let deltaY = event.locationInWindow.y - dragStartLocation.y
        let proposed = NSRect(
            x: dragStartOrigin.x - deltaX,
            y: dragStartOrigin.y + deltaY,
            width: scrollView.contentView.bounds.width,
            height: scrollView.contentView.bounds.height
        )
        let constrained = scrollView.contentView.constrainBoundsRect(proposed)
        scrollView.contentView.scroll(to: constrained.origin)
        scrollView.reflectScrolledClipView(scrollView.contentView)
    }

    override func mouseUp(with event: NSEvent) {
        dragStartLocation = nil
        dragStartOrigin = nil
        if cursorPushed {
            NSCursor.pop()
            cursorPushed = false
        }
    }
}

private final class ImageScrollView: NSScrollView {
    var onZoomStep: ((CGFloat) -> Void)?

    override func scrollWheel(with event: NSEvent) {
        guard abs(event.scrollingDeltaY) >= abs(event.scrollingDeltaX), event.scrollingDeltaY != 0 else {
            super.scrollWheel(with: event)
            return
        }
        onZoomStep?(event.scrollingDeltaY < 0 ? 1.12 : 1 / 1.12)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var documents: [DocumentWindowController] = []
    private var pendingOpenURLs: [URL] = []
    private var hasFinishedLaunching = false
    private var currentDocument: DocumentWindowController? {
        documents.first(where: { $0.window?.isKeyWindow == true }) ?? documents.last
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenus()
        hasFinishedLaunching = true
        let startupURLs = pendingOpenURLs
        pendingOpenURLs.removeAll()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            guard let self else { return }
            if startupURLs.isEmpty {
                if self.documents.isEmpty { self.showDocument(url: nil) }
            } else {
                startupURLs.forEach { self.showDocument(url: $0) }
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func application(_ application: NSApplication, shouldSaveApplicationState coder: NSCoder) -> Bool { false }

    func application(_ application: NSApplication, shouldRestoreApplicationState coder: NSCoder) -> Bool { false }

    func application(_ sender: NSApplication, openFiles filenames: [String]) {
        let urls = filenames.map { URL(fileURLWithPath: $0) }
        if hasFinishedLaunching {
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                urls.forEach { self.showDocument(url: $0) }
            }
        } else {
            pendingOpenURLs.append(contentsOf: urls)
        }
        sender.reply(toOpenOrPrint: .success)
    }

    @objc private func openDocument(_ sender: Any?) {
        let panel = NSOpenPanel()
        panel.title = "打开 Markdown 或图片"
        panel.allowedContentTypes = (["md", "markdown", "png", "jpg", "jpeg", "webp", "gif", "bmp"]
            .compactMap { UTType(filenameExtension: $0) }) + [.plainText]
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.directoryURL = currentDocument?.fileURL?.deletingLastPathComponent()
        guard panel.runModal() == .OK else { return }
        panel.urls.forEach { showDocument(url: $0) }
    }

    @objc private func openFolder(_ sender: Any?) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "打开文件夹"
        panel.directoryURL = currentDocument?.fileURL?.deletingLastPathComponent()
        guard panel.runModal() == .OK, let directory = panel.url else { return }
        let files = ((try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles]
        )) ?? []).filter {
            (isMarkdownURL($0) || isImageURL($0))
                && ((try? $0.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) ?? false)
        }.sorted {
            $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending
        }
        guard let first = files.first else {
            let alert = NSAlert()
            alert.messageText = "这个文件夹里没有可阅读文件"
            alert.informativeText = "请选择第一层包含 Markdown、PNG、JPG、WebP、GIF 或 BMP 的文件夹。"
            alert.runModal()
            return
        }
        showDocument(url: first)
    }

    @objc private func saveDocument(_ sender: Any?) { currentDocument?.save(sender) }
    @objc private func saveDocumentAs(_ sender: Any?) { currentDocument?.saveAs(sender) }
    @objc private func showReading(_ sender: Any?) { currentDocument?.showReading(sender) }
    @objc private func showEditing(_ sender: Any?) { currentDocument?.showEditing(sender) }
    @objc private func showSplit(_ sender: Any?) { currentDocument?.showSplit(sender) }
    @objc private func zoomIn(_ sender: Any?) { currentDocument?.zoomIn(sender) }
    @objc private func zoomOut(_ sender: Any?) { currentDocument?.zoomOut(sender) }
    @objc private func zoomReset(_ sender: Any?) { currentDocument?.zoomReset(sender) }
    @objc private func toggleSidebar(_ sender: Any?) { currentDocument?.toggleSidebar(sender) }
    @objc private func showMarkdownSyntax(_ sender: Any?) { currentDocument?.showSyntaxGuide(sender) }
    @objc private func copyMarkdownDocument(_ sender: Any?) { currentDocument?.copyMarkdownSource(sender) }

    private func showDocument(url: URL?) {
        if let url,
           let existing = documents.first(where: { $0.fileURL?.standardizedFileURL == url.standardizedFileURL }) {
            existing.showWindow(nil)
            existing.window?.makeKeyAndOrderFront(nil)
            return
        }
        let controller = DocumentWindowController(fileURL: url)
        controller.onClose = { [weak self, weak controller] in
            guard let self, let controller else { return }
            self.documents.removeAll { $0 === controller }
        }
        documents.append(controller)
        controller.showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func buildMenus() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "关于轻阅 Markdown", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出轻阅 Markdown", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let fileItem = NSMenuItem()
        main.addItem(fileItem)
        let fileMenu = NSMenu(title: "文件")
        fileMenu.addItem(withTitle: "打开…", action: #selector(openDocument(_:)), keyEquivalent: "o").target = self
        let openFolder = fileMenu.addItem(withTitle: "打开文件夹…", action: #selector(openFolder(_:)), keyEquivalent: "O")
        openFolder.target = self
        openFolder.keyEquivalentModifierMask = [.command, .shift]
        fileMenu.addItem(.separator())
        let save = fileMenu.addItem(withTitle: "保存", action: #selector(saveDocument(_:)), keyEquivalent: "s")
        save.target = self
        let saveAs = fileMenu.addItem(withTitle: "另存为…", action: #selector(saveDocumentAs(_:)), keyEquivalent: "S")
        saveAs.target = self
        saveAs.keyEquivalentModifierMask = [.command, .shift]
        fileMenu.addItem(.separator())
        fileMenu.addItem(withTitle: "关闭窗口", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        fileItem.submenu = fileMenu

        let editItem = NSMenuItem()
        main.addItem(editItem)
        let editMenu = NSMenu(title: "编辑")
        editMenu.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "Z").keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "复制", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        let copyMarkdown = editMenu.addItem(withTitle: "复制整篇 Markdown", action: #selector(copyMarkdownDocument(_:)), keyEquivalent: "C")
        copyMarkdown.target = self
        copyMarkdown.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu

        let viewItem = NSMenuItem()
        main.addItem(viewItem)
        let viewMenu = NSMenu(title: "显示")
        let reading = viewMenu.addItem(withTitle: "阅读模式", action: #selector(showReading(_:)), keyEquivalent: "1")
        reading.target = self
        let editing = viewMenu.addItem(withTitle: "编辑模式", action: #selector(showEditing(_:)), keyEquivalent: "2")
        editing.target = self
        let split = viewMenu.addItem(withTitle: "分栏模式", action: #selector(showSplit(_:)), keyEquivalent: "3")
        split.target = self
        viewMenu.addItem(.separator())
        let sidebar = viewMenu.addItem(withTitle: "显示或隐藏文档列表", action: #selector(toggleSidebar(_:)), keyEquivalent: "\\")
        sidebar.target = self
        sidebar.keyEquivalentModifierMask = [.command]
        viewMenu.addItem(.separator())
        let larger = viewMenu.addItem(withTitle: "放大", action: #selector(zoomIn(_:)), keyEquivalent: "+")
        larger.target = self
        let smaller = viewMenu.addItem(withTitle: "缩小", action: #selector(zoomOut(_:)), keyEquivalent: "-")
        smaller.target = self
        let actual = viewMenu.addItem(withTitle: "实际大小", action: #selector(zoomReset(_:)), keyEquivalent: "0")
        actual.target = self
        viewMenu.addItem(.separator())
        let fullScreen = viewMenu.addItem(withTitle: "进入全屏幕", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fullScreen.keyEquivalentModifierMask = [.control, .command]
        viewItem.submenu = viewMenu

        let windowItem = NSMenuItem()
        main.addItem(windowItem)
        let windowMenu = NSMenu(title: "窗口")
        windowMenu.addItem(withTitle: "最小化", action: #selector(NSWindow.miniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "缩放", action: #selector(NSWindow.zoom(_:)), keyEquivalent: "")
        windowItem.submenu = windowMenu
        NSApp.windowsMenu = windowMenu

        let helpItem = NSMenuItem()
        main.addItem(helpItem)
        let helpMenu = NSMenu(title: "帮助")
        let syntax = helpMenu.addItem(withTitle: "Markdown 语法速查（⌘F / ⌘/）", action: #selector(showMarkdownSyntax(_:)), keyEquivalent: "/")
        syntax.target = self
        syntax.keyEquivalentModifierMask = [.command]
        helpItem.submenu = helpMenu
        NSApp.helpMenu = helpMenu

        NSApp.mainMenu = main
    }
}

private final class DocumentWindow: NSWindow {
    weak var documentController: DocumentWindowController?

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        let modifiers = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        let key = event.charactersIgnoringModifiers?.lowercased()
        if modifiers == [.command], key == "f" || key == "/" {
            documentController?.showSyntaxGuide(nil)
            return true
        }
        if modifiers == [.command, .shift], key == "c" {
            documentController?.copyMarkdownSource(nil)
            return true
        }
        if modifiers == [.control, .command], key == "f" {
            toggleFullScreen(nil)
            return true
        }
        return super.performKeyEquivalent(with: event)
    }

    override func keyDown(with event: NSEvent) {
        if documentController?.handleNavigationKey(event) == true { return }
        super.keyDown(with: event)
    }
}

private final class FormattingTextView: NSTextView {
    var onMouseSelectionFinished: (() -> Void)?
    var onCancelFormatTool: (() -> Bool)?

    override func mouseUp(with event: NSEvent) {
        super.mouseUp(with: event)
        onMouseSelectionFinished?()
    }

    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53, onCancelFormatTool?() == true { return }
        super.keyDown(with: event)
    }
}

private final class SyntaxGuideViewController: NSViewController, NSSearchFieldDelegate {
    private let guideText: String
    private let searchField = NSSearchField()
    private let resultLabel = NSTextField(labelWithString: "")
    private let guideView = NSTextView(frame: NSRect(x: 0, y: 0, width: 410, height: 2200))
    private var matches: [NSRange] = []
    private var currentMatch = 0

    init(guideText: String) {
        self.guideText = guideText
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func loadView() {
        let root = NSVisualEffectView(frame: NSRect(x: 0, y: 0, width: 450, height: 570))
        root.material = .popover
        root.state = .active

        let heading = NSTextField(labelWithString: "Markdown 语法速查")
        heading.font = .systemFont(ofSize: 16, weight: .semibold)
        heading.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(heading)

        searchField.placeholderString = "搜索语法，例如 Callout、折叠、图片"
        searchField.sendsSearchStringImmediately = true
        searchField.delegate = self
        searchField.target = self
        searchField.action = #selector(searchSubmitted(_:))
        searchField.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(searchField)

        resultLabel.font = .monospacedDigitSystemFont(ofSize: 11, weight: .regular)
        resultLabel.textColor = .secondaryLabelColor
        resultLabel.alignment = .right
        resultLabel.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(resultLabel)

        let previous = NSButton(title: "‹", target: self, action: #selector(previousResult(_:)))
        previous.bezelStyle = .inline
        previous.toolTip = "上一个结果（Shift+Enter）"
        previous.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(previous)

        let next = NSButton(title: "›", target: self, action: #selector(nextResult(_:)))
        next.bezelStyle = .inline
        next.toolTip = "下一个结果（Enter）"
        next.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(next)

        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.drawsBackground = false
        scroll.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(scroll)

        guideView.isEditable = false
        guideView.isSelectable = true
        guideView.drawsBackground = false
        guideView.font = .monospacedSystemFont(ofSize: 12.5, weight: .regular)
        guideView.textColor = .labelColor
        guideView.textContainerInset = NSSize(width: 8, height: 8)
        guideView.autoresizingMask = [.width]
        guideView.minSize = NSSize(width: 0, height: 0)
        guideView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        guideView.isVerticallyResizable = true
        guideView.isHorizontallyResizable = false
        guideView.textContainer?.widthTracksTextView = true
        guideView.textContainer?.containerSize = NSSize(width: 414, height: CGFloat.greatestFiniteMagnitude)
        guideView.string = guideText
        scroll.documentView = guideView

        NSLayoutConstraint.activate([
            heading.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 18),
            heading.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -18),
            heading.topAnchor.constraint(equalTo: root.topAnchor, constant: 16),
            searchField.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 16),
            searchField.topAnchor.constraint(equalTo: heading.bottomAnchor, constant: 12),
            searchField.widthAnchor.constraint(greaterThanOrEqualToConstant: 250),
            resultLabel.leadingAnchor.constraint(equalTo: searchField.trailingAnchor, constant: 8),
            resultLabel.centerYAnchor.constraint(equalTo: searchField.centerYAnchor),
            resultLabel.widthAnchor.constraint(equalToConstant: 45),
            previous.leadingAnchor.constraint(equalTo: resultLabel.trailingAnchor, constant: 3),
            previous.centerYAnchor.constraint(equalTo: searchField.centerYAnchor),
            previous.widthAnchor.constraint(equalToConstant: 25),
            next.leadingAnchor.constraint(equalTo: previous.trailingAnchor, constant: 1),
            next.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -12),
            next.centerYAnchor.constraint(equalTo: searchField.centerYAnchor),
            next.widthAnchor.constraint(equalToConstant: 25),
            scroll.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 10),
            scroll.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -10),
            scroll.topAnchor.constraint(equalTo: searchField.bottomAnchor, constant: 10),
            scroll.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -10)
        ])

        view = root
    }

    func focusSearch() {
        _ = view
        view.window?.makeFirstResponder(searchField)
    }

    func controlTextDidChange(_ obj: Notification) {
        rebuildMatches()
    }

    func control(_ control: NSControl, textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
        if commandSelector == #selector(NSResponder.cancelOperation(_:)), !searchField.stringValue.isEmpty {
            searchField.stringValue = ""
            rebuildMatches()
            return true
        }
        return false
    }

    @objc private func searchSubmitted(_ sender: Any?) {
        let backwards = NSApp.currentEvent?.modifierFlags.contains(.shift) == true
        moveResult(by: backwards ? -1 : 1)
    }

    @objc private func previousResult(_ sender: Any?) { moveResult(by: -1) }
    @objc private func nextResult(_ sender: Any?) { moveResult(by: 1) }

    private func rebuildMatches() {
        guard let storage = guideView.textStorage else { return }
        let fullRange = NSRange(location: 0, length: storage.length)
        storage.removeAttribute(.backgroundColor, range: fullRange)
        matches.removeAll()
        currentMatch = 0

        let query = searchField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else {
            resultLabel.stringValue = ""
            return
        }

        let source = storage.string as NSString
        var searchRange = NSRange(location: 0, length: source.length)
        while searchRange.length > 0 {
            let found = source.range(of: query, options: [.caseInsensitive, .diacriticInsensitive], range: searchRange)
            guard found.location != NSNotFound else { break }
            matches.append(found)
            let nextLocation = found.location + max(found.length, 1)
            guard nextLocation <= source.length else { break }
            searchRange = NSRange(location: nextLocation, length: source.length - nextLocation)
        }

        for range in matches {
            storage.addAttribute(.backgroundColor, value: NSColor.systemYellow.withAlphaComponent(0.58), range: range)
        }
        showCurrentMatch()
    }

    private func moveResult(by offset: Int) {
        guard !matches.isEmpty else { return }
        currentMatch = (currentMatch + offset + matches.count) % matches.count
        showCurrentMatch()
    }

    private func showCurrentMatch() {
        guard let storage = guideView.textStorage else { return }
        for range in matches {
            storage.addAttribute(.backgroundColor, value: NSColor.systemYellow.withAlphaComponent(0.58), range: range)
        }
        guard !matches.isEmpty else {
            resultLabel.stringValue = "0 / 0"
            return
        }
        let active = matches[currentMatch]
        storage.addAttribute(.backgroundColor, value: NSColor.systemOrange.withAlphaComponent(0.86), range: active)
        guideView.scrollRangeToVisible(active)
        resultLabel.stringValue = "\(currentMatch + 1) / \(matches.count)"
    }
}

final class DocumentWindowController: NSWindowController, NSWindowDelegate, NSTextViewDelegate, WKNavigationDelegate, NSTableViewDataSource, NSTableViewDelegate, NSSplitViewDelegate {
    var onClose: (() -> Void)?
    private(set) var fileURL: URL?
    private var lastSavedText = ""
    private var renderWorkItem: DispatchWorkItem?
    private var webReady = false
    private var fontScale = 1.0
    private var currentContentKind = ContentKind.markdown
    private var currentMode = ViewMode.reading
    private var documentURLs: [URL] = []
    private var imageURLs: [URL] = []
    private var documentHeadings: [DocumentHeading] = []
    private var sidebarMode = SidebarMode.documents
    private var sidebarVisible = false
    private var didChooseInitialSidebarVisibility = false
    private var isUpdatingSidebarSelection = false
    private var syntaxPopover: NSPopover?
    private var syntaxGuideController: SyntaxGuideViewController?
    private var copyFeedbackWorkItem: DispatchWorkItem?
    private var activeFormatTool: InlineFormatTool?
    private var isApplyingSplitLayout = false
    private var editorOnRight = UserDefaults.standard.bool(forKey: "LightMarkEditorOnRight")
    private var editorSplitRatio: CGFloat = {
        let stored = UserDefaults.standard.double(forKey: "LightMarkEditorSplitRatio")
        return stored >= 0.25 && stored <= 0.75 ? CGFloat(stored) : 0.44
    }()
    private var sidebarWidth: CGFloat = {
        let stored = UserDefaults.standard.double(forKey: "LightMarkSidebarWidth")
        return stored >= 170 && stored <= 310 ? CGFloat(stored) : 220
    }()
    private var imageZoomMode: ImageZoomMode = {
        guard let raw = UserDefaults.standard.string(forKey: "LightMarkImageZoomMode"),
              let mode = ImageZoomMode(rawValue: raw) else { return .fit }
        return mode
    }()
    private var imageScale: CGFloat = {
        let stored = UserDefaults.standard.double(forKey: "LightMarkImageZoomScale")
        return stored >= 0.05 && stored <= 8 ? CGFloat(stored) : 1
    }()

    private let sidebarToggleButton = NSButton(title: "☰", target: nil, action: nil)
    private let modeControl = NSSegmentedControl(labels: ["阅读", "编辑", "分栏"], trackingMode: .selectOne, target: nil, action: nil)
    private let syntaxButton = NSButton(title: "语法", target: nil, action: nil)
    private let copyButton = NSButton(title: "", target: nil, action: nil)
    private let titleLabel = NSTextField(labelWithString: "未命名")
    private let statusLabel = NSTextField(labelWithString: "")
    private let previousButton = NSButton(title: "‹", target: nil, action: nil)
    private let nextButton = NSButton(title: "›", target: nil, action: nil)
    private let positionLabel = NSTextField(labelWithString: "")
    private let editorContainer = NSView()
    private let formattingBar = NSVisualEffectView()
    private let formattingHint = NSTextField(labelWithString: "先选中文字再点按钮，或先开启画笔再拖选")
    private let highlightButton = NSButton(title: "黄色高光", target: nil, action: nil)
    private let redTextButton = NSButton(title: "红色笔", target: nil, action: nil)
    private let paneSwapButton = NSButton(title: "⇄ 换边", target: nil, action: nil)
    private let editor = FormattingTextView()
    private let editorScroll = NSScrollView()
    private let webView: WKWebView
    private let splitView = NSSplitView()
    private let contentHost = NSView()
    private let imageViewer = NSView()
    private let imageToolbar = NSVisualEffectView()
    private let imageZoomOutButton = NSButton(title: "−", target: nil, action: nil)
    private let imageZoomLabel = NSTextField(labelWithString: "适合")
    private let imageZoomInButton = NSButton(title: "+", target: nil, action: nil)
    private let imageFitButton = NSButton(title: "适合窗口", target: nil, action: nil)
    private let imageActualButton = NSButton(title: "原始大小", target: nil, action: nil)
    private let imageGestureHint = NSTextField(labelWithString: "滚轮缩放 · 拖动查看大图")
    private let imageDetailsLabel = NSTextField(labelWithString: "")
    private let imageScroll = ImageScrollView()
    private let imageCanvas = ImageCanvasView()
    private let documentAreaSplitView = NSSplitView()
    private let sidebarContainer = NSVisualEffectView()
    private let sidebarModeControl = NSSegmentedControl(labels: ["图片", "文档", "本文目录"], trackingMode: .selectOne, target: nil, action: nil)
    private let sidebarScroll = NSScrollView()
    private let sidebarTable = NSTableView()

    init(fileURL: URL?) {
        self.fileURL = fileURL
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        self.webView = WKWebView(frame: .zero, configuration: config)

        let window = DocumentWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1040, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isRestorable = false
        window.minSize = NSSize(width: 640, height: 420)
        window.center()
        super.init(window: window)
        window.documentController = self
        window.delegate = self
        setupUI()
        load(fileURL)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    deinit { NotificationCenter.default.removeObserver(self) }

    private var hasUnsavedChanges: Bool {
        currentContentKind == .markdown && editor.string != lastSavedText
    }
    private static let outlineFenceRegex = try! NSRegularExpression(pattern: #"^ {0,3}(`{3,}|~{3,})"#)
    private static let outlineHeadingRegex = try! NSRegularExpression(pattern: #"^ {0,3}(#{1,6})(?:[ \t]+|$)(.*)$"#)
    private static let outlineSetextRegex = try! NSRegularExpression(pattern: #"^ {0,3}(=+|-+)[ \t]*$"#)

    private func setupUI() {
        guard let window else { return }
        let root = DropView(frame: .zero)
        root.translatesAutoresizingMaskIntoConstraints = false
        root.onDrop = { [weak self] url in self?.replaceDocument(with: url) }
        window.contentView = root

        let topBar = NSVisualEffectView()
        topBar.material = .headerView
        topBar.blendingMode = .withinWindow
        topBar.state = .active
        topBar.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(topBar)

        sidebarToggleButton.bezelStyle = .inline
        sidebarToggleButton.isBordered = false
        if let image = NSImage(systemSymbolName: "sidebar.left", accessibilityDescription: "文档列表") {
            sidebarToggleButton.image = image
            sidebarToggleButton.title = ""
        }
        sidebarToggleButton.target = self
        sidebarToggleButton.action = #selector(toggleSidebar(_:))
        sidebarToggleButton.toolTip = "显示或隐藏文档列表（⌘\\）"
        sidebarToggleButton.translatesAutoresizingMaskIntoConstraints = false
        topBar.addSubview(sidebarToggleButton)

        modeControl.selectedSegment = ViewMode.reading.rawValue
        modeControl.segmentStyle = .rounded
        modeControl.target = self
        modeControl.action = #selector(modeChanged(_:))
        modeControl.translatesAutoresizingMaskIntoConstraints = false
        topBar.addSubview(modeControl)

        syntaxButton.bezelStyle = .inline
        syntaxButton.font = .systemFont(ofSize: 12, weight: .medium)
        syntaxButton.target = self
        syntaxButton.action = #selector(showSyntaxGuide(_:))
        syntaxButton.toolTip = "Markdown 语法速查（⌘F 或 ⌘/）"
        syntaxButton.translatesAutoresizingMaskIntoConstraints = false
        topBar.addSubview(syntaxButton)

        copyButton.bezelStyle = .inline
        copyButton.isBordered = false
        copyButton.target = self
        copyButton.action = #selector(copyMarkdownSource(_:))
        copyButton.toolTip = "复制整篇 Markdown（⇧⌘C）"
        copyButton.setAccessibilityLabel("复制整篇 Markdown")
        copyButton.translatesAutoresizingMaskIntoConstraints = false
        updateCopyButton(copied: false)
        topBar.addSubview(copyButton)

        titleLabel.font = .systemFont(ofSize: 13, weight: .semibold)
        titleLabel.lineBreakMode = .byTruncatingMiddle
        titleLabel.alignment = .center
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        topBar.addSubview(titleLabel)

        for button in [previousButton, nextButton] {
            button.bezelStyle = .inline
            button.isBordered = false
            button.font = .systemFont(ofSize: 24, weight: .medium)
            button.contentTintColor = .secondaryLabelColor
            button.translatesAutoresizingMaskIntoConstraints = false
            topBar.addSubview(button)
        }
        previousButton.target = self
        previousButton.action = #selector(showPreviousDocument(_:))
        previousButton.toolTip = "上一篇（阅读模式按 ←）"
        previousButton.setAccessibilityLabel("上一篇")
        nextButton.target = self
        nextButton.action = #selector(showNextDocument(_:))
        nextButton.toolTip = "下一篇（阅读模式按 →）"
        nextButton.setAccessibilityLabel("下一篇")

        positionLabel.font = .monospacedDigitSystemFont(ofSize: 11, weight: .regular)
        positionLabel.textColor = .secondaryLabelColor
        positionLabel.alignment = .center
        positionLabel.translatesAutoresizingMaskIntoConstraints = false
        topBar.addSubview(positionLabel)

        statusLabel.font = .systemFont(ofSize: 11)
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.alignment = .right
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        topBar.addSubview(statusLabel)

        splitView.isVertical = true
        splitView.dividerStyle = .thin
        splitView.delegate = self
        documentAreaSplitView.isVertical = true
        documentAreaSplitView.dividerStyle = .thin
        documentAreaSplitView.delegate = self
        documentAreaSplitView.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(documentAreaSplitView)

        sidebarContainer.material = .sidebar
        sidebarContainer.blendingMode = .withinWindow
        sidebarContainer.state = .active
        sidebarModeControl.selectedSegment = SidebarMode.documents.rawValue
        sidebarModeControl.segmentStyle = .texturedRounded
        sidebarModeControl.controlSize = .small
        sidebarModeControl.target = self
        sidebarModeControl.action = #selector(sidebarModeChanged(_:))
        sidebarModeControl.translatesAutoresizingMaskIntoConstraints = false
        sidebarContainer.addSubview(sidebarModeControl)
        sidebarScroll.drawsBackground = false
        sidebarScroll.hasVerticalScroller = true
        sidebarScroll.autohidesScrollers = true
        sidebarScroll.translatesAutoresizingMaskIntoConstraints = false
        sidebarContainer.addSubview(sidebarScroll)

        let documentColumn = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("document"))
        documentColumn.title = "文档"
        sidebarTable.addTableColumn(documentColumn)
        sidebarTable.headerView = nil
        sidebarTable.style = .sourceList
        sidebarTable.rowSizeStyle = .medium
        sidebarTable.rowHeight = 30
        sidebarTable.intercellSpacing = NSSize(width: 0, height: 2)
        sidebarTable.backgroundColor = .clear
        sidebarTable.dataSource = self
        sidebarTable.delegate = self
        sidebarScroll.documentView = sidebarTable

        NSLayoutConstraint.activate([
            sidebarScroll.leadingAnchor.constraint(equalTo: sidebarContainer.leadingAnchor),
            sidebarScroll.trailingAnchor.constraint(equalTo: sidebarContainer.trailingAnchor),
            sidebarModeControl.leadingAnchor.constraint(equalTo: sidebarContainer.leadingAnchor, constant: 8),
            sidebarModeControl.trailingAnchor.constraint(equalTo: sidebarContainer.trailingAnchor, constant: -8),
            sidebarModeControl.topAnchor.constraint(equalTo: sidebarContainer.topAnchor, constant: 8),
            sidebarModeControl.heightAnchor.constraint(equalToConstant: 25),
            sidebarScroll.topAnchor.constraint(equalTo: sidebarModeControl.bottomAnchor, constant: 6),
            sidebarScroll.bottomAnchor.constraint(equalTo: sidebarContainer.bottomAnchor),
            sidebarContainer.widthAnchor.constraint(greaterThanOrEqualToConstant: 170),
            sidebarContainer.widthAnchor.constraint(lessThanOrEqualToConstant: 310)
        ])

        documentAreaSplitView.addArrangedSubview(sidebarContainer)
        documentAreaSplitView.addArrangedSubview(contentHost)

        editorContainer.translatesAutoresizingMaskIntoConstraints = false
        formattingBar.material = .contentBackground
        formattingBar.blendingMode = .withinWindow
        formattingBar.state = .active
        formattingBar.translatesAutoresizingMaskIntoConstraints = false
        editorContainer.addSubview(formattingBar)

        for button in [highlightButton, redTextButton] {
            button.bezelStyle = .rounded
            button.controlSize = .small
            button.setButtonType(.toggle)
            button.font = .systemFont(ofSize: 11.5, weight: .medium)
            button.translatesAutoresizingMaskIntoConstraints = false
            formattingBar.addSubview(button)
        }
        highlightButton.target = self
        highlightButton.action = #selector(useHighlightTool(_:))
        highlightButton.toolTip = "黄色高光：选中文字后点击，或开启后拖选文字"
        highlightButton.contentTintColor = .systemYellow
        if let image = NSImage(systemSymbolName: "highlighter", accessibilityDescription: "黄色高光") {
            highlightButton.image = image
            highlightButton.imagePosition = .imageLeading
        }
        redTextButton.target = self
        redTextButton.action = #selector(useRedTextTool(_:))
        redTextButton.toolTip = "红色文字：选中文字后点击，或开启后拖选文字"
        redTextButton.contentTintColor = .systemRed
        if let image = NSImage(systemSymbolName: "pencil.tip", accessibilityDescription: "红色笔") {
            redTextButton.image = image
            redTextButton.imagePosition = .imageLeading
        }

        paneSwapButton.bezelStyle = .rounded
        paneSwapButton.controlSize = .small
        paneSwapButton.setButtonType(.toggle)
        paneSwapButton.font = .systemFont(ofSize: 11.5, weight: .medium)
        paneSwapButton.target = self
        paneSwapButton.action = #selector(swapPaneSides(_:))
        paneSwapButton.toolTip = "把编辑区移到右侧"
        paneSwapButton.translatesAutoresizingMaskIntoConstraints = false
        formattingBar.addSubview(paneSwapButton)

        formattingHint.font = .systemFont(ofSize: 10.5)
        formattingHint.textColor = .secondaryLabelColor
        formattingHint.lineBreakMode = .byTruncatingTail
        formattingHint.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        formattingHint.translatesAutoresizingMaskIntoConstraints = false
        formattingBar.addSubview(formattingHint)

        editor.isRichText = false
        editor.allowsUndo = true
        editor.isAutomaticQuoteSubstitutionEnabled = false
        editor.isAutomaticDashSubstitutionEnabled = false
        editor.isAutomaticTextReplacementEnabled = false
        editor.font = .monospacedSystemFont(ofSize: 14, weight: .regular)
        editor.textColor = .labelColor
        editor.backgroundColor = .textBackgroundColor
        editor.textContainerInset = NSSize(width: 28, height: 30)
        editor.delegate = self
        editor.autoresizingMask = [.width]
        editor.isVerticallyResizable = true
        editor.isHorizontallyResizable = false
        editor.textContainer?.widthTracksTextView = true
        editor.onMouseSelectionFinished = { [weak self] in self?.applyActiveFormatToolToSelection() }
        editor.onCancelFormatTool = { [weak self] in
            guard let self, self.activeFormatTool != nil else { return false }
            self.setActiveFormatTool(nil)
            return true
        }
        editorScroll.translatesAutoresizingMaskIntoConstraints = false
        editorScroll.documentView = editor
        editorScroll.hasVerticalScroller = true
        editorScroll.drawsBackground = true
        editorScroll.contentView.postsBoundsChangedNotifications = true
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(editorViewportDidChange(_:)),
            name: NSView.boundsDidChangeNotification,
            object: editorScroll.contentView
        )
        editorContainer.addSubview(editorScroll)

        webView.navigationDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        splitView.translatesAutoresizingMaskIntoConstraints = false
        contentHost.addSubview(splitView)

        imageViewer.translatesAutoresizingMaskIntoConstraints = false
        imageViewer.isHidden = true
        contentHost.addSubview(imageViewer)

        imageToolbar.material = .contentBackground
        imageToolbar.blendingMode = .withinWindow
        imageToolbar.state = .active
        imageToolbar.translatesAutoresizingMaskIntoConstraints = false
        imageViewer.addSubview(imageToolbar)

        for button in [imageZoomOutButton, imageZoomInButton, imageFitButton, imageActualButton] {
            button.bezelStyle = .rounded
            button.controlSize = .small
            button.font = .systemFont(ofSize: 11.5, weight: .medium)
            button.translatesAutoresizingMaskIntoConstraints = false
            imageToolbar.addSubview(button)
        }
        imageZoomOutButton.target = self
        imageZoomOutButton.action = #selector(zoomImageOut(_:))
        imageZoomOutButton.toolTip = "缩小图片（⌘− 或滚轮向下）"
        imageZoomOutButton.setAccessibilityLabel("缩小图片")
        imageZoomInButton.target = self
        imageZoomInButton.action = #selector(zoomImageIn(_:))
        imageZoomInButton.toolTip = "放大图片（⌘+ 或滚轮向上）"
        imageZoomInButton.setAccessibilityLabel("放大图片")
        imageFitButton.target = self
        imageFitButton.action = #selector(fitImageToWindow(_:))
        imageFitButton.setButtonType(.toggle)
        imageFitButton.toolTip = "让整张图片适合当前窗口"
        imageFitButton.setAccessibilityLabel("适合窗口")
        imageActualButton.target = self
        imageActualButton.action = #selector(showImageAtActualSize(_:))
        imageActualButton.setButtonType(.toggle)
        imageActualButton.toolTip = "以图片原始像素尺寸显示"
        imageActualButton.setAccessibilityLabel("原始大小")

        imageZoomLabel.font = .monospacedDigitSystemFont(ofSize: 11, weight: .medium)
        imageZoomLabel.alignment = .center
        imageZoomLabel.translatesAutoresizingMaskIntoConstraints = false
        imageZoomLabel.setAccessibilityLabel("图片缩放比例")
        imageToolbar.addSubview(imageZoomLabel)

        imageGestureHint.font = .systemFont(ofSize: 10.5)
        imageGestureHint.textColor = .secondaryLabelColor
        imageGestureHint.lineBreakMode = .byTruncatingTail
        imageGestureHint.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        imageGestureHint.translatesAutoresizingMaskIntoConstraints = false
        imageToolbar.addSubview(imageGestureHint)

        imageDetailsLabel.font = .monospacedDigitSystemFont(ofSize: 10.5, weight: .regular)
        imageDetailsLabel.textColor = .secondaryLabelColor
        imageDetailsLabel.alignment = .right
        imageDetailsLabel.lineBreakMode = .byTruncatingHead
        imageDetailsLabel.translatesAutoresizingMaskIntoConstraints = false
        imageToolbar.addSubview(imageDetailsLabel)

        imageScroll.hasHorizontalScroller = true
        imageScroll.hasVerticalScroller = true
        imageScroll.autohidesScrollers = true
        imageScroll.drawsBackground = true
        imageScroll.backgroundColor = .textBackgroundColor
        imageScroll.translatesAutoresizingMaskIntoConstraints = false
        imageScroll.documentView = imageCanvas
        imageScroll.onZoomStep = { [weak self] factor in self?.zoomImage(by: factor) }
        imageCanvas.hostingScrollView = imageScroll
        imageViewer.addSubview(imageScroll)

        splitView.addArrangedSubview(editorContainer)
        splitView.addArrangedSubview(webView)
        applyPaneOrder()

        let titleAfterCopy = titleLabel.leadingAnchor.constraint(greaterThanOrEqualTo: copyButton.trailingAnchor, constant: 8)
        titleAfterCopy.priority = .defaultHigh

        NSLayoutConstraint.activate([
            topBar.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            topBar.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            topBar.topAnchor.constraint(equalTo: root.topAnchor),
            topBar.heightAnchor.constraint(equalToConstant: 52),
            sidebarToggleButton.leadingAnchor.constraint(equalTo: topBar.leadingAnchor, constant: 14),
            sidebarToggleButton.centerYAnchor.constraint(equalTo: topBar.centerYAnchor, constant: 5),
            sidebarToggleButton.widthAnchor.constraint(equalToConstant: 28),
            sidebarToggleButton.heightAnchor.constraint(equalToConstant: 28),
            modeControl.leadingAnchor.constraint(equalTo: sidebarToggleButton.trailingAnchor, constant: 8),
            modeControl.centerYAnchor.constraint(equalTo: topBar.centerYAnchor, constant: 5),
            modeControl.widthAnchor.constraint(equalToConstant: 190),
            syntaxButton.leadingAnchor.constraint(equalTo: modeControl.trailingAnchor, constant: 7),
            syntaxButton.centerYAnchor.constraint(equalTo: modeControl.centerYAnchor),
            syntaxButton.widthAnchor.constraint(equalToConstant: 42),
            syntaxButton.heightAnchor.constraint(equalToConstant: 26),
            copyButton.leadingAnchor.constraint(equalTo: syntaxButton.trailingAnchor, constant: 4),
            copyButton.centerYAnchor.constraint(equalTo: syntaxButton.centerYAnchor),
            copyButton.widthAnchor.constraint(equalToConstant: 30),
            copyButton.heightAnchor.constraint(equalToConstant: 26),
            titleLabel.centerXAnchor.constraint(equalTo: topBar.centerXAnchor),
            titleLabel.centerYAnchor.constraint(equalTo: modeControl.centerYAnchor),
            titleLabel.widthAnchor.constraint(lessThanOrEqualToConstant: 280),
            titleAfterCopy,
            titleLabel.trailingAnchor.constraint(lessThanOrEqualTo: previousButton.leadingAnchor, constant: -12),
            statusLabel.trailingAnchor.constraint(equalTo: topBar.trailingAnchor, constant: -16),
            statusLabel.centerYAnchor.constraint(equalTo: modeControl.centerYAnchor),
            statusLabel.widthAnchor.constraint(equalToConstant: 105),
            nextButton.trailingAnchor.constraint(equalTo: statusLabel.leadingAnchor, constant: -10),
            nextButton.centerYAnchor.constraint(equalTo: modeControl.centerYAnchor),
            nextButton.widthAnchor.constraint(equalToConstant: 26),
            nextButton.heightAnchor.constraint(equalToConstant: 28),
            positionLabel.trailingAnchor.constraint(equalTo: nextButton.leadingAnchor, constant: -3),
            positionLabel.centerYAnchor.constraint(equalTo: modeControl.centerYAnchor),
            positionLabel.widthAnchor.constraint(equalToConstant: 52),
            previousButton.trailingAnchor.constraint(equalTo: positionLabel.leadingAnchor, constant: -3),
            previousButton.centerYAnchor.constraint(equalTo: modeControl.centerYAnchor),
            previousButton.widthAnchor.constraint(equalToConstant: 26),
            previousButton.heightAnchor.constraint(equalToConstant: 28),
            formattingBar.leadingAnchor.constraint(equalTo: editorContainer.leadingAnchor),
            formattingBar.trailingAnchor.constraint(equalTo: editorContainer.trailingAnchor),
            formattingBar.topAnchor.constraint(equalTo: editorContainer.topAnchor),
            formattingBar.heightAnchor.constraint(equalToConstant: 40),
            highlightButton.leadingAnchor.constraint(equalTo: formattingBar.leadingAnchor, constant: 10),
            highlightButton.centerYAnchor.constraint(equalTo: formattingBar.centerYAnchor),
            redTextButton.leadingAnchor.constraint(equalTo: highlightButton.trailingAnchor, constant: 6),
            redTextButton.centerYAnchor.constraint(equalTo: formattingBar.centerYAnchor),
            formattingHint.leadingAnchor.constraint(equalTo: redTextButton.trailingAnchor, constant: 10),
            formattingHint.trailingAnchor.constraint(lessThanOrEqualTo: paneSwapButton.leadingAnchor, constant: -8),
            formattingHint.centerYAnchor.constraint(equalTo: formattingBar.centerYAnchor),
            paneSwapButton.trailingAnchor.constraint(equalTo: formattingBar.trailingAnchor, constant: -10),
            paneSwapButton.centerYAnchor.constraint(equalTo: formattingBar.centerYAnchor),
            editorScroll.leadingAnchor.constraint(equalTo: editorContainer.leadingAnchor),
            editorScroll.trailingAnchor.constraint(equalTo: editorContainer.trailingAnchor),
            editorScroll.topAnchor.constraint(equalTo: formattingBar.bottomAnchor),
            editorScroll.bottomAnchor.constraint(equalTo: editorContainer.bottomAnchor),
            splitView.leadingAnchor.constraint(equalTo: contentHost.leadingAnchor),
            splitView.trailingAnchor.constraint(equalTo: contentHost.trailingAnchor),
            splitView.topAnchor.constraint(equalTo: contentHost.topAnchor),
            splitView.bottomAnchor.constraint(equalTo: contentHost.bottomAnchor),
            imageViewer.leadingAnchor.constraint(equalTo: contentHost.leadingAnchor),
            imageViewer.trailingAnchor.constraint(equalTo: contentHost.trailingAnchor),
            imageViewer.topAnchor.constraint(equalTo: contentHost.topAnchor),
            imageViewer.bottomAnchor.constraint(equalTo: contentHost.bottomAnchor),
            imageToolbar.leadingAnchor.constraint(equalTo: imageViewer.leadingAnchor),
            imageToolbar.trailingAnchor.constraint(equalTo: imageViewer.trailingAnchor),
            imageToolbar.topAnchor.constraint(equalTo: imageViewer.topAnchor),
            imageToolbar.heightAnchor.constraint(equalToConstant: 44),
            imageZoomOutButton.leadingAnchor.constraint(equalTo: imageToolbar.leadingAnchor, constant: 12),
            imageZoomOutButton.centerYAnchor.constraint(equalTo: imageToolbar.centerYAnchor),
            imageZoomOutButton.widthAnchor.constraint(equalToConstant: 32),
            imageZoomLabel.leadingAnchor.constraint(equalTo: imageZoomOutButton.trailingAnchor, constant: 4),
            imageZoomLabel.centerYAnchor.constraint(equalTo: imageToolbar.centerYAnchor),
            imageZoomLabel.widthAnchor.constraint(equalToConstant: 72),
            imageZoomInButton.leadingAnchor.constraint(equalTo: imageZoomLabel.trailingAnchor, constant: 4),
            imageZoomInButton.centerYAnchor.constraint(equalTo: imageToolbar.centerYAnchor),
            imageZoomInButton.widthAnchor.constraint(equalToConstant: 32),
            imageFitButton.leadingAnchor.constraint(equalTo: imageZoomInButton.trailingAnchor, constant: 10),
            imageFitButton.centerYAnchor.constraint(equalTo: imageToolbar.centerYAnchor),
            imageActualButton.leadingAnchor.constraint(equalTo: imageFitButton.trailingAnchor, constant: 6),
            imageActualButton.centerYAnchor.constraint(equalTo: imageToolbar.centerYAnchor),
            imageGestureHint.leadingAnchor.constraint(equalTo: imageActualButton.trailingAnchor, constant: 12),
            imageGestureHint.centerYAnchor.constraint(equalTo: imageToolbar.centerYAnchor),
            imageGestureHint.trailingAnchor.constraint(lessThanOrEqualTo: imageDetailsLabel.leadingAnchor, constant: -8),
            imageDetailsLabel.trailingAnchor.constraint(equalTo: imageToolbar.trailingAnchor, constant: -14),
            imageDetailsLabel.centerYAnchor.constraint(equalTo: imageToolbar.centerYAnchor),
            imageDetailsLabel.widthAnchor.constraint(lessThanOrEqualToConstant: 250),
            imageScroll.leadingAnchor.constraint(equalTo: imageViewer.leadingAnchor),
            imageScroll.trailingAnchor.constraint(equalTo: imageViewer.trailingAnchor),
            imageScroll.topAnchor.constraint(equalTo: imageToolbar.bottomAnchor),
            imageScroll.bottomAnchor.constraint(equalTo: imageViewer.bottomAnchor),
            documentAreaSplitView.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            documentAreaSplitView.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            documentAreaSplitView.topAnchor.constraint(equalTo: topBar.bottomAnchor),
            documentAreaSplitView.bottomAnchor.constraint(equalTo: root.bottomAnchor)
        ])

        editorContainer.widthAnchor.constraint(greaterThanOrEqualToConstant: 280).isActive = true
        webView.widthAnchor.constraint(greaterThanOrEqualToConstant: 320).isActive = true
        applySidebarVisibility()
        applyMode(.reading)
    }

    private func load(_ url: URL?) {
        if let url, isImageURL(url) {
            loadImage(url)
            return
        }

        let text: String
        if let url {
            do {
                text = try String(contentsOf: url, encoding: .utf8)
                statusLabel.stringValue = "已打开"
            } catch {
                text = "# 无法打开文件\n\n\(error.localizedDescription)"
                statusLabel.stringValue = "打开失败"
            }
        } else {
            text = "# 欢迎使用轻阅 Markdown\n\n把 `.md` 文件拖到窗口，或按 **⌘O** 打开。\n\n> [!note] Obsidian Callout\n> Note、Tip、Warning 等 Callout 会按卡片正常显示。\n\n切换到「编辑」或「分栏」即可修改内容，按 **⌘S** 保存。"
            statusLabel.stringValue = "拖入文件即可阅读"
        }
        currentContentKind = .markdown
        editor.string = text
        imageCanvas.setImage(nil)
        refreshDocumentOutline()
        setActiveFormatTool(nil)
        lastSavedText = text
        applyContentKind(.markdown)
        updateTitle()
        refreshSiblingDocuments()
        loadPreviewShell()
    }

    private func loadImage(_ url: URL) {
        guard let image = NSImage(contentsOf: url) else {
            NSSound.beep()
            statusLabel.stringValue = "图片打开失败"
            let alert = NSAlert()
            alert.messageText = "无法显示这张图片"
            alert.informativeText = "系统无法解码 \(url.lastPathComponent)。"
            alert.runModal()
            return
        }

        currentContentKind = .image
        editor.string = ""
        lastSavedText = ""
        documentHeadings = []
        setActiveFormatTool(nil)
        let naturalSize = imagePixelSize(image)
        imageCanvas.setImage(image, naturalSize: naturalSize)
        applyContentKind(.image)
        updateTitle()
        refreshSiblingDocuments()
        updateImageDetails(url: url, naturalSize: naturalSize)
        statusLabel.stringValue = "已打开图片"
        DispatchQueue.main.async { [weak self] in
            self?.applyImageZoomPreference(alignTop: true)
            self?.window?.makeFirstResponder(self?.imageScroll)
        }
    }

    private func imagePixelSize(_ image: NSImage) -> NSSize {
        let representation = image.representations.max {
            $0.pixelsWide * $0.pixelsHigh < $1.pixelsWide * $1.pixelsHigh
        }
        if let representation, representation.pixelsWide > 0, representation.pixelsHigh > 0 {
            return NSSize(width: representation.pixelsWide, height: representation.pixelsHigh)
        }
        return image.size
    }

    private func updateImageDetails(url: URL, naturalSize: NSSize) {
        let bytes = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        let sizeText: String
        if bytes < 1024 {
            sizeText = "\(bytes) B"
        } else if bytes < 1024 * 1024 {
            sizeText = String(format: bytes < 10 * 1024 ? "%.1f KB" : "%.0f KB", Double(bytes) / 1024)
        } else {
            sizeText = String(format: "%.1f MB", Double(bytes) / (1024 * 1024))
        }
        let type = url.pathExtension.lowercased() == "jpeg" ? "JPG" : url.pathExtension.uppercased()
        imageDetailsLabel.stringValue = "\(Int(naturalSize.width)) × \(Int(naturalSize.height)) · \(sizeText) · \(type)"
    }

    private func applyContentKind(_ kind: ContentKind) {
        currentContentKind = kind
        let imageMode = kind == .image
        splitView.isHidden = imageMode
        imageViewer.isHidden = !imageMode
        modeControl.isEnabled = !imageMode
        syntaxButton.isEnabled = !imageMode
        copyButton.isEnabled = !imageMode
        sidebarModeControl.setEnabled(!imageMode, forSegment: SidebarMode.outline.rawValue)
        previousButton.toolTip = imageMode ? "上一张（按 ←）" : "上一篇（阅读模式按 ←）"
        previousButton.setAccessibilityLabel(imageMode ? "上一张" : "上一篇")
        nextButton.toolTip = imageMode ? "下一张（按 →）" : "下一篇（阅读模式按 →）"
        nextButton.setAccessibilityLabel(imageMode ? "下一张" : "下一篇")

        if imageMode {
            sidebarMode = .images
        } else if sidebarMode == .images {
            sidebarMode = .documents
        }
        sidebarModeControl.selectedSegment = sidebarMode.rawValue
        isUpdatingSidebarSelection = true
        sidebarTable.reloadData()
        sidebarTable.deselectAll(nil)
        DispatchQueue.main.async { [weak self] in self?.isUpdatingSidebarSelection = false }
    }

    private func replaceDocument(with url: URL) {
        guard isSupportedContentURL(url) else {
            NSSound.beep()
            statusLabel.stringValue = "不支持这种文件"
            return
        }
        guard confirmLeavingCurrentDocument() else { return }
        fileURL = url
        load(url)
    }

    private func refreshSiblingDocuments() {
        guard let fileURL else {
            documentURLs = []
            imageURLs = []
            updateNavigationControls()
            return
        }
        let directory = fileURL.deletingLastPathComponent()
        let urls = (try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles]
        )) ?? []
        let regularFiles = urls.filter { url in
            return (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) ?? false
        }.sorted {
            $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending
        }
        documentURLs = regularFiles.filter(isMarkdownURL)
        imageURLs = regularFiles.filter(isImageURL)
        if !didChooseInitialSidebarVisibility {
            sidebarVisible = documentURLs.count + imageURLs.count > 1
            didChooseInitialSidebarVisibility = true
            applySidebarVisibility()
        }
        updateNavigationControls()
    }

    private var currentNavigationURLs: [URL] {
        currentContentKind == .image ? imageURLs : documentURLs
    }

    private var currentSiblingIndex: Int? {
        guard let current = fileURL?.standardizedFileURL else { return nil }
        return currentNavigationURLs.firstIndex { $0.standardizedFileURL == current }
    }

    private var sidebarMatchesCurrentContent: Bool {
        (currentContentKind == .image && sidebarMode == .images)
            || (currentContentKind == .markdown && sidebarMode == .documents)
    }

    private func updateNavigationControls() {
        guard let index = currentSiblingIndex else {
            previousButton.isEnabled = false
            nextButton.isEnabled = false
            positionLabel.stringValue = ""
            if sidebarMatchesCurrentContent {
                isUpdatingSidebarSelection = true
                sidebarTable.reloadData()
                sidebarTable.deselectAll(nil)
                DispatchQueue.main.async { [weak self] in self?.isUpdatingSidebarSelection = false }
            }
            return
        }
        previousButton.isEnabled = index > 0
        nextButton.isEnabled = index + 1 < currentNavigationURLs.count
        positionLabel.stringValue = "\(index + 1) / \(currentNavigationURLs.count)"
        if sidebarMatchesCurrentContent {
            isUpdatingSidebarSelection = true
            sidebarTable.reloadData()
            sidebarTable.selectRowIndexes(IndexSet(integer: index), byExtendingSelection: false)
            sidebarTable.scrollRowToVisible(index)
            DispatchQueue.main.async { [weak self] in self?.isUpdatingSidebarSelection = false }
        }
    }

    @objc private func showPreviousDocument(_ sender: Any?) { navigateDocument(by: -1) }
    @objc private func showNextDocument(_ sender: Any?) { navigateDocument(by: 1) }

    private func navigateDocument(by offset: Int) {
        refreshSiblingDocuments()
        guard let index = currentSiblingIndex else { NSSound.beep(); return }
        let destination = index + offset
        guard currentNavigationURLs.indices.contains(destination) else { NSSound.beep(); return }
        navigateDocument(to: destination)
    }

    private func navigateDocument(to destination: Int) {
        let urls = currentNavigationURLs
        guard urls.indices.contains(destination) else { return }
        guard confirmLeavingCurrentDocument() else { return }
        fileURL = urls[destination]
        load(fileURL)
    }

    @objc func toggleSidebar(_ sender: Any?) {
        sidebarVisible.toggle()
        didChooseInitialSidebarVisibility = true
        applySidebarVisibility()
    }

    private func applySidebarVisibility() {
        sidebarContainer.isHidden = !sidebarVisible
        sidebarToggleButton.contentTintColor = sidebarVisible ? .controlAccentColor : .secondaryLabelColor
        if sidebarVisible {
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                let available = self.documentAreaSplitView.bounds.width - self.documentAreaSplitView.dividerThickness
                guard available > 360 else { return }
                self.sidebarWidth = min(310, max(170, min(self.sidebarWidth, available - 360)))
                self.documentAreaSplitView.setPosition(self.sidebarWidth, ofDividerAt: 0)
            }
        }
    }

    func splitViewDidResizeSubviews(_ notification: Notification) {
        guard let resized = notification.object as? NSSplitView else { return }
        if resized === documentAreaSplitView, sidebarVisible, !sidebarContainer.isHidden {
            let width = sidebarContainer.frame.width
            guard width >= 170, width <= 310 else { return }
            sidebarWidth = width
            UserDefaults.standard.set(Double(width), forKey: "LightMarkSidebarWidth")
        } else if resized === splitView, !isApplyingSplitLayout, currentMode == .split, !editorContainer.isHidden, !webView.isHidden {
            let available = splitView.bounds.width - splitView.dividerThickness
            guard available > 0 else { return }
            let ratio = editorContainer.frame.width / available
            guard ratio >= 0.25, ratio <= 0.75 else { return }
            editorSplitRatio = ratio
            UserDefaults.standard.set(Double(ratio), forKey: "LightMarkEditorSplitRatio")
        }
    }

    private func cleanHeadingTitle(_ value: String) -> String {
        value
            .replacingOccurrences(of: #"[ \t]+#+[ \t]*$"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"<[^>]+>"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"[*_~`]"#, with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func refreshDocumentOutline() {
        let source = editor.string as NSString
        var headings: [DocumentHeading] = []
        var location = 0
        var lineNumber = 0
        var fence: (character: Character, length: Int)?
        var inFrontmatter = false
        var previousLine: (text: String, range: NSRange)?

        while location < source.length {
            let fullRange = source.lineRange(for: NSRange(location: location, length: 0))
            var contentRange = fullRange
            while contentRange.length > 0 {
                let character = source.character(at: NSMaxRange(contentRange) - 1)
                guard character == 10 || character == 13 else { break }
                contentRange.length -= 1
            }
            let line = source.substring(with: contentRange)
            let normalized = line.replacingOccurrences(of: "\u{FEFF}", with: "").trimmingCharacters(in: .whitespaces)
            if lineNumber == 0, normalized == "---" {
                inFrontmatter = true
                previousLine = nil
                location = NSMaxRange(fullRange)
                lineNumber += 1
                continue
            }
            if inFrontmatter {
                if normalized == "---" { inFrontmatter = false }
                previousLine = nil
                location = NSMaxRange(fullRange)
                lineNumber += 1
                continue
            }

            let localRange = NSRange(location: 0, length: (line as NSString).length)
            if let match = Self.outlineFenceRegex.firstMatch(in: line, options: [], range: localRange) {
                let marker = (line as NSString).substring(with: match.range(at: 1))
                if let current = fence {
                    if marker.first == current.character, marker.count >= current.length { fence = nil }
                } else if let character = marker.first {
                    fence = (character, marker.count)
                }
                previousLine = nil
            } else if fence == nil, let match = Self.outlineHeadingRegex.firstMatch(in: line, options: [], range: localRange) {
                let marks = (line as NSString).substring(with: match.range(at: 1))
                let title = cleanHeadingTitle((line as NSString).substring(with: match.range(at: 2)))
                if !title.isEmpty { headings.append(DocumentHeading(level: marks.count, title: title, range: contentRange)) }
                previousLine = nil
            } else if fence == nil, let match = Self.outlineSetextRegex.firstMatch(in: line, options: [], range: localRange), let previous = previousLine {
                let marks = (line as NSString).substring(with: match.range(at: 1))
                let title = cleanHeadingTitle(previous.text)
                if !title.isEmpty { headings.append(DocumentHeading(level: marks.first == "=" ? 1 : 2, title: title, range: previous.range)) }
                previousLine = nil
            } else if fence == nil {
                previousLine = (line, contentRange)
            } else {
                previousLine = nil
            }
            location = NSMaxRange(fullRange)
            lineNumber += 1
        }

        documentHeadings = headings
        if sidebarMode == .outline {
            isUpdatingSidebarSelection = true
            sidebarTable.reloadData()
            sidebarTable.deselectAll(nil)
            DispatchQueue.main.async { [weak self] in self?.isUpdatingSidebarSelection = false }
        }
    }

    private func jumpToHeading(_ heading: DocumentHeading, index: Int) {
        if currentMode == .reading {
            scrollPreviewToHeading(index)
            return
        }
        editor.setSelectedRange(NSRange(location: heading.range.location, length: 0))
        editor.scrollRangeToVisible(heading.range)
        window?.makeFirstResponder(editor)
        syncPreviewToEditor()
        if currentMode == .split {
            DispatchQueue.main.async { [weak self] in self?.scrollPreviewToHeading(index) }
        }
    }

    private func scrollPreviewToHeading(_ index: Int) {
        webView.evaluateJavaScript("document.querySelectorAll('h1,h2,h3,h4,h5,h6')[\(index)]?.scrollIntoView({block:'start',behavior:'auto'});")
    }

    @objc private func sidebarModeChanged(_ sender: NSSegmentedControl) {
        sidebarMode = SidebarMode(rawValue: sender.selectedSegment) ?? (currentContentKind == .image ? .images : .documents)
        isUpdatingSidebarSelection = true
        sidebarTable.reloadData()
        sidebarTable.deselectAll(nil)
        if sidebarMatchesCurrentContent, let index = currentSiblingIndex {
            sidebarTable.selectRowIndexes(IndexSet(integer: index), byExtendingSelection: false)
            sidebarTable.scrollRowToVisible(index)
        }
        DispatchQueue.main.async { [weak self] in self?.isUpdatingSidebarSelection = false }
    }

    func numberOfRows(in tableView: NSTableView) -> Int {
        switch sidebarMode {
        case .images: return imageURLs.count
        case .documents: return documentURLs.count
        case .outline: return documentHeadings.count
        }
    }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        let identifier = NSUserInterfaceItemIdentifier("documentCell")
        let cell: NSTableCellView
        if let reused = tableView.makeView(withIdentifier: identifier, owner: self) as? NSTableCellView {
            cell = reused
        } else {
            cell = NSTableCellView()
            cell.identifier = identifier
            let label = NSTextField(labelWithString: "")
            label.lineBreakMode = .byTruncatingMiddle
            label.font = .systemFont(ofSize: 12.5)
            label.translatesAutoresizingMaskIntoConstraints = false
            cell.textField = label
            cell.addSubview(label)
            NSLayoutConstraint.activate([
                label.leadingAnchor.constraint(equalTo: cell.leadingAnchor, constant: 10),
                label.trailingAnchor.constraint(equalTo: cell.trailingAnchor, constant: -8),
                label.centerYAnchor.constraint(equalTo: cell.centerYAnchor)
            ])
        }
        let name: String
        if sidebarMode == .images {
            name = imageURLs[row].lastPathComponent
            cell.textField?.font = .systemFont(ofSize: 12.5)
            cell.textField?.textColor = .labelColor
        } else if sidebarMode == .documents {
            name = documentURLs[row].lastPathComponent
            cell.textField?.font = .systemFont(ofSize: 12.5)
            cell.textField?.textColor = .labelColor
        } else {
            let heading = documentHeadings[row]
            name = String(repeating: "  ", count: max(0, heading.level - 1)) + heading.title
            cell.textField?.font = .systemFont(ofSize: 12.5, weight: heading.level == 1 ? .semibold : .regular)
            cell.textField?.textColor = heading.level == 1 ? .labelColor : .secondaryLabelColor
        }
        cell.textField?.stringValue = name
        cell.toolTip = name
        return cell
    }

    func tableViewSelectionDidChange(_ notification: Notification) {
        guard !isUpdatingSidebarSelection else { return }
        let row = sidebarTable.selectedRow
        if sidebarMode == .outline {
            guard documentHeadings.indices.contains(row) else { return }
            jumpToHeading(documentHeadings[row], index: row)
            return
        }
        let urls = sidebarMode == .images ? imageURLs : documentURLs
        guard urls.indices.contains(row) else { return }
        if urls[row].standardizedFileURL == fileURL?.standardizedFileURL { return }
        if confirmLeavingCurrentDocument() {
            fileURL = urls[row]
            load(fileURL)
        } else {
            updateNavigationControls()
        }
    }

    private func confirmLeavingCurrentDocument() -> Bool {
        guard hasUnsavedChanges else { return true }
        let alert = NSAlert()
        alert.messageText = "当前修改尚未保存"
        alert.informativeText = "切换文档前要保存这些修改吗？"
        alert.addButton(withTitle: "保存并继续")
        alert.addButton(withTitle: "不保存")
        alert.addButton(withTitle: "取消")
        switch alert.runModal() {
        case .alertFirstButtonReturn:
            save(nil)
            return !hasUnsavedChanges
        case .alertSecondButtonReturn:
            return true
        default:
            return false
        }
    }

    fileprivate func handleNavigationKey(_ event: NSEvent) -> Bool {
        guard currentContentKind == .image || currentMode == .reading else { return false }
        let modifiers = event.modifierFlags.intersection([.command, .control, .option, .shift])
        guard modifiers.isEmpty else { return false }
        switch event.keyCode {
        case 123:
            navigateDocument(by: -1)
            return true
        case 124:
            navigateDocument(by: 1)
            return true
        default:
            return false
        }
    }

    private func updateTitle() {
        let name = fileURL?.lastPathComponent ?? "轻阅 Markdown"
        titleLabel.stringValue = name
        window?.title = name
        window?.isDocumentEdited = hasUnsavedChanges
    }

    private func loadPreviewShell() {
        webReady = false
        guard let templateURL = Bundle.main.url(forResource: "preview", withExtension: "html"),
              let markedURL = Bundle.main.url(forResource: "marked.min", withExtension: "js"),
              let purifyURL = Bundle.main.url(forResource: "purify.min", withExtension: "js"),
              var html = try? String(contentsOf: templateURL, encoding: .utf8),
              let marked = try? String(contentsOf: markedURL, encoding: .utf8),
              let purify = try? String(contentsOf: purifyURL, encoding: .utf8) else {
            statusLabel.stringValue = "预览资源缺失"
            return
        }
        html = html.replacingOccurrences(of: "/*__MARKED__*/", with: marked)
        html = html.replacingOccurrences(of: "/*__PURIFY__*/", with: purify)
        let baseURL = fileURL?.deletingLastPathComponent() ?? Bundle.main.resourceURL
        webView.loadHTMLString(html, baseURL: baseURL)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webReady = true
        renderPreview()
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url {
            if url.scheme == "http" || url.scheme == "https" || url.scheme == "mailto" {
                NSWorkspace.shared.open(url)
                decisionHandler(.cancel)
                return
            }
        }
        decisionHandler(.allow)
    }

    func textDidChange(_ notification: Notification) {
        window?.isDocumentEdited = hasUnsavedChanges
        statusLabel.stringValue = hasUnsavedChanges ? "有未保存修改" : "已保存"
        refreshDocumentOutline()
        renderWorkItem?.cancel()
        let item = DispatchWorkItem { [weak self] in self?.renderPreview() }
        renderWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12, execute: item)
    }

    @objc private func useHighlightTool(_ sender: NSButton) { handleFormatTool(.highlight) }
    @objc private func useRedTextTool(_ sender: NSButton) { handleFormatTool(.redText) }

    private func handleFormatTool(_ tool: InlineFormatTool) {
        if let activeFormatTool {
            setActiveFormatTool(activeFormatTool == tool ? nil : tool)
            window?.makeFirstResponder(editor)
            return
        }
        if editor.selectedRange().length > 0 {
            _ = applyFormat(tool)
        } else {
            setActiveFormatTool(tool)
        }
        window?.makeFirstResponder(editor)
    }

    private func setActiveFormatTool(_ tool: InlineFormatTool?) {
        activeFormatTool = tool
        highlightButton.state = tool == .highlight ? .on : .off
        redTextButton.state = tool == .redText ? .on : .off
        formattingHint.stringValue = tool.map { "\($0.label)已开启 · 拖选文字即可标记 · Esc 退出" }
            ?? "先选中文字再点按钮，或先开启画笔再拖选"
        formattingHint.textColor = tool == nil ? .secondaryLabelColor : .controlAccentColor
    }

    private func applyActiveFormatToolToSelection() {
        guard let activeFormatTool, editor.selectedRange().length > 0 else { return }
        _ = applyFormat(activeFormatTool)
    }

    @discardableResult
    private func applyFormat(_ tool: InlineFormatTool) -> Bool {
        let source = editor.string as NSString
        let selection = editor.selectedRange()
        guard selection.location != NSNotFound,
              selection.length > 0,
              NSMaxRange(selection) <= source.length else {
            formattingHint.stringValue = "请先选中要标记的文字"
            return false
        }

        let selected = source.substring(with: selection)
        guard !selected.replacingOccurrences(of: "\r\n", with: "\n").contains("\n\n") else {
            NSSound.beep()
            formattingHint.stringValue = "一次请只标记同一段文字"
            return false
        }

        let openingLength = (tool.opening as NSString).length
        let closingLength = (tool.closing as NSString).length
        var replacementRange = selection
        var replacement = tool.opening + selected + tool.closing
        var nextSelection = NSRange(location: selection.location + openingLength, length: selection.length)
        var removed = false

        let outerStart = selection.location - openingLength
        let outerEnd = NSMaxRange(selection) + closingLength
        if outerStart >= 0,
           outerEnd <= source.length,
           source.substring(with: NSRange(location: outerStart, length: openingLength)) == tool.opening,
           source.substring(with: NSRange(location: NSMaxRange(selection), length: closingLength)) == tool.closing {
            replacementRange = NSRange(location: outerStart, length: openingLength + selection.length + closingLength)
            replacement = selected
            nextSelection = NSRange(location: outerStart, length: selection.length)
            removed = true
        } else if selected.hasPrefix(tool.opening), selected.hasSuffix(tool.closing) {
            let selectedNSString = selected as NSString
            let contentLength = selectedNSString.length - openingLength - closingLength
            replacement = selectedNSString.substring(with: NSRange(location: openingLength, length: contentLength))
            nextSelection = NSRange(location: selection.location, length: contentLength)
            removed = true
        }

        editor.insertText(replacement, replacementRange: replacementRange)
        editor.setSelectedRange(nextSelection)
        if activeFormatTool == nil {
            formattingHint.stringValue = removed ? "已移除文字标记" : "已添加文字标记"
        }
        return true
    }

    private func renderPreview() {
        guard webReady else { return }
        let text = editor.string
        guard let data = try? JSONSerialization.data(withJSONObject: [text]),
              var json = String(data: data, encoding: .utf8) else { return }
        json.removeFirst()
        json.removeLast()
        let followEditor = currentMode == .split
            ? "requestAnimationFrame(() => { const e = document.scrollingElement; const max = Math.max(0, e.scrollHeight - innerHeight); window.scrollTo(0, max * \(editorViewportRatio())); });"
            : ""
        webView.evaluateJavaScript("window.lightmarkRender(\(json)); window.lightmarkSetScale(\(fontScale)); \(followEditor)")
    }

    private func editorViewportRatio() -> CGFloat {
        guard let documentView = editorScroll.documentView else { return 0 }
        let visibleHeight = editorScroll.contentView.bounds.height
        let scrollRange = max(1, documentView.bounds.height - visibleHeight)
        return min(1, max(0, editorScroll.contentView.bounds.origin.y / scrollRange))
    }

    @objc private func editorViewportDidChange(_ notification: Notification) { syncPreviewToEditor() }

    private func syncPreviewToEditor() {
        guard currentMode == .split, webReady else { return }
        let ratio = editorViewportRatio()
        webView.evaluateJavaScript("requestAnimationFrame(() => { const e = document.scrollingElement; const max = Math.max(0, e.scrollHeight - innerHeight); window.scrollTo(0, max * \(ratio)); });")
    }

    @objc private func modeChanged(_ sender: NSSegmentedControl) {
        applyMode(ViewMode(rawValue: sender.selectedSegment) ?? .reading)
    }

    private func applyMode(_ mode: ViewMode) {
        guard currentContentKind == .markdown else { return }
        currentMode = mode
        modeControl.selectedSegment = mode.rawValue
        editorContainer.isHidden = mode == .reading
        webView.isHidden = mode == .editing
        paneSwapButton.isEnabled = mode == .split
        if mode == .reading { setActiveFormatTool(nil) }
        if mode == .split {
            DispatchQueue.main.async { [weak self] in
                self?.applySplitDividerPosition()
                self?.syncPreviewToEditor()
            }
        }
        if mode != .editing { renderPreview() }
        if mode == .editing { window?.makeFirstResponder(editor) }
    }

    @objc func showReading(_ sender: Any?) { applyMode(.reading) }
    @objc func showEditing(_ sender: Any?) { applyMode(.editing) }
    @objc func showSplit(_ sender: Any?) { applyMode(.split) }

    @objc private func swapPaneSides(_ sender: Any?) {
        guard currentMode == .split else { return }
        editorOnRight.toggle()
        UserDefaults.standard.set(editorOnRight, forKey: "LightMarkEditorOnRight")
        DispatchQueue.main.async { [weak self] in
            self?.applySplitDividerPosition()
            self?.syncPreviewToEditor()
        }
        window?.makeFirstResponder(editor)
    }

    private func applyPaneOrder() {
        if editorOnRight, splitView.arrangedSubviews.first === editorContainer {
            splitView.removeArrangedSubview(editorContainer)
            editorContainer.removeFromSuperview()
            splitView.addArrangedSubview(editorContainer)
        } else if !editorOnRight, splitView.arrangedSubviews.first === webView {
            splitView.removeArrangedSubview(webView)
            webView.removeFromSuperview()
            splitView.addArrangedSubview(webView)
        }
        paneSwapButton.state = editorOnRight ? .on : .off
        paneSwapButton.toolTip = editorOnRight ? "把编辑区移到左侧" : "把编辑区移到右侧"
        paneSwapButton.setAccessibilityLabel(paneSwapButton.toolTip ?? "交换编辑区与预览区")
    }

    private func applySplitDividerPosition() {
        isApplyingSplitLayout = true
        defer { isApplyingSplitLayout = false }
        applyPaneOrder()
        let available = splitView.bounds.width - splitView.dividerThickness
        guard available > 0 else { return }
        let desiredLeft = available * (editorOnRight ? 1 - editorSplitRatio : editorSplitRatio)
        let firstMinimum: CGFloat = editorOnRight ? 320 : 280
        let secondMinimum: CGFloat = editorOnRight ? 280 : 320
        let lower = min(firstMinimum, available / 2)
        let upper = max(lower, available - min(secondMinimum, available / 2))
        splitView.setPosition(min(upper, max(lower, desiredLeft)), ofDividerAt: 0)
    }

    @objc func showSyntaxGuide(_ sender: Any?) {
        guard currentContentKind == .markdown else { return }
        if syntaxPopover?.isShown == true {
            syntaxGuideController?.focusSearch()
            return
        }

        let popover = NSPopover()
        popover.behavior = .transient
        popover.contentSize = NSSize(width: 450, height: 570)

        let guideText = """
        标题
        # 一级标题
        ## 二级标题
        ### 三级标题
        #### 四级标题

        文字
        **粗体**
        *斜体*
        ~~删除线~~
        `行内代码`

        黄色高光
        <mark>需要高光的文字</mark>

        红色文字
        <span class="text-red">红色文字</span>

        段落、换行与中文段首
        第一段文字

        第二段文字（中间空一整行就是新段落）
        行尾加两个半角空格再回车，只换行、不分段
        　　中文段首可输入两个全角空格
        注意：行首 4 个半角空格会变成代码块，不是首行缩进

        列表
        - 无序列表
        1. 有序列表
        - [ ] 未完成任务
        - [x] 已完成任务

        引用与分隔线
        > 引用内容
        ---

        链接和图片
        [显示文字](https://example.com)
        ![图片说明](images/photo.png)

        代码块
        ```swift
        let message = "Hello"
        ```

        表格
        | 名称 | 数值 |
        | --- | --- |
        | 示例 | 100 |

        Obsidian Callout
        > [!note] 提示标题
        > 这里填写提示内容

        > [!warning] 注意
        > 这里填写警告内容

        完整 Callout 类型与别名
        note
        abstract / summary / tldr
        info
        todo
        tip / hint / important
        success / check / done
        question / help / faq
        warning / caution / attention
        failure / fail / missing
        danger / error
        bug
        example
        quote / cite

        可折叠 Callout
        > [!faq]- 默认收起
        > 点击标题后显示内容

        > [!tip]+ 默认展开
        > 点击标题后收起内容

        嵌套 Callout
        > [!question] 外层 Callout
        > > [!todo] 内层 Callout
        > > 这里填写嵌套内容

        Obsidian Wiki Link
        [[文档名称]]
        [[文档名称|显示文字]]
        """

        let controller = SyntaxGuideViewController(guideText: guideText)
        popover.contentViewController = controller
        let anchor = (sender as? NSView) ?? syntaxButton
        popover.show(relativeTo: anchor.bounds, of: anchor, preferredEdge: .maxY)
        syntaxPopover = popover
        syntaxGuideController = controller
        DispatchQueue.main.async { controller.focusSearch() }
    }

    @objc func copyMarkdownSource(_ sender: Any?) {
        guard currentContentKind == .markdown else { return }
        let previousStatus = statusLabel.stringValue
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        guard pasteboard.setString(editor.string, forType: .string) else {
            statusLabel.stringValue = "复制失败"
            return
        }

        copyFeedbackWorkItem?.cancel()
        updateCopyButton(copied: true)
        statusLabel.stringValue = "全文已复制"

        let item = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.updateCopyButton(copied: false)
            if self.statusLabel.stringValue == "全文已复制" {
                self.statusLabel.stringValue = previousStatus
            }
        }
        copyFeedbackWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5, execute: item)
    }

    private func updateCopyButton(copied: Bool) {
        let symbol = copied ? "checkmark.circle.fill" : "doc.on.doc"
        copyButton.image = NSImage(systemSymbolName: symbol, accessibilityDescription: "复制整篇 Markdown")
        copyButton.contentTintColor = copied ? .systemGreen : .secondaryLabelColor
    }

    @objc func save(_ sender: Any?) {
        guard currentContentKind == .markdown else { return }
        guard let url = fileURL else { saveAs(sender); return }
        write(to: url)
    }

    @objc func saveAs(_ sender: Any?) {
        guard currentContentKind == .markdown else { return }
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.init(filenameExtension: "md")!]
        panel.nameFieldStringValue = fileURL?.lastPathComponent ?? "未命名.md"
        panel.directoryURL = fileURL?.deletingLastPathComponent()
        guard panel.runModal() == .OK, let url = panel.url else { return }
        fileURL = url
        write(to: url)
        loadPreviewShell()
    }

    private func write(to url: URL) {
        do {
            try editor.string.write(to: url, atomically: true, encoding: .utf8)
            lastSavedText = editor.string
            statusLabel.stringValue = "已保存"
            updateTitle()
            refreshSiblingDocuments()
        } catch {
            let alert = NSAlert(error: error)
            alert.messageText = "无法保存文件"
            alert.runModal()
        }
    }

    private func rememberImageZoomPreference() {
        UserDefaults.standard.set(imageZoomMode.rawValue, forKey: "LightMarkImageZoomMode")
        UserDefaults.standard.set(Double(imageScale), forKey: "LightMarkImageZoomScale")
    }

    private func updateImageControls() {
        let percent = Int((imageScale * 100).rounded())
        imageZoomLabel.stringValue = imageZoomMode == .fit ? "适合 \(percent)%" : "\(percent)%"
        imageZoomOutButton.isEnabled = imageScale > 0.0501
        imageZoomInButton.isEnabled = imageScale < 7.999
        imageFitButton.state = imageZoomMode == .fit ? .on : .off
        imageActualButton.state = imageZoomMode == .actual ? .on : .off
    }

    private func setImageScale(_ scale: CGFloat, mode: ImageZoomMode, preserveCenter: Bool = false, alignTop: Bool = false) {
        guard imageCanvas.naturalSize.width > 0, imageCanvas.naturalSize.height > 0 else { return }
        let clipView = imageScroll.contentView
        let oldSize = imageCanvas.frame.size
        let centerRatioX = oldSize.width > 0 ? clipView.bounds.midX / oldSize.width : 0.5
        let centerRatioY = oldSize.height > 0 ? clipView.bounds.midY / oldSize.height : 0.5

        imageScale = min(8, max(0.05, scale))
        imageZoomMode = mode
        rememberImageZoomPreference()
        imageCanvas.updateScale(imageScale, viewportSize: clipView.bounds.size)
        imageScroll.layoutSubtreeIfNeeded()
        updateImageControls()

        let newSize = imageCanvas.frame.size
        let viewport = clipView.bounds.size
        let origin: NSPoint
        if preserveCenter {
            origin = NSPoint(
                x: centerRatioX * newSize.width - viewport.width / 2,
                y: centerRatioY * newSize.height - viewport.height / 2
            )
        } else {
            origin = NSPoint(
                x: max(0, (newSize.width - viewport.width) / 2),
                y: alignTop ? 0 : max(0, (newSize.height - viewport.height) / 2)
            )
        }
        let constrained = clipView.constrainBoundsRect(NSRect(origin: origin, size: viewport))
        clipView.scroll(to: constrained.origin)
        imageScroll.reflectScrolledClipView(clipView)
    }

    private func fitImage(alignTop: Bool = false) {
        let availableWidth = max(1, imageScroll.contentView.bounds.width - 48)
        let availableHeight = max(1, imageScroll.contentView.bounds.height - 48)
        let scale = min(
            1,
            availableWidth / max(1, imageCanvas.naturalSize.width),
            availableHeight / max(1, imageCanvas.naturalSize.height)
        )
        setImageScale(scale, mode: .fit, alignTop: alignTop)
    }

    private func applyImageZoomPreference(alignTop: Bool) {
        switch imageZoomMode {
        case .fit: fitImage(alignTop: alignTop)
        case .actual: setImageScale(1, mode: .actual, alignTop: alignTop)
        case .custom: setImageScale(imageScale, mode: .custom, alignTop: alignTop)
        }
    }

    private func zoomImage(by factor: CGFloat) {
        setImageScale(imageScale * factor, mode: .custom, preserveCenter: true)
    }

    @objc private func zoomImageOut(_ sender: Any?) { zoomImage(by: 1 / 1.2) }
    @objc private func zoomImageIn(_ sender: Any?) { zoomImage(by: 1.2) }
    @objc private func fitImageToWindow(_ sender: Any?) { fitImage() }
    @objc private func showImageAtActualSize(_ sender: Any?) { setImageScale(1, mode: .actual) }

    @objc func zoomIn(_ sender: Any?) {
        if currentContentKind == .image { zoomImage(by: 1.2); return }
        fontScale = min(1.5, fontScale + 0.1)
        renderPreview()
    }

    @objc func zoomOut(_ sender: Any?) {
        if currentContentKind == .image { zoomImage(by: 1 / 1.2); return }
        fontScale = max(0.75, fontScale - 0.1)
        renderPreview()
    }

    @objc func zoomReset(_ sender: Any?) {
        if currentContentKind == .image { showImageAtActualSize(sender); return }
        fontScale = 1.0
        renderPreview()
    }

    func windowDidResize(_ notification: Notification) {
        guard currentContentKind == .image else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if self.imageZoomMode == .fit {
                self.fitImage()
            } else {
                self.setImageScale(self.imageScale, mode: self.imageZoomMode, preserveCenter: true)
            }
        }
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        guard hasUnsavedChanges else { return true }
        let alert = NSAlert()
        alert.messageText = "要保存对“\(titleLabel.stringValue)”的修改吗？"
        alert.informativeText = "如果不保存，修改将会丢失。"
        alert.addButton(withTitle: "保存")
        alert.addButton(withTitle: "不保存")
        alert.addButton(withTitle: "取消")
        switch alert.runModal() {
        case .alertFirstButtonReturn:
            save(nil)
            return !hasUnsavedChanges
        case .alertSecondButtonReturn:
            return true
        default:
            return false
        }
    }

    func windowWillClose(_ notification: Notification) { onClose?() }
}

final class DropView: NSView {
    var onDrop: ((URL) -> Void)?

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        registerForDraggedTypes([.fileURL])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        acceptableURL(from: sender) == nil ? [] : .copy
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        guard let url = acceptableURL(from: sender) else { return false }
        onDrop?(url)
        return true
    }

    private func acceptableURL(from sender: NSDraggingInfo) -> URL? {
        guard let value = sender.draggingPasteboard.readObjects(forClasses: [NSURL.self])?.first as? URL,
              isSupportedContentURL(value) else { return nil }
        return value
    }
}

let application = NSApplication.shared
let applicationDelegate = AppDelegate()
application.setActivationPolicy(.regular)
application.delegate = applicationDelegate
application.run()
