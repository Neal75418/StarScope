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
