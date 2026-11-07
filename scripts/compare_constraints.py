"""比對兩份 constraints（pip freeze 格式），列出版本變低或不見的套件（update-constraints.sh 寫入前呼叫）。

constraints.txt 是開發機 venv 的 freeze。Dependabot 的 pip PR 合併後，venv 沒跟著裝新版的話，下次跑腳本會用舊的
freeze 蓋掉 constraints，把剛合進來的版本悄悄改回去；只動開發工具（不在 packaging.lock）的 PR 連測試都不會紅。
真的要降版或拿掉套件時，腳本另有旗標放行。

用法：python scripts/compare_constraints.py <現有的 constraints.txt> <新的 freeze>（有退步或比對不了的行時結束碼 1）
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from packaging.utils import canonicalize_name
from packaging.version import InvalidVersion, Version


def _read(path: Path) -> tuple[dict[str, tuple[str, Version]], dict[str, str]]:
    """(正規化後的套件名 → (原本寫的名字, 版本), 正規化後的套件名 → 比對不了的行)。

    比對不了的是沒有 `==` 的行（從本機 wheel 或 URL 裝的套件，freeze 寫成 `名稱 @ 位置`）與版本號不合 PEP 440 的行。
    """
    pins: dict[str, tuple[str, Version]] = {}
    unparsable: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.split("#")[0].strip()
        if not line:
            continue
        name, separator, version = line.partition("==")
        try:
            if not separator:
                raise InvalidVersion(line)
            pins[canonicalize_name(name)] = (name.strip(), Version(version.strip()))
        except InvalidVersion:
            unparsable[canonicalize_name(re.split(r"[\s@;\[<>=!~]", line, maxsplit=1)[0])] = line
    return pins, unparsable


def regressions(old: Path, new: Path) -> list[str]:
    """比對不了的行，加上 old 有、new 版本較低或沒有的套件（依名稱排序）。"""
    before, before_unparsable = _read(old)
    after, after_unparsable = _read(new)
    problems = [f"無法比對的行：{line}" for line in [*before_unparsable.values(), *after_unparsable.values()]]
    for key, (name, version) in sorted(before.items()):
        if key in after_unparsable:
            continue
        if key not in after:
            problems.append(f"{name}：{version} → （沒了）")
        elif after[key][1] < version:
            problems.append(f"{name}：{version} → {after[key][1]}")
    return problems


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 2:
        print(f"用法：{Path(sys.argv[0]).name} <現有的 constraints.txt> <新的 freeze>", file=sys.stderr)
        return 2
    problems = regressions(Path(args[0]), Path(args[1]))
    if problems:
        print("venv 的 freeze 跟 constraints.txt 比，有這些退步或比對不了的地方：", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
