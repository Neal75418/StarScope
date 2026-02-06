//! StarScope 應用程式入口點。

// 在 Windows release 模式下隱藏額外的 console 視窗，請勿移除！
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    starscope_lib::run()
}
