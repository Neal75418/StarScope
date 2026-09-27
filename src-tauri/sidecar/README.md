# 打包進安裝檔的 sidecar

這個資料夾會整個打包進安裝檔（`tauri.conf.json` 的 `bundle.resources`），Rust 從這裡啟動 sidecar。

repo 裡只放這份 README：目錄存在，開發模式與 `cargo test` 才編得過。發版時 CI 用
`scripts/stage_sidecar.py` 清空這裡，放進 PyInstaller 產出的 onedir。本機打包版實測用
`scripts/run-packaged-app.sh`，它把 onedir 放在暫存目錄，不動這裡。

不要把 sidecar commit 進來（`.gitignore` 已擋）。
