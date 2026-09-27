# 改用安裝版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 日常使用可以從開發模式換成安裝版：同一份資料、每次開 app 約 1 秒、macOS 下載後打得開。

**Architecture:** 資料目錄固定為 `~/.starscope`（`STARSCOPE_DATA_DIR` 仍可覆蓋）。sidecar 改用 PyInstaller onedir，由 `stage_sidecar.py` 攤平 symlink 後放進 `src-tauri/sidecar/`，作為 Tauri `resources` 打包；Rust 從 `resource_dir()/sidecar/` 啟動。macOS 用 ad-hoc 簽章（`signingIdentity: "-"`）。CI 從安裝檔中取出 sidecar 跑 smoke test，並驗證簽章。

**Tech Stack:** Tauri 2.11（Rust）、tauri-plugin-shell、PyInstaller 6、Python 3.12（CI）／sidecar `.venv`（本機）、GitHub Actions、tauri-action v1

**Spec:** `docs/superpowers/specs/2026-09-27-use-installed-app-design.md`

## Global Constraints

- 🚨 **預設資料目錄就是真實資料（`~/.starscope`）**。任何會啟動 sidecar 的實驗、測試或打包版實測，都必須設定 `STARSCOPE_DATA_DIR` 指向暫存目錄，同時設 `PYTHON_KEYRING_BACKEND=keyring.backends.null.Keyring`、`GITHUB_TOKEN=`。不能讀寫真實的 `~/.starscope`，也不能碰 `~/Library/Application Support/com.nealchen.starscope`。
- 後端測試：`cd sidecar && STARSCOPE_DATA_DIR="$(mktemp -d)" .venv/bin/python -m pytest …`
- Rust 測試：`cd src-tauri && cargo test --lib`（需要 repo 根目錄已有 `dist/`，沒有就先跑 `npm run build`）
- 沒得到同意之前，不能綁 8008、8009、1420、1421。smoke test 用 18008。
- 查行程只能用 `ps -axo pid=,comm=`，不能用 `pgrep -f`／`-l`、`ps aux`、`ps -o args`，這幾個會把其他行程的環境變數秘密印出來。
- 每個 commit 都要使用者授權才做。訊息用 Conventional Commits，純文字，**不加 Co-Authored-By**。push 由使用者自己做。
- 每個階段結束先過 code-reviewer 審查，修完才進下一個階段。
- 新增的每一個條件，都要做一次 mutation 驗證：拔掉它，確認有測試會變紅。還原時用備份檔加 `cmp`，不能用 `git checkout`；開始前先確認基準測試是全綠的。
- 文件和註解都用繁體中文，不寫本機絕對路徑。

## Review Focus

1. **安裝路徑含空白**（Windows 的 `C:\Program Files\StarScope\sidecar\starscope-sidecar.exe`）：要能啟動。由 Task 4 的解壓位置刻意含空白，加上 Task 6 在 Windows 上實際跑 smoke test 來驗證。
2. **唯讀位置**（macOS 的 App Translocation）：sidecar 不能嘗試寫進自己所在的資料夾。Task 4 會把取出的副本設成唯讀再跑 smoke test。
3. **忘了 stage**：`src-tauri/sidecar/` 裡只有 README 時，Rust 要直接回報 SpawnFailed、不重試（Task 5 的測試），CI 的檢查要擋下來（Task 3 的測試）。
4. **`run-packaged-app.sh` 的 `--config` 用 merge patch 合併 resources**：repo 的 README 不能被一起打包進去。Task 7 的腳本在打包後直接檢查。
5. **重複 stage**：上一次 stage 留下的檔案必須先清掉，不能混進新的一份。Task 2 的測試。

---

## 階段 1：統一資料位置

### Task 1: sidecar 不再採用 `TAURI_APP_DATA_DIR`，Rust 也不再傳它

**Files:**
- Create: `sidecar/tests/test_app_data_dir.py`
- Modify: `sidecar/db/database.py:16-32`
- Modify: `src-tauri/src/lib.rs:247-251`
- Modify: `CLAUDE.md`（「資料庫實際位置」、「schema 變更」兩節）
- Modify: `CHANGELOG.md`（`[Unreleased]` → `### 修復`）

**Interfaces:**
- Produces: `get_app_data_dir() -> Path` 的優先序改為 `STARSCOPE_DATA_DIR` → `Path.home() / ".starscope"`

- [ ] **Step 1: 寫會失敗的測試**

`sidecar/tests/test_app_data_dir.py`：

```python
"""資料目錄：開發模式、安裝版、collector 必須是同一個，安裝版才看得到 collector 寫的資料。"""

from pathlib import Path

from db.database import get_app_data_dir


def test_uses_the_explicit_override(monkeypatch, tmp_path):
    monkeypatch.setenv("STARSCOPE_DATA_DIR", str(tmp_path / "custom"))
    monkeypatch.setenv("TAURI_APP_DATA_DIR", str(tmp_path / "app-support"))

    assert get_app_data_dir() == tmp_path / "custom"


def test_the_installed_app_uses_the_same_folder_as_dev_mode(monkeypatch, tmp_path):
    # 舊版 Rust 會傳 TAURI_APP_DATA_DIR（Application Support），安裝版因此看不到 collector 的資料：
    # 就算有人把它加回去，也不能採用
    monkeypatch.delenv("STARSCOPE_DATA_DIR", raising=False)
    monkeypatch.setenv("TAURI_APP_DATA_DIR", str(tmp_path / "app-support"))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)

    assert get_app_data_dir() == tmp_path / ".starscope"
```

- [ ] **Step 2: 執行，確認失敗**

Run: `cd sidecar && STARSCOPE_DATA_DIR="$(mktemp -d)" .venv/bin/python -m pytest tests/test_app_data_dir.py -v`
Expected: `test_the_installed_app_uses_the_same_folder_as_dev_mode` FAIL，因為回傳的是 `…/app-support`；`test_uses_the_explicit_override` PASS

- [ ] **Step 3: 實作**

`sidecar/db/database.py` 的 `get_app_data_dir` 整個換成：

```python
def get_app_data_dir() -> Path:
    """
    取得資料目錄。開發模式、安裝版、launchd 的 collector 都用同一個位置，
    三者才看得到同一份資料。

    優先順序:
    1. STARSCOPE_DATA_DIR — 明確覆蓋（測試、smoke test、打包版實測的隔離）
    2. ~/.starscope

    不讀 TAURI_APP_DATA_DIR：安裝版以前由 Rust 傳入 Application Support 底下的路徑，
    結果看不到 collector 寫的資料。
    """
    if env_path := os.environ.get("STARSCOPE_DATA_DIR"):
        return Path(env_path)

    return Path.home() / ".starscope"
```

`src-tauri/src/lib.rs` 刪掉以下這段（位在 `start_sidecar_with_retry` 的 spawn 迴圈裡）：

```rust
        // 將 app data dir 與 session secret 透過環境變數傳給 sidecar 子程序，
        // 而非使用 std::env::set_var（在多執行緒環境有 data race 風險）。
        if let Ok(app_data_dir) = app.path().app_data_dir() {
            cmd = cmd.env("TAURI_APP_DATA_DIR", app_data_dir.to_string_lossy().to_string());
        }
        cmd = cmd.env("STARSCOPE_SESSION_SECRET", session_secret);
```

換成：

```rust
        // session secret 透過 Command::env() 傳給 sidecar，而不是 std::env::set_var
        //（在多執行緒環境有 data race 風險）。資料目錄不傳：安裝版與開發模式、collector
        // 共用 sidecar 預設的 ~/.starscope（見 db/database.py 的 get_app_data_dir）
        cmd = cmd.env("STARSCOPE_SESSION_SECRET", session_secret);
```

- [ ] **Step 4: 執行，確認通過；再跑整套**

Run: `cd sidecar && STARSCOPE_DATA_DIR="$(mktemp -d)" .venv/bin/python -m pytest tests/test_app_data_dir.py -v`
Expected: 2 passed

Run: `cd sidecar && STARSCOPE_DATA_DIR="$(mktemp -d)" .venv/bin/python -m pytest -q`
Expected: 全部通過，數量跟改動前相同再加 2

Run: `cd src-tauri && cargo test --lib`
Expected: 全部通過；`cargo` 沒有出現 unused 警告

Run: `git grep -n "TAURI_APP_DATA_DIR" -- ':!docs/superpowers' ':!CHANGELOG.md'`
Expected: 只剩 `sidecar/db/database.py` 的說明文字、`sidecar/tests/test_app_data_dir.py`，以及 Step 5 改寫前的 CLAUDE.md

- [ ] **Step 5: 文件**

CLAUDE.md 的「資料庫實際位置（最常踩的坑）」，把優先序那三行換成：

```markdown
1. `STARSCOPE_DATA_DIR` 環境變數（測試、smoke test、打包版實測的隔離）
2. `~/.starscope`：開發模式、安裝版、launchd 的 collector 共用這一份

⚠️ 安裝版也用 `~/.starscope`，也就是真實資料。任何會啟動打包版或 sidecar 的實驗都要設 `STARSCOPE_DATA_DIR`。
不能再讓 Rust 傳資料目錄給 sidecar：以前傳過 `TAURI_APP_DATA_DIR`，安裝版就看不到 collector 寫的資料
（`tests/test_app_data_dir.py` 守住）。
```

「schema 變更：不走 alembic」一節的最後，加一段：

```markdown
**schema 變更必須維持加法**：安裝版與開發模式可能跑不同版本的程式碼，卻共用 `~/.starscope` 同一個資料庫。
`ensure_columns()` 只新增欄位、索引，舊版程式會忽略它不認識的欄位與資料表，所以加法變更兩邊都能用；
改名、刪欄位、改型別會讓其中一邊壞掉。
```

CHANGELOG `[Unreleased]` 的 `### 修復`，最上面加一條：

```markdown
- **安裝版看不到開發模式與背景收集器的資料** — 安裝版原本另外在「應用程式支援」資料夾開一個空的資料庫。現在三者共用 `~/.starscope`，改用安裝版後資料都在
```

- [ ] **Step 6: mutation 驗證**

把 `get_app_data_dir` 裡 `STARSCOPE_DATA_DIR` 那個 `if` 暫時改成 `if False and (env_path := …)`（先用 `cp database.py /tmp/…bak` 備份），執行 `tests/test_app_data_dir.py`，預期 `test_uses_the_explicit_override` 變紅。還原：`cp` 備份檔回去，再用 `cmp` 確認跟備份一模一樣。

- [ ] **Step 7: Commit（使用者授權後）**

```bash
git add sidecar/db/database.py sidecar/tests/test_app_data_dir.py src-tauri/src/lib.rs CLAUDE.md CHANGELOG.md
git commit -m "fix: the installed app uses the same data as dev mode and the collector"
```

**🚧 階段 1 審查閘門**：用 code-reviewer 審 Task 1 的 diff，修完才進階段 2。

---

## 階段 2：打包用的腳本

### Task 2: `scripts/stage_sidecar.py`：把 onedir 放進 Tauri resources，同時攤平 symlink

**Files:**
- Create: `scripts/stage_sidecar.py`
- Create: `sidecar/tests/test_stage_sidecar.py`

**Interfaces:**
- Produces: `stage(src: Path, dest: Path) -> None`，失敗時拋 `StageError`；CLI 為 `python scripts/stage_sidecar.py <onedir> <dest>`，成功時 exit 0 並印出 ✅，失敗時 exit 1 並印出 ❌ 加原因

- [ ] **Step 1: 寫會失敗的測試**

`sidecar/tests/test_stage_sidecar.py`：

```python
"""scripts/stage_sidecar.py：把 PyInstaller 的 onedir 放進 Tauri 打包的 resources。

Tauri 打包 resources 時，會把指向檔案的 symlink 換成檔案、把指向資料夾的默默丟掉——這不是
文件寫明的行為。這裡自己先攤平，讓打包的輸入固定，不依賴 Tauri 的版本。
"""

import importlib.util
import os
import stat
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "stage_sidecar.py"
_spec = importlib.util.spec_from_file_location("stage_sidecar", SCRIPT)
stage_sidecar = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(stage_sidecar)

needs_symlinks = pytest.mark.skipif(os.name == "nt", reason="Windows 的 onedir 沒有 symlink，建立也要權限")


def _onedir(root: Path) -> Path:
    """仿 macOS 的 onedir：執行檔、_internal/、Python.framework 的 symlink 結構。"""
    src = root / "starscope-sidecar"
    fw = src / "_internal" / "Python.framework"
    (fw / "Versions" / "3.12" / "Resources").mkdir(parents=True)
    (fw / "Versions" / "3.12" / "Python").write_bytes(b"libpython")
    (fw / "Versions" / "3.12" / "Resources" / "Info.plist").write_text("plist")
    exe = src / "starscope-sidecar"
    exe.write_bytes(b"bootloader")
    exe.chmod(0o755)
    if os.name != "nt":
        (fw / "Versions" / "Current").symlink_to("3.12")
        (fw / "Resources").symlink_to("Versions/Current/Resources")
        (src / "_internal" / "Python").symlink_to("Python.framework/Versions/3.12/Python")
    return src


def _symlinks(root: Path) -> list[Path]:
    return [p for p in root.rglob("*") if p.is_symlink()]


@needs_symlinks
def test_copies_file_symlinks_as_files_and_drops_folder_aliases(tmp_path):
    src = _onedir(tmp_path)
    dest = tmp_path / "out" / "sidecar"

    stage_sidecar.stage(src, dest)

    assert _symlinks(dest) == []
    assert (dest / "_internal" / "Python").read_bytes() == b"libpython"
    # 資料夾別名拿掉，內容透過真實路徑仍在
    assert not (dest / "_internal" / "Python.framework" / "Versions" / "Current").exists()
    assert not (dest / "_internal" / "Python.framework" / "Resources").exists()
    assert (dest / "_internal" / "Python.framework" / "Versions" / "3.12" / "Resources" / "Info.plist").exists()


def test_keeps_the_executable_bit(tmp_path):
    src = _onedir(tmp_path)
    dest = tmp_path / "out" / "sidecar"

    stage_sidecar.stage(src, dest)

    if os.name != "nt":
        assert (dest / "starscope-sidecar").stat().st_mode & stat.S_IXUSR


def test_clears_what_a_previous_stage_left(tmp_path):
    src = _onedir(tmp_path)
    dest = tmp_path / "out" / "sidecar"
    dest.mkdir(parents=True)
    (dest / "README.md").write_text("repo 的說明")
    (dest / "stale.so").write_bytes(b"old")

    stage_sidecar.stage(src, dest)

    assert not (dest / "README.md").exists()
    assert not (dest / "stale.so").exists()


@needs_symlinks
def test_refuses_a_dangling_symlink(tmp_path):
    src = _onedir(tmp_path)
    (src / "_internal" / "gone.dylib").symlink_to("nowhere.dylib")

    with pytest.raises(stage_sidecar.StageError, match="不存在"):
        stage_sidecar.stage(src, tmp_path / "out" / "sidecar")


@needs_symlinks
def test_refuses_a_symlink_that_points_outside_the_folder(tmp_path):
    src = _onedir(tmp_path)
    outside = tmp_path / "outside.dylib"
    outside.write_bytes(b"x")
    (src / "_internal" / "escape.dylib").symlink_to(outside)

    with pytest.raises(stage_sidecar.StageError, match="外面"):
        stage_sidecar.stage(src, tmp_path / "out" / "sidecar")


def test_refuses_a_destination_that_is_not_a_sidecar_folder(tmp_path):
    # 會先清空目的地：路徑打錯時不能把別的資料夾整個刪掉
    src = _onedir(tmp_path)
    precious = tmp_path / "precious"
    precious.mkdir()
    (precious / "keep.txt").write_text("keep")

    with pytest.raises(stage_sidecar.StageError, match="sidecar"):
        stage_sidecar.stage(src, precious)
    assert (precious / "keep.txt").exists()


def test_refuses_a_missing_source(tmp_path):
    with pytest.raises(stage_sidecar.StageError, match="找不到"):
        stage_sidecar.stage(tmp_path / "nothing", tmp_path / "out" / "sidecar")


def test_prints_on_a_cp1252_console(tmp_path):
    # Windows runner 的主控台是 cp1252：印 ✅／中文要能印出來（同 check_sidecar_binary.py）
    src = _onedir(tmp_path)
    env = {**os.environ, "PYTHONIOENCODING": "cp1252"}
    env.pop("PYTHONUTF8", None)
    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(src), str(tmp_path / "out" / "sidecar")],
        capture_output=True, text=True, encoding="utf-8", env=env, timeout=30,
    )
    assert result.returncode == 0, result.stderr
    assert "✅" in result.stdout
```

- [ ] **Step 2: 執行，確認失敗**

Run: `cd sidecar && STARSCOPE_DATA_DIR="$(mktemp -d)" .venv/bin/python -m pytest tests/test_stage_sidecar.py -v`
Expected: collection error，因為 `scripts/stage_sidecar.py` 不存在

- [ ] **Step 3: 實作**

`scripts/stage_sidecar.py`：

```python
"""把 PyInstaller 的 onedir 放進 Tauri 打包的 resources 資料夾。

Tauri 打包 resources 時對 symlink 的處理不在文件裡：實測指向檔案的會換成檔案本身，指向資料夾的
會被默默丟掉。這裡自己先攤平，打包的輸入就固定，不依賴 Tauri 的版本：
- 指向檔案：換成檔案本身
- 指向資料夾、目標在同一棵樹裡：拿掉（只是別名，內容透過真實路徑還在；macOS 的
  Python.framework 有兩個這種 symlink，實測拿掉後照樣能跑）
- 懸空的、指向樹外面的：失敗，不猜

目的地會先清空（repo 裡的 src-tauri/sidecar/ 只有 README）。為了路徑打錯時不把別的資料夾
整個刪掉，目的地的名字必須是 sidecar。

用法：python scripts/stage_sidecar.py <onedir 資料夾> <目的地>
"""

from __future__ import annotations  # 開發機的系統 python3 可能是 3.9

import io
import os
import shutil
import sys
from pathlib import Path

DEST_NAME = "sidecar"


class StageError(Exception):
    pass


def stage(src: Path, dest: Path) -> None:
    src = src.resolve()
    if not src.is_dir():
        raise StageError(f"找不到 onedir 資料夾：{src}")
    if dest.name != DEST_NAME:
        raise StageError(f"目的地必須是名為 {DEST_NAME} 的資料夾（會先清空）：{dest}")

    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)

    # followlinks=False：指向資料夾的 symlink 出現在 dirs 裡，但不會走進去
    for root, dirs, files in os.walk(src):
        here = Path(root)
        out = dest / here.relative_to(src)
        out.mkdir(exist_ok=True)
        for name in [*dirs, *files]:
            path = here / name
            if path.is_symlink():
                target = path.resolve()
                if not target.exists():
                    raise StageError(f"{path} 指向不存在的 {target}")
                if not target.is_relative_to(src):
                    raise StageError(f"{path} 指向 onedir 外面的 {target}")
                if target.is_file():
                    shutil.copy2(target, out / name)
                # 指向資料夾：別名，不複製
            elif name in files:
                shutil.copy2(path, out / name)


if __name__ == "__main__":
    # Windows runner 的主控台是 cp1252：印 ✅／❌ 與中文會丟 UnicodeEncodeError（同 check_sidecar_binary.py）
    for stream in (sys.stdout, sys.stderr):
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(encoding="utf-8")
    if len(sys.argv) != 3:
        sys.exit(f"用法: {sys.argv[0]} <onedir 資料夾> <目的地>")
    try:
        stage(Path(sys.argv[1]), Path(sys.argv[2]))
    except StageError as e:
        sys.exit(f"❌ {e}")
    print(f"✅ 已把 {sys.argv[1]} 放進 {sys.argv[2]}")
```

- [ ] **Step 4: 執行，確認通過**

Run: `cd sidecar && STARSCOPE_DATA_DIR="$(mktemp -d)" .venv/bin/python -m pytest tests/test_stage_sidecar.py -v`
Expected: 8 passed

- [ ] **Step 5: mutation 驗證**（先備份 `scripts/stage_sidecar.py`，每拔一項跑一次 Step 4，確認指定的測試變紅，然後還原並用 `cmp` 確認）

| 拔掉 | 預期變紅 |
|---|---|
| `if not target.exists(): raise …` | `test_refuses_a_dangling_symlink` |
| `if not target.is_relative_to(src): raise …` | `test_refuses_a_symlink_that_points_outside_the_folder` |
| `if dest.name != DEST_NAME: raise …` | `test_refuses_a_destination_that_is_not_a_sidecar_folder` |
| `if dest.exists(): shutil.rmtree(dest)` | `test_clears_what_a_previous_stage_left` |
| `if target.is_file():` 改成 `if True:` | `test_copies_file_symlinks_as_files_and_drops_folder_aliases` |
| `reconfigure(encoding="utf-8")` 那兩行 | `test_prints_on_a_cp1252_console` |

- [ ] **Step 6: Commit（使用者授權後）**

```bash
git add scripts/stage_sidecar.py sidecar/tests/test_stage_sidecar.py
git commit -m "build: stage the onedir sidecar for Tauri with symlinks flattened"
```

### Task 3: `check_sidecar_binary.py` 改成檢查整個 sidecar 資料夾

**Files:**
- Modify: `scripts/check_sidecar_binary.py`
- Modify: `sidecar/tests/test_check_sidecar_binary_script.py`

**Interfaces:**
- Consumes: Task 2 產出的資料夾結構（`starscope-sidecar[.exe]`、`_internal/`、沒有 symlink）
- Produces: CLI 為 `python scripts/check_sidecar_binary.py <sidecar 資料夾> <target triple>`，通過時 exit 0

- [ ] **Step 1: 改寫測試，讓它先失敗**

`sidecar/tests/test_check_sidecar_binary_script.py` 整個換成：

```python
"""scripts/check_sidecar_binary.py：確認要包進安裝檔的 sidecar 資料夾是目標平台的完整 onedir。

也要在 Windows runner 上把結果印得出來：主控台是 cp1252，印 ✅ 與中文會丟 UnicodeEncodeError，
失敗訊息會變成 \\u274c 這類跳脫字元。這裡以 PYTHONIOENCODING=cp1252 在任何平台重現。
"""

import os
import struct
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "check_sidecar_binary.py"
MACHO_ARM64 = b"\xcf\xfa\xed\xfe" + struct.pack("<I", 0x0100000C)
MACHO_X86_64 = b"\xcf\xfa\xed\xfe" + struct.pack("<I", 0x01000007)


def _run(folder: Path, target: str) -> subprocess.CompletedProcess[str]:
    env = {**os.environ, "PYTHONIOENCODING": "cp1252"}
    env.pop("PYTHONUTF8", None)
    return subprocess.run(
        [sys.executable, str(SCRIPT), str(folder), target],
        capture_output=True, text=True, encoding="utf-8", env=env, timeout=30,
    )


def _sidecar(root: Path, header: bytes = MACHO_ARM64, exe_name: str = "starscope-sidecar") -> Path:
    folder = root / "sidecar"
    (folder / "_internal").mkdir(parents=True)
    (folder / "_internal" / "base_library.zip").write_bytes(b"zip")
    (folder / exe_name).write_bytes(header + b"\0" * 4096)
    return folder


def test_accepts_a_complete_onedir_on_a_cp1252_console(tmp_path):
    result = _run(_sidecar(tmp_path), "aarch64-apple-darwin")

    assert result.returncode == 0, result.stderr
    assert "✅" in result.stdout
    assert "Traceback" not in result.stderr


def test_rejects_a_folder_that_holds_only_the_readme(tmp_path):
    # 忘了 stage：repo 裡的 src-tauri/sidecar/ 只有 README
    folder = tmp_path / "sidecar"
    folder.mkdir()
    (folder / "README.md").write_text("說明")

    result = _run(folder, "aarch64-apple-darwin")

    assert result.returncode == 1
    assert "❌" in result.stderr  # 印得出來，不是 \u274c
    assert "starscope-sidecar" in result.stderr
    assert "Traceback" not in result.stderr


def test_rejects_the_wrong_architecture(tmp_path):
    # Intel 版在 arm64 runner 上打包時，架構會是 arm64
    result = _run(_sidecar(tmp_path, header=MACHO_ARM64), "x86_64-apple-darwin")

    assert result.returncode == 1
    assert "x86_64" in result.stderr


def test_rejects_a_text_file_in_place_of_the_executable(tmp_path):
    result = _run(_sidecar(tmp_path, header=b"#!/bin/bash\n"), "aarch64-apple-darwin")

    assert result.returncode == 1
    assert "unknown" in result.stderr


def test_rejects_a_onedir_without_its_libraries(tmp_path):
    folder = _sidecar(tmp_path)
    (folder / "_internal" / "base_library.zip").unlink()
    (folder / "_internal").rmdir()

    result = _run(folder, "aarch64-apple-darwin")

    assert result.returncode == 1
    assert "_internal" in result.stderr


@pytest.mark.skipif(os.name == "nt", reason="建立 symlink 要權限")
def test_rejects_a_symlink_left_in_the_folder(tmp_path):
    # Tauri 會把指向資料夾的 symlink 默默丟掉：必須先由 stage_sidecar.py 攤平
    folder = _sidecar(tmp_path)
    (folder / "_internal" / "Current").symlink_to(".")

    result = _run(folder, "aarch64-apple-darwin")

    assert result.returncode == 1
    assert "symlink" in result.stderr


def test_expects_the_windows_executable_name(tmp_path):
    pe = b"MZ" + b"\0" * 0x3A + struct.pack("<I", 0x40) + b"PE\0\0" + struct.pack("<H", 0x8664)
    result = _run(_sidecar(tmp_path, header=pe, exe_name="starscope-sidecar.exe"), "x86_64-pc-windows-msvc")

    assert result.returncode == 0, result.stderr
```

- [ ] **Step 2: 執行，確認失敗**

Run: `cd sidecar && STARSCOPE_DATA_DIR="$(mktemp -d)" .venv/bin/python -m pytest tests/test_check_sidecar_binary_script.py -v`
Expected: `test_accepts_a_complete_onedir…`、`test_expects_the_windows_executable_name` FAIL（腳本把資料夾當成檔案，回報「找不到」）；其餘幾條可能因為原因字串不同而失敗

- [ ] **Step 3: 實作**

`scripts/check_sidecar_binary.py`：把模組說明、`MIN_REAL_BINARY_BYTES`、`check()`，以及 `__main__` 的用法字串，換成下面的內容；`EXPECTED`、`_MACHO_CPU`、`_ELF_MACHINE`、`_PE_MACHINE`、`identify()`、UTF-8 reconfigure 保留不動：

```python
"""確認要包進安裝檔的 sidecar 資料夾是目標平台的完整 onedir。

PyInstaller 只產出執行中架構的 binary：Intel 版在 arm64 runner 上打包，架構就是錯的，
而 Tauri 照樣產出安裝檔。資料夾不完整（忘了 stage、只剩 repo 的 README、少了 _internal）
或留著 symlink（Tauri 會把指向資料夾的默默丟掉）時也一樣。smoke test 跑的是
PyInstaller 的產物，不是 Tauri 實際取用的那一份，所以這裡另外檢查。

用法：python scripts/check_sidecar_binary.py <sidecar 資料夾> <target triple>
"""
```

```python
EXECUTABLE = "starscope-sidecar"


def check(folder: Path, target: str) -> str | None:
    """通過回 None，否則回失敗原因。"""
    if target not in EXPECTED:
        return f"不認得的 target：{target}"
    if not folder.is_dir():
        return f"找不到 sidecar 資料夾：{folder}"
    exe = folder / (EXECUTABLE + (".exe" if EXPECTED[target][0] == "PE" else ""))
    if not exe.is_file():
        return f"{folder} 裡沒有 {exe.name}（忘了用 scripts/stage_sidecar.py 放進來？）"
    with exe.open("rb") as f:
        header = f.read(4096)
    actual = identify(header)
    if actual != EXPECTED[target]:
        return f"{exe} 是 {actual[0]} {actual[1]}，但 {target} 需要 {EXPECTED[target][0]} {EXPECTED[target][1]}"
    if not (folder / "_internal").is_dir():
        return f"{folder} 裡沒有 _internal/：不是完整的 onedir"
    links = [p for p in folder.rglob("*") if p.is_symlink()]
    if links:
        return f"{folder} 裡還有 symlink（Tauri 會默默丟掉指向資料夾的）：{links[0]}"
    return None
```

`__main__` 裡：

```python
    if len(sys.argv) != 3:
        sys.exit(f"用法: {sys.argv[0]} <sidecar 資料夾> <target triple>")
    problem = check(Path(sys.argv[1]), sys.argv[2])
    if problem:
        sys.exit(f"❌ {problem}")
    print(f"✅ {sys.argv[1]} 是 {sys.argv[2]} 的完整 sidecar")
```

- [ ] **Step 4: 執行，確認通過**

Run: `cd sidecar && STARSCOPE_DATA_DIR="$(mktemp -d)" .venv/bin/python -m pytest tests/test_check_sidecar_binary_script.py -v`
Expected: 7 passed

- [ ] **Step 5: mutation 驗證**（做法同 Task 2）

| 拔掉 | 預期變紅 |
|---|---|
| `if not exe.is_file(): return …` | `test_rejects_a_folder_that_holds_only_the_readme` |
| `if actual != EXPECTED[target]: return …` | `test_rejects_the_wrong_architecture`、`test_rejects_a_text_file…` |
| `if not (folder / "_internal").is_dir(): return …` | `test_rejects_a_onedir_without_its_libraries` |
| `if links: return …` | `test_rejects_a_symlink_left_in_the_folder` |
| `".exe" if … == "PE"` 改成 `""` | `test_expects_the_windows_executable_name` |

- [ ] **Step 6: Commit（使用者授權後）**

```bash
git add scripts/check_sidecar_binary.py sidecar/tests/test_check_sidecar_binary_script.py
git commit -m "build: check the whole onedir sidecar folder before bundling"
```

### Task 4: `scripts/extract_bundled_sidecar.py`：從安裝檔取出 sidecar，給 smoke test 用

**Files:**
- Create: `scripts/extract_bundled_sidecar.py`
- Create: `sidecar/tests/test_extract_bundled_sidecar.py`

**Interfaces:**
- Produces:
  - `extract(bundle: Path, out: Path, platform: str = sys.platform) -> Path`：回傳取出的執行檔路徑
  - `find_sidecar(root: Path, exe_name: str) -> Path`
  - `ExtractError`
  - CLI：`python scripts/extract_bundled_sidecar.py <bundle 目錄> <輸出目錄>`，stdout 只印一行執行檔路徑（`as_posix()`，Git Bash 才吃得下 Windows 路徑）

- [ ] **Step 1: 寫會失敗的測試**

`sidecar/tests/test_extract_bundled_sidecar.py`：

```python
"""scripts/extract_bundled_sidecar.py：從安裝檔取出 Tauri 實際打包的 sidecar。

.deb 與 .msi 的解開只在 CI 的 Linux／Windows runner 上跑得到；這裡驗證找檔的規則，
以及 macOS 那條（.app 本身就是資料夾，任何平台都能模擬）。
"""

import importlib.util
import os
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "extract_bundled_sidecar.py"
_spec = importlib.util.spec_from_file_location("extract_bundled_sidecar", SCRIPT)
ebs = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ebs)


def _fake_app(bundle: Path, name: str = "StarScope.app") -> Path:
    folder = bundle / "macos" / name / "Contents" / "Resources" / "sidecar"
    (folder / "_internal").mkdir(parents=True)
    (folder / "_internal" / "lib.dylib").write_bytes(b"lib")
    (folder / "starscope-sidecar").write_bytes(b"exe")
    return folder


def test_finds_the_one_sidecar(tmp_path):
    folder = _fake_app(tmp_path)

    assert ebs.find_sidecar(tmp_path, "starscope-sidecar") == folder / "starscope-sidecar"


def test_ignores_a_file_with_the_same_name_outside_a_sidecar_folder(tmp_path):
    _fake_app(tmp_path)
    (tmp_path / "starscope-sidecar").write_bytes(b"not it")

    assert ebs.find_sidecar(tmp_path, "starscope-sidecar").parent.name == "sidecar"


def test_reports_a_bundle_without_a_sidecar(tmp_path):
    (tmp_path / "macos").mkdir()

    with pytest.raises(ebs.ExtractError, match="找不到"):
        ebs.find_sidecar(tmp_path, "starscope-sidecar")


def test_reports_more_than_one_sidecar(tmp_path):
    _fake_app(tmp_path, "StarScope.app")
    _fake_app(tmp_path, "Old.app")

    with pytest.raises(ebs.ExtractError, match="不只一份"):
        ebs.find_sidecar(tmp_path, "starscope-sidecar")


def test_macos_copies_the_sidecar_to_a_path_with_a_space(tmp_path):
    _fake_app(tmp_path / "bundle")

    exe = ebs.extract(tmp_path / "bundle", tmp_path / "out", platform="darwin")

    assert " " in str(exe.relative_to(tmp_path / "out"))  # Windows 的 Program Files 就有空白
    assert exe.read_bytes() == b"exe"
    assert (exe.parent / "_internal" / "lib.dylib").exists()


@pytest.mark.skipif(os.name == "nt", reason="唯讀靠 POSIX 權限")
def test_macos_copy_is_read_only(tmp_path):
    # 沒搬進「應用程式」就打開的 app 會被 App Translocation 放到唯讀位置執行
    _fake_app(tmp_path / "bundle")

    exe = ebs.extract(tmp_path / "bundle", tmp_path / "out", platform="darwin")

    assert not os.access(exe.parent, os.W_OK)
    assert not os.access(exe.parent / "_internal", os.W_OK)


def test_extracting_twice_replaces_the_read_only_copy(tmp_path):
    _fake_app(tmp_path / "bundle")
    ebs.extract(tmp_path / "bundle", tmp_path / "out", platform="darwin")

    exe = ebs.extract(tmp_path / "bundle", tmp_path / "out", platform="darwin")

    assert exe.exists()


def test_requires_exactly_one_app(tmp_path):
    _fake_app(tmp_path / "bundle", "StarScope.app")
    _fake_app(tmp_path / "bundle", "Other.app")

    with pytest.raises(ebs.ExtractError, match="剛好一個"):
        ebs.extract(tmp_path / "bundle", tmp_path / "out", platform="darwin")
```

- [ ] **Step 2: 執行，確認失敗**

Run: `cd sidecar && STARSCOPE_DATA_DIR="$(mktemp -d)" .venv/bin/python -m pytest tests/test_extract_bundled_sidecar.py -v`
Expected: collection error，因為腳本不存在

- [ ] **Step 3: 實作**

`scripts/extract_bundled_sidecar.py`：

```python
"""從安裝檔取出 Tauri 實際打包的 sidecar，印出執行檔路徑，給 smoke test 用。

setup-sidecar 的 smoke test 跑的是 PyInstaller 的產物；這裡跑的是安裝檔裡的那一份，證明
使用者實際裝到的能跑（Windows、Linux 沒辦法手動測）：
- macOS：.app/Contents/Resources/sidecar/
- Linux：dpkg-deb -x 解開 .deb
- Windows：msiexec /a（管理安裝：只解開檔案，不註冊、不需要解除安裝）解開 .msi

取出的位置刻意含空白（Windows 的 C:\\Program Files 就有）。Unix 上再把整份設成唯讀：
沒搬進「應用程式」就打開的 macOS app 會被 App Translocation 放到唯讀位置執行。

用法：python scripts/extract_bundled_sidecar.py <bundle 目錄> <輸出目錄>
"""

from __future__ import annotations

import io
import shutil
import stat
import subprocess
import sys
from pathlib import Path

EXECUTABLE = "starscope-sidecar"
INSTALL_DIR_NAME = "Program Files"


class ExtractError(Exception):
    pass


def find_sidecar(root: Path, exe_name: str) -> Path:
    """root 底下唯一一個 sidecar/<exe_name>。找不到或不只一份都是錯。"""
    matches = sorted(p for p in root.rglob(exe_name) if p.is_file() and p.parent.name == "sidecar")
    if not matches:
        raise ExtractError(f"{root} 裡找不到 sidecar/{exe_name}")
    if len(matches) > 1:
        raise ExtractError(f"{root} 裡有不只一份 sidecar：" + "、".join(str(p) for p in matches))
    return matches[0]


def _single(bundle: Path, pattern: str) -> Path:
    found = sorted(bundle.glob(pattern))
    if len(found) != 1:
        raise ExtractError(f"{bundle} 裡的 {pattern} 應該剛好一個，實際 {len(found)} 個")
    return found[0]


def _set_writable(folder: Path, writable: bool) -> None:
    for path in [folder, *folder.rglob("*")]:
        mode = path.stat().st_mode
        path.chmod(mode | stat.S_IWUSR if writable else mode & ~(stat.S_IWUSR | stat.S_IWGRP | stat.S_IWOTH))


def extract(bundle: Path, out: Path, platform: str = sys.platform) -> Path:
    if out.exists():
        _set_writable(out, True)  # 上一次留下的唯讀副本
        shutil.rmtree(out)
    install = out / INSTALL_DIR_NAME
    install.mkdir(parents=True)

    exe_name = EXECUTABLE + (".exe" if platform == "win32" else "")
    if platform == "darwin":
        app = _single(bundle, "macos/*.app")
        source = find_sidecar(app / "Contents" / "Resources", exe_name).parent
        shutil.copytree(source, install / "sidecar")
    elif platform.startswith("linux"):
        deb = _single(bundle, "deb/*.deb")
        subprocess.run(["dpkg-deb", "-x", str(deb), str(install)], check=True)
    elif platform == "win32":
        msi = _single(bundle, "msi/*.msi")
        # 字串直接交給 CreateProcess：TARGETDIR 的值含空白，要用 msiexec 認得的 PROP="value" 形式
        subprocess.run(f'msiexec /a "{msi}" /qn TARGETDIR="{install}"', check=True)
    else:
        raise ExtractError(f"不支援的平台：{platform}")

    exe = find_sidecar(install, exe_name)
    if platform != "win32":
        _set_writable(exe.parent, False)
    return exe


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(encoding="utf-8")
    if len(sys.argv) != 3:
        sys.exit(f"用法: {sys.argv[0]} <bundle 目錄> <輸出目錄>")
    try:
        print(extract(Path(sys.argv[1]), Path(sys.argv[2])).as_posix())
    except (ExtractError, subprocess.CalledProcessError) as e:
        sys.exit(f"❌ {e}")
```

- [ ] **Step 4: 執行，確認通過**

Run: `cd sidecar && STARSCOPE_DATA_DIR="$(mktemp -d)" .venv/bin/python -m pytest tests/test_extract_bundled_sidecar.py -v`
Expected: 8 passed

- [ ] **Step 5: 用真的 .app 試一次**

用 scratchpad 裡先前實驗打包好的 onedir 測試 app（`…/onedir-spike/target/release/bundle`）當 bundle 目錄：

Run: `python3 scripts/extract_bundled_sidecar.py <那個 bundle 目錄> <scratchpad>/extract-try`，再對印出的路徑跑 `scripts/smoke-test-sidecar.sh`
Expected: 印出一行路徑，其中含 `Program Files/sidecar/starscope-sidecar`；smoke test 兩段都 ✅（唯讀位置照樣能跑）

如果 scratchpad 已經被清掉，這一步改到 Task 7 用 `run-packaged-app.sh` 打出來的 .app 做。

- [ ] **Step 6: mutation 驗證**（做法同 Task 2）

| 拔掉 | 預期變紅 |
|---|---|
| `and p.parent.name == "sidecar"` | `test_ignores_a_file_with_the_same_name…` |
| `if len(matches) > 1: raise …` | `test_reports_more_than_one_sidecar` |
| `_single` 的數量檢查 | `test_requires_exactly_one_app` |
| `_set_writable(exe.parent, False)` | `test_macos_copy_is_read_only` |
| `_set_writable(out, True)`（重跑前） | `test_extracting_twice_replaces_the_read_only_copy` |

- [ ] **Step 7: Commit（使用者授權後）**

```bash
git add scripts/extract_bundled_sidecar.py sidecar/tests/test_extract_bundled_sidecar.py
git commit -m "build: extract the sidecar from each installer for a smoke test"
```

**🚧 階段 2 審查閘門**：用 code-reviewer 審 Task 2 到 Task 4，修完才進階段 3。

---

## 階段 3：改用 onedir 與簽章

### Task 5: PyInstaller onedir、Tauri resources 加簽章、Rust 從 resource 路徑啟動

這個 task 要一起改：設定和 Rust 只改一邊的話，app 就起不來。

**Files:**
- Modify: `sidecar/starscope-sidecar.spec`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/src/lib.rs`（常數、`locate_sidecar`、`start_sidecar_with_retry`、`report_spawn_failed`、`terminate_gracefully` 與 `cleanup_sidecar` 的說明、測試）
- Modify: `src-tauri/Cargo.toml`（libc 的註解）
- Create: `src-tauri/sidecar/README.md`
- Modify: `.gitignore`
- Delete: `src-tauri/binaries/`（整個目錄）

**Interfaces:**
- Consumes: Task 2 的 stage 產出（`src-tauri/sidecar/starscope-sidecar[.exe]`）
- Produces:
  - `const SIDECAR_RESOURCE_DIR: &str = "sidecar"`
  - `const SIDECAR_EXECUTABLE: &str = "starscope-sidecar"`
  - `fn locate_sidecar(resource_dir: &Path) -> Result<PathBuf, String>`

- [ ] **Step 1: 寫會失敗的 Rust 測試**

加進 `src-tauri/src/lib.rs` 的 `mod tests`：

```rust
    /// 每個測試自己的暫存目錄（dev-dependencies 沒有 tempfile）
    fn scratch_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("starscope-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn locate_sidecar_finds_the_bundled_executable() {
        let resources = scratch_dir("locate-found");
        let folder = resources.join(SIDECAR_RESOURCE_DIR);
        std::fs::create_dir_all(&folder).unwrap();
        let exe = folder.join(format!("{SIDECAR_EXECUTABLE}{}", std::env::consts::EXE_SUFFIX));
        std::fs::write(&exe, b"").unwrap();

        assert_eq!(locate_sidecar(&resources), Ok(exe));
        std::fs::remove_dir_all(&resources).unwrap();
    }

    #[test]
    fn locate_sidecar_reports_a_folder_that_holds_only_the_readme() {
        // 忘了 stage：resources 裡只有 repo 的 README。直接回報，不讓使用者白等重試
        let resources = scratch_dir("locate-readme");
        let folder = resources.join(SIDECAR_RESOURCE_DIR);
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("README.md"), b"").unwrap();

        assert!(locate_sidecar(&resources).is_err());
        std::fs::remove_dir_all(&resources).unwrap();
    }

    #[test]
    fn locate_sidecar_does_not_take_a_folder_for_the_executable() {
        let resources = scratch_dir("locate-dir");
        let exe_path = resources
            .join(SIDECAR_RESOURCE_DIR)
            .join(format!("{SIDECAR_EXECUTABLE}{}", std::env::consts::EXE_SUFFIX));
        std::fs::create_dir_all(&exe_path).unwrap();

        assert!(locate_sidecar(&resources).is_err());
        std::fs::remove_dir_all(&resources).unwrap();
    }

    #[test]
    fn the_sidecar_ships_as_a_signed_resource_folder() {
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let bundle = &config["bundle"];
        // externalBin 只能放單一執行檔；onedir 整個資料夾放 resources，位置要跟 locate_sidecar 一致
        assert!(bundle.get("externalBin").is_none());
        let target = format!("{SIDECAR_RESOURCE_DIR}/");
        assert_eq!(bundle["resources"][target.as_str()], serde_json::Value::String(target.clone()));
        // 沒有完整的 bundle 簽章時，下載的 app 在 Apple Silicon 上被判「已損毀」，沒有強制打開可按
        assert_eq!(bundle["macOS"]["signingIdentity"], "-");
    }
```

- [ ] **Step 2: 執行，確認失敗**

Run: `cd src-tauri && cargo test --lib`
Expected: 編譯錯誤，`SIDECAR_RESOURCE_DIR`、`SIDECAR_EXECUTABLE`、`locate_sidecar` 還不存在

- [ ] **Step 3: 實作 Rust**

`use` 區加上：

```rust
use std::path::{Path, PathBuf};
```

在 `SIDECAR_STATUS_EVENT` 之後加：

```rust
/// 打包進 resources 的 sidecar 資料夾：與 tauri.conf.json 的 bundle.resources 一致
const SIDECAR_RESOURCE_DIR: &str = "sidecar";
/// sidecar 執行檔的名字（Windows 另外加 .exe）
const SIDECAR_EXECUTABLE: &str = "starscope-sidecar";
```

在 `start_sidecar_with_retry` 之前加：

```rust
/// 打包進 resources 的 sidecar 執行檔。不在就回 Err：重試不會讓它出現
fn locate_sidecar(resource_dir: &Path) -> Result<PathBuf, String> {
    let program = resource_dir
        .join(SIDECAR_RESOURCE_DIR)
        .join(format!("{SIDECAR_EXECUTABLE}{}", std::env::consts::EXE_SUFFIX));
    if program.is_file() {
        Ok(program)
    } else {
        Err(format!("找不到 {}", program.display()))
    }
}
```

`start_sidecar_with_retry` 從開頭到 `match cmd.spawn()` 之前，換成：

```rust
fn start_sidecar_with_retry(app: &AppHandle, session_secret: &str) {
    // 開發時 start-dev.sh 在 8008 跑自己的 sidecar：不 spawn、不檢查 port，讓前端直接探測
    if cfg!(debug_assertions) {
        set_sidecar_status(app, SidecarStatus::External);
        return;
    }
    // port 被佔著就不啟動：啟動了也綁不到 port 就退出，而前端會連到佔用者
    if let Some(holder) =
        wait_for_port(|| port_holder(SIDECAR_PORT), STARSCOPE_RELEASE_WAIT, STARSCOPE_RELEASE_POLL)
    {
        warn!("連接埠 {SIDECAR_PORT} 已被佔用（{holder:?}），不啟動 sidecar");
        set_sidecar_status(app, SidecarStatus::PortInUse { holder });
        return;
    }
    let program = match app.path().resource_dir().map_err(|e| e.to_string()).and_then(|dir| locate_sidecar(&dir)) {
        Ok(program) => program,
        Err(e) => {
            warn!("沒有打包好的 sidecar：{e}");
            report_spawn_failed(app);
            return;
        }
    };

    for attempt in 0..=MAX_RETRIES {
        // 每次重試都重建 Command，因為 spawn() 會 consume self
        let mut cmd = app.shell().command(&program);

        // session secret 透過 Command::env() 傳給 sidecar，而不是 std::env::set_var
        //（在多執行緒環境有 data race 風險）。資料目錄不傳：安裝版與開發模式、collector
        // 共用 sidecar 預設的 ~/.starscope（見 db/database.py 的 get_app_data_dir）
        cmd = cmd.env("STARSCOPE_SESSION_SECRET", session_secret);
        // sidecar 以它看門（sidecar/utils/parent_watchdog.py）：app 當掉或被強制結束、
        // cleanup_sidecar 來不及跑時，sidecar 發現父行程不在就自己結束
        cmd = cmd.env("STARSCOPE_PARENT_PID", std::process::id().to_string());
        // 發行版必須以 production 模式跑 sidecar：main.py 的 ENV 預設是 development
        //（docs 端點開著、CORS 多放行 localhost:1420/1421）
        cmd = cmd.env("ENV", "production");
```

`Ok((rx, child))` 分支裡，兩處 `if !cfg!(debug_assertions)` 拿掉，直接呼叫：

```rust
                set_sidecar_status(app, SidecarStatus::Running);
                let state = app.state::<SidecarState>();
                let exit_app = app.clone();
                let quitting = state.quitting.clone();
                tauri::async_runtime::spawn(watch_sidecar_exit(rx, state.exited.clone(), move |code| {
                    report_exit(&quitting, code, |status| set_sidecar_status(&exit_app, status));
                }));
```

`report_spawn_failed` 換成：

```rust
/// 沒能啟動 sidecar 時告訴前端（只有 release 會走到：debug 不 spawn）
fn report_spawn_failed(app: &AppHandle) {
    set_sidecar_status(app, SidecarStatus::SpawnFailed);
}
```

`terminate_gracefully` 的說明換成：

```rust
/// 送 SIGTERM 並等 `has_exited()` 成立：uvicorn 收到 SIGTERM 會走正常關閉（停排程、關 HTTP client）。
///
/// 已經結束就什麼都不送：它的 PID 可能已經分給別的行程。結束與否看 shell plugin 的回報，
/// 不看 kill(pid, 0)。回報要等 stdout／stderr 的 pipe 全部關閉才送出，比回收晚幾毫秒，
/// 這段空檔裡仍可能對剛回收的 PID 送 SIGTERM。
```

`cleanup_sidecar` 的說明換成：

```rust
/// 結束 sidecar。Unix 先 SIGTERM、等 SIDECAR_STOP_TIMEOUT，仍在才 SIGKILL。
/// Windows 沒有 SIGTERM，直接 kill：onedir 只有一個行程，kill 就是結束 Python 本身，不走
/// uvicorn 的正常關閉——最壞丟掉一次進行中的抓取，SQLite 每次 commit 都是原子的。
/// 以 take() 取出 child，關視窗與 RunEvent::Exit 都呼叫也不會重複處理。
```

`src-tauri/Cargo.toml` 的 libc 註解換成：

```toml
# cleanup_sidecar 先送 SIGTERM，讓 sidecar 走 uvicorn 的正常關閉
```

- [ ] **Step 4: 設定、打包 spec、placeholder**

`src-tauri/tauri.conf.json` 的 `bundle` 裡，`externalBin` 換成：

```json
    "resources": {
      "sidecar/": "sidecar/"
    },
    "macOS": {
      "signingIdentity": "-"
    }
```

`src-tauri/capabilities/default.json` 的 `permissions` 改成（拿掉 `shell:allow-spawn` 那一整項：前端沒有用到 shell plugin，Rust 端的 `command()` 不經過 capability）：

```json
  "permissions": [
    "core:default",
    "opener:default",
    "notification:default"
  ]
```

`sidecar/starscope-sidecar.spec`：刪掉 `import os`、`import platform`，以及從「產物檔名要對上 Tauri 的 --target」那段註解到 `target_triple = …` 的判斷；`exe = EXE(…)` 換成：

```python
# onedir：執行檔加上 _internal/。onefile 每次啟動都要把整包解壓到暫存目錄（實測 8–10 秒），
# onedir 直接載入（約 1 秒）。整個資料夾由 scripts/stage_sidecar.py 放進 src-tauri/sidecar/，
# 作為 Tauri 的 resources 打包（externalBin 只能放單一執行檔）。架構不寫在檔名上：
# scripts/check_sidecar_binary.py 讀執行檔的檔頭來檢查
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='starscope-sidecar',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,  # UPX 壓過的 macOS dylib 簽章會失效
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name='starscope-sidecar',
)
```

`src-tauri/sidecar/README.md`：

```markdown
# 打包進安裝檔的 sidecar

這個資料夾會整個打包進安裝檔（`tauri.conf.json` 的 `bundle.resources`），Rust 從這裡啟動 sidecar。

repo 裡只放這份 README：目錄存在，開發模式與 `cargo test` 才編得過。發版時 CI 用
`scripts/stage_sidecar.py` 清空這裡，放進 PyInstaller 產出的 onedir。本機打包版實測用
`scripts/run-packaged-app.sh`，它把 onedir 放在暫存目錄，不動這裡。

不要把 sidecar commit 進來（`.gitignore` 已擋）。
```

`.gitignore` 的 `# PyInstaller` 區塊後面加：

```gitignore
# 打包時由 scripts/stage_sidecar.py 放進來的 sidecar（repo 只留 README）
src-tauri/sidecar/*
!src-tauri/sidecar/README.md
```

刪除 placeholder：

```bash
git rm -r src-tauri/binaries
```

- [ ] **Step 5: 執行，確認通過**

Run: `cd src-tauri && cargo test --lib`
Expected: 全部通過（原本 28 條加上 4 條新的），沒有 unused／dead_code 警告

Run: `cd src-tauri && cargo build`
Expected: 成功。`src-tauri/sidecar/` 只有 README 時，tauri-build 照樣編得過

Run: `git grep -n -e "binaries/" -e "externalBin" -e "allow-spawn" -e "STARSCOPE_TARGET_TRIPLE" -- ':!docs/superpowers' ':!CHANGELOG.md'`
Expected: 只剩 `.github/actions/setup-sidecar/action.yml`、`scripts/run-packaged-app.sh`、CLAUDE.md，這三個在 Task 6 到 Task 8 處理；以及 `lib.rs` 的 `the_sidecar_ships_as_a_signed_resource_folder` 裡的 `externalBin`

- [ ] **Step 6: mutation 驗證**

| 改動 | 預期變紅 |
|---|---|
| `locate_sidecar` 的 `if program.is_file()` 改成 `if true` | `…holds_only_the_readme`、`…does_not_take_a_folder…` |
| 同一行改成 `if program.exists()` | `…does_not_take_a_folder_for_the_executable` |
| `tauri.conf.json` 刪掉 `macOS.signingIdentity` | `the_sidecar_ships_as_a_signed_resource_folder` |
| `tauri.conf.json` 的 resources 目標改成 `bin/` | `the_sidecar_ships_as_a_signed_resource_folder` |

- [ ] **Step 7: Commit（使用者授權後）**

```bash
git add -A sidecar/starscope-sidecar.spec src-tauri/tauri.conf.json src-tauri/capabilities/default.json src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/sidecar/README.md .gitignore src-tauri/binaries
git commit -m "perf: bundle the sidecar as a onedir resource so the app starts in about a second"
```

### Task 6: CI 改走 stage，從安裝檔取出 sidecar 跑 smoke test、驗證簽章

**Files:**
- Modify: `.github/actions/setup-sidecar/action.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `scripts/smoke-test-sidecar.sh:19,44`

**Interfaces:**
- Consumes：Task 2 的 CLI、Task 3 的 CLI、Task 4 的 CLI

- [ ] **Step 1: setup-sidecar action**

`inputs.target.description` 改成：`Rust target triple（用來在包進安裝檔前檢查架構；Python 的架構由 runner 決定，這個值改不了它）`

從「PyInstaller 預設只產出執行中架構的 binary」那段註解開始，到檔案結尾，換成：

```yaml
    # PyInstaller 預設只產出執行中架構的 binary（跨架構要所有依賴都有 fat wheel，本專案不成立），
    # 所以每個 target 都要在該架構的 runner 上打包（見 release.yml 的 matrix）
    - name: Build sidecar
      shell: bash
      working-directory: sidecar
      run: pyinstaller starscope-sidecar.spec

    # 原始碼的測試看不到打包後才會壞的問題，所以在包進安裝檔之前實際執行它
    - name: Smoke test sidecar
      shell: bash
      run: scripts/smoke-test-sidecar.sh "sidecar/dist/starscope-sidecar/starscope-sidecar${{ runner.os == 'Windows' && '.exe' || '' }}"

    # 放進 Tauri 打包的 resources：清空 repo 裡的 README，攤平 symlink（Tauri 會把指向資料夾的默默丟掉）
    - name: Stage sidecar for Tauri
      shell: bash
      run: python scripts/stage_sidecar.py sidecar/dist/starscope-sidecar src-tauri/sidecar

    # 架構錯（Intel 版在 arm64 runner 上打包）或內容不完整時，Tauri 照樣產出安裝檔
    - name: Verify the sidecar Tauri will bundle
      shell: bash
      run: python scripts/check_sidecar_binary.py src-tauri/sidecar "${{ inputs.target }}"
```

- [ ] **Step 2: release.yml**

在 `Build and release` 之後加：

```yaml
      # 從安裝檔取出 sidecar 再跑一次 smoke test，證明使用者實際裝到的那份能跑（Windows、Linux 沒辦法手動測）。
      # 正式發版也要跑：draft release 在這一步之前就建好了，這一步紅了就不要發佈
      - name: Smoke test the sidecar inside the installer
        shell: bash
        run: |
          SIDECAR="$(python scripts/extract_bundled_sidecar.py "src-tauri/target/${{ matrix.target }}/release/bundle" "$RUNNER_TEMP/bundled-sidecar")"
          scripts/smoke-test-sidecar.sh "$SIDECAR"

      # 沒有完整的 bundle 簽章時，下載的 app 在 Apple Silicon 上被判「已損毀」，沒有強制打開可按（v1.0.0 就是這樣）
      - name: Verify the macOS signature
        if: runner.os == 'macOS'
        run: codesign --verify --deep --strict --verbose=2 "src-tauri/target/${{ matrix.target }}/release/bundle/macos/StarScope.app"
```

`releaseBody` 的 macOS 那兩行換成：

```yaml
            - **macOS (Intel)**: `.dmg` file for x86_64
            - **macOS (Apple Silicon)**: `.dmg` file for aarch64
            - macOS will say Apple cannot verify the app: see [first launch on macOS](https://github.com/${{ github.repository }}#macos--首次開啟)
```

- [ ] **Step 3: smoke-test-sidecar.sh 的註解**

第 19 行：

```bash
TIMEOUT_SECONDS=120   # 新檔案第一次執行時會被掃描（macOS 實測最慢 26 秒；Windows 的防毒更慢）
```

`stop_sidecar` 裡 `pkill -9 -P` 上面那行註解換成：

```bash
  # 子行程也一起收：萬一哪天換回 onefile，它會多一個 bootloader 父行程
```

- [ ] **Step 4: 本機能驗的部分**

Run: `python3 -c "import yaml,sys; [yaml.safe_load(open(f)) for f in sys.argv[1:]]" .github/actions/setup-sidecar/action.yml .github/workflows/release.yml && echo ok`
Expected: `ok`（如果系統 python3 沒有 yaml，改用 `sidecar/.venv/bin/python`）

在本機照 action 的順序手動跑一次：PyInstaller（輸出到 scratchpad）→ smoke test → stage 到 scratchpad 的 `…/sidecar` → check。
Expected: 四步都 ✅。stage 的目的地用 scratchpad，**不要**寫進 repo 的 `src-tauri/sidecar/`

CI 部分（stage、安裝檔的 smoke test、codesign）只有在發版預演時才驗得到，見「階段 4」。

- [ ] **Step 5: Commit（使用者授權後）**

```bash
git add .github/actions/setup-sidecar/action.yml .github/workflows/release.yml scripts/smoke-test-sidecar.sh
git commit -m "ci: smoke-test the sidecar inside each installer and verify the macOS signature"
```

### Task 7: `run-packaged-app.sh` 改成 onedir，並在本機實測打包版

**Files:**
- Modify: `scripts/run-packaged-app.sh`

- [ ] **Step 1: 改寫腳本**

開頭說明裡，這兩行：

```bash
# - 打包 sidecar 到暫存區，tauri build 以 --config 指向它，不動 repo 裡的 placeholder
# - STARSCOPE_DATA_DIR 指到暫存區：它優先於 Tauri 注入的資料目錄，不會碰到真實資料庫
```

換成：

```bash
# - 打包 onedir 到暫存區，tauri build 以 --config 指向它，不動 repo 的 src-tauri/sidecar/
# - STARSCOPE_DATA_DIR 指到暫存區：預設的 ~/.starscope 就是真實資料（安裝版、開發模式、collector 共用）
```

`if [ "${1:-}" != "--skip-build" ]; then … fi` 整段，以及後面那行 `[ -x "$APP/Contents/MacOS/starscope" ] …`，換成：

```bash
SIDECAR="$APP/Contents/Resources/sidecar/starscope-sidecar"
PY="$REPO/sidecar/.venv/bin/python"

if [ "${1:-}" != "--skip-build" ]; then
  TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
  [ -n "$TRIPLE" ] || { echo "❌ 讀不到 rustc 的 host triple"; exit 1; }
  rm -rf "$WORK/build" "$WORK/dist" "$WORK/sidecar" || exit 1

  echo "== 打包 sidecar（${TRIPLE}）"
  (cd "$REPO/sidecar" && .venv/bin/pyinstaller starscope-sidecar.spec \
    --distpath "$WORK/dist" --workpath "$WORK/build" --noconfirm >"$WORK/pyinstaller.log" 2>&1) \
    || { echo "❌ sidecar 打包失敗，見 $WORK/pyinstaller.log"; exit 1; }
  "$PY" "$REPO/scripts/stage_sidecar.py" "$WORK/dist/starscope-sidecar" "$WORK/sidecar" || exit 1
  "$PY" "$REPO/scripts/check_sidecar_binary.py" "$WORK/sidecar" "$TRIPLE" || exit 1

  echo "== 打包 app"
  # --config 是 JSON merge patch：resources 會合併而不是取代，要用 null 拿掉 repo 那一項（只有 README），
  # 否則兩個來源都會打包進 sidecar/
  (cd "$REPO" && npx tauri build --bundles app \
    --config "{\"bundle\":{\"resources\":{\"sidecar/\":null,\"$WORK/sidecar/\":\"sidecar/\"}}}" >"$WORK/tauri-build.log" 2>&1) \
    || { echo "❌ app 打包失敗，見 $WORK/tauri-build.log"; exit 1; }
fi

[ -x "$APP/Contents/MacOS/starscope" ] && [ -x "$SIDECAR" ] \
  || { echo "❌ ${APP} 不完整，先不帶 --skip-build 跑一次"; exit 1; }
[ ! -e "$APP/Contents/Resources/sidecar/README.md" ] \
  || { echo "❌ repo 的 src-tauri/sidecar/README.md 也被打包進去了：--config 沒有取代 resources"; exit 1; }
codesign --verify --deep --strict "$APP" || { echo "❌ 簽章驗證失敗（下載後會被判「已損毀」）"; exit 1; }
```

殘留檢查那行換成：

```bash
leftover() { ps -axo pid=,comm= | grep -F "$SIDECAR" | grep -v grep; }
```

- [ ] **Step 2: 打包並實測（綁 8008 前要先取得使用者同意；已安裝的 StarScope 和 start-dev.sh 都要先關掉）**

Run: `scripts/run-packaged-app.sh`
Expected:
- 打包、stage、check 都 ✅；README 和簽章兩道檢查都通過
- 點一下視窗之後，Dashboard 約 1 到 2 秒出現（資料是空的，因為用的是隔離資料）
- 分別用關視窗、Cmd+Q、系統列 Quit 結束，每次都印出「✅ 沒有殘留的 sidecar」
- 用 `--skip-build` 再開一次，也一切正常
- 強制結束：另一個終端機對 app 主行程送 `kill`（不是 sidecar），腳本仍印出沒有殘留

- [ ] **Step 3: mutation 驗證**

暫時把 `--config` 裡的 `\"sidecar/\":null,` 拿掉（先備份），跑 `scripts/run-packaged-app.sh`。
Expected: 打包後停在「❌ repo 的 src-tauri/sidecar/README.md 也被打包進去了」。還原後用 `cmp` 確認。

如果拿掉之後 README 並沒有被打包進去，代表 Tauri 的 `--config` 其實是取代而不是合併：這時把 null 那一項和這道檢查都拿掉，並回頭更正 spec 裡的說法。

- [ ] **Step 4: Commit（使用者授權後）**

```bash
git add scripts/run-packaged-app.sh
git commit -m "build: run the packaged app with the onedir sidecar"
```

### Task 8: 文件

**Files:**
- Modify: `CLAUDE.md`
- Modify: `sidecar/utils/parent_watchdog.py`（模組說明、`_windows_liveness_check` 的說明）
- Modify: `src/api/sidecarConnection.ts:37-41`
- Modify: `README.md`（「macOS — 首次開啟」）
- Modify: `CHANGELOG.md`

- [ ] **Step 1: CLAUDE.md**

「sidecar 生命週期」：

```markdown
- 看門不是當機備援，不能拿掉：Windows 沒有 SIGTERM，`kill()` 只殺到 onefile 的 bootloader，
  **Windows 每一次結束都靠看門收掉 Python 子行程**
```

換成：

```markdown
- 看門不能拿掉：app 當掉、被強制結束時走不到 `cleanup_sidecar`，只能靠它
- sidecar 是 onedir（`src-tauri/sidecar/`，作為 Tauri resources 打包），只有一個行程：Unix 的 SIGTERM
  直接送到 Python；Windows 的 `kill()` 直接結束 Python，不走正常關閉（SQLite 每次 commit 都是原子的，最壞丟掉一次進行中的抓取）
- debug build 不 spawn sidecar：開發時由 `start-dev.sh` 提供
```

刪掉：`⚠️ onefile 打包時，直接 kill 只殺到 bootloader，Python 子行程會佔著 8008，下次開 app 就是「連接埠被佔用」。`

測試段落裡，`不動 repo 裡的 placeholder` 改成 `不動 repo 的 src-tauri/sidecar/`。

「發佈前驗證」那段的最後一句換成：

```markdown
只改 sidecar 時可先跑 `verify-sidecar.yml`（約 2 分鐘）：它和 release 共用 `setup-sidecar` action——打包、smoke test、
stage 進 `src-tauri/sidecar/`、確認是對應架構的完整 onedir。release（含預演）另外從安裝檔取出 sidecar 再跑一次
smoke test，macOS 並驗證簽章。
```

開發流程（`./start-dev.sh` 那段程式碼區塊）之後加：

```markdown
⚠️ 開發前先關掉安裝版：兩者都用 8008。`start-dev.sh` 會 `kill -9` 佔著 8008 的行程，也就是安裝版的 sidecar；
安裝版開著時直接跑 `tauri dev`，dev 前端會連到安裝版的 sidecar，session secret 對不上，整片 403。
```

- [ ] **Step 2: parent_watchdog.py**

模組說明的第二段換成：

```python
Tauri 正常結束時會先收掉 sidecar（src-tauri/src/lib.rs 的 cleanup_sidecar）；這裡補的是
它來不及的情況：app 當掉或被強制結束。留下來的 sidecar 會佔著 port，下次開 app 新的 sidecar
綁不到 port，前端連到的是舊的那個——它拿的是上一次的 session secret，每個請求都 403。
```

`_windows_liveness_check` 說明裡的「Windows 上 Tauri 只能收掉 onefile 的 bootloader，Python 子行程每次都靠這裡結束，所以這個窗口不能留。」換成：「app 當掉時就靠這裡結束，所以這個窗口不能留。」

- [ ] **Step 3: sidecarConnection.ts**

```ts
/**
 * 從沒連上過、又超過這麼久，才從「啟動中」改說「沒有回應」。
 * onefile 裝好後第一次開實測 22.8 秒，CI runner 更慢。
 */
```

換成：

```ts
/**
 * 從沒連上過、又超過這麼久，才從「啟動中」改說「沒有回應」。
 * onedir 平常約 1 秒，但新檔案第一次執行時系統會先掃描：macOS 實測最慢 26 秒，Windows 的防毒更慢。
 */
```

- [ ] **Step 4: README 的「macOS — 首次開啟」**

整節換成：

```markdown
### macOS — 首次開啟

StarScope 沒有經過 Apple 公證，第一次打開時 macOS 會說「Apple 無法驗證」。任一方法：

1. 按「完成」，到「系統設定 → 隱私權與安全性」，在最下面按「強制打開」，輸入密碼後再按「打開」
2. 或在終端機執行：

   ```bash
   xattr -d com.apple.quarantine /Applications/StarScope.app
   ```

每次更新後都要再做一次。1.0.0 的簽章不完整，macOS 會說它「已損毀」，只能用方法 2。
```

- [ ] **Step 5: CHANGELOG `[Unreleased]` 的 `### 修復`，最上面加兩條**

```markdown
- **開啟 app 要等將近 10 秒** — 背景服務原本每次啟動都要先解壓整個程式，現在約 1 秒就能用（安裝後第一次開啟，macOS 會先檢查新檔案，會久一些）
- **從網路下載的 macOS 版顯示「已損毀」、無法打開** — 安裝檔的簽章不完整。現在 macOS 會改說「Apple 無法驗證」，可以在「系統設定 → 隱私權與安全性」選擇強制打開
```

- [ ] **Step 6: 驗證**

Run: `git grep -n -i -e "onefile" -e "placeholder" -e "bootloader" -- ':!docs/superpowers' ':!CHANGELOG.md'`
Expected: 只剩刻意保留的：`starscope-sidecar.spec` 裡說明 onedir 為什麼比 onefile 快的那段、`smoke-test-sidecar.sh` 的 `pkill -P` 註解、`check_sidecar_binary.py` 說明裡的「README」字樣。其餘每一筆都要處理或說明為什麼保留

Run: `npm run lint && npm test -- --run src/api` （只改了註解，確認沒有打錯字而弄壞程式）
Expected: 全綠

- [ ] **Step 7: Commit（使用者授權後）**

```bash
git add CLAUDE.md sidecar/utils/parent_watchdog.py src/api/sidecarConnection.ts README.md CHANGELOG.md
git commit -m "docs: describe the onedir sidecar, the shared data folder and first launch on macOS"
```

**🚧 階段 3 審查閘門**：用 code-reviewer 審 Task 5 到 Task 8（重點是 Rust 的啟動路徑、CI 步驟、文件跟實作是否一致），修完才進階段 4。

---

## 階段 4：發版驗證與切換（大部分由使用者操作）

- [ ] **推送**：使用者 push。
- [ ] **發版預演**：使用者在 Actions 手動跑 `Release`（main）。Expected：四個 job 全綠，包含「Smoke test the sidecar inside the installer」（四個平台）與「Verify the macOS signature」（兩個 macOS job）；release 清單沒有多出任何 draft（用 GitHub 插件的 `list_releases` 確認）。失敗時從 job log 找原因，回到對應的 Task 修正。
- [ ] **打 tag**：CHANGELOG 定版本號、打 tag，由使用者操作。
- [ ] **發佈前的 Gatekeeper 實測**：從 draft release **用瀏覽器下載** aarch64 的 dmg，拖進「應用程式」後打開。Expected：出現「Apple 無法驗證」（不是「已損毀」）；強制打開後可以用。這時用的是真實資料，所以這一步就是切換本身。
- [ ] **切換**：
  1. 先停掉 `start-dev.sh`，確認 8008 是空的
  2. 打開安裝版，確認資料都在（追蹤清單、最近的快照）
  3. 記下讀 Keychain 的提示實際是什麼樣子
  4. 一小時後確認 `~/.starscope/jobs.log` 仍在增長（collector 照常寫入）
  5. localStorage 裡的設定要重設一次
- [ ] **發佈 draft release**：由使用者操作。
