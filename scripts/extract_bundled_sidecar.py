"""從安裝檔取出 Tauri 實際打包的 sidecar，印出執行檔路徑，給 smoke test 用。

setup-sidecar 的 smoke test 跑的是 PyInstaller 的產物；這裡跑的是安裝檔裡的那一份，證明
使用者實際裝到的能跑（Windows、Linux 沒辦法手動測）：
- macOS：.app/Contents/Resources/sidecar/
- Linux：dpkg-deb -x 解開 .deb；第三個參數給 appimage 則用 --appimage-extract 解開 .AppImage
  （不需要 FUSE）。AppImage 另外驗是因為 linuxdeploy 會改寫 usr/lib 裡的 ELF（rpath、strip），
  PyInstaller 執行檔尾端接著封存檔，改壞了 .deb 照樣正常
- Windows：msiexec /a（管理安裝：只解開檔案，不註冊、不需要解除安裝）解開 .msi

取出的位置刻意含空白（Windows 的 C:\\Program Files 就有），名字則避開系統資料夾。Unix 上再把整份設成唯讀：
沒搬進「應用程式」就打開的 macOS app 會被 App Translocation 放到唯讀位置執行。

用法：python scripts/extract_bundled_sidecar.py <bundle 目錄> <輸出目錄> [deb|appimage]
"""

from __future__ import annotations

import io
import shutil
import stat
import subprocess
import sys
from pathlib import Path

EXECUTABLE = "starscope-sidecar"
# 含空白，但不能跟系統資料夾同名：out 給成磁碟根目錄時，"Program Files" 會是真的 C:\Program Files
INSTALL_DIR_NAME = "StarScope Program Files"


class ExtractError(Exception):
    pass


def find_sidecar(root: Path, exe_name: str) -> Path:
    """root 底下唯一一個 sidecar/<exe_name>。找不到或不只一份都是錯。"""
    matches = sorted(p for p in root.rglob(exe_name) if p.is_file() and p.parent.name == "sidecar")
    if not matches:
        raise ExtractError(f"{root} 裡找不到 sidecar/{exe_name}")
    if len(matches) > 1:
        raise ExtractError(f"{root} 裡有不只一份 sidecar：" + "、".join(str(p) for p in matches))
    return matches[0]


def _single(bundle: Path, pattern: str) -> Path:
    found = sorted(bundle.glob(pattern))
    if len(found) != 1:
        raise ExtractError(f"{bundle} 裡的 {pattern} 應該剛好一個，實際 {len(found)} 個")
    return found[0]


def _set_writable(folder: Path, writable: bool) -> None:
    # 不跟著 symlink 走：chmod 會改到它指向的東西（可能在 folder 外面），懸空的還會炸
    for path in [folder, *folder.rglob("*")]:
        if path.is_symlink():
            continue
        mode = path.stat().st_mode
        path.chmod(mode | stat.S_IWUSR if writable else mode & ~(stat.S_IWUSR | stat.S_IWGRP | stat.S_IWOTH))


def extract(bundle: Path, out: Path, platform: str = sys.platform, kind: str | None = None) -> Path:
    bundle = bundle.resolve()
    out = out.resolve()
    if kind is not None and not platform.startswith("linux"):
        raise ExtractError(f"只有 Linux 需要指定安裝檔種類：{kind}")
    if bundle.is_relative_to(out):
        raise ExtractError(f"安裝檔 {bundle} 在輸出目錄 {out} 裡面（參數對調了？）")
    # 只刪自己建立的那個資料夾，out 裡別的東西不動：out 給錯（例如變數是空的變成 "."）時不能全刪
    install = out / INSTALL_DIR_NAME
    if install.exists():
        _set_writable(install, True)  # 上一次留下的唯讀副本
        shutil.rmtree(install)
    install.mkdir(parents=True)

    exe_name = EXECUTABLE + (".exe" if platform == "win32" else "")
    if platform == "darwin":
        app = _single(bundle, "macos/*.app")
        source = find_sidecar(app / "Contents" / "Resources", exe_name).parent
        shutil.copytree(source, install / "sidecar")
    elif platform.startswith("linux"):
        kind = kind or "deb"
        if kind == "deb":
            deb = _single(bundle, "deb/*.deb")
            subprocess.run(["dpkg-deb", "-x", str(deb), str(install)], check=True, stdout=subprocess.DEVNULL)
        elif kind == "appimage":
            image = _single(bundle, "appimage/*.AppImage")
            image.chmod(image.stat().st_mode | stat.S_IXUSR)
            # 解到 cwd 底下的 squashfs-root。它會把解出來的每個檔案逐行印到 stdout，而 CI 用 $(...) 接
            # 這支腳本的 stdout：解開工具的輸出一律丟掉，stdout 只留最後那一行路徑
            subprocess.run([str(image), "--appimage-extract"], cwd=install, check=True, stdout=subprocess.DEVNULL)
        else:
            raise ExtractError(f"Linux 的安裝檔種類只認得 deb 或 appimage：{kind}")
    elif platform == "win32":
        msi = _single(bundle, "msi/*.msi")
        # 字串直接交給 CreateProcess：TARGETDIR 的值含空白，要用 msiexec 認得的 PROP="value" 形式
        subprocess.run(f'msiexec /a "{msi}" /qn TARGETDIR="{install}"', check=True, stdout=subprocess.DEVNULL)
    else:
        raise ExtractError(f"不支援的平台：{platform}")

    exe = find_sidecar(install, exe_name)
    if platform != "win32":
        _set_writable(exe.parent, False)
    return exe


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(encoding="utf-8")
    if len(sys.argv) not in (3, 4):
        sys.exit(f"用法: {sys.argv[0]} <bundle 目錄> <輸出目錄> [deb|appimage]")
    try:
        kind = sys.argv[3] if len(sys.argv) == 4 else None
        print(extract(Path(sys.argv[1]), Path(sys.argv[2]), kind=kind).as_posix())
    except (ExtractError, subprocess.CalledProcessError) as e:
        sys.exit(f"❌ {e}")
