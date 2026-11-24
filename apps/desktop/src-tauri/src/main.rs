// Folevi for Windows and Linux. No console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    folevi_lib::linux::pre_init();
    folevi_lib::run()
}
