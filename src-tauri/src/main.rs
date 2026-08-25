// Hides the console window that Windows would otherwise open alongside the app in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    brew_terminal_lib::run()
}
