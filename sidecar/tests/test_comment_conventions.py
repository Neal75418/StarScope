"""註解不寫變更史與審查流程（CLAUDE.md「註解與日誌慣例」）。

掃前端、後端與 Rust 的原始碼，出現下面這些句式就紅，並列出位置。這是絆線，不是語意分析：
只收常見的幾種寫法，同一類的別種說法（含英文、跨行的）抓不到；反過來，少數講現況的句子
也會被抓（例如「覆蓋先前寫入的快照」），遇到時換個說法即可。「它原本的名字」「先前的焦點」
這類不在清單內。逐行比對、不要求同一行有註解符號：區塊註解與 docstring 的接續行沒有符號。
只掃 SOURCE_DIRS 底下、SUFFIXES 列的副檔名：設定檔（含 sidecar 底下的 .ini、.toml 與 PyInstaller 的 .spec）、
根目錄的 scripts/ 與設定檔（vite.config.ts 等）、workflow 都不在掃描範圍內。
"""

import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SOURCE_DIRS = ("sidecar", "src", "src-tauri/src")
SUFFIXES = {".py", ".ts", ".tsx", ".rs", ".css"}
# 測試、模板產物（alembic）與測試基建（src/test）不在慣例範圍內
EXCLUDED_DIRS = {"tests", "__tests__", "alembic", "test", ".venv", "node_modules", "target", "__pycache__"}
# 翻譯檔是給使用者看的文案，不是註解
EXCLUDED_FILES = {"src/i18n/translations.ts"}

HISTORY_PHRASES = re.compile(
    "原本(是|用|這裡|會|只|的寫法|都|兩種|跟|的折線|讀的|改用)"
    "|取代了?原本"
    "|先前(只|寫|回|這裡|漏|是|用|後端)"
    "|舊寫法|這次改版|曾刻意|曾經(是|空)"
    "|重審抓到|審查(發現|抓到)|第三方審查"
)

# 清單裡的每個用語各一句
NARRATION_EXAMPLES = (
    "# 原本是無條件套用成功色",
    "# 原本用 localStorage 存這個值",
    "# 原本這裡直接回傳空陣列",
    "# 原本會在每次渲染時重算",
    "# 原本只看 isError",
    "# 原本的寫法會漏掉最後一頁",
    "# 原本都放在同一個 effect 裡",
    "# 原本兩種狀態共用一個旗標",
    "# 原本跟主程式共用同一條連線",
    "# 原本的折線換成長條",
    "# 原本讀的是另一個欄位",
    "# 原本改用批次寫入的那段搬到這裡",
    "# 用單一查詢取代原本的迴圈",
    "# 取代了原本的輪詢",
    "# 先前只檢查狀態碼",
    "# 先前寫成固定 3 秒",
    "# 先前回的是 200 加空陣列",
    "# 先前這裡沒有上限",
    "# 先前漏了 unique 約束",
    "# 先前是同步呼叫",
    "# 先前用 setInterval",
    "# 先前後端不帶這個欄位",
    "# 舊寫法會重複送出",
    "# 這次改版把它搬到 Context",
    "# 曾刻意不做快取",
    "# 曾經是必填欄位",
    "# 曾經空了一整天",
    "# 重審抓到漏了逾時的情況",
    "# 審查發現這裡會吞掉例外",
    "# 審查抓到少了一個分支",
    "# 第三方審查建議加上上限",
)


def _source_files() -> list[Path]:
    files: list[Path] = []
    for directory in SOURCE_DIRS:
        for path in (REPO / directory).rglob("*"):
            relative = path.relative_to(REPO)
            if (
                path.suffix in SUFFIXES
                and not EXCLUDED_DIRS.intersection(relative.parts)
                and relative.as_posix() not in EXCLUDED_FILES
            ):
                files.append(path)
    return sorted(files)


def _offending_lines(text: str) -> list[tuple[int, str]]:
    return [
        (number, line.strip())
        for number, line in enumerate(text.splitlines(), start=1)
        if HISTORY_PHRASES.search(line)
    ]


def test_the_scan_reaches_every_kind_of_source_file():
    """路徑、副檔名或排除名單寫錯時會少掃一整類檔案，下面那條就空過了：每一類各點名一個。"""
    scanned = {path.relative_to(REPO).as_posix() for path in _source_files()}

    assert {
        "sidecar/main.py",
        "src/App.css",
        "src/components/ConfirmDialog.tsx",
        "src/i18n/index.ts",
        "src/utils/format.ts",
        "src-tauri/src/lib.rs",
    } <= scanned
    assert "src/i18n/translations.ts" not in scanned
    assert not [name for name in scanned if "/tests/" in name or "/__tests__/" in name or "/alembic/" in name]


def test_comments_do_not_narrate_how_the_code_got_here():
    offenders = [
        f"{path.relative_to(REPO)}:{number}: {line}"
        for path in _source_files()
        for number, line in _offending_lines(path.read_text(encoding="utf-8"))
    ]
    assert not offenders, "註解寫的是變更史或審查流程，改成現在式的約束句：\n" + "\n".join(offenders)


def test_every_listed_phrase_is_caught():
    """變更史與審查流程兩類用語都要守住：清單少了哪一個，對應的例句就不再被抓。"""
    missed = [line for line in NARRATION_EXAMPLES if not _offending_lines(line)]

    assert not missed


def test_the_phrases_cover_block_comment_continuation_lines():
    """區塊註解中間的行整行都沒有註解符號：比對時要求符號的話，這種行會被漏掉。"""
    block = "/* 排序由值決定。\n   原本是無條件套用成功色，\n   所以負數也是綠的 */"

    assert _offending_lines(block) == [(2, "原本是無條件套用成功色，")]


def test_present_tense_uses_of_the_same_words_are_left_alone():
    """講現況的常見用法不在清單內。"""
    text = "\n".join([
        "# 改名之後，它原本的名字可能被別的 repo 拿去用",
        "# 還原先前的焦點元素",
        "# 給曾經打開過這個選單的人",
        "# 在此之前呼叫會撞 no such table",
    ])

    assert _offending_lines(text) == []
