"""打包環境的鎖檔 packaging.lock：每個套件鎖死版本並附雜湊；跟開發機的 constraints.txt 都有的套件，版本一致。

setup-sidecar 用 `pip install --require-hashes --only-binary :all: -r sidecar/packaging.lock` 裝打包環境：
下載、快取或鏡像站被竄改時雜湊對不上、pip 直接失敗。它由 scripts/update-constraints.sh 從 packaging.in 產生
（uv pip compile --universal：一份涵蓋所有平台，平台專屬的套件以 marker 區分）。
升級套件後只重新產生 constraints、沒重新產生鎖檔的話，這裡的版本比對會紅。
"""

from pathlib import Path

from packaging.markers import Marker
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

SIDECAR_DIR = Path(__file__).resolve().parent.parent
LOCK = SIDECAR_DIR / "packaging.lock"


def _logical_lines(path: Path) -> list[str]:
    """去掉註解、把以 \\ 接續的行接成一行。"""
    lines: list[str] = []
    current = ""
    for raw in path.read_text(encoding="utf-8").splitlines():
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        current += " " + stripped.removesuffix("\\").strip()
        if not stripped.endswith("\\"):
            lines.append(current.strip())
            current = ""
    return lines


# 產生 constraints.txt 的開發機（macOS arm64、CPython 3.14）。marker 的 11 個變數全部給定：沒給的會被
# Marker.evaluate 換成執行測試那台機器的值，同一份鎖檔在 Mac 與 Linux CI 上會得到不同結果
DEV_MACHINE = {
    "implementation_name": "cpython",
    "implementation_version": "3.14.7",
    "os_name": "posix",
    "platform_machine": "arm64",
    "platform_python_implementation": "CPython",
    "platform_release": "25.6.0",
    "platform_system": "Darwin",
    "platform_version": "Darwin Kernel Version 25.6.0",
    "python_full_version": "3.14.7",
    "python_version": "3.14",
    "sys_platform": "darwin",
}


def _markers() -> dict[str, list[str]]:
    """套件名 → 它在鎖檔裡各筆的 marker（沒有 marker 是空字串）。"""
    markers: dict[str, list[str]] = {}
    for line in _logical_lines(LOCK):
        name, _, marker = line.split(" --hash=")[0].partition(";")
        markers.setdefault(canonicalize_name(name.partition("==")[0].strip()), []).append(marker.strip())
    return markers


def _locked() -> dict[str, list[tuple[str, list[str]]]]:
    """套件名 → [(鎖的版本, 雜湊)]。同一個套件在不同 marker 下可能出現不只一次。"""
    entries: dict[str, list[tuple[str, list[str]]]] = {}
    for line in _logical_lines(LOCK):
        requirement, *hashes = line.split(" --hash=")
        spec = requirement.partition(";")[0].strip()
        name, _, version = spec.partition("==")
        entries.setdefault(canonicalize_name(name), []).append((version.strip(), hashes))
    return entries


def _pins() -> dict[str, str]:
    pins: dict[str, str] = {}
    for line in _logical_lines(SIDECAR_DIR / "constraints.txt"):
        name, version = line.split("==")
        pins[canonicalize_name(name)] = version
    return pins


def _inputs(path: Path = SIDECAR_DIR / "packaging.in") -> list[Requirement]:
    """packaging.in 宣告的套件，跟著 -r 走（路徑跟 pip 一樣相對於引用它的檔）。"""
    requirements: list[Requirement] = []
    for line in _logical_lines(path):
        line = line.split("#")[0].strip()
        if line.startswith("-r "):
            requirements += _inputs(path.parent / line.removeprefix("-r ").strip())
        elif line:
            requirements.append(Requirement(line))
    return requirements


def test_every_locked_package_has_an_exact_version_and_hashes():
    locked = _locked()
    assert locked, "packaging.lock 是空的"
    loose = sorted(name for name, versions in locked.items() for version, _ in versions if not version)
    unhashed = sorted(
        name for name, versions in locked.items() for _, hashes in versions
        if not hashes or not all(h.startswith("sha256:") for h in hashes)
    )
    assert not loose, f"沒有用 == 鎖死版本：{loose}"
    assert not unhashed, f"沒有附 sha256 雜湊：{unhashed}"


def test_locked_versions_match_the_constraints():
    """鎖檔與 constraints 都有的套件，版本要一樣：打包環境裝到的就是開發機在用、測試跑過的那一版。"""
    pins = _pins()
    drift = sorted(
        f"{name}：鎖檔 {version}，constraints {pins[name]}"
        for name, versions in _locked().items() if name in pins
        for version, _ in versions if version != pins[name]
    )
    assert not drift, "packaging.lock 跟 constraints.txt 對不上，執行 scripts/update-constraints.sh 重新產生：\n" + "\n".join(drift)


def test_the_lock_covers_every_packaging_input():
    """packaging.in 宣告的每一個套件（執行期依賴與打包工具）都要在鎖檔裡。"""
    locked = _locked()
    inputs = _inputs()
    assert any(canonicalize_name(r.name) == "pyinstaller" for r in inputs)
    missing = sorted(r.name for r in inputs if canonicalize_name(r.name) not in locked)
    assert not missing, f"packaging.lock 沒有這些套件，執行 scripts/update-constraints.sh 重新產生：{missing}"


def test_only_platform_specific_packages_are_missing_from_the_constraints():
    """constraints 是開發機 venv 的 freeze：只在鎖檔、不在 constraints 的套件，開發機上應該根本用不到。

    不是的話（marker 在開發機上成立，或根本沒有 marker），代表 constraints 漏鎖了它，或鎖檔還留著已經拿掉的依賴。
    """
    pins = _pins()
    suspicious = sorted(
        name for name, markers in _markers().items() if name not in pins
        for marker in markers if not marker or Marker(marker).evaluate(DEV_MACHINE)
    )
    assert not suspicious, f"這些套件開發機也會裝，卻不在 constraints.txt：{suspicious}"
