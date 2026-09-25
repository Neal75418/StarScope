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
