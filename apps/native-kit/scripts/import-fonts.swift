// Copies the Folevi fonts out of the web app's built export into FoleviDesign as TrueType files
// (docs/NATIVE_APP_PLAN.md section 7: the native apps draw with the same faces the web self-hosts through
// next/font). next/font writes each face as several unicode-range subsets with hashed names; this picks the
// Latin subset of each face we bundle (the one with Basic Latin, Latin-1 and the "…" and "’" punctuation),
// reads its tables with Core Text and writes them back out as a plain sfnt, which Core Text registers on every
// OS version (no WOFF2 decoding needed at run time). Missing characters fall back to the system font.
//
//   pnpm --filter @folevi/web build:shell        (or any export with _next/static/media)
//   swift apps/native-kit/scripts/import-fonts.swift <export>/_next/static/media
//
// All faces are under the SIL Open Font License 1.1 (Resources/Fonts/OFL.txt).
import CoreText
import Foundation

let wanted: [(postScript: String, file: String)] = [
    ("InstrumentSans-Regular", "InstrumentSans.ttf"),         // variable, weight 400 to 700
    ("Spectral-Regular", "Spectral-Regular.ttf"),
    ("Spectral-Italic", "Spectral-Italic.ttf"),
    ("Spectral-Medium", "Spectral-Medium.ttf"),
    ("Spectral-MediumItalic", "Spectral-MediumItalic.ttf"),
    ("Spectral-SemiBold", "Spectral-SemiBold.ttf"),
    ("Spectral-SemiBoldItalic", "Spectral-SemiBoldItalic.ttf"),
    ("Spectral-Bold", "Spectral-Bold.ttf"),
    // Variable fonts: the Latin subset reports a named instance (e.g. "Inter-Regular_Thin"), so these match by prefix.
    ("JetBrainsMono-Regular|JetBrainsMonoRoman-", "JetBrainsMono.ttf"), // variable, weight 100 to 800
    ("Inter-Regular", "Inter.ttf"),                           // variable, the "Modern" font type's standard face
]
let latinProbe = "Aaé…’•"

guard CommandLine.arguments.count >= 2 else {
    FileHandle.standardError.write("usage: swift import-fonts.swift <export>/_next/static/media [out dir]\n".data(using: .utf8)!)
    exit(2)
}
let media = URL(fileURLWithPath: CommandLine.arguments[1])
let out = CommandLine.arguments.count > 2
    ? URL(fileURLWithPath: CommandLine.arguments[2])
    : URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../Sources/FoleviDesign/Resources/Fonts").standardized

func coversLatin(_ font: CTFont) -> Bool {
    let set = CTFontCopyCharacterSet(font) as CharacterSet
    return latinProbe.unicodeScalars.allSatisfy { set.contains($0) }
}

/// The font's tables as one sfnt file (TrueType or CFF flavour).
func sfnt(_ font: CTFont) -> Data {
    // The array holds the tags unboxed, as pointer-sized integers (CTFontCopyAvailableTables' documentation).
    var tags: [UInt32] = []
    if let array = CTFontCopyAvailableTables(font, []) {
        for i in 0..<CFArrayGetCount(array) {
            tags.append(UInt32(UInt(bitPattern: CFArrayGetValueAtIndex(array, i))))
        }
    }
    tags.sort()
    var tables: [(UInt32, Data)] = []
    for tag in tags {
        if let d = CTFontCopyTable(font, CTFontTableTag(tag), []) as Data? { tables.append((tag, d)) }
    }
    let isCFF = tables.contains { $0.0 == 0x4346_4620 } // 'CFF '
    var data = Data()
    func u16(_ v: Int) { var b = UInt16(v).bigEndian; data.append(Data(bytes: &b, count: 2)) }
    func u32(_ v: UInt32) { var b = v.bigEndian; data.append(Data(bytes: &b, count: 4)) }
    let n = tables.count
    var pow2 = 1, log2 = 0
    while pow2 * 2 <= n { pow2 *= 2; log2 += 1 }
    u32(isCFF ? 0x4F54_544F : 0x0001_0000)
    u16(n); u16(pow2 * 16); u16(log2); u16(n * 16 - pow2 * 16)
    var offset = 12 + 16 * n
    func checksum(_ d: Data) -> UInt32 {
        var sum: UInt32 = 0
        var padded = d
        while padded.count % 4 != 0 { padded.append(0) }
        padded.withUnsafeBytes { raw in
            for i in stride(from: 0, to: padded.count, by: 4) {
                sum = sum &+ UInt32(bigEndian: raw.loadUnaligned(fromByteOffset: i, as: UInt32.self))
            }
        }
        return sum
    }
    for (tag, d) in tables {
        u32(tag); u32(checksum(d)); u32(UInt32(offset)); u32(UInt32(d.count))
        offset += (d.count + 3) / 4 * 4
    }
    for (_, d) in tables {
        data.append(d)
        while data.count % 4 != 0 { data.append(0) }
    }
    return data
}

let files = (try? FileManager.default.contentsOfDirectory(at: media, includingPropertiesForKeys: nil)) ?? []
var found: [String: CTFont] = [:]
for url in files where url.pathExtension == "woff2" {
    guard let descriptors = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor], let d = descriptors.first else { continue }
    let font = CTFontCreateWithFontDescriptor(d, 12, nil)
    let name = CTFontCopyPostScriptName(font) as String
    guard let w = wanted.first(where: { $0.postScript.split(separator: "|").contains { name == $0 || name.hasPrefix($0 + "_") || ($0.hasSuffix("-") && name.hasPrefix($0)) } }) else { continue }
    if found[w.postScript] == nil, coversLatin(font) { found[w.postScript] = font }
}
try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
var missing = false
for w in wanted {
    guard let font = found[w.postScript] else {
        FileHandle.standardError.write("missing: \(w.postScript)\n".data(using: .utf8)!)
        missing = true
        continue
    }
    try sfnt(font).write(to: out.appendingPathComponent(w.file))
    print("wrote \(w.file)")
}
exit(missing ? 1 : 0)
