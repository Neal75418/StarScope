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
        # 真實佈局裡的鏈：經過資料夾 symlink Current 才到檔案
        (fw / "Python").symlink_to("Versions/Current/Python")
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
    assert (dest / "_internal" / "Python.framework" / "Python").read_bytes() == b"libpython"
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
    # repo 的 README，加上上一次 stage 的產物（執行檔、_internal 裡的舊檔）：都要清掉，不能混進新的一份
    src = _onedir(tmp_path)
    dest = tmp_path / "out" / "sidecar"
    (dest / "_internal").mkdir(parents=True)
    (dest / "README.md").write_text("repo 的說明")
    (dest / "starscope-sidecar").write_bytes(b"old exe")
    (dest / "_internal" / "stale.so").write_bytes(b"old")

    stage_sidecar.stage(src, dest)

    assert not (dest / "README.md").exists()
    assert not (dest / "_internal" / "stale.so").exists()
    assert (dest / "starscope-sidecar").read_bytes() == b"bootloader"


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


@needs_symlinks
def test_refuses_a_relative_symlink_that_escapes_through_dotdot(tmp_path):
    # 只解一層、不正規化的話，../../ 會被當成樹內
    src = _onedir(tmp_path)
    (tmp_path / "outside.txt").write_text("secret")
    (src / "_internal" / "leak").symlink_to("../../outside.txt")

    with pytest.raises(stage_sidecar.StageError, match="外面"):
        stage_sidecar.stage(src, tmp_path / "out" / "sidecar")


def test_refuses_the_repo_source_folder_as_destination(tmp_path):
    # 最容易打錯的路徑：少打 src-tauri/，目的地變成 repo 的 Python 專案資料夾 sidecar/，
    # 名字剛好過得了守衛。清空它等於刪掉原始碼、.venv、未提交的改動
    #（onedir 放在 repo 外面：放在 repo/sidecar/dist 裡的情況由「來源在目的地裡面」那道守衛擋）
    repo = tmp_path / "repo"
    (repo / "sidecar" / "app").mkdir(parents=True)
    (repo / "sidecar" / "app" / "main.py").write_text("code")
    (repo / "sidecar" / "pyproject.toml").write_text("")
    src = _onedir(tmp_path / "build")

    with pytest.raises(stage_sidecar.StageError, match="不是 stage 的產物"):
        stage_sidecar.stage(src, repo / "sidecar")
    assert (repo / "sidecar" / "app" / "main.py").read_text() == "code"


def test_refuses_the_source_itself_as_destination(tmp_path):
    src = tmp_path / "sidecar"
    _onedir(tmp_path).rename(src)  # 名字對、內容也像 stage 的產物：只剩「同一個」這道守衛

    with pytest.raises(stage_sidecar.StageError, match="同一個"):
        stage_sidecar.stage(src, src)
    assert (src / "starscope-sidecar").exists()


def test_refuses_a_destination_inside_the_source(tmp_path):
    # 會一路複製自己：_internal/sidecar/_internal/sidecar/… 直到路徑太長
    src = _onedir(tmp_path)

    with pytest.raises(stage_sidecar.StageError, match="裡面"):
        stage_sidecar.stage(src, src / "_internal" / "sidecar")


def test_refuses_a_destination_that_contains_the_source(tmp_path):
    dest = tmp_path / "sidecar"
    src = _onedir(dest)

    with pytest.raises(stage_sidecar.StageError, match="裡面"):
        stage_sidecar.stage(src, dest)
    assert (src / "starscope-sidecar").exists()


def test_replaces_a_previous_stage_but_not_anything_else(tmp_path):
    # 上一次 stage 的產物（執行檔＋_internal）可以清；多了別的東西就不能碰
    src = _onedir(tmp_path)
    dest = tmp_path / "out" / "sidecar"
    stage_sidecar.stage(src, dest)
    (dest / "notes.txt").write_text("someone's file")

    with pytest.raises(stage_sidecar.StageError, match="不是 stage 的產物"):
        stage_sidecar.stage(src, dest)
    assert (dest / "notes.txt").exists()


def test_ignores_finder_metadata_in_the_destination(tmp_path):
    # 本機用 Finder 開過目的地會留下 .DS_Store：不能因此拒絕重跑
    src = _onedir(tmp_path)
    dest = tmp_path / "out" / "sidecar"
    dest.mkdir(parents=True)
    (dest / ".DS_Store").write_bytes(b"\0")

    stage_sidecar.stage(src, dest)

    assert (dest / "starscope-sidecar").exists()


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
