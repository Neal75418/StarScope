"""確認要包進安裝檔的 sidecar 資料夾是目標平台的完整 onedir。

PyInstaller 只產出執行中架構的 binary：Intel 版在 arm64 runner 上打包，架構就是錯的，
而 Tauri 照樣產出安裝檔。資料夾不完整（忘了 stage、只剩 repo 的 README、少了 _internal）
或留著 symlink（Tauri 會把指向資料夾的默默丟掉）時也一樣。smoke test 跑的是
PyInstaller 的產物，不是 Tauri 實際取用的那一份，所以這裡另外檢查。

用法：python scripts/check_sidecar_binary.py <sidecar 資料夾> <target triple>
"""

from __future__ import annotations  # 開發機的系統 python3 可能是 3.9

import io
import struct
import sys
from pathlib import Path

EXECUTABLE = "starscope-sidecar"

# target triple → (格式, 架構)
EXPECTED = {
    "x86_64-apple-darwin": ("Mach-O", "x86_64"),
    "aarch64-apple-darwin": ("Mach-O", "arm64"),
    "x86_64-unknown-linux-gnu": ("ELF", "x86_64"),
    "x86_64-pc-windows-msvc": ("PE", "x86_64"),
}

_MACHO_CPU = {0x01000007: "x86_64", 0x0100000C: "arm64"}
_ELF_MACHINE = {0x3E: "x86_64", 0xB7: "arm64"}
_PE_MACHINE = {0x8664: "x86_64", 0xAA64: "arm64"}


def identify(data: bytes) -> tuple[str, str]:
    """從檔頭判斷 (格式, 架構)；認不出來回 ("unknown", "unknown")。"""
    if data[:4] == b"\xcf\xfa\xed\xfe":  # 64-bit Mach-O，little endian
        (cpu,) = struct.unpack_from("<I", data, 4)
        return "Mach-O", _MACHO_CPU.get(cpu, f"cpu 0x{cpu:x}")
    if data[:4] == b"\xca\xfe\xba\xbe":
        return "Mach-O", "universal"
    if data[:4] == b"\x7fELF":
        (machine,) = struct.unpack_from("<H", data, 18)
        return "ELF", _ELF_MACHINE.get(machine, f"machine 0x{machine:x}")
    if data[:2] == b"MZ" and len(data) >= 0x40:
        (pe_offset,) = struct.unpack_from("<I", data, 0x3C)
        if data[pe_offset:pe_offset + 4] == b"PE\0\0":
            (machine,) = struct.unpack_from("<H", data, pe_offset + 4)
            return "PE", _PE_MACHINE.get(machine, f"machine 0x{machine:x}")
    return "unknown", "unknown"


def check(folder: Path, target: str) -> str | None:
    """通過回 None，否則回失敗原因。"""
    if target not in EXPECTED:
        return f"不認得的 target：{target}"
    if not folder.is_dir():
        return f"找不到 sidecar 資料夾：{folder}"
    exe = folder / (EXECUTABLE + (".exe" if EXPECTED[target][0] == "PE" else ""))
    if not exe.is_file():
        return f"{folder} 裡沒有 {exe.name}（忘了用 scripts/stage_sidecar.py 放進來？）"
    with exe.open("rb") as f:
        header = f.read(4096)
    actual = identify(header)
    if actual != EXPECTED[target]:
        return f"{exe} 是 {actual[0]} {actual[1]}，但 {target} 需要 {EXPECTED[target][0]} {EXPECTED[target][1]}"
    if not (folder / "_internal").is_dir():
        return f"{folder} 裡沒有 _internal/：不是完整的 onedir"
    links = [p for p in folder.rglob("*") if p.is_symlink()]
    if links:
        return f"{folder} 裡還有 symlink（Tauri 會默默丟掉指向資料夾的）：{links[0]}"
    return None


if __name__ == "__main__":
    # Windows runner 的主控台是 cp1252：印 ✅／❌ 與中文時 stdout 丟 UnicodeEncodeError、
    # stderr 變成 \uXXXX。統一改用 UTF-8
    for stream in (sys.stdout, sys.stderr):
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(encoding="utf-8")
    if len(sys.argv) != 3:
        sys.exit(f"用法: {sys.argv[0]} <sidecar 資料夾> <target triple>")
    problem = check(Path(sys.argv[1]), sys.argv[2])
    if problem:
        sys.exit(f"❌ {problem}")
    print(f"✅ {sys.argv[1]} 是 {sys.argv[2]} 的完整 sidecar")
