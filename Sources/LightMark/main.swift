import AppKit
import WebKit

private enum ViewMode: Int {
    case reading = 0
    case editing = 1
    case split = 2
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
        panel.allowedContentTypes = [.init(filenameExtension: "md")!, .init(filenameExtension: "markdown")!, .plainText]
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        guard panel.runModal() == .OK else { return }
        panel.urls.forEach { showDocument(url: $0) }
    }

    @objc private func openFolder(_ sender: Any?) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "打开文件夹"
        guard panel.runModal() == .OK, let directory = panel.url else { return }
        let files = ((try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles]
        )) ?? []).filter {
            ["md", "markdown"].contains($0.pathExtension.lowercased())
        }.sorted {
            $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending
        }
        guard let first = files.first else {
            let alert = NSAlert()
            alert.messageText = "这个文件夹里没有 Markdown 文档"
            alert.informativeText = "请选择包含 .md 或 .markdown 文件的文件夹。"
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
        let syntax = helpMenu.addItem(withTitle: "Markdown 语法速查", action: #selector(showMarkdownSyntax(_:)), keyEquivalent: "")
        syntax.target = self
        helpItem.submenu = helpMenu
        NSApp.helpMenu = helpMenu

        NSApp.mainMenu = main
    }
}

private final class DocumentWindow: NSWindow {
    weak var documentController: DocumentWindowController?

    override func keyDown(with event: NSEvent) {
        if documentController?.handleNavigationKey(event) == true { return }
        super.keyDown(with: event)
    }
}

final class DocumentWindowController: NSWindowController, NSWindowDelegate, NSTextViewDelegate, WKNavigationDelegate, NSTableViewDataSource, NSTableViewDelegate {
    var onClose: (() -> Void)?
    private(set) var fileURL: URL?
    private var lastSavedText = ""
    private var renderWorkItem: DispatchWorkItem?
    private var webReady = false
    private var fontScale = 1.0
    private var currentMode = ViewMode.reading
    private var siblingURLs: [URL] = []
    private var sidebarVisible = false
    private var didChooseInitialSidebarVisibility = false
    private var isUpdatingSidebarSelection = false
    private var syntaxPopover: NSPopover?

    private let sidebarToggleButton = NSButton(title: "☰", target: nil, action: nil)
    private let modeControl = NSSegmentedControl(labels: ["阅读", "编辑", "分栏"], trackingMode: .selectOne, target: nil, action: nil)
    private let syntaxButton = NSButton(title: "语法", target: nil, action: nil)
    private let titleLabel = NSTextField(labelWithString: "未命名")
    private let statusLabel = NSTextField(labelWithString: "")
    private let previousButton = NSButton(title: "‹", target: nil, action: nil)
    private let nextButton = NSButton(title: "›", target: nil, action: nil)
    private let positionLabel = NSTextField(labelWithString: "")
    private let editor = NSTextView()
    private let editorScroll = NSScrollView()
    private let webView: WKWebView
    private let splitView = NSSplitView()
    private let documentAreaSplitView = NSSplitView()
    private let sidebarContainer = NSVisualEffectView()
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

    private var hasUnsavedChanges: Bool { editor.string != lastSavedText }

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
        syntaxButton.toolTip = "Markdown 语法速查"
        syntaxButton.translatesAutoresizingMaskIntoConstraints = false
        topBar.addSubview(syntaxButton)

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
        documentAreaSplitView.isVertical = true
        documentAreaSplitView.dividerStyle = .thin
        documentAreaSplitView.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(documentAreaSplitView)

        sidebarContainer.material = .sidebar
        sidebarContainer.blendingMode = .withinWindow
        sidebarContainer.state = .active
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
            sidebarScroll.topAnchor.constraint(equalTo: sidebarContainer.topAnchor, constant: 8),
            sidebarScroll.bottomAnchor.constraint(equalTo: sidebarContainer.bottomAnchor),
            sidebarContainer.widthAnchor.constraint(greaterThanOrEqualToConstant: 170),
            sidebarContainer.widthAnchor.constraint(lessThanOrEqualToConstant: 310)
        ])

        documentAreaSplitView.addArrangedSubview(sidebarContainer)
        documentAreaSplitView.addArrangedSubview(splitView)

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
        editorScroll.documentView = editor
        editorScroll.hasVerticalScroller = true
        editorScroll.drawsBackground = true

        webView.navigationDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        splitView.addArrangedSubview(editorScroll)
        splitView.addArrangedSubview(webView)

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
            titleLabel.centerXAnchor.constraint(equalTo: topBar.centerXAnchor),
            titleLabel.centerYAnchor.constraint(equalTo: modeControl.centerYAnchor),
            titleLabel.widthAnchor.constraint(lessThanOrEqualToConstant: 280),
            titleLabel.leadingAnchor.constraint(greaterThanOrEqualTo: syntaxButton.trailingAnchor, constant: 8),
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
            documentAreaSplitView.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            documentAreaSplitView.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            documentAreaSplitView.topAnchor.constraint(equalTo: topBar.bottomAnchor),
            documentAreaSplitView.bottomAnchor.constraint(equalTo: root.bottomAnchor)
        ])

        editorScroll.widthAnchor.constraint(greaterThanOrEqualToConstant: 280).isActive = true
        webView.widthAnchor.constraint(greaterThanOrEqualToConstant: 320).isActive = true
        applySidebarVisibility()
        applyMode(.reading)
    }

    private func load(_ url: URL?) {
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
        editor.string = text
        lastSavedText = text
        updateTitle()
        refreshSiblingDocuments()
        loadPreviewShell()
    }

    private func replaceDocument(with url: URL) {
        guard ["md", "markdown", "txt"].contains(url.pathExtension.lowercased()) else {
            NSSound.beep()
            statusLabel.stringValue = "仅支持 Markdown 文本"
            return
        }
        guard confirmLeavingCurrentDocument() else { return }
        fileURL = url
        load(url)
    }

    private func refreshSiblingDocuments() {
        guard let fileURL else {
            siblingURLs = []
            updateNavigationControls()
            return
        }
        let directory = fileURL.deletingLastPathComponent()
        let urls = (try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles]
        )) ?? []
        siblingURLs = urls.filter { url in
            let ext = url.pathExtension.lowercased()
            guard ext == "md" || ext == "markdown" else { return false }
            return (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) ?? false
        }.sorted {
            $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending
        }
        if !didChooseInitialSidebarVisibility {
            sidebarVisible = siblingURLs.count > 1
            didChooseInitialSidebarVisibility = true
            applySidebarVisibility()
        }
        updateNavigationControls()
    }

    private var currentSiblingIndex: Int? {
        guard let current = fileURL?.standardizedFileURL else { return nil }
        return siblingURLs.firstIndex { $0.standardizedFileURL == current }
    }

    private func updateNavigationControls() {
        guard let index = currentSiblingIndex else {
            previousButton.isEnabled = false
            nextButton.isEnabled = false
            positionLabel.stringValue = ""
            isUpdatingSidebarSelection = true
            sidebarTable.reloadData()
            sidebarTable.deselectAll(nil)
            DispatchQueue.main.async { [weak self] in self?.isUpdatingSidebarSelection = false }
            return
        }
        previousButton.isEnabled = index > 0
        nextButton.isEnabled = index + 1 < siblingURLs.count
        positionLabel.stringValue = "\(index + 1) / \(siblingURLs.count)"
        isUpdatingSidebarSelection = true
        sidebarTable.reloadData()
        sidebarTable.selectRowIndexes(IndexSet(integer: index), byExtendingSelection: false)
        sidebarTable.scrollRowToVisible(index)
        DispatchQueue.main.async { [weak self] in self?.isUpdatingSidebarSelection = false }
    }

    @objc private func showPreviousDocument(_ sender: Any?) { navigateDocument(by: -1) }
    @objc private func showNextDocument(_ sender: Any?) { navigateDocument(by: 1) }

    private func navigateDocument(by offset: Int) {
        refreshSiblingDocuments()
        guard let index = currentSiblingIndex else { NSSound.beep(); return }
        let destination = index + offset
        guard siblingURLs.indices.contains(destination) else { NSSound.beep(); return }
        navigateDocument(to: destination)
    }

    private func navigateDocument(to destination: Int) {
        guard siblingURLs.indices.contains(destination) else { return }
        guard confirmLeavingCurrentDocument() else { return }
        fileURL = siblingURLs[destination]
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
                guard let self, self.documentAreaSplitView.bounds.width > 220 else { return }
                self.documentAreaSplitView.setPosition(220, ofDividerAt: 0)
            }
        }
    }

    func numberOfRows(in tableView: NSTableView) -> Int { siblingURLs.count }

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
        let name = siblingURLs[row].lastPathComponent
        cell.textField?.stringValue = name
        cell.toolTip = name
        return cell
    }

    func tableViewSelectionDidChange(_ notification: Notification) {
        guard !isUpdatingSidebarSelection else { return }
        let row = sidebarTable.selectedRow
        guard siblingURLs.indices.contains(row), row != currentSiblingIndex else { return }
        if confirmLeavingCurrentDocument() {
            fileURL = siblingURLs[row]
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
        guard currentMode == .reading else { return false }
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
        renderWorkItem?.cancel()
        let item = DispatchWorkItem { [weak self] in self?.renderPreview() }
        renderWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12, execute: item)
    }

    private func renderPreview() {
        guard webReady else { return }
        let text = editor.string
        guard let data = try? JSONSerialization.data(withJSONObject: [text]),
              var json = String(data: data, encoding: .utf8) else { return }
        json.removeFirst()
        json.removeLast()
        webView.evaluateJavaScript("window.lightmarkRender(\(json)); window.lightmarkSetScale(\(fontScale));")
    }

    @objc private func modeChanged(_ sender: NSSegmentedControl) {
        applyMode(ViewMode(rawValue: sender.selectedSegment) ?? .reading)
    }

    private func applyMode(_ mode: ViewMode) {
        currentMode = mode
        modeControl.selectedSegment = mode.rawValue
        editorScroll.isHidden = mode == .reading
        webView.isHidden = mode == .editing
        if mode == .split {
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.splitView.setPosition(self.splitView.bounds.width * 0.44, ofDividerAt: 0)
            }
        }
        if mode != .editing { renderPreview() }
        if mode == .editing { window?.makeFirstResponder(editor) }
    }

    @objc func showReading(_ sender: Any?) { applyMode(.reading) }
    @objc func showEditing(_ sender: Any?) { applyMode(.editing) }
    @objc func showSplit(_ sender: Any?) { applyMode(.split) }

    @objc func showSyntaxGuide(_ sender: Any?) {
        syntaxPopover?.close()

        let popover = NSPopover()
        popover.behavior = .transient
        popover.contentSize = NSSize(width: 430, height: 520)

        let controller = NSViewController()
        let root = NSVisualEffectView(frame: NSRect(x: 0, y: 0, width: 430, height: 520))
        root.material = .popover
        root.state = .active

        let heading = NSTextField(labelWithString: "Markdown 语法速查")
        heading.font = .systemFont(ofSize: 16, weight: .semibold)
        heading.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(heading)

        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.drawsBackground = false
        scroll.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(scroll)

        let guide = NSTextView(frame: NSRect(x: 0, y: 0, width: 410, height: 900))
        guide.isEditable = false
        guide.isSelectable = true
        guide.drawsBackground = false
        guide.font = .monospacedSystemFont(ofSize: 12.5, weight: .regular)
        guide.textColor = .labelColor
        guide.textContainerInset = NSSize(width: 8, height: 8)
        guide.autoresizingMask = [.width]
        guide.minSize = NSSize(width: 0, height: 0)
        guide.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        guide.isVerticallyResizable = true
        guide.isHorizontallyResizable = false
        guide.textContainer?.widthTracksTextView = true
        guide.textContainer?.containerSize = NSSize(width: 394, height: CGFloat.greatestFiniteMagnitude)
        guide.string = """
        标题
        # 一级标题
        ## 二级标题
        ### 三级标题

        文字
        **粗体**
        *斜体*
        ~~删除线~~
        `行内代码`

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

        Obsidian Wiki Link
        [[文档名称]]
        [[文档名称|显示文字]]
        """
        scroll.documentView = guide

        NSLayoutConstraint.activate([
            heading.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 18),
            heading.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -18),
            heading.topAnchor.constraint(equalTo: root.topAnchor, constant: 16),
            scroll.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 10),
            scroll.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -10),
            scroll.topAnchor.constraint(equalTo: heading.bottomAnchor, constant: 10),
            scroll.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -10)
        ])

        controller.view = root
        popover.contentViewController = controller
        let anchor = (sender as? NSView) ?? syntaxButton
        popover.show(relativeTo: anchor.bounds, of: anchor, preferredEdge: .maxY)
        syntaxPopover = popover
    }

    @objc func save(_ sender: Any?) {
        guard let url = fileURL else { saveAs(sender); return }
        write(to: url)
    }

    @objc func saveAs(_ sender: Any?) {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.init(filenameExtension: "md")!]
        panel.nameFieldStringValue = fileURL?.lastPathComponent ?? "未命名.md"
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

    @objc func zoomIn(_ sender: Any?) { fontScale = min(1.5, fontScale + 0.1); renderPreview() }
    @objc func zoomOut(_ sender: Any?) { fontScale = max(0.75, fontScale - 0.1); renderPreview() }
    @objc func zoomReset(_ sender: Any?) { fontScale = 1.0; renderPreview() }

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
              ["md", "markdown", "txt"].contains(value.pathExtension.lowercased()) else { return nil }
        return value
    }
}

let application = NSApplication.shared
let applicationDelegate = AppDelegate()
application.setActivationPolicy(.regular)
application.delegate = applicationDelegate
application.run()
