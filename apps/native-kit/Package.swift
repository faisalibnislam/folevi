// swift-tools-version: 6.0
// FoleviKit: the Swift shared by Folevi for iPhone, iPad and Mac (docs/NATIVE_APP_PLAN.md section 6.1).
// apps/ios (App.xcodeproj, a local package reference) and apps/mac (project.yml) both use it.
//
//   FoleviEngine   the bridge to the web engine in the Page View: protocol envelope, generated models
//                  (Generated/, scripts/engine-codegen.mjs), EngineClient, observable list and value stores
//   FoleviDesign   tokens (Generated/Tokens.swift from `pnpm tokens`), the bundled fonts, and the components
//
// Later packages add their targets here (FoleviBridgeHost N1, FoleviServices N0b, FoleviScreens N7+,
// FoleviPhone N5, FoleviMac N8); the owner of this file (N0) merges them.
import PackageDescription

let strict: [SwiftSetting] = [
    .enableUpcomingFeature("ExistentialAny"),
]

let package = Package(
    name: "FoleviKit",
    defaultLocalization: "en",
    platforms: [.iOS(.v17), .macOS(.v15)],
    products: [
        .library(name: "FoleviEngine", targets: ["FoleviEngine"]),
        .library(name: "FoleviDesign", targets: ["FoleviDesign"]),
        .library(name: "FoleviScreens", targets: ["FoleviScreens"]),
    ],
    targets: [
        .target(
            name: "FoleviEngine",
            swiftSettings: strict
        ),
        .target(
            name: "FoleviDesign",
            resources: [.copy("Resources/Fonts")],
            swiftSettings: strict
        ),
        .target(
            name: "FoleviScreens",
            dependencies: ["FoleviEngine", "FoleviDesign"],
            swiftSettings: strict
        ),
        .testTarget(
            name: "FoleviEngineTests",
            dependencies: ["FoleviEngine"],
            swiftSettings: strict
        ),
        .testTarget(
            name: "FoleviDesignTests",
            dependencies: ["FoleviDesign"],
            exclude: ["__Snapshots__"],
            swiftSettings: strict
        ),
        .testTarget(
            name: "FoleviScreensTests",
            dependencies: ["FoleviScreens", "FoleviEngine", "FoleviDesign"],
            exclude: ["__Snapshots__"],
            swiftSettings: strict
        ),
    ],
    swiftLanguageModes: [.v6]
)
