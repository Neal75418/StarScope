"""scripts/extract_bundled_sidecar.py：從安裝檔取出 Tauri 實際打包的 sidecar。

.deb 與 .msi 的解開只在 CI 的 Linux／Windows runner 上跑得到；這裡驗證找檔的規則，
以及 macOS 那條（.app 本身就是資料夾，任何平台都能模擬）。
"""

import importlib.util
import os
import subprocess
import sys
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
    # 但不能跟系統資料夾同名：out 給成磁碟根目錄時會清掉真的 C:\Program Files
    assert exe.parent.parent.name not in {"Program Files", "Program Files (x86)"}
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


def test_leaves_other_files_in_the_output_folder_alone(tmp_path):
    # 只刪自己建立的那個資料夾：out 打錯（例如 "."）時不能把別的東西一起刪掉
    _fake_app(tmp_path / "bundle")
    out = tmp_path / "out"
    ebs.extract(tmp_path / "bundle", out, platform="darwin")  # 先有一份，重跑才會走到清除
    (out / "notes.txt").write_text("someone's file")

    ebs.extract(tmp_path / "bundle", out, platform="darwin")

    assert (out / "notes.txt").exists()


def test_refuses_an_output_folder_that_contains_the_bundle(tmp_path):
    # 參數對調或 out 給成 "." 時，bundle 會在 out 裡面：不能動
    _fake_app(tmp_path / "bundle")
    (tmp_path / ebs.INSTALL_DIR_NAME).mkdir()

    with pytest.raises(ebs.ExtractError, match="裡面"):
        ebs.extract(tmp_path / "bundle", tmp_path, platform="darwin")
    assert (tmp_path / "bundle" / "macos" / "StarScope.app").exists()


@pytest.mark.skipif(os.name == "nt", reason="唯讀靠 POSIX 權限")
def test_does_not_follow_symlinks_when_unlocking_a_previous_copy(tmp_path):
    # 解鎖上一次的副本時，指向外面的 symlink 不能改到對方的權限；懸空的也不能讓它炸掉
    _fake_app(tmp_path / "bundle")
    out = tmp_path / "out"
    ebs.extract(tmp_path / "bundle", out, platform="darwin")
    outside = tmp_path / "outside.txt"
    outside.write_text("x")
    outside.chmod(0o444)
    (out / ebs.INSTALL_DIR_NAME / "link").symlink_to(outside)
    (out / ebs.INSTALL_DIR_NAME / "dangling").symlink_to(tmp_path / "nowhere")

    ebs.extract(tmp_path / "bundle", out, platform="darwin")

    assert outside.stat().st_mode & 0o777 == 0o444


def _fake_run(monkeypatch, make_tree):
    """換掉 subprocess.run：記下指令，並在解開位置建出安裝檔的內容。"""
    calls = []

    def fake(cmd, *args, **kwargs):
        calls.append((cmd, kwargs))
        make_tree()
        return subprocess.CompletedProcess(cmd, 0)

    monkeypatch.setattr(ebs.subprocess, "run", fake)
    return calls


def test_linux_extracts_the_deb_and_finds_the_sidecar(tmp_path, monkeypatch):
    bundle = tmp_path / "bundle"
    (bundle / "deb").mkdir(parents=True)
    deb = bundle / "deb" / "StarScope_1.0.0_amd64.deb"
    deb.write_bytes(b"deb")
    install = tmp_path / "out" / ebs.INSTALL_DIR_NAME

    def make_tree():
        folder = install / "usr" / "lib" / "StarScope" / "sidecar"
        (folder / "_internal").mkdir(parents=True)
        (folder / "starscope-sidecar").write_bytes(b"exe")

    calls = _fake_run(monkeypatch, make_tree)

    exe = ebs.extract(bundle, tmp_path / "out", platform="linux")

    assert [c for c, _ in calls] == [["dpkg-deb", "-x", str(deb), str(install)]]
    assert calls[0][1].get("stdout") == subprocess.DEVNULL  # stdout 只能有那一行路徑：CI 用 $(...) 接
    assert exe == install / "usr" / "lib" / "StarScope" / "sidecar" / "starscope-sidecar"
    if os.name != "nt":
        assert not os.access(exe.parent, os.W_OK)  # Linux 也設唯讀，跟 macOS 一樣


def test_linux_extracts_the_appimage_when_asked(tmp_path, monkeypatch):
    # linuxdeploy 會改寫 usr/lib 裡的 ELF：.deb 正常不代表 AppImage 裡的執行檔沒被改壞
    bundle = tmp_path / "bundle"
    (bundle / "appimage").mkdir(parents=True)
    image = bundle / "appimage" / "StarScope_1.0.0_amd64.AppImage"
    image.write_bytes(b"img")
    install = tmp_path / "out" / ebs.INSTALL_DIR_NAME

    def make_tree():
        folder = install / "squashfs-root" / "usr" / "lib" / "StarScope" / "sidecar"
        (folder / "_internal").mkdir(parents=True)
        (folder / "starscope-sidecar").write_bytes(b"exe")

    calls = _fake_run(monkeypatch, make_tree)

    exe = ebs.extract(bundle, tmp_path / "out", platform="linux", kind="appimage")

    assert calls[0][0] == [str(image), "--appimage-extract"]
    assert calls[0][1]["cwd"] == install  # squashfs-root 解在 cwd 底下
    # --appimage-extract 會把解出來的每個檔案逐行印到 stdout，會混進 CI 用 $(...) 接的那一行路徑
    assert calls[0][1].get("stdout") == subprocess.DEVNULL
    if os.name != "nt":
        assert os.access(image, os.X_OK)  # 下載下來的 AppImage 沒有執行位元
    assert exe.relative_to(install).parts[0] == "squashfs-root"


def test_linux_rejects_an_unknown_installer_kind(tmp_path):
    (tmp_path / "bundle").mkdir()

    with pytest.raises(ebs.ExtractError, match="deb 或 appimage"):
        ebs.extract(tmp_path / "bundle", tmp_path / "out", platform="linux", kind="rpm")


def test_kind_is_only_for_linux(tmp_path):
    _fake_app(tmp_path / "bundle")

    with pytest.raises(ebs.ExtractError, match="只有 Linux"):
        ebs.extract(tmp_path / "bundle", tmp_path / "out", platform="darwin", kind="appimage")


def test_windows_runs_an_admin_install_with_quoted_paths(tmp_path, monkeypatch):
    # 安裝位置含空白（Program Files）：msiexec 的 PROP="value" 沒加引號會被拆開
    bundle = tmp_path / "bundle"
    (bundle / "msi").mkdir(parents=True)
    msi = bundle / "msi" / "StarScope_1.0.0_x64_en-US.msi"
    msi.write_bytes(b"msi")
    install = tmp_path / "out" / ebs.INSTALL_DIR_NAME

    def make_tree():
        folder = install / "PFiles" / "StarScope" / "sidecar"
        (folder / "_internal").mkdir(parents=True)
        (folder / "starscope-sidecar.exe").write_bytes(b"exe")

    calls = _fake_run(monkeypatch, make_tree)

    exe = ebs.extract(bundle, tmp_path / "out", platform="win32")

    assert len(calls) == 1 and isinstance(calls[0][0], str)
    cmd = calls[0][0]
    assert cmd.startswith("msiexec /a ")
    assert f'"{msi}"' in cmd
    assert f'TARGETDIR="{install}"' in cmd
    assert calls[0][1].get("stdout") == subprocess.DEVNULL
    assert exe.name == "starscope-sidecar.exe"
    assert os.access(exe.parent, os.W_OK)  # Windows 不設唯讀


def test_cli_prints_exactly_one_posix_path(tmp_path):
    # CI 用 $(...) 接 stdout 交給 smoke test：只能是一行路徑，Git Bash 吃不下反斜線
    _fake_app(tmp_path / "bundle")

    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(tmp_path / "bundle"), str(tmp_path / "out")],
        capture_output=True, text=True, encoding="utf-8", timeout=30,
    )

    assert result.returncode == 0, result.stderr
    lines = result.stdout.splitlines()
    assert len(lines) == 1
    assert "\\" not in lines[0]
    assert Path(lines[0]).is_file()
