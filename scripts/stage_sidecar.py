"""把 PyInstaller 的 onedir 放進 Tauri 打包的 resources 資料夾。

Tauri 打包 resources 時對 symlink 的處理不在文件裡：實測指向檔案的會換成檔案本身，指向資料夾的
會被默默丟掉。這裡自己先攤平，打包的輸入就固定，不依賴 Tauri 的版本：
- 指向檔案：換成檔案本身
- 指向資料夾、目標在同一棵樹裡：拿掉（只是別名，內容透過真實路徑還在；macOS 的
  Python.framework 有兩個這種 symlink，實測拿掉後照樣能跑）
- 懸空的、指向樹外面的：失敗，不猜

目的地會先清空（repo 裡的 src-tauri/sidecar/ 只有 README）。路徑打錯時不能把別的資料夾整個
刪掉——repo 的 Python 專案資料夾也叫 sidecar，少打 src-tauri/ 就會指到它——所以除了名字要是
sidecar，裡面也只能是空的、只有 README、或上一次 stage 的產物；來源與目的地不能互相包含。

用法：python scripts/stage_sidecar.py <onedir 資料夾> <目的地>
"""

from __future__ import annotations  # 開發機的系統 python3 可能是 3.9

import io
import os
import shutil
import sys
from pathlib import Path

DEST_NAME = "sidecar"
EXECUTABLE = "starscope-sidecar"


class StageError(Exception):
    pass


def _is_previous_stage(dest: Path) -> bool:
    """目的地裡的是上一次 stage 的產物（執行檔＋_internal），還是別的東西。"""
    # 空的、repo 的 README、Finder 的 .DS_Store、上一次的產物（含中斷留下的一半）都可以清；
    # 多了別的東西就不能碰
    names = {p.name for p in dest.iterdir()}
    return names <= {"README.md", ".DS_Store", EXECUTABLE, f"{EXECUTABLE}.exe", "_internal"}


def stage(src: Path, dest: Path) -> None:
    src = src.resolve()
    dest = dest.resolve()
    if not src.is_dir():
        raise StageError(f"找不到 onedir 資料夾：{src}")
    if dest.name != DEST_NAME:
        raise StageError(f"目的地必須是名為 {DEST_NAME} 的資料夾（會先清空）：{dest}")
    if dest == src:
        raise StageError(f"來源與目的地是同一個資料夾：{src}")
    if dest.is_relative_to(src):
        raise StageError(f"目的地 {dest} 在來源 {src} 裡面")
    if src.is_relative_to(dest):
        raise StageError(f"來源 {src} 在目的地 {dest} 裡面")
    if dest.exists() and not _is_previous_stage(dest):
        raise StageError(f"{dest} 裡有不是 stage 的產物的東西，不清空：{sorted(p.name for p in dest.iterdir())}")

    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)

    # followlinks=False：指向資料夾的 symlink 出現在 dirs 裡，但不會走進去
    for root, dirs, files in os.walk(src):
        here = Path(root)
        out = dest / here.relative_to(src)
        out.mkdir(exist_ok=True)
        for name in [*dirs, *files]:
            path = here / name
            if path.is_symlink():
                target = path.resolve()
                if not target.exists():
                    raise StageError(f"{path} 指向不存在的 {target}")
                if not target.is_relative_to(src):
                    raise StageError(f"{path} 指向 onedir 外面的 {target}")
                if target.is_file():
                    shutil.copy2(target, out / name)
                # 指向資料夾：別名，不複製
            elif name in files:
                shutil.copy2(path, out / name)


if __name__ == "__main__":
    # Windows runner 的主控台是 cp1252：印 ✅／❌ 與中文會丟 UnicodeEncodeError（同 check_sidecar_binary.py）
    for stream in (sys.stdout, sys.stderr):
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(encoding="utf-8")
    if len(sys.argv) != 3:
        sys.exit(f"用法: {sys.argv[0]} <onedir 資料夾> <目的地>")
    try:
        stage(Path(sys.argv[1]), Path(sys.argv[2]))
    except StageError as e:
        sys.exit(f"❌ {e}")
    print(f"✅ 已把 {sys.argv[1]} 放進 {sys.argv[2]}")
