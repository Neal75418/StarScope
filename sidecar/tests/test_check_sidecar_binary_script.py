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
    assert "❌" in result.stderr  # 印得出來，不是跳脫成 backslash-u274c
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
    assert "還有 symlink" in result.stderr  # 路徑本身就含 symlink 這個字（tmp_path 以測試名命名）


def test_expects_the_windows_executable_name(tmp_path):
    pe = b"MZ" + b"\0" * 0x3A + struct.pack("<I", 0x40) + b"PE\0\0" + struct.pack("<H", 0x8664)
    result = _run(_sidecar(tmp_path, header=pe, exe_name="starscope-sidecar.exe"), "x86_64-pc-windows-msvc")

    assert result.returncode == 0, result.stderr
