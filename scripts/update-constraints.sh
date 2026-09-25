#!/bin/bash
# 從開發機的 sidecar venv 重新產生 sidecar/constraints.txt。
# 升級流程：.venv/bin/pip install -U <套件> → 跑測試 → 執行這支腳本 → commit 兩個檔案。

set -euo pipefail

cd "$(dirname "$0")/../sidecar"
# pyinstaller 不在 requirements.txt，但 release 用 constraints 鎖它；venv 沒裝的話 freeze 會把它的鎖弄丟
if ! .venv/bin/pip show --quiet pyinstaller 2>/dev/null; then
  echo "❌ sidecar/.venv 沒有 pyinstaller，先執行：cd sidecar && .venv/bin/pip install pyinstaller -c constraints.txt" >&2
  exit 1
fi
FREEZE="$(.venv/bin/pip freeze --exclude-editable)"

{
  cat <<'EOF'
# CI 與 release 安裝時用的版本鎖定（pip install -r requirements.txt -c constraints.txt）。
# 內容是開發機（macOS arm64）venv 的 pip freeze。requirements.txt 只宣告範圍；沒有這份檔案的話，
# CI 全新安裝會悄悄裝到範圍內的最新版。
#
# 不要手改：升級套件後執行 scripts/update-constraints.sh 重新產生。
# ⚠️ 鎖不到的：constraints 只限制「要裝的話裝哪一版」，開發機沒裝、其他平台才會裝的套件不在 freeze 裡，
# 仍會裝到最新版。例如 greenlet（SQLAlchemy 只在 x86_64／aarch64 等機型拉它，Mac arm64 不算，
# 所以 CI 的 ubuntu、Intel Mac、Windows 都會裝）、Linux 上 keyring 的 SecretStorage／cryptography、
# Windows 上的 tzdata／pefile。
EOF
  echo "$FREEZE"
} > constraints.txt

echo "✅ sidecar/constraints.txt：$(grep -c '==' constraints.txt) 個套件"
