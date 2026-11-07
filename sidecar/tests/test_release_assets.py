"""scripts/release_assets.py：release 的 build job 收齊各平台的安裝檔，publish job 核對整組檔名後才上傳。"""

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "release_assets.py"
_spec = importlib.util.spec_from_file_location("release_assets", SCRIPT)
assert _spec is not None
assert _spec.loader is not None
release_assets = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(release_assets)

# v1.1.1 實際的 9 個安裝檔（gh release view v1.1.1）：使用者的下載網址就是這些名字，之後的版本只有版號不同
V1_1_1_ASSETS = {
    "StarScope-1.1.1-1.x86_64.rpm",
    "StarScope_1.1.1_aarch64.app.tar.gz",
    "StarScope_1.1.1_aarch64.dmg",
    "StarScope_1.1.1_amd64.AppImage",
    "StarScope_1.1.1_amd64.deb",
    "StarScope_1.1.1_x64-setup.exe",
    "StarScope_1.1.1_x64.app.tar.gz",
    "StarScope_1.1.1_x64.dmg",
    "StarScope_1.1.1_x64_en-US.msi",
}

needs_symlinks = pytest.mark.skipif(os.name == "nt", reason="Windows 建立 symlink 要權限")


def _write(path: Path, content: bytes = b"x") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return path


def _linux_bundle(root: Path) -> Path:
    bundle = root / "bundle"
    _write(bundle / "appimage" / "StarScope_1.1.1_amd64.AppImage")
    (bundle / "appimage" / "StarScope.AppDir" / "usr").mkdir(parents=True)  # 打包過程的資料夾，不是安裝檔
    _write(bundle / "deb" / "StarScope_1.1.1_amd64.deb")
    (bundle / "deb" / "StarScope_1.1.1_amd64" / "data").mkdir(parents=True)
    _write(bundle / "rpm" / "StarScope-1.1.1-1.x86_64.rpm")
    return bundle


def _mac_bundle(root: Path, arch: str = "aarch64") -> Path:
    bundle = root / "bundle"
    _write(bundle / "dmg" / f"StarScope_1.1.1_{arch}.dmg")
    _write(bundle / "dmg" / "bundle_dmg.sh")  # 產生 dmg 用的腳本，不是安裝檔
    app = bundle / "macos" / "StarScope.app"
    _write(app / "Contents" / "Info.plist", b"plist")
    exe = _write(app / "Contents" / "MacOS" / "starscope", b"binary")
    exe.chmod(0o755)
    return bundle


def _windows_bundle(root: Path) -> Path:
    bundle = root / "bundle"
    _write(bundle / "msi" / "StarScope_1.1.1_x64_en-US.msi")
    _write(bundle / "nsis" / "StarScope_1.1.1_x64-setup.exe")
    return bundle


def test_collects_the_linux_installers(tmp_path: Path):
    out = tmp_path / "out"

    collected = release_assets.collect(_linux_bundle(tmp_path), "x86_64-unknown-linux-gnu", out)

    names = {"StarScope_1.1.1_amd64.AppImage", "StarScope_1.1.1_amd64.deb", "StarScope-1.1.1-1.x86_64.rpm"}
    assert {p.name for p in collected} == names
    assert {p.name for p in out.iterdir()} == names


def test_collects_the_windows_installers(tmp_path: Path):
    out = tmp_path / "out"

    release_assets.collect(_windows_bundle(tmp_path), "x86_64-pc-windows-msvc", out)

    assert {p.name for p in out.iterdir()} == {"StarScope_1.1.1_x64_en-US.msi", "StarScope_1.1.1_x64-setup.exe"}


@pytest.mark.parametrize(("target", "arch"), [("aarch64-apple-darwin", "aarch64"), ("x86_64-apple-darwin", "x64")])
def test_packs_the_macos_app_next_to_the_dmg(tmp_path: Path, target: str, arch: str):
    """.app 是資料夾、不能直接上傳：打成 .app.tar.gz，名字跟 .dmg 同一個前綴。"""
    out = tmp_path / "out"

    release_assets.collect(_mac_bundle(tmp_path, arch), target, out)

    assert {p.name for p in out.iterdir()} == {f"StarScope_1.1.1_{arch}.dmg", f"StarScope_1.1.1_{arch}.app.tar.gz"}
    with tarfile.open(out / f"StarScope_1.1.1_{arch}.app.tar.gz") as archive:
        members = {m.name: m for m in archive.getmembers()}
    assert "StarScope.app/Contents/Info.plist" in members
    # 執行檔的權限要留著：解開之後要能直接執行
    assert members["StarScope.app/Contents/MacOS/starscope"].mode & 0o111


@needs_symlinks
def test_keeps_symlinks_inside_the_macos_app(tmp_path: Path):
    """.app 裡的 framework 靠 symlink 組成，變成實體檔或被丟掉的話簽章就壞了。"""
    bundle = _mac_bundle(tmp_path)
    (bundle / "macos" / "StarScope.app" / "Contents" / "Current").symlink_to("MacOS")
    out = tmp_path / "out"

    release_assets.collect(bundle, "aarch64-apple-darwin", out)

    with tarfile.open(out / "StarScope_1.1.1_aarch64.app.tar.gz") as archive:
        link = archive.getmember("StarScope.app/Contents/Current")
    assert link.issym()
    assert link.linkname == "MacOS"


def test_fails_when_an_installer_is_missing(tmp_path: Path):
    bundle = _linux_bundle(tmp_path)
    (bundle / "rpm" / "StarScope-1.1.1-1.x86_64.rpm").unlink()

    with pytest.raises(release_assets.ReleaseAssetError, match="rpm"):
        release_assets.collect(bundle, "x86_64-unknown-linux-gnu", tmp_path / "out")


def test_fails_when_there_is_more_than_one_of_a_kind(tmp_path: Path):
    """舊版本的安裝檔還留在 bundle 裡時，不能挑一個上傳。"""
    bundle = _mac_bundle(tmp_path)
    _write(bundle / "dmg" / "StarScope_1.1.0_aarch64.dmg")

    with pytest.raises(release_assets.ReleaseAssetError, match="dmg"):
        release_assets.collect(bundle, "aarch64-apple-darwin", tmp_path / "out")


def test_fails_for_an_unknown_target(tmp_path: Path):
    with pytest.raises(release_assets.ReleaseAssetError, match="riscv64"):
        release_assets.collect(_linux_bundle(tmp_path), "riscv64gc-unknown-linux-gnu", tmp_path / "out")


def _config(tmp_path: Path, version: str = "1.1.1") -> Path:
    return _write(tmp_path / "tauri.conf.json", json.dumps({"productName": "StarScope", "version": version}).encode())


def _downloaded(tmp_path: Path, per_artifact: dict[str, set[str]] | None = None) -> Path:
    """download-artifact 不合併時的樣子：每個 artifact 一個資料夾。預設是四個平台都齊。"""
    if per_artifact is None:
        per_artifact = {
            f"release-assets-{target}": names
            for target, names in release_assets.expected_assets(_config(tmp_path)).items()
        }
    folder = tmp_path / "release-assets"
    folder.mkdir()
    for artifact, names in per_artifact.items():
        (folder / artifact).mkdir()
        for name in names:
            _write(folder / artifact / name)
    return folder


def test_expects_the_same_names_as_the_v1_1_1_release(tmp_path: Path):
    expected = release_assets.expected_assets(_config(tmp_path))

    # 每個 matrix 打包的 target 都要有預期檔名，合起來就是 v1.1.1 實際的那一組
    assert set(expected) == set(release_assets.INSTALLERS)
    assert set().union(*expected.values()) == V1_1_1_ASSETS


def test_verify_accepts_the_full_set(tmp_path: Path):
    release_assets.verify(_downloaded(tmp_path), _config(tmp_path), tag="v1.1.1")


def test_verify_names_missing_and_unexpected_files_per_platform(tmp_path: Path):
    folder = _downloaded(tmp_path)
    (folder / "release-assets-x86_64-apple-darwin" / "StarScope_1.1.1_x64.dmg").unlink()
    _write(folder / "release-assets-x86_64-apple-darwin" / "StarScope_1.1.1_x64.dmg.sig")

    with pytest.raises(release_assets.ReleaseAssetError) as error:
        release_assets.verify(folder, _config(tmp_path))

    message = str(error.value)
    assert "release-assets-x86_64-apple-darwin" in message
    assert "StarScope_1.1.1_x64.dmg" in message
    assert "StarScope_1.1.1_x64.dmg.sig" in message


def test_verify_rejects_a_file_in_the_wrong_platforms_artifact(tmp_path: Path):
    """各平台的 artifact 只能裝自己平台的安裝檔：放了別的平台的檔名要擋下（上傳時兩個同名檔會搶同一個名字，先到的留下）。"""
    folder = _downloaded(tmp_path)
    _write(folder / "release-assets-x86_64-unknown-linux-gnu" / "StarScope_1.1.1_x64-setup.exe")

    with pytest.raises(release_assets.ReleaseAssetError, match="x86_64-unknown-linux-gnu"):
        release_assets.verify(folder, _config(tmp_path))


def test_verify_rejects_an_extra_artifact(tmp_path: Path):
    folder = _downloaded(tmp_path)
    (folder / "release-assets-zz").mkdir()

    with pytest.raises(release_assets.ReleaseAssetError, match="release-assets-zz"):
        release_assets.verify(folder, _config(tmp_path))


def test_verify_rejects_a_missing_artifact(tmp_path: Path):
    folder = _downloaded(tmp_path)
    shutil.rmtree(folder / "release-assets-x86_64-pc-windows-msvc")

    with pytest.raises(release_assets.ReleaseAssetError, match="release-assets-x86_64-pc-windows-msvc"):
        release_assets.verify(folder, _config(tmp_path))


def test_verify_rejects_a_folder_inside_an_artifact(tmp_path: Path):
    """上傳時 release-assets/*/* 會把資料夾也交給 gh，要到上傳才失敗、留下做到一半的 draft。"""
    folder = _downloaded(tmp_path)
    (folder / "release-assets-aarch64-apple-darwin" / "StarScope.app").mkdir()

    with pytest.raises(release_assets.ReleaseAssetError, match="StarScope.app"):
        release_assets.verify(folder, _config(tmp_path))


def test_verify_rejects_a_tag_that_does_not_match_the_version(tmp_path: Path):
    """tag 打成 v1.2.0、版號還是 1.1.1 時，release 會掛著 1.1.1 的安裝檔：要在上傳前擋下。"""
    with pytest.raises(release_assets.ReleaseAssetError, match="v1.2.0"):
        release_assets.verify(_downloaded(tmp_path), _config(tmp_path), tag="v1.2.0")


def test_verify_reports_a_missing_folder(tmp_path: Path):
    with pytest.raises(release_assets.ReleaseAssetError, match="不是資料夾"):
        release_assets.verify(tmp_path / "nowhere", _config(tmp_path))


def test_cli_reports_errors_readably_on_a_cp1252_console(tmp_path: Path):
    """Windows runner 的主控台是 cp1252：錯誤訊息不能變成 \\uXXXX，也不能是 traceback。"""
    folder = _downloaded(tmp_path, {})
    env = {**os.environ, "PYTHONIOENCODING": "cp1252"}
    env.pop("PYTHONUTF8", None)

    result = subprocess.run(
        [sys.executable, str(SCRIPT), "verify", str(folder), str(_config(tmp_path))],
        capture_output=True, text=True, encoding="utf-8", env=env, timeout=30,
    )

    assert result.returncode == 1
    assert "錯誤" in result.stderr
    assert "release-assets-x86_64-apple-darwin" in result.stderr
    assert "Traceback" not in result.stderr
