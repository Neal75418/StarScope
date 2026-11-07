"""scripts/update-constraints.sh 的守門接線：新的 freeze 把版本改低、弄丟套件或有比對不了的行時，不寫入、不重產鎖檔。

比對本身在 test_compare_constraints.py 測；這裡測腳本有沒有真的在寫入前呼叫它、擋下時有沒有動到檔案、旗標怎麼解析。
在暫存目錄搭一份最小的 repo：pip 與 uv 是假的（freeze 的內容由測試給、uv 只留下被呼叫過的記號），
python 轉給真的 venv python（比對要用 packaging）。
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
CONSTRAINTS = "# 開頭的註解\nfastapi==0.141.1\nruff==0.16.9\n"


@pytest.fixture
def sandbox(tmp_path: Path) -> Path:
    (tmp_path / "scripts").mkdir()
    for name in ("update-constraints.sh", "compare_constraints.py"):
        shutil.copy2(REPO / "scripts" / name, tmp_path / "scripts" / name)
    (tmp_path / ".python-version").write_text("3.14\n", encoding="utf-8")
    sidecar = tmp_path / "sidecar"
    venv_bin = sidecar / ".venv" / "bin"
    venv_bin.mkdir(parents=True)
    (sidecar / "constraints.txt").write_text(CONSTRAINTS, encoding="utf-8")
    _executable(venv_bin / "pip", '#!/bin/sh\n[ "$1" = "freeze" ] && cat "$FAKE_FREEZE"\nexit 0\n')
    # 用 symlink 的話 python 找不到 pyvenv.cfg、讀不到 venv 裡的 packaging
    _executable(venv_bin / "python", f'#!/bin/sh\nexec "{sys.executable}" "$@"\n')
    fake_bin = tmp_path / "fake-bin"
    fake_bin.mkdir()
    _executable(fake_bin / "uv", '#!/bin/sh\ntouch "$UV_CALLED"\nexit 0\n')
    return tmp_path


def _executable(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")
    path.chmod(0o755)


def _run(sandbox: Path, freeze: str, *args: str) -> subprocess.CompletedProcess[str]:
    (sandbox / "freeze.txt").write_text(freeze, encoding="utf-8")
    env = {
        **os.environ,
        "PATH": f"{sandbox / 'fake-bin'}{os.pathsep}{os.environ['PATH']}",
        "FAKE_FREEZE": str(sandbox / "freeze.txt"),
        "UV_CALLED": str(sandbox / "uv-called"),
    }
    return subprocess.run(
        ["bash", str(sandbox / "scripts" / "update-constraints.sh"), *args],
        capture_output=True, text=True, env=env, timeout=60,
    )


def _constraints(sandbox: Path) -> str:
    return (sandbox / "sidecar" / "constraints.txt").read_text(encoding="utf-8")


def test_writes_the_freeze_and_regenerates_the_lock_when_nothing_went_backwards(sandbox: Path):
    result = _run(sandbox, "fastapi==0.141.1\nruff==0.17.0\n")

    assert result.returncode == 0, result.stderr
    assert "ruff==0.17.0" in _constraints(sandbox)
    assert (sandbox / "uv-called").exists()


@pytest.mark.parametrize(
    "freeze",
    [
        pytest.param("fastapi==0.141.1\nruff==0.16.8\n", id="lower-version"),
        pytest.param("fastapi==0.141.1\n", id="missing-package"),
        pytest.param("fastapi==0.141.1\nruff @ file:///tmp/ruff.whl\n", id="unparsable-line"),
    ],
)
def test_stops_before_touching_anything_when_the_freeze_went_backwards(sandbox: Path, freeze: str):
    """合併了 Dependabot 的 PR、venv 卻沒跟著裝：不能用舊的 freeze 把剛合進來的版本蓋回去。"""
    result = _run(sandbox, freeze)

    assert result.returncode == 1
    assert _constraints(sandbox) == CONSTRAINTS
    assert not (sandbox / "uv-called").exists()
    assert "--allow-downgrade" in result.stderr


def test_allow_downgrade_lets_it_through(sandbox: Path):
    result = _run(sandbox, "fastapi==0.141.1\nruff==0.16.8\n", "--allow-downgrade")

    assert result.returncode == 0, result.stderr
    assert "ruff==0.16.8" in _constraints(sandbox)


def test_rejects_unknown_arguments(sandbox: Path):
    """打錯旗標時不能當成沒加：那樣守門照常擋，使用者卻以為已經放行。"""
    result = _run(sandbox, "fastapi==0.141.1\nruff==0.16.9\n", "--allow-downgrad")

    assert result.returncode == 2
    assert _constraints(sandbox) == CONSTRAINTS
