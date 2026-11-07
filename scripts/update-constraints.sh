#!/bin/bash
# 從開發機的 sidecar venv 重新產生 sidecar/constraints.txt，再依它產生打包環境的 sidecar/packaging.lock。
# 升級流程：.venv/bin/pip install -U <套件> → 跑測試 → 執行這支腳本 → 看過 packaging.lock 的 diff 再 commit
# constraints.txt 與 packaging.lock（改了 requirements 檔的範圍就連它一起）。

set -euo pipefail

cd "$(dirname "$0")/../sidecar"
# pyinstaller 不在 requirements 檔，packaging.lock 的版本取自 constraints；venv 沒裝的話 freeze 會把它的鎖弄丟
if ! .venv/bin/pip show --quiet pyinstaller 2>/dev/null; then
  echo "❌ sidecar/.venv 沒有 pyinstaller，先執行：cd sidecar && .venv/bin/pip install pyinstaller -c constraints.txt" >&2
  exit 1
fi
# packaging.lock 要用 uv 產生（pip 只解得出目前這個平台）：先確認有它，免得 constraints 改了、鎖檔沒跟上
if ! command -v uv >/dev/null 2>&1; then
  echo "❌ 找不到 uv：產生 sidecar/packaging.lock 要用它（https://docs.astral.sh/uv/getting-started/installation/）" >&2
  exit 1
fi
FREEZE="$(.venv/bin/pip freeze --exclude-editable)"

{
  cat <<'EOF'
# CI 安裝時用的版本鎖定（pip install -r requirements-dev.txt／requirements.txt -c constraints.txt）。
# 內容是開發機（macOS arm64）venv 的 pip freeze。requirements 檔只宣告範圍；沒有這份檔案的話，
# CI 全新安裝會悄悄裝到範圍內的最新版。
#
# 不要手改：升級套件後執行 scripts/update-constraints.sh 重新產生。
# ⚠️ 鎖不到的：constraints 只限制「要裝的話裝哪一版」，開發機沒裝、其他平台才會裝的套件不在 freeze 裡，
# 仍會裝到最新版——只影響 test.yml 的測試與 E2E（Linux），例如 keyring 的 SecretStorage／cryptography。
# 打包環境不直接裝這份：它裝 packaging.lock（同一支腳本產生，含各平台的套件與雜湊），版本以這份為準；
# 這份沒鎖的平台專屬套件，取重產當下的最新版。
EOF
  echo "$FREEZE"
} > constraints.txt

echo "✅ sidecar/constraints.txt：$(grep -c '==' constraints.txt) 個套件"

# 打包環境的鎖檔：packaging.in 在上面的版本下解出各平台都適用的一份（平台專屬的套件以 marker 區分，
# 開發機沒裝的 Linux／Windows 套件也一起鎖住），每個套件附雜湊。
# - --upgrade：constraints 沒鎖的平台專屬套件（cryptography、tzdata…）每次都取當下最新版；不加的話 uv 會沿用
#   鎖檔裡的舊版，它們就再也升不上去，安全修補也進不來。commit 前看一下鎖檔的 diff
# - --no-config：不讀 uv.toml／pyproject.toml 的設定（例如換掉 index）；UV_* 環境變數（UV_INDEX_URL、UV_EXCLUDE_NEWER…）
#   仍然有效，跑之前不要設
# uv 失敗時 constraints 已經更新、鎖檔還是舊的：重跑這支腳本即可。鎖檔該跟著變的部分 tests/test_packaging_lock.py 會紅；
# 平台專屬套件沒更新到不會紅（只是停在上一版）
uv pip compile packaging.in -c constraints.txt --universal --generate-hashes --upgrade --no-config \
  --python-version "$(cat ../.python-version)" --custom-compile-command "scripts/update-constraints.sh" \
  --quiet -o packaging.lock
echo "✅ sidecar/packaging.lock：$(grep -c '==' packaging.lock) 個套件"
