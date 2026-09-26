"""確認要包進安裝檔的 sidecar 是目標平台的真 binary。

src-tauri/binaries/ 裡放著給開發用的 placeholder（幾十 bytes 的 shell script），檔名與正式
binary 一模一樣。打包出來的檔名若與 Tauri 的 --target 對不上，Tauri 不會報錯，而是把
placeholder 包進去——安裝檔照樣產出，裝起來 sidecar 一啟動就只印一行字。smoke test 抓不到：
它跑的是打包產物，不是 Tauri 實際取用的那個檔。

用法：python scripts/check_sidecar_binary.py <binary 路徑> <target triple>
"""

from __future__ import annotations  # 開發機的系統 python3 可能是 3.9

import io
import struct
import sys
from pathlib import Path

MIN_REAL_BINARY_BYTES = 1_000_000  # PyInstaller 產物是幾十 MB；placeholder 不到 100 bytes

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


def check(path: Path, target: str) -> str | None:
    """通過回 None，否則回失敗原因。"""
    if target not in EXPECTED:
        return f"不認得的 target：{target}"
    if not path.is_file():
        return f"找不到 {path}"
    size = path.stat().st_size
    if size < MIN_REAL_BINARY_BYTES:
        return f"{path} 只有 {size} bytes，是 placeholder 而不是打包出來的 sidecar"
    with path.open("rb") as f:
        header = f.read(4096)
    actual = identify(header)
    if actual != EXPECTED[target]:
        return f"{path} 是 {actual[0]} {actual[1]}，但 {target} 需要 {EXPECTED[target][0]} {EXPECTED[target][1]}"
    return None


if __name__ == "__main__":
    # Windows runner 的主控台是 cp1252：印 ✅／❌ 與中文時 stdout 丟 UnicodeEncodeError、
    # stderr 變成 \uXXXX。統一改用 UTF-8
    for stream in (sys.stdout, sys.stderr):
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(encoding="utf-8")
    if len(sys.argv) != 3:
        sys.exit(f"用法: {sys.argv[0]} <binary 路徑> <target triple>")
    problem = check(Path(sys.argv[1]), sys.argv[2])
    if problem:
        sys.exit(f"❌ {problem}")
    print(f"✅ {sys.argv[1]} 是 {sys.argv[2]} 的真 binary")
