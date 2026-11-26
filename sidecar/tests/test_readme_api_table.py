"""README 的 API 端點表要跟 routers/ 對得上。

每個有 `router` 的路由模組都要有一列、前綴一致，表上也不能有不存在的模組或重複的列；漏列的模組讀者找不到、寫錯前綴會照著打錯的路徑。
前綴直接讀 import 之後的 `router.prefix`（main.py 註冊的就是它，不在 include_router 另加前綴）。說明文字沒辦法自動驗，改端點時要一併看那一列。
"""

import importlib
import re
from pathlib import Path

from fastapi import APIRouter

SIDECAR = Path(__file__).resolve().parents[1]
README = SIDECAR.parent / "README.md"
HEADING = "## 🔌 API 端點"


def _table_rows() -> list[tuple[str, str]]:
    text = README.read_text(encoding="utf-8")
    assert HEADING in text, f"README 找不到「{HEADING}」那一節"
    section = text.split(HEADING, 1)[1].split("\n## ", 1)[0]
    return re.findall(r"^\|\s*`([a-z_]+)`\s*\|\s*`([^`]+)`\s*\|", section, re.MULTILINE)


def _router_prefixes() -> dict[str, str]:
    prefixes = {}
    for path in sorted((SIDECAR / "routers").glob("*.py")):
        if path.stem == "__init__":
            continue
        router = getattr(importlib.import_module(f"routers.{path.stem}"), "router", None)
        if isinstance(router, APIRouter):
            prefixes[path.stem] = router.prefix
    return prefixes


def test_the_table_lists_every_router_module_with_its_prefix():
    routers = _router_prefixes()
    assert len(routers) >= 18  # 讀不到路由模組時不能因為兩邊都是空的而通過
    rows = _table_rows()
    assert len(rows) == len(dict(rows)), "表上有重複的模組"
    assert dict(rows) == routers
