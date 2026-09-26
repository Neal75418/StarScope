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
        port: int = s.getsockname()[1]
        return port


def _healthy(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=0.5) as resp:
            return bool(resp.status == 200)
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
