import Foundation
import XCTest

enum Fixtures {
    /// Repository root, derived from this file's location (apps/macos/FoleviTests/TestSupport.swift).
    static let repoRoot: URL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // FoleviTests
        .deletingLastPathComponent() // macos
        .deletingLastPathComponent() // apps
        .deletingLastPathComponent() // repo root

    static func editorSchema(_ name: String) throws -> Data {
        try Data(contentsOf: repoRoot.appendingPathComponent("packages/editor-schema/fixtures/\(name)"))
    }

    static func local(_ name: String) throws -> Data {
        try Data(contentsOf: repoRoot.appendingPathComponent("apps/macos/FoleviTests/Fixtures/\(name)"))
    }

    static func json(_ data: Data) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: data)
    }

    static var reference: JSONValue {
        get throws { try json(local("reference-outputs.json")) }
    }
}

func temporaryDirectory() -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("folevi-tests-\(UUID().uuidString)", isDirectory: true)
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}
