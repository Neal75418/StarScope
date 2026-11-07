"""constraints.txt 要涵蓋 requirements 檔宣告的每一個套件，鎖的版本也要落在宣告的範圍內。

CI 用 `pip install -r requirements-dev.txt -c constraints.txt`（它再用 -r 帶進打包用的 requirements.txt），
裝到的版本跟開發機一樣。漏掉的套件會在 CI 上悄悄裝到最新版——正是 constraints 要擋的事；
版本不在範圍內則 pip 直接失敗。
"""

from pathlib import Path

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

SIDECAR_DIR = Path(__file__).resolve().parent.parent


def _requirements(path: Path = SIDECAR_DIR / "requirements-dev.txt") -> list[Requirement]:
    """從 CI 裝的 requirements-dev.txt 出發、跟著 -r 走：CI 裝到的每一個宣告都要檢查，不另列檔名清單。

    -r 的路徑跟 pip 一樣，相對於引用它的那個檔。
    """
    requirements: list[Requirement] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.split("#")[0].strip()
        if line.startswith("-r "):
            requirements += _requirements(path.parent / line.removeprefix("-r ").strip())
        elif line:
            requirements.append(Requirement(line))
    return requirements


def _pins() -> dict[str, str]:
    pins: dict[str, str] = {}
    for line in (SIDECAR_DIR / "constraints.txt").read_text(encoding="utf-8").splitlines():
        line = line.split("#")[0].strip()
        if line:
            name, version = line.split("==")
            pins[canonicalize_name(name)] = version
    return pins


def test_every_requirement_is_pinned():
    pins = _pins()
    missing = sorted(r.name for r in _requirements() if canonicalize_name(r.name) not in pins)
    assert not missing, f"constraints.txt 沒有鎖這些套件：{missing}"


def test_pins_satisfy_the_declared_ranges():
    pins = _pins()
    outside = sorted(
        f"{r.name}=={pins[canonicalize_name(r.name)]}（範圍 {r.specifier}）"
        for r in _requirements()
        if canonicalize_name(r.name) in pins
        and not r.specifier.contains(pins[canonicalize_name(r.name)], prereleases=True)
    )
    assert not outside, f"constraints.txt 鎖的版本不在 requirements 檔宣告的範圍內：{outside}"


def test_the_release_packaging_tool_is_pinned_too():
    # release 的 composite action 另外 `pip install pyinstaller`：它產出發行版，漂移的影響最直接
    assert "pyinstaller" in _pins()
