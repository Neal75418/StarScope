"""scripts/check_sidecar_binary.py 在 Windows runner 上也要把結果印得出來。

Windows 的主控台編碼是 cp1252：成功時印 ✅ 與中文丟 UnicodeEncodeError、整個步驟失敗；
失敗時 stderr 以 backslashreplace 印成 \\u274c 這類跳脫字元，原因很難讀。release.yml 與 verify-sidecar.yml 共用這一步，所以 Windows
版的發佈會卡在這裡。這裡以 PYTHONIOENCODING=cp1252 在任何平台重現那個主控台。
"""

import os
import struct
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "check_sidecar_binary.py"


def _run(binary: Path, target: str) -> subprocess.CompletedProcess[str]:
    env = {**os.environ, "PYTHONIOENCODING": "cp1252"}
    env.pop("PYTHONUTF8", None)
    return subprocess.run(
        [sys.executable, str(SCRIPT), str(binary), target],
        capture_output=True, text=True, encoding="utf-8", env=env, timeout=30,
    )


def test_reports_a_real_binary_on_a_cp1252_console(tmp_path):
    binary = tmp_path / "starscope-sidecar-aarch64-apple-darwin"
    header = b"\xcf\xfa\xed\xfe" + struct.pack("<I", 0x0100000C)  # 64-bit Mach-O, arm64
    binary.write_bytes(header + b"\0" * 1_100_000)

    result = _run(binary, "aarch64-apple-darwin")

    assert result.returncode == 0, result.stderr
    assert "✅" in result.stdout
    assert "Traceback" not in result.stderr


def test_explains_a_placeholder_on_a_cp1252_console(tmp_path):
    placeholder = tmp_path / "starscope-sidecar-x86_64-pc-windows-msvc.exe"
    placeholder.write_bytes(b"#!/bin/bash\necho placeholder\n")

    result = _run(placeholder, "x86_64-pc-windows-msvc")

    assert result.returncode == 1
    assert "❌" in result.stderr  # 印得出來，不是 \u274c
    assert "placeholder" in result.stderr
    assert "Traceback" not in result.stderr
