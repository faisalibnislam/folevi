fn main() {
    // Folevi's version as Folevi writes it ("1.5.68"; Cargo's and the installer's is its semver form):
    // apps/desktop/package.json "foleviVersion", which scripts/version.mjs copies from version.json.
    let pkg = std::fs::read_to_string("../package.json").unwrap_or_default();
    let version = pkg
        .split("\"foleviVersion\"")
        .nth(1)
        .and_then(|rest| rest.split('"').nth(1))
        .unwrap_or(env!("CARGO_PKG_VERSION"))
        .to_string();
    println!("cargo:rustc-env=FOLEVI_VERSION={version}");
    println!("cargo:rerun-if-changed=../package.json");
    println!("cargo:rerun-if-changed=bridge/host.js");
    println!("cargo:rerun-if-changed=../../ios/ios/App/Native/Shell/shell-bridge.js");
    tauri_build::build()
}
