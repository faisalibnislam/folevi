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
    // The shared Dropbox and Google Drive code (apps/ios/scripts/bundle-cloud.mjs, git-ignored): put in every page by
    // lib.rs when it's built; without it the page has no cloud kit and doesn't offer them.
    let kit = "../../ios/ios/App/Native/Shell/folevi-cloud.js";
    println!("cargo:rerun-if-changed={kit}");
    println!("cargo:rerun-if-env-changed=FOLEVI_DROPBOX_APP_KEY");
    println!("cargo:rerun-if-env-changed=FOLEVI_GOOGLE_DESKTOP_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=FOLEVI_GOOGLE_DESKTOP_CLIENT_SECRET");
    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR"));
    std::fs::write(out.join("folevi-cloud.js"), std::fs::read_to_string(kit).unwrap_or_default()).expect("OUT_DIR is writable");
    tauri_build::build()
}
