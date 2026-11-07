"""scripts/compare_constraints.py：update-constraints.sh 寫入前，新的 freeze 不能把版本改低或把套件弄丟。

constraints.txt 是開發機 venv 的 freeze。Dependabot 的 pip PR 合併後，venv 沒跟著裝新版的話，下次跑腳本會用舊的 freeze
蓋掉 constraints，把剛合進來的版本悄悄改回去——只動開發工具（不在 packaging.lock）的 PR 連測試都不會紅。
"""

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "compare_constraints.py"
_spec = importlib.util.spec_from_file_location("compare_constraints", SCRIPT)
assert _spec is not None
assert _spec.loader is not None
compare_constraints = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(compare_constraints)

HEADER = "# 註解行不算\n#\n"


def _write(path: Path, body: str) -> Path:
    path.write_text(HEADER + body, encoding="utf-8")
    return path


def test_upgrades_and_new_packages_are_fine(tmp_path: Path):
    old = _write(tmp_path / "old.txt", "ruff==0.16.9\nfastapi==0.141.1\n")
    new = _write(tmp_path / "new.txt", "ruff==0.16.10\nfastapi==0.141.1\nhttpx==0.28.1\n")

    assert compare_constraints.regressions(old, new) == []


def test_reports_a_lower_version(tmp_path: Path):
    """版本照 PEP 440 比：0.16.10 比 0.16.9 新，字串比的話會反過來。"""
    old = _write(tmp_path / "old.txt", "ruff==0.16.10\n")
    new = _write(tmp_path / "new.txt", "ruff==0.16.9\n")

    assert compare_constraints.regressions(old, new) == ["ruff：0.16.10 → 0.16.9"]


def test_reports_a_package_that_disappeared(tmp_path: Path):
    old = _write(tmp_path / "old.txt", "ruff==0.16.9\nmypy==2.3.1\n")
    new = _write(tmp_path / "new.txt", "ruff==0.16.9\n")

    assert compare_constraints.regressions(old, new) == ["mypy：2.3.1 → （沒了）"]


def test_matches_names_the_way_pip_does(tmp_path: Path):
    """pip freeze 與 Dependabot 寫的名字大小寫、底線可能不同（jaraco.classes／jaraco-classes）。"""
    old = _write(tmp_path / "old.txt", "jaraco-classes==3.4.0\nSQLAlchemy==2.1.2\n")
    new = _write(tmp_path / "new.txt", "jaraco.classes==3.4.0\nsqlalchemy==2.1.2\n")

    assert compare_constraints.regressions(old, new) == []


def test_cli_exits_non_zero_and_names_what_went_backwards(tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    old = _write(tmp_path / "old.txt", "ruff==0.17.0\n")
    new = _write(tmp_path / "new.txt", "ruff==0.16.9\n")

    assert compare_constraints.main([str(old), str(new)]) == 1
    assert "ruff：0.17.0 → 0.16.9" in capsys.readouterr().err


def test_cli_passes_when_nothing_went_backwards(tmp_path: Path):
    old = _write(tmp_path / "old.txt", "ruff==0.16.9\n")
    new = _write(tmp_path / "new.txt", "ruff==0.17.0\n")

    assert compare_constraints.main([str(old), str(new)]) == 0


def test_reports_lines_it_cannot_compare(tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    """從本機 wheel 或 URL 裝的套件，freeze 寫成 `名稱 @ 位置`：列出來擋下，不丟 traceback。"""
    old = _write(tmp_path / "old.txt", "ruff==0.16.9\n")
    new = _write(tmp_path / "new.txt", "ruff @ file:///tmp/ruff-0.16.9-py3-none-any.whl\n")

    assert compare_constraints.regressions(old, new) == ["無法比對的行：ruff @ file:///tmp/ruff-0.16.9-py3-none-any.whl"]
    assert compare_constraints.main([str(old), str(new)]) == 1
    assert "Traceback" not in capsys.readouterr().err
