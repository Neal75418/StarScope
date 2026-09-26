#!/bin/bash
# 在本機實際跑一次打包版 app（macOS），不碰開發者的資料與憑證。
#
# 開發模式（start-dev.sh）不走打包後的啟停路徑，sidecar 生命週期、冷啟動這類問題只有打包版看得到。
# 這支腳本：
# - 打包 sidecar 到暫存區，tauri build 以 --config 指向它，不動 repo 裡的 placeholder
# - 以 env -i 從零建環境：shell 裡的 token 一個都帶不進去；keyring 換成 null、GITHUB_TOKEN 設空
# - STARSCOPE_DATA_DIR 指到暫存區：它優先於 Tauri 注入的資料目錄，不會碰到真實資料庫
# - cwd 在暫存區：打包後的 sidecar 會從 cwd 往上找 .env，repo 根目錄那份放著真 token
# - app 結束後檢查有沒有殘留的 sidecar、8008 有沒有放開
#
# 前端的 localStorage（介面偏好）跟已安裝的 StarScope 共用同一個 app identifier，這點隔離不了。
#
# 用法：scripts/run-packaged-app.sh [--skip-build]
#   --skip-build  沿用上一次打包的 .app

set -u

if [ "$(uname)" != "Darwin" ]; then
  echo "❌ 只支援 macOS（其他平台的打包產物不是 .app）"
  exit 1
fi

REPO="$(cd "$(dirname "$0")/.." && pwd)"
TMP_ROOT="${TMPDIR:-/tmp}"
WORK="${TMP_ROOT%/}/starscope-packaged-app"
APP="$REPO/src-tauri/target/release/bundle/macos/StarScope.app"
PORT=8008   # 打包版的 sidecar 固定用 8008

if [ "${1:-}" != "--skip-build" ]; then
  TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
  [ -n "$TRIPLE" ] || { echo "❌ 讀不到 rustc 的 host triple"; exit 1; }
  rm -rf "$WORK/build" "$WORK/dist" "$WORK/bin" && mkdir -p "$WORK/bin" || exit 1

  echo "== 打包 sidecar（${TRIPLE}）"
  (cd "$REPO/sidecar" && STARSCOPE_TARGET_TRIPLE="$TRIPLE" .venv/bin/pyinstaller starscope-sidecar.spec \
    --distpath "$WORK/dist" --workpath "$WORK/build" --noconfirm >"$WORK/pyinstaller.log" 2>&1) \
    || { echo "❌ sidecar 打包失敗，見 $WORK/pyinstaller.log"; exit 1; }
  cp "$WORK/dist/starscope-sidecar-$TRIPLE" "$WORK/bin/" || exit 1

  echo "== 打包 app"
  # externalBin 不帶 triple 後綴，Tauri 會自己補
  (cd "$REPO" && npx tauri build --bundles app \
    --config "{\"bundle\":{\"externalBin\":[\"$WORK/bin/starscope-sidecar\"]}}" >"$WORK/tauri-build.log" 2>&1) \
    || { echo "❌ app 打包失敗，見 $WORK/tauri-build.log"; exit 1; }
fi

[ -x "$APP/Contents/MacOS/starscope" ] || { echo "❌ 找不到 ${APP}，先不帶 --skip-build 跑一次"; exit 1; }

# 已經有東西在 8008：新 sidecar 綁不到就退出，前端連到的是別人，結果全都不準
if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "❌ port $PORT 已經有東西在聽（已安裝的 StarScope 或開發中的 sidecar？），先關掉它"
  exit 1
fi

DATA_DIR="$WORK/appdata"
mkdir -p "$DATA_DIR" && cd "$DATA_DIR" || exit 1
LOG="$WORK/app.log"
echo "== 啟動（資料：${DATA_DIR}；app 輸出：${LOG}；sidecar 日誌：$DATA_DIR/starscope.log）"
echo "   結束 app 後這裡會檢查殘留"

env -i HOME="$HOME" PATH="/usr/bin:/bin:/usr/sbin:/sbin" USER="${USER:-}" LANG="${LANG:-en_US.UTF-8}" \
  TMPDIR="${TMPDIR:-/tmp}" \
  STARSCOPE_DATA_DIR="$DATA_DIR" PYTHON_KEYRING_BACKEND=keyring.backends.null.Keyring GITHUB_TOKEN= \
  "$APP/Contents/MacOS/starscope" >"$LOG" 2>&1
echo "== app 已結束（exit $?）"

# 只看執行檔路徑（comm），不看參數：macOS 上讀別的行程的參數可能溢出到它的環境變數
leftover() { ps -axo pid=,comm= | grep "StarScope.app/Contents/MacOS/starscope-sidecar" | grep -v grep; }
for _ in {1..5}; do
  if ! leftover >/dev/null && ! lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
    echo "✅ 沒有殘留的 sidecar，port $PORT 已放開"
    exit 0
  fi
  sleep 1
done
echo "❌ app 結束 5 秒後 sidecar 仍在："
leftover
lsof -nP -iTCP:$PORT -sTCP:LISTEN
exit 1
