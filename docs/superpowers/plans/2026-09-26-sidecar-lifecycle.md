# sidecar 生命週期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打包版 app 以任何方式結束（關視窗、Cmd+Q、系統列 Quit、當掉）都不留下 sidecar，第二次開啟不再整片 403。

**Architecture:** 三層。L1：Tauri 在 `RunEvent::Exit` 清理 sidecar。L2：Unix 先送 SIGTERM（onefile 的 bootloader 會轉給 Python 子行程），3 秒內沒結束才 SIGKILL。L3：Tauri 以 `STARSCOPE_PARENT_PID` 傳自己的 PID，sidecar 每 2 秒檢查，父行程不在就讓 uvicorn 正常關閉。

**Tech Stack:** Tauri 2.11（Rust）、tauri-plugin-shell 2.3、libc 0.2；Python 3.13 sidecar（uvicorn、pytest）；bash smoke test（macOS／Linux／Windows Git Bash）。

**Spec:** `docs/superpowers/specs/2026-09-26-sidecar-lifecycle-design.md`

## Global Constraints

- 環境變數名稱：`STARSCOPE_PARENT_PID`，值為 Tauri 的 `std::process::id()`
- 看門間隔 2 秒；Tauri 端等 SIGTERM 生效最多 3 秒，每 50ms 檢查一次
- Windows 上**不能**用 `os.kill(pid, 0)` 檢查行程（會 TerminateProcess 掉它）；改用 ctypes `OpenProcess(SYNCHRONIZE)`＋`WaitForSingleObject(handle, 0)`
- 沒有 `STARSCOPE_PARENT_PID` 就不啟動看門；值不是正整數時記 WARNING、不啟動、不讓啟動失敗
- `libc` 只在 Unix：`[target.'cfg(unix)'.dependencies]`
- 看門只掛在 `run_server()` 的非 reload 分支；reload 分支（開發模式）不變
- `run_server()` 非 reload 分支仍傳 app 物件、不傳 `"main:app"`（PyInstaller 打包後沒有 `main` 模組）
- 後端測試：`cd sidecar && STARSCOPE_DATA_DIR=<暫存目錄> PYTHON_KEYRING_BACKEND=keyring.backends.null.Keyring GITHUB_TOKEN= .venv/bin/python -m pytest …`
- 啟動真的 sidecar 的測試一律設 `DEBUG=false`（`sidecar/.env` 可能有 `DEBUG=true`，會走 reload 分支、沒有看門）、隔離資料目錄、空的 port
- CI 不編譯 Rust：Rust 改動靠本機 `cargo build`／`cargo test` 與實機驗證
- Commit：Conventional Commits、純文字、不加 Co-Authored-By；需使用者授權
- 階段閘門：Task 1–4 完成後送 code-reviewer（含 libc 的供應鏈檢查），修完才做 Task 5 的實機驗證

## Review Focus

1. **app 當掉或被強制結束**（Activity Monitor 強制結束、`kill -9` Tauri）：sidecar 要在幾秒內自己結束，下次開啟正常（Task 2 的整合測試以 `sleep` 當父行程模擬）。
2. **sidecar 無視 SIGTERM 或卡在關閉流程**：Tauri 等 3 秒後一定要 SIGKILL，不能讓 app 卡在結束（Task 4 的 `terminate_gracefully` 測試用一個忽略 SIGTERM 的行程）。
3. **開發模式與 collector 不能被影響**：沒設 `STARSCOPE_PARENT_PID` 時，sidecar 不會因為「找不到父行程」自己結束（Task 2 對照組）。
4. **Windows 的父行程檢查不能誤殺父行程**：`parent_alive` 在 Windows 走 ctypes 路徑；smoke test 在 Windows runner 上以假父行程實際跑一次（Task 3）。
5. **環境變數值壞掉**（空字串、非數字、0、負數）：不啟動看門、不讓 sidecar 啟動失敗（Task 1）。

---

### Task 1: `parent_watchdog` 模組

**Files:**
- Create: `sidecar/utils/parent_watchdog.py`
- Test: `sidecar/tests/test_parent_watchdog.py`

**Interfaces:**
- Produces:
  - `PARENT_PID_ENV_VAR = "STARSCOPE_PARENT_PID"`
  - `parent_alive(pid: int) -> bool`
  - `parent_pid_from_env(environ: Mapping[str, str]) -> int | None`
  - `start_parent_watchdog(pid: int, on_parent_gone: Callable[[], None], *, interval: float = 2.0, is_alive: Callable[[int], bool] = parent_alive) -> threading.Thread`

- [ ] **Step 1: Write the failing tests**

```python
"""父行程看門：Tauri 當掉或被強制結束時，sidecar 要自己結束，不能佔著 port 讓下次開啟整片 403。"""

import os
import subprocess
import sys
import threading
import time

import pytest

from utils.parent_watchdog import (
    PARENT_PID_ENV_VAR,
    parent_alive,
    parent_pid_from_env,
    start_parent_watchdog,
)


def test_own_process_is_alive():
    assert parent_alive(os.getpid()) is True


def test_a_finished_and_reaped_process_is_not_alive():
    proc = subprocess.Popen([sys.executable, "-c", "pass"])
    proc.wait()  # 回收，避免殭屍行程讓 kill(pid, 0) 仍然成功

    assert parent_alive(proc.pid) is False


@pytest.mark.parametrize("raw, expected", [
    ("4242", 4242),
    (" 4242 ", 4242),
])
def test_parent_pid_is_read_from_the_environment(raw, expected):
    assert parent_pid_from_env({PARENT_PID_ENV_VAR: raw}) == expected


def test_no_variable_means_no_watchdog():
    assert parent_pid_from_env({}) is None


@pytest.mark.parametrize("raw", ["", "abc", "0", "-5", "12.5"])
def test_a_bad_value_disables_the_watchdog_with_a_warning(raw, caplog):
    with caplog.at_level("WARNING"):
        assert parent_pid_from_env({PARENT_PID_ENV_VAR: raw}) is None
    assert PARENT_PID_ENV_VAR in caplog.text


def test_watchdog_calls_back_once_when_the_parent_is_gone():
    alive = {"value": True}
    gone = threading.Event()
    calls = []

    def on_gone():
        calls.append(1)
        gone.set()

    thread = start_parent_watchdog(1234, on_gone, interval=0.01, is_alive=lambda _pid: alive["value"])
    time.sleep(0.05)
    assert calls == []  # 父行程還在：不能提早結束

    alive["value"] = False
    assert gone.wait(1)
    thread.join(1)
    assert calls == [1]
    assert not thread.is_alive()
    assert thread.daemon  # 不能擋住 sidecar 自己正常結束
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sidecar && STARSCOPE_DATA_DIR=$TMPDIR/ss PYTHON_KEYRING_BACKEND=keyring.backends.null.Keyring GITHUB_TOKEN= .venv/bin/python -m pytest tests/test_parent_watchdog.py -v`
Expected: FAIL（`ModuleNotFoundError: No module named 'utils.parent_watchdog'`）

- [ ] **Step 3: Implement**

`sidecar/utils/parent_watchdog.py`：

```python
"""父行程看門：Tauri（父行程）不在了，sidecar 就自己結束。

Tauri 正常結束時會先收掉 sidecar（src-tauri/src/lib.rs 的 cleanup_sidecar）；這裡補的是
它來不及的情況：app 當掉、被強制結束，以及 Windows 上 onefile 的 Python 子行程（Tauri 只
能 TerminateProcess 掉 bootloader）。留下來的 sidecar 會佔著 port，下次開 app 新的 sidecar
綁不到 port，前端連到的是舊的那個——它拿的是上一次的 session secret，每個請求都 403。

只在 STARSCOPE_PARENT_PID 有設時啟動：start-dev.sh、e2e、headless collector、pytest 都不設。
"""

import logging
import os
import sys
import threading
import time
from collections.abc import Callable, Mapping

logger = logging.getLogger(__name__)

PARENT_PID_ENV_VAR = "STARSCOPE_PARENT_PID"

if sys.platform == "win32":
    import ctypes
    from ctypes import wintypes

    _SYNCHRONIZE = 0x00100000
    _WAIT_TIMEOUT = 0x00000102
    _kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _kernel32.OpenProcess.restype = wintypes.HANDLE
    _kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    _kernel32.WaitForSingleObject.restype = wintypes.DWORD
    _kernel32.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
    _kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)

    def parent_alive(pid: int) -> bool:
        # 不能用 os.kill(pid, 0)：Windows 上它會 TerminateProcess 掉那個行程
        handle = _kernel32.OpenProcess(_SYNCHRONIZE, False, pid)
        if not handle:
            return False
        try:
            return _kernel32.WaitForSingleObject(handle, 0) == _WAIT_TIMEOUT
        finally:
            _kernel32.CloseHandle(handle)

else:

    def parent_alive(pid: int) -> bool:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            return True  # 行程在，只是不是我們的使用者
        return True


def parent_pid_from_env(environ: Mapping[str, str]) -> int | None:
    """讀 STARSCOPE_PARENT_PID；沒有或格式不對時回 None（格式不對另記 WARNING）。"""
    raw = environ.get(PARENT_PID_ENV_VAR)
    if raw is None:
        return None
    try:
        pid = int(raw.strip())
    except ValueError:
        pid = 0
    if pid <= 0:
        logger.warning("[父行程看門] %s=%r 不是有效的 PID，不啟動看門", PARENT_PID_ENV_VAR, raw)
        return None
    return pid


def start_parent_watchdog(
    pid: int,
    on_parent_gone: Callable[[], None],
    *,
    interval: float = 2.0,
    is_alive: Callable[[int], bool] = parent_alive,
) -> threading.Thread:
    """每 interval 秒檢查一次父行程；第一次發現不在就呼叫 on_parent_gone() 並結束。"""

    def watch() -> None:
        while is_alive(pid):
            time.sleep(interval)
        logger.warning("[父行程看門] 父行程 %d 已結束，sidecar 跟著結束", pid)
        on_parent_gone()

    thread = threading.Thread(target=watch, name="parent-watchdog", daemon=True)
    thread.start()
    return thread
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sidecar && STARSCOPE_DATA_DIR=$TMPDIR/ss PYTHON_KEYRING_BACKEND=keyring.backends.null.Keyring GITHUB_TOKEN= .venv/bin/python -m pytest tests/test_parent_watchdog.py -v && .venv/bin/ruff check . && .venv/bin/mypy . --config-file mypy.ini`
Expected: 全部 PASS；ruff、mypy 無錯（mypy 依 `sys.platform` 只檢查目前平台的分支）

- [ ] **Step 5: Commit**（先取得使用者授權）

```bash
git add sidecar/utils/parent_watchdog.py sidecar/tests/test_parent_watchdog.py
git commit -m "feat(sidecar): parent watchdog that notices when the app process is gone"
```

---

### Task 2: `run_server()` 掛上看門

**Files:**
- Modify: `sidecar/main.py:395-420`（`run_server`）
- Modify: `sidecar/tests/test_main_startup.py:60-98`
- Test: `sidecar/tests/test_parent_watchdog_process.py`（整合，啟動真的 sidecar）

**Interfaces:**
- Consumes: Task 1 的 `parent_pid_from_env`、`start_parent_watchdog`
- Produces: `run_server()` 非 reload 分支改為 `uvicorn.Server(uvicorn.Config(app, host=host, port=port)).run()`；有父行程 PID 時啟動看門，callback 設 `server.should_exit = True`

- [ ] **Step 1: 改既有啟動測試成新行為（先紅）**

`sidecar/tests/test_main_startup.py` 把兩條非 reload 的測試換成 patch `main.uvicorn.Server`，並新增看門的接線測試：

```python
def test_release_mode_passes_the_app_object_not_an_import_string():
    """PyInstaller 打包後入口模組叫 __main__，沒有可以 import 的 "main"——
    傳 "main:app" 會讓發行版一啟動就 `Could not import module "main"` 退出。"""
    import main

    with patch.object(main, "DEBUG", False), patch("main.uvicorn.Server") as server_cls, \
            patch("main.uvicorn.run") as run:
        main.run_server()

    config = server_cls.call_args.args[0]
    assert config.app is main.app
    assert not config.reload
    server_cls.return_value.run.assert_called_once()
    run.assert_not_called()


def test_frozen_binary_ignores_debug(monkeypatch):
    """打包後的 binary 就算讀到 DEBUG=true（使用者環境變數、上層目錄的 .env）也不能開 reload：
    reloader 會先佔住 port，子行程再跑一次入口又綁同一個 port，結果行程活著卻永遠不服務。"""
    import sys
    import main

    monkeypatch.setattr(sys, "frozen", True, raising=False)
    with patch.object(main, "DEBUG", True), patch("main.uvicorn.Server") as server_cls, \
            patch("main.uvicorn.run") as run:
        main.run_server()

    assert server_cls.call_args.args[0].app is main.app
    run.assert_not_called()


def test_release_mode_starts_the_parent_watchdog_when_told_the_parent_pid(monkeypatch):
    import main

    monkeypatch.setenv("STARSCOPE_PARENT_PID", "4242")
    with patch.object(main, "DEBUG", False), patch("main.uvicorn.Server") as server_cls, \
            patch("main.start_parent_watchdog") as watchdog:
        main.run_server()

    pid, on_parent_gone = watchdog.call_args.args
    assert pid == 4242
    server = server_cls.return_value
    server.should_exit = False
    on_parent_gone()
    assert server.should_exit is True  # 走 uvicorn 的正常關閉，不是直接殺掉


def test_release_mode_without_a_parent_pid_has_no_watchdog(monkeypatch):
    import main

    monkeypatch.delenv("STARSCOPE_PARENT_PID", raising=False)
    with patch.object(main, "DEBUG", False), patch("main.uvicorn.Server"), \
            patch("main.start_parent_watchdog") as watchdog:
        main.run_server()

    watchdog.assert_not_called()
```

`test_debug_mode_keeps_hot_reload` 不動（reload 分支仍用 `uvicorn.run("main:app", reload=True)`）。

- [ ] **Step 2: Write the failing integration test**

`sidecar/tests/test_parent_watchdog_process.py`：

```python
"""真的啟動 sidecar，確認父行程消失後它會自己結束、放開 port。

以 sleep 行程模擬 Tauri：殺掉它＝app 當掉或被強制結束。
"""

import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import pytest

SIDECAR_DIR = Path(__file__).resolve().parent.parent


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _healthy(port: int) -> bool:
    try:
        return urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=0.5).status == 200
    except Exception:
        return False


@pytest.fixture
def launch(tmp_path):
    procs: list[subprocess.Popen] = []

    def start(parent_pid: int | None) -> tuple[subprocess.Popen, int]:
        port = _free_port()
        env = {
            "PATH": os.environ["PATH"],
            "HOME": str(tmp_path),
            "PORT": str(port),
            "STARSCOPE_DATA_DIR": str(tmp_path / "data"),
            "PYTHON_KEYRING_BACKEND": "keyring.backends.null.Keyring",
            "GITHUB_TOKEN": "",
            # sidecar/.env 可能有 DEBUG=true：那會走 reload 分支，沒有看門
            "DEBUG": "false",
            "ENV": "production",
        }
        if parent_pid is not None:
            env["STARSCOPE_PARENT_PID"] = str(parent_pid)
        proc = subprocess.Popen([sys.executable, "main.py"], cwd=SIDECAR_DIR, env=env,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        procs.append(proc)
        deadline = time.monotonic() + 30
        while not _healthy(port):
            assert proc.poll() is None, "sidecar 在回應之前就結束了"
            assert time.monotonic() < deadline, "sidecar 30 秒內沒有回應 /api/health"
            time.sleep(0.2)
        return proc, port

    yield start
    for proc in procs:
        if proc.poll() is None:
            proc.kill()
            proc.wait()


def _fake_parent() -> subprocess.Popen:
    return subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"])


def test_sidecar_exits_cleanly_when_its_parent_dies(launch):
    parent = _fake_parent()
    try:
        sidecar, port = launch(parent.pid)

        parent.kill()
        parent.wait()

        assert sidecar.wait(timeout=10) == 0  # 正常關閉，不是被殺
        assert not _healthy(port)
    finally:
        if parent.poll() is None:
            parent.kill()


def test_without_a_parent_pid_the_sidecar_keeps_running(launch):
    # 對照組：開發模式、e2e、collector 不設 STARSCOPE_PARENT_PID，不能因此自己結束
    bystander = _fake_parent()
    sidecar, port = launch(None)

    bystander.kill()
    bystander.wait()
    time.sleep(3)

    assert sidecar.poll() is None
    assert _healthy(port)
```

- [ ] **Step 3: Run to verify failures**

Run: `cd sidecar && STARSCOPE_DATA_DIR=$TMPDIR/ss PYTHON_KEYRING_BACKEND=keyring.backends.null.Keyring GITHUB_TOKEN= .venv/bin/python -m pytest tests/test_main_startup.py tests/test_parent_watchdog_process.py -v`
Expected: `test_release_mode_passes_the_app_object…`、`test_frozen_binary_ignores_debug`、`test_release_mode_starts_the_parent_watchdog…` 失敗（`main` 沒有 `start_parent_watchdog`、Server 沒被呼叫）；`test_sidecar_exits_cleanly_when_its_parent_dies` 失敗（`TimeoutExpired`）；對照組通過

- [ ] **Step 4: Implement**

`sidecar/main.py` import 區加：

```python
from utils.parent_watchdog import parent_pid_from_env, start_parent_watchdog
```

`run_server()` 的 `else` 分支改為：

```python
    else:
        # 傳物件而不是 "main:app"：PyInstaller 打包後入口模組叫 __main__，
        # 沒有名為 main 的模組可以 import
        server = uvicorn.Server(uvicorn.Config(app, host=host, port=port))
        # Tauri 會告訴我們它的 PID：它當掉或被強制結束時，sidecar 要自己走正常關閉，
        # 不能佔著 port 讓下次開 app 整片 403（見 utils/parent_watchdog.py）
        parent_pid = parent_pid_from_env(os.environ)
        if parent_pid is not None:
            start_parent_watchdog(parent_pid, lambda: setattr(server, "should_exit", True))
        server.run()
```

- [ ] **Step 5: Run tests**

Run: `cd sidecar && STARSCOPE_DATA_DIR=$TMPDIR/ss PYTHON_KEYRING_BACKEND=keyring.backends.null.Keyring GITHUB_TOKEN= .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check . && .venv/bin/mypy . --config-file mypy.ini`
Expected: 全部 PASS

- [ ] **Step 6: Commit**（先取得使用者授權）

```bash
git add sidecar/main.py sidecar/tests/test_main_startup.py sidecar/tests/test_parent_watchdog_process.py
git commit -m "fix(sidecar): shut down when the app that started it is gone"
```

---

### Task 3: smoke test 加孤兒檢查

**Files:**
- Modify: `scripts/smoke-test-sidecar.sh`

**Interfaces:**
- Consumes: Task 2 的行為（有 `STARSCOPE_PARENT_PID` 時父行程消失就結束）
- Produces: smoke test 在三個 OS 上驗證「打包後的 binary 在父行程消失後自己結束」

- [ ] **Step 1: 改腳本**

在啟動 binary 之前起一個假父行程，把它的 PID（Windows 取 `/proc/$!/winpid`）交給 binary；健康檢查通過後不直接 `exit 0`，改為殺掉假父行程並等 binary 結束：

```bash
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
```

啟動行改為帶上 `STARSCOPE_PARENT_PID="$PARENT_PID_FOR_BINARY"`：

```bash
STARSCOPE_DATA_DIR="$DATA_DIR" PORT="$PORT" ENV=production DEBUG=false GITHUB_TOKEN= \
  PYTHON_KEYRING_BACKEND=keyring.backends.null.Keyring \
  STARSCOPE_PARENT_PID="$PARENT_PID_FOR_BINARY" \
  "$BINARY" >"$LOG_FILE" 2>&1 &
```

健康檢查迴圈裡成功時的 `exit 0` 改成 `HEALTHY=1; break`，迴圈後：

```bash
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
```

頂端常數加 `PARENT_GONE_TIMEOUT_SECONDS=15`；`cleanup()` 也要 `kill "$FAKE_PARENT" 2>/dev/null || true`。

- [ ] **Step 2: 本機驗證（打包進暫存區，不動 `src-tauri/binaries`）**

```bash
S=$TMPDIR/smoke-lifecycle && rm -rf $S && mkdir -p $S
cd sidecar && STARSCOPE_TARGET_TRIPLE=aarch64-apple-darwin .venv/bin/pyinstaller starscope-sidecar.spec --distpath $S/dist --workpath $S/build --noconfirm
cd .. && scripts/smoke-test-sidecar.sh $S/dist/starscope-sidecar-aarch64-apple-darwin
```

Expected: 先 `✅ sidecar 在 Ns 內回應`，再 `✅ 父行程消失後 Ns 內自己結束並放開 port`

- [ ] **Step 3: 反向驗證（腳本真的會紅）**

暫時拿掉看門、重打、跑同一支腳本，驗完以備份還原（不用 `git stash`／`git checkout`，避免動到其他未提交的檔）：

```bash
cp sidecar/main.py $S/main.py.bak
python3 - <<'PY'
p = "sidecar/main.py"; s = open(p, encoding="utf-8").read()
old = "        if parent_pid is not None:\n            start_parent_watchdog(parent_pid, lambda: setattr(server, \"should_exit\", True))\n"
assert s.count(old) == 1
open(p, "w", encoding="utf-8").write(s.replace(old, ""))
PY
(cd sidecar && STARSCOPE_TARGET_TRIPLE=aarch64-apple-darwin .venv/bin/pyinstaller starscope-sidecar.spec --distpath $S/dist-noguard --workpath $S/build-noguard --noconfirm)
scripts/smoke-test-sidecar.sh $S/dist-noguard/starscope-sidecar-aarch64-apple-darwin; echo "exit=$?"
cp $S/main.py.bak sidecar/main.py && cmp sidecar/main.py $S/main.py.bak && echo restored
```

Expected: `❌ 父行程消失 15s 後 sidecar 仍在`、`exit=1`、`restored`

- [ ] **Step 4: Commit**（先取得使用者授權）

```bash
git add scripts/smoke-test-sidecar.sh
git commit -m "ci: the sidecar smoke test checks it exits when its parent is gone"
```

---

### Task 4: Tauri 在所有結束路徑優雅收掉 sidecar

**Files:**
- Modify: `src-tauri/Cargo.toml`（Unix 加 `libc = "0.2"`）
- Modify: `src-tauri/src/lib.rs`（`start_sidecar_with_retry` 加 env、`cleanup_sidecar`、`run()`、tests）

**Interfaces:**
- Produces:
  - `#[cfg(unix)] fn terminate_gracefully(pid: u32, timeout: Duration) -> bool`：送 SIGTERM、等到行程消失回 true，逾時回 false
  - `fn wait_until(mut done: impl FnMut() -> bool, timeout: Duration, step: Duration) -> bool`
  - 常數 `SIDECAR_STOP_TIMEOUT: Duration = 3s`、`SIDECAR_STOP_POLL: Duration = 50ms`

- [ ] **Step 1: Write the failing tests**（`lib.rs` 的 `mod tests` 內）

```rust
    #[test]
    fn wait_until_returns_as_soon_as_the_condition_holds() {
        let mut calls = 0;
        let done = wait_until(|| { calls += 1; calls >= 3 }, Duration::from_secs(1), Duration::from_millis(1));
        assert!(done);
        assert_eq!(calls, 3);
    }

    #[test]
    fn wait_until_gives_up_after_the_timeout() {
        let started = std::time::Instant::now();
        assert!(!wait_until(|| false, Duration::from_millis(100), Duration::from_millis(10)));
        assert!(started.elapsed() >= Duration::from_millis(100));
    }

    /// 起一個子行程並在背景回收它（對應 shell plugin 的等待執行緒）：
    /// 沒人 wait 的話它結束後會變成殭屍，kill(pid, 0) 仍然成功
    #[cfg(unix)]
    fn spawn_reaped(script: &str) -> u32 {
        let mut child = std::process::Command::new("sh").arg("-c").arg(script).spawn().unwrap();
        let pid = child.id();
        std::thread::spawn(move || { let _ = child.wait(); });
        std::thread::sleep(Duration::from_millis(200)); // 讓 trap 先掛上
        pid
    }

    #[cfg(unix)]
    #[test]
    fn terminate_gracefully_stops_a_process_that_honours_sigterm() {
        let pid = spawn_reaped("trap 'exit 0' TERM; while true; do sleep 0.05; done");
        assert!(terminate_gracefully(pid, Duration::from_secs(3)));
    }

    #[cfg(unix)]
    #[test]
    fn terminate_gracefully_reports_a_process_that_ignores_sigterm() {
        // 呼叫端看到 false 才會改用 SIGKILL；這裡自己收尾
        let pid = spawn_reaped("trap '' TERM; while true; do sleep 0.05; done");
        assert!(!terminate_gracefully(pid, Duration::from_millis(300)));
        unsafe { libc::kill(pid as libc::pid_t, libc::SIGKILL) };
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `cd src-tauri && cargo test --lib 2>&1 | tail -20`
Expected: 編譯錯誤（`wait_until`、`terminate_gracefully` 未定義；`libc` 未宣告）

- [ ] **Step 3: Implement**

`src-tauri/Cargo.toml`：

```toml
[target.'cfg(unix)'.dependencies]
# cleanup_sidecar 先送 SIGTERM：onefile 的 bootloader 會轉給 Python 子行程，讓它正常關閉
libc = "0.2"
```

`src-tauri/src/lib.rs`：

- `use` 加 `std::time::Duration`，`tauri::{…}` 加 `RunEvent`
- 常數：

```rust
/// 結束 sidecar 時等 SIGTERM 生效的上限；逾時改用 SIGKILL，不讓 app 卡在結束
const SIDECAR_STOP_TIMEOUT: Duration = Duration::from_secs(3);
const SIDECAR_STOP_POLL: Duration = Duration::from_millis(50);
```

- `start_sidecar_with_retry` 在 `cmd.env("STARSCOPE_SESSION_SECRET", …)` 之後：

```rust
        // sidecar 以它看門（sidecar/utils/parent_watchdog.py）：app 當掉或被強制結束、
        // cleanup_sidecar 來不及跑時，sidecar 發現父行程不在就自己結束
        cmd = cmd.env("STARSCOPE_PARENT_PID", std::process::id().to_string());
```

- 新函式：

```rust
/// 反覆檢查 `done()` 直到成立或逾時；成立回 true。
fn wait_until(mut done: impl FnMut() -> bool, timeout: Duration, step: Duration) -> bool {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        if done() {
            return true;
        }
        if std::time::Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(step);
    }
}

/// 送 SIGTERM 並等行程消失。onefile 的 bootloader 會把 SIGTERM 轉給 Python 子行程，
/// uvicorn 走正常關閉；直接 SIGKILL 只會殺到 bootloader，Python 子行程留下來佔著 port。
#[cfg(unix)]
fn terminate_gracefully(pid: u32, timeout: Duration) -> bool {
    let pid = pid as libc::pid_t;
    // SAFETY: kill(2) 只對指定 pid 送 signal，不碰這個行程的記憶體
    if unsafe { libc::kill(pid, libc::SIGTERM) } != 0 {
        return false;
    }
    // shell plugin 的等待執行緒會回收子行程，結束後 kill(pid, 0) 就會失敗
    wait_until(|| unsafe { libc::kill(pid, 0) } != 0, timeout, SIDECAR_STOP_POLL)
}
```

- `cleanup_sidecar` 改為：

```rust
/// 結束 sidecar。Unix 先 SIGTERM、等 SIDECAR_STOP_TIMEOUT，仍在才 SIGKILL；
/// Windows 沒有 SIGTERM，直接 kill（onefile 的 Python 子行程由 sidecar 的父行程看門收掉）。
/// 以 take() 取出 child，關視窗與 RunEvent::Exit 都呼叫也不會重複處理。
fn cleanup_sidecar(app: &AppHandle) {
    let Some(state) = app.try_state::<SidecarState>() else { return };
    let Ok(mut child_guard) = state.child.lock() else { return };
    let Some(child) = child_guard.take() else { return };

    #[cfg(unix)]
    if terminate_gracefully(child.pid(), SIDECAR_STOP_TIMEOUT) {
        info!("Sidecar 程序已正常結束");
        return;
    }

    if let Err(e) = child.kill() {
        warn!("終止 sidecar 程序失敗: {e}");
    } else {
        info!("Sidecar 程序已強制終止");
    }
}
```

- `run()` 結尾：`.run(tauri::generate_context!()).expect(…)` 改為

```rust
        .build(tauri::generate_context!())
        .expect("致命錯誤：無法啟動 Tauri 應用程式，請檢查 WebView 運行環境與連接埠可用性")
        // 關視窗之外的結束方式（Cmd+Q、系統列 Quit 的 app.exit）不會觸發 CloseRequested；
        // 它們最後都會走到 Exit。沒收掉的 sidecar 會佔著 port，下次開 app 整片 403
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                cleanup_sidecar(app_handle);
            }
        });
```

`on_window_event` 的 `CloseRequested` 清理保留。

- [ ] **Step 4: Run tests and build**

Run: `cd src-tauri && cargo test --lib 2>&1 | tail -15 && cargo clippy --all-targets 2>&1 | tail -5`
Expected: 全部 PASS（含既有 4 條 save_file 測試）；clippy 無新警告

- [ ] **Step 5: Commit**（先取得使用者授權）

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs
git commit -m "fix: stop the sidecar gracefully on every way the app can exit"
```

- [ ] **Step 6: 階段閘門**——送 code-reviewer 審 Task 1–4（含 `libc` 的供應鏈：版本、是否已在 lock 裡作為傳遞依賴），findings 修完才做 Task 5

---

### Task 5: 實機驗證與文件

**Files:**
- Modify: `CLAUDE.md`（以 claude-md-management skill 提案，使用者同意後才改）
- Modify: `CHANGELOG.md`（`[Unreleased]` 加一條修正）

- [ ] **Step 1: 打包版實機驗證**（先徵得使用者同意：打包版會讀鑰匙圈的 token 做 star 同步；或由使用者自己跑）

```bash
npm run tauri build
open src-tauri/target/release/bundle/macos/StarScope.app
```

分別以三種方式結束，每次結束後：

```bash
pgrep -fl starscope-sidecar || echo "沒有殘留"
lsof -nP -iTCP:8008 -sTCP:LISTEN || echo "8008 已釋放"
```

1. 關視窗
2. Cmd+Q
3. 系統列選單 Quit

再開一次 app，確認 Dashboard 正常載入（不是整片錯誤）。
Expected: 三種方式結束後都「沒有殘留」「8008 已釋放」；第二次開啟正常。

另外驗證 L3：開 app 後在終端機 `kill -9 $(pgrep -x StarScope)`，5 秒內 `pgrep -fl starscope-sidecar` 應為空。

- [ ] **Step 2: 文件**

`CHANGELOG.md` `[Unreleased]` 下（沒有「修正」小節就新增）：

```markdown
### 修正

- **打包版第二次開啟就整片錯誤** — 關閉 app 後背景服務會留下來佔著連接埠，下次開啟時新的服務起不來、畫面上每個請求都失敗。現在關視窗、Cmd+Q、系統列 Quit 都會正常結束背景服務；app 當掉或被強制結束時，背景服務也會在幾秒內自己結束
```

`CLAUDE.md` 提案（放在「Sidecar 的兩層本機防護」之後）：

```markdown
### sidecar 生命週期

- Tauri 在 `RunEvent::Exit` 與 `CloseRequested` 都呼叫 `cleanup_sidecar`：Unix 先 SIGTERM（onefile 的 bootloader 會轉給 Python），3 秒後才 SIGKILL
- sidecar 以 `STARSCOPE_PARENT_PID` 看門（`utils/parent_watchdog.py`），父行程不在就正常關閉；沒設這個變數時不啟動（start-dev、e2e、collector、pytest）
- ⚠️ 直接 SIGKILL onefile 只殺到 bootloader，Python 子行程會佔著 port，下次開 app 新 sidecar 綁不到、前端連到舊的而整片 403
```

- [ ] **Step 3: Commit**（先取得使用者授權）

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "docs: sidecar lifecycle in CLAUDE.md and changelog"
```

- [ ] **Step 4: 最終審查**——送一個 fresh reviewer 審整批
