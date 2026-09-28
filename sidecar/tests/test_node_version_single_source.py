"""Node 版本只寫在 repo 根目錄的 .nvmrc：CI 每個 setup-node 都讀它、README 寫的版本也要等於它。

CI 曾經寫死 Node 20，本機是 24；20 在 2026-04 停止維護後，vitest 5、jest-dom 7 等新版套件宣告
要 22 以上，CI 卻還在舊版上跑。版本號多寫一份，就多一個會漂走的地方
（同樣的理由見 test_python_version_single_source.py）。
"""

import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
VERSION = (REPO / ".nvmrc").read_text(encoding="utf-8").strip()


def _setup_node_blocks(path: Path) -> list[str]:
    """每個 `uses: actions/setup-node` 之後、下一個步驟（`- name:`／`- uses:`）之前的文字。"""
    text = path.read_text(encoding="utf-8")
    starts = [m.end() for m in re.finditer(r"uses: actions/setup-node@[^\n]*\n", text)]
    blocks = []
    for start in starts:
        nxt = re.search(r"\n\s*- (?:name|uses):", text[start:])
        blocks.append(text[start : start + nxt.start()] if nxt else text[start:])
    return blocks


def test_the_version_file_holds_one_major_version():
    assert re.fullmatch(r"\d+", VERSION)


def test_every_ci_setup_node_reads_the_version_file():
    # 掃整個 .github：新加的 workflow 也不能寫死版本
    files = sorted((REPO / ".github").rglob("*.y*ml"))
    blocks = [b for p in files for b in _setup_node_blocks(p)]
    assert len(blocks) == 3  # test.yml 的 frontend、e2e，加上 release.yml
    for block in blocks:
        assert re.search(r"^\s*node-version-file:\s*['\"]?\.nvmrc['\"]?\s*$", block, re.MULTILINE), block
        assert not re.search(r"^\s*node-version:", block, re.MULTILINE), block


def test_the_readme_quotes_the_same_version():
    readme = (REPO / "README.md").read_text(encoding="utf-8")
    assert f"| Node.js | {VERSION}（以 `.nvmrc` 為準）" in readme
