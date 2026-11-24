// Folevi for Windows and Linux. No console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    folevi_lib::run()
}
