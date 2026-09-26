#!/bin/bash
# 打包後的 sidecar 啟動檢查：實際執行 binary，等 /api/health 回 200，
# 再確認它在父行程消失後會自己結束、放開 port。
#
# 單元測試跑的是原始碼，看不到「打包後才會壞」的問題——例如 uvicorn.run("main:app")
# 在 PyInstaller 產物裡找不到 main 模組，binary 一啟動就退出，而原始碼的測試全綠。
#
# 用法：scripts/smoke-test-sidecar.sh <binary 路徑>

set -u

BINARY="${1:?用法: $0 <binary 路徑>}"
if [ ! -f "$BINARY" ]; then
  echo "❌ 找不到 binary：$BINARY"
  exit 1
fi
BINARY="$(cd "$(dirname "$BINARY")" && pwd)/$(basename "$BINARY")"
PORT=18008            # 不用 8008：避免撞到開發者正在跑的 sidecar
TIMEOUT_SECONDS=120   # onefile 首次啟動要解壓，本機實測約 22 秒，CI runner 更慢
PARENT_GONE_TIMEOUT_SECONDS=15   # 看門每 2 秒檢查一次，加上 uvicorn 正常關閉的時間
HEALTH_URL="http://127.0.0.1:$PORT/api/health"

# 先確認 port 是空的：否則 binary 綁不到 port 就退出，curl 卻打到別的行程而假通過
if curl -sf --max-time 2 "$HEALTH_URL" >/dev/null; then
  echo "❌ port $PORT 已經有東西在回應，無法判斷結果"
  exit 1
fi

# mktemp 失敗時一定要停：STARSCOPE_DATA_DIR="" 會被當成沒設定，退回 ~/.starscope 的真實資料庫
DATA_DIR="$(mktemp -d)" || exit 1
LOG_FILE="$DATA_DIR/sidecar.log"
PID=""
FAKE_PARENT=""

stop_sidecar() {
  [ -n "$PID" ] || return 0
  kill "$PID" 2>/dev/null || return 0
  for _ in {1..10}; do
    kill -0 "$PID" 2>/dev/null || return 0
    sleep 1
  done
  # onefile 是 bootloader 父行程＋Python 子行程：只殺父行程，子行程會變孤兒繼續佔著 port
  pkill -9 -P "$PID" 2>/dev/null || true
  kill -9 "$PID" 2>/dev/null || true
}

cleanup() {
  stop_sidecar
  [ -z "$FAKE_PARENT" ] || kill "$FAKE_PARENT" 2>/dev/null || true
  cd / && rm -rf "$DATA_DIR"
}
trap cleanup EXIT

# 在本機跑時不能碰到開發者的資料與憑證：
# - cd 到暫存目錄：打包後的 binary 會從 CWD 往上找 .env（python-dotenv 的 frozen 分支）
# - 清空 GITHUB_TOKEN、keyring 換成 null backend：否則會讀到 Keychain 裡的真 token 並用它打 GitHub
# - ENV=production 比照 Tauri release build 的注入（src-tauri/src/lib.rs）。Tauri 不設 DEBUG、
#   會繼承使用者環境；這裡固定 false 是為了跟開發者的環境隔開，frozen＋DEBUG=true 的情況
#   由 tests/test_main_startup.py 守
cd "$DATA_DIR" || exit 1

# 假的父行程：代表 Tauri。健康檢查通過後殺掉它，binary 要自己結束
#（app 當掉或被強制結束時，留下來的 sidecar 會佔著 port，下次開 app 整片 403）
sleep 600 &
FAKE_PARENT=$!
disown "$FAKE_PARENT"
PARENT_PID_FOR_BINARY="$FAKE_PARENT"
# Windows 的 Git Bash 裡 $! 是 MSYS 的 pid，原生 exe 看到的是 Windows PID
if [ -r "/proc/$FAKE_PARENT/winpid" ]; then
  PARENT_PID_FOR_BINARY="$(cat "/proc/$FAKE_PARENT/winpid")"
fi

STARSCOPE_DATA_DIR="$DATA_DIR" PORT="$PORT" ENV=production DEBUG=false GITHUB_TOKEN= \
  PYTHON_KEYRING_BACKEND=keyring.backends.null.Keyring \
  STARSCOPE_PARENT_PID="$PARENT_PID_FOR_BINARY" \
  "$BINARY" >"$LOG_FILE" 2>&1 &
PID=$!
# 不讓 bash 把它當成 job 追蹤：否則被 kill 時會在輸出裡多一行「Terminated」。
# 存活與否一律用 kill -0 判斷，不需要 wait
disown "$PID"

for ((elapsed = 0; elapsed < TIMEOUT_SECONDS; elapsed++)); do
  if curl -sf --max-time 2 "$HEALTH_URL" >/dev/null; then
    echo "✅ sidecar 在 ${elapsed}s 內回應 /api/health"
    HEALTHY=1
    break
  fi
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "❌ sidecar 在回應之前就結束了，輸出如下："
    cat "$LOG_FILE"
    exit 1
  fi
  sleep 1
done

if [ "${HEALTHY:-0}" != 1 ]; then
  echo "❌ sidecar ${TIMEOUT_SECONDS}s 內沒有回應 /api/health，輸出如下："
  cat "$LOG_FILE"
  exit 1
fi

kill "$FAKE_PARENT" 2>/dev/null
for ((waited = 0; waited < PARENT_GONE_TIMEOUT_SECONDS; waited++)); do
  if ! kill -0 "$PID" 2>/dev/null && ! curl -sf --max-time 2 "$HEALTH_URL" >/dev/null; then
    echo "✅ 父行程消失後 ${waited}s 內自己結束並放開 port"
    PID=""
    exit 0
  fi
  sleep 1
done
echo "❌ 父行程消失 ${PARENT_GONE_TIMEOUT_SECONDS}s 後 sidecar 仍在（會佔著 port，下次開 app 整片 403），輸出如下："
cat "$LOG_FILE"
exit 1
