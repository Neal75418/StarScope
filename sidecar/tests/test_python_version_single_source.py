"""Python 版本只寫在 repo 根目錄的 .python-version：CI 每個 setup-python 都讀它、mypy 跟著執行它的
直譯器、文件裡寫到的版本號都要等於它、本機 venv 也要是它。

以前 CI 寫 3.12、本機 venv 是 3.13，constraints.txt 從本機產生，CI 卻用另一個版本去裝；
本機全綠的東西到 CI 才第一次在別的版本上跑。版本號多寫一份，就多一個會漂走的地方。

不用 PyYAML 解析（它不在 requirements 裡）：setup-python 的 with 區塊結構固定，用文字切就夠。
"""

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
VERSION = (REPO / ".python-version").read_text(encoding="utf-8").strip()


def _setup_python_blocks(path: Path) -> list[str]:
    """每個 `uses: actions/setup-python` 之後、下一個步驟（`- name:`／`- uses:`）之前的文字。"""
    text = path.read_text(encoding="utf-8")
    starts = [m.end() for m in re.finditer(r"uses: actions/setup-python@[^\n]*\n", text)]
    blocks = []
    for start in starts:
        nxt = re.search(r"\n\s*- (?:name|uses):", text[start:])
        blocks.append(text[start : start + nxt.start()] if nxt else text[start:])
    return blocks


def test_the_version_file_holds_one_minor_version():
    assert re.fullmatch(r"\d+\.\d+", VERSION)


def test_every_ci_setup_python_reads_the_version_file():
    # 掃整個 .github：新加的 workflow 也不能寫死版本
    files = sorted((REPO / ".github").rglob("*.y*ml"))
    blocks = [b for p in files for b in _setup_python_blocks(p)]
    assert len(blocks) == 3  # test.yml 的 backend、e2e，加上 setup-sidecar action；release／verify 走 action
    for block in blocks:
        assert re.search(r"^\s*python-version-file:\s*['\"]?\.python-version['\"]?\s*$", block, re.MULTILINE), block
        assert not re.search(r"^\s*python-version:", block, re.MULTILINE), block


def test_mypy_follows_the_interpreter():
    # 沒設 python_version 時 mypy 用執行它的直譯器版本：本機與 CI 都自動跟 venv 走
    ini = (REPO / "sidecar" / "mypy.ini").read_text(encoding="utf-8")
    assert not re.search(r"^\s*python_version\s*=", ini, re.MULTILINE)


def test_the_docs_quote_the_same_version():
    # 文件裡的版本號沒辦法從檔案推導，只能在這裡逐處對照：升版時這條會指出還有哪裡沒改
    readme = (REPO / "README.md").read_text(encoding="utf-8")
    claude = (REPO / "CLAUDE.md").read_text(encoding="utf-8")
    assert f"badge/Python-{VERSION}-" in readme
    assert f"Python {VERSION}" in readme  # 架構圖
    assert f"| Python  | {VERSION}" in readme  # 需求表
    assert f"python{VERSION} -m venv" in readme  # 建 venv 的指令
    assert f"`.python-version`（{VERSION}）" in claude
    assert f"python{VERSION} -m venv" in claude
    assert not re.search(r"python3\.\d+ -m venv", claude.replace(f"python{VERSION} -m venv", ""))
    assert not re.search(r"python3\.\d+ -m venv", readme.replace(f"python{VERSION} -m venv", ""))
    # 裸 python3 在 macOS 是 3.9：照著做會建出缺 StrEnum 的 venv
    assert "python3 -m venv" not in claude
    assert "python3 -m venv" not in readme


def test_the_venv_running_the_tests_matches_the_file():
    # 這次問題的根因：本機 venv 是別的版本，constraints.txt 從它產生，CI 用另一版去裝
    assert f"{sys.version_info[0]}.{sys.version_info[1]}" == VERSION
