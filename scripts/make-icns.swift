#!/usr/bin/env swift

import AppKit

guard CommandLine.arguments.count == 3 else {
    fputs("usage: make-icns.swift INPUT.png OUTPUT.icns\n", stderr)
    exit(2)
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])

guard let source = NSImage(contentsOf: inputURL) else {
    fputs("unable to open input image: \(inputURL.path)\n", stderr)
    exit(1)
}

func pngData(pixelSize: Int) -> Data? {
    guard let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: pixelSize,
        pixelsHigh: pixelSize,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bitmapFormat: [],
        bytesPerRow: 0,
        bitsPerPixel: 0
    ) else {
        return nil
    }

    NSGraphicsContext.saveGraphicsState()
    guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
        NSGraphicsContext.restoreGraphicsState()
        return nil
    }
    NSGraphicsContext.current = context
    context.imageInterpolation = .high
    context.shouldAntialias = true

    let canvas = NSRect(x: 0, y: 0, width: pixelSize, height: pixelSize)
    NSColor.clear.setFill()
    canvas.fill()
    source.draw(
        in: canvas,
        from: NSRect(origin: .zero, size: source.size),
        operation: .copy,
        fraction: 1,
        respectFlipped: true,
        hints: [.interpolation: NSImageInterpolation.high]
    )
    context.flushGraphics()
    NSGraphicsContext.restoreGraphicsState()

    return bitmap.representation(using: .png, properties: [:])
}

func appendBigEndian(_ value: UInt32, to data: inout Data) {
    var encoded = value.bigEndian
    withUnsafeBytes(of: &encoded) { bytes in
        data.append(contentsOf: bytes)
    }
}

let representations: [(type: String, pixels: Int)] = [
    ("icp4", 16),
    ("icp5", 32),
    ("icp6", 64),
    ("ic07", 128),
    ("ic08", 256),
    ("ic09", 512),
    ("ic10", 1024),
]

var payload = Data()
for representation in representations {
    guard let png = pngData(pixelSize: representation.pixels) else {
        fputs("unable to render \(representation.pixels)-pixel icon\n", stderr)
        exit(1)
    }
    payload.append(contentsOf: representation.type.utf8)
    appendBigEndian(UInt32(png.count + 8), to: &payload)
    payload.append(png)
}

var icns = Data("icns".utf8)
appendBigEndian(UInt32(payload.count + 8), to: &icns)
icns.append(payload)

do {
    try icns.write(to: outputURL, options: .atomic)
} catch {
    fputs("unable to write ICNS file: \(error)\n", stderr)
    exit(1)
}
