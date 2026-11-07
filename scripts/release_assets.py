"""收齊與核對 GitHub Release 要上傳的安裝檔（release.yml 用）。

release.yml 的 build job 只有讀取權限：在每個平台用 collect 收齊安裝檔、上傳成 workflow artifact
（名字是 release-assets-<target>）。有寫入權限的只有 publish job：下載四個平台的 artifact，
用 verify 核對過才建立 release。
這樣 npm 與 cargo 的建置腳本、PyInstaller 和它們的依賴都碰不到能改寫 release 的 token。

- collect：從 bundle 目錄挑出這個平台的安裝檔，每一種都要剛好一個，否則失敗。macOS 另把 .app 打成
  .app.tar.gz（.app 是資料夾、不能直接上傳）：名字是 .dmg 的前綴加 .app.tar.gz、用系統的 tar 打包，
  跟已發佈的 release 一致，下載連結看的就是這些名字。
- verify：逐個 artifact 核對。artifact 要剛好是 matrix 的那幾個，每個裡面只能有自己平台該有的檔名：
  檔名是使用者的下載網址，變了要是刻意的；多塞一個 artifact、或在自己的 artifact 放別的平台的檔名也會擋下。
  擋不住的：拿到 runtime token 的 build 可以用同名 artifact 整個換掉別的平台的，所以任何一個 build 被攻陷，
  這一版就不可信。給了 tag 時一併確認它就是 v＋版號。

用法：
  python scripts/release_assets.py collect <bundle 目錄> <target triple> <輸出目錄>
  python scripts/release_assets.py verify <download-artifact 的資料夾> <tauri.conf.json> [--tag vX.Y.Z]
"""

from __future__ import annotations

import argparse
import io
import json
import shutil
import subprocess
import sys
from pathlib import Path

# release.yml 的 matrix 打包的 target → 這個平台的安裝檔：(bundle 底下的資料夾, 檔名結尾)。
# 對應 tauri.conf.json 的 bundle.targets = "all" 在各平台產出的格式；matrix 加了 target 要一起加，verify 的檔名也是
_MACOS = [("dmg", ".dmg")]
INSTALLERS = {
    "aarch64-apple-darwin": _MACOS,
    "x86_64-apple-darwin": _MACOS,
    "x86_64-pc-windows-msvc": [("msi", ".msi"), ("nsis", "-setup.exe")],
    "x86_64-unknown-linux-gnu": [("appimage", ".AppImage"), ("deb", ".deb"), ("rpm", ".rpm")],
}


# release.yml 上傳的 artifact 名字是這個前綴加 target
ARTIFACT_PREFIX = "release-assets-"


class ReleaseAssetError(Exception):
    pass


def _installers_for(target: str) -> list[tuple[str, str]]:
    if target not in INSTALLERS:
        raise ReleaseAssetError(f"不認得的 target：{target}（認得的：{', '.join(INSTALLERS)}）")
    return INSTALLERS[target]


def _only_one(folder: Path, ending: str) -> Path:
    """folder 裡唯一一個以 ending 結尾的項目。沒有或不只一個都是錯。"""
    matches = sorted(folder.glob(f"*{ending}"))
    if len(matches) != 1:
        found = ", ".join(p.name for p in matches) or "沒有"
        raise ReleaseAssetError(f"{folder} 裡的 *{ending} 要剛好一個，找到：{found}")
    return matches[0]


def collect(bundle: Path, target: str, out: Path) -> list[Path]:
    """把 bundle 目錄裡這個平台的安裝檔放進 out，回傳放進去的檔案。"""
    out.mkdir(parents=True, exist_ok=True)
    collected = []
    for folder, ending in _installers_for(target):
        installer = _only_one(bundle / folder, ending)
        collected.append(Path(shutil.copy2(installer, out / installer.name)))
        if ending == ".dmg":
            app = _only_one(bundle / "macos", ".app")
            archive = out / f"{installer.name.removesuffix('.dmg')}.app.tar.gz"
            # 用系統的 tar：symlink 與權限原樣保留，.app 的簽章解開後才驗得過
            subprocess.run(["tar", "czf", str(archive), "-C", str(app.parent), app.name], check=True)
            collected.append(archive)
    return collected


def expected_assets(config: Path) -> dict[str, set[str]]:
    """這個版本各 target 該有的安裝檔名，由 tauri.conf.json 的 productName 與 version 推出來。"""
    conf = json.loads(config.read_text(encoding="utf-8"))
    name, version = conf["productName"], conf["version"]
    return {
        "aarch64-apple-darwin": {f"{name}_{version}_aarch64.dmg", f"{name}_{version}_aarch64.app.tar.gz"},
        "x86_64-apple-darwin": {f"{name}_{version}_x64.dmg", f"{name}_{version}_x64.app.tar.gz"},
        "x86_64-pc-windows-msvc": {f"{name}_{version}_x64_en-US.msi", f"{name}_{version}_x64-setup.exe"},
        "x86_64-unknown-linux-gnu": {
            f"{name}_{version}_amd64.AppImage",
            f"{name}_{version}_amd64.deb",
            f"{name}-{version}-1.x86_64.rpm",
        },
    }


def _differences(where: str, expected: set[str], actual: set[str]) -> list[str]:
    problems = []
    if missing := sorted(expected - actual):
        problems.append(f"{where} 少了：{', '.join(missing)}")
    if unexpected := sorted(actual - expected):
        problems.append(f"{where} 多了：{', '.join(unexpected)}")
    return problems


def verify(folder: Path, config: Path, tag: str | None = None) -> None:
    """folder 是 download-artifact 不合併的結果：每個 artifact 一個資料夾，各自剛好是該平台的安裝檔。

    資料夾也算進去：上傳時 release-assets/*/* 會把它們交給 gh，要到上傳那一刻才失敗。
    """
    version = json.loads(config.read_text(encoding="utf-8"))["version"]
    if tag is not None and tag != f"v{version}":
        raise ReleaseAssetError(f"tag {tag} 跟版號 {version} 對不上（應該是 v{version}）")
    if not folder.is_dir():
        raise ReleaseAssetError(f"{folder} 不是資料夾（artifact 沒下載到？）")
    expected = {ARTIFACT_PREFIX + target: names for target, names in expected_assets(config).items()}
    present = {p.name for p in folder.iterdir()}
    problems = _differences(str(folder), set(expected), present)
    for artifact in sorted(set(expected) & present):
        problems += _differences(artifact, expected[artifact], {p.name for p in (folder / artifact).iterdir()})
    if problems:
        raise ReleaseAssetError("；".join(problems))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="收齊與核對 GitHub Release 要上傳的安裝檔")
    commands = parser.add_subparsers(dest="command", required=True)
    collect_cmd = commands.add_parser("collect")
    collect_cmd.add_argument("bundle", type=Path)
    collect_cmd.add_argument("target")
    collect_cmd.add_argument("out", type=Path)
    verify_cmd = commands.add_parser("verify")
    verify_cmd.add_argument("folder", type=Path)
    verify_cmd.add_argument("config", type=Path)
    verify_cmd.add_argument("--tag")
    args = parser.parse_args(argv)

    try:
        if args.command == "collect":
            for path in collect(args.bundle, args.target, args.out):
                print(path.name)
        else:
            verify(args.folder, args.config, args.tag)
            print("release 的安裝檔齊全")
    except ReleaseAssetError as e:
        print(f"錯誤：{e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    # Windows runner 的主控台是 cp1252：中文的錯誤訊息會變成 \uXXXX。統一改用 UTF-8
    for stream in (sys.stdout, sys.stderr):
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(encoding="utf-8")
    sys.exit(main())
