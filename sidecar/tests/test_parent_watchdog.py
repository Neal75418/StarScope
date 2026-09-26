"""父行程看門：Tauri 當掉或被強制結束時，sidecar 要自己結束，不能佔著 port 讓下次開啟整片 403。"""

import os
import subprocess
import sys
import threading
import time

import pytest

from utils import parent_watchdog
from utils.parent_watchdog import (
    _WAIT_TIMEOUT,
    PARENT_PID_ENV_VAR,
    _windows_liveness_check,
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


class _FakeKernel32:
    """記錄呼叫的 kernel32 替身：Windows 的判斷邏輯在任何平台都能測。"""

    def __init__(self, handle: int, waits: list[int]) -> None:
        self._handle = handle
        self._waits = waits
        self.opened: list[int] = []
        self.closed: list[int] = []

    def OpenProcess(self, access: int, inherit: bool, pid: int) -> int:
        self.opened.append(pid)
        return self._handle

    def WaitForSingleObject(self, handle: int, timeout_ms: int) -> int:
        assert handle == self._handle and timeout_ms == 0
        return self._waits.pop(0)

    def CloseHandle(self, handle: int) -> None:
        self.closed.append(handle)


def test_windows_check_opens_the_parent_once_and_keeps_the_handle():
    # 只要手上還有 handle，Windows 就不會把這個 PID 分給別的行程；每次重開的話，
    # 父行程結束後 PID 被重用，看門會以為它還在，sidecar 就一直佔著 port
    kernel32 = _FakeKernel32(handle=99, waits=[_WAIT_TIMEOUT, _WAIT_TIMEOUT, 0])
    check = _windows_liveness_check(4242, kernel32)

    assert [check(), check(), check()] == [True, True, False]
    assert kernel32.opened == [4242]
    assert kernel32.closed == []


def test_windows_check_treats_a_parent_it_cannot_open_as_gone():
    kernel32 = _FakeKernel32(handle=0, waits=[])
    check = _windows_liveness_check(4242, kernel32)

    assert check() is False


def test_default_watchdog_builds_its_check_once_before_the_thread_starts(monkeypatch):
    # 在啟動時就拿住父行程（Windows 上是開 handle），不是等第一次輪詢
    built: list[tuple[int, str]] = []
    polls = {"left": 3}

    def fake_liveness_check(pid: int):
        built.append((pid, threading.current_thread().name))

        def check() -> bool:
            polls["left"] -= 1
            return polls["left"] > 0

        return check

    monkeypatch.setattr(parent_watchdog, "_liveness_check", fake_liveness_check)
    gone = threading.Event()
    thread = start_parent_watchdog(4242, gone.set, interval=0.01)

    assert built == [(4242, threading.current_thread().name)]
    assert gone.wait(1)
    thread.join(1)
    assert built == [(4242, threading.current_thread().name)]  # 輪詢時沒有再建一次
