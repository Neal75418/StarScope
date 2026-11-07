"""Dependabot 要涵蓋 repo 裡每一種依賴、它的 PR 要跑 CI，分組、忽略與範圍的規則要照這個 repo 的版本政策。

- 要更新的生態系由 repo 裡的依賴檔推出來（npm 看根目錄與第一層子目錄、cargo／pip 看第一層子目錄、composite action
  看 .github/actions/*）：新加了依賴檔而設定沒涵蓋時，這裡會紅
- cooldown：新版發佈幾天後才開 PR，被搶先發佈的惡意版本多半在這段時間內被撤下
- tauri 的 npm 套件與 crate 各自要全部在同一組，而且排在 catch-all 前面（文件寫的是一個依賴只進第一個對上的 group，
  實作看 pattern 的明確程度；兩種規則下都進 tauri 組）
- test.yml 要有 pull_request 觸發：npm、pip、actions 的 PR 只靠它跑 CI；cargo 的 PR 也要靠它跑 test_tauri_versions
  （rust.yml 不跑 pytest）
"""

from fnmatch import fnmatch
from pathlib import Path
from typing import Any

import yaml
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name
from packaging.version import Version

REPO = Path(__file__).resolve().parents[2]


def _config() -> dict[str, Any]:
    config: dict[str, Any] = yaml.safe_load((REPO / ".github" / "dependabot.yml").read_text(encoding="utf-8"))
    return config


def _updates(ecosystem: str) -> list[dict[str, Any]]:
    return [u for u in _config()["updates"] if u["package-ecosystem"] == ecosystem]


def _directories(update: dict[str, Any]) -> list[str]:
    return list(update.get("directories", [])) + ([update["directory"]] if "directory" in update else [])


def _covered(ecosystem: str, directory: str) -> bool:
    return any(fnmatch(directory, pattern) for u in _updates(ecosystem) for pattern in _directories(u))


def _expected_directories() -> dict[str, set[str]]:
    expected: dict[str, set[str]] = {"github-actions": {"/"}}
    first_level = [p for p in REPO.iterdir() if p.is_dir() and not p.name.startswith(".") and p.name != "node_modules"]
    if (REPO / "package.json").exists():
        expected["npm"] = {"/"}
    for folder in first_level:
        if (folder / "package.json").exists():
            expected.setdefault("npm", set()).add(f"/{folder.name}")
        if (folder / "Cargo.toml").exists():
            expected.setdefault("cargo", set()).add(f"/{folder.name}")
        if any(folder.glob("requirements*.txt")):
            expected.setdefault("pip", set()).add(f"/{folder.name}")
    # composite action 不在預設的 /.github/workflows 裡，每一個都要被某個 directories 涵蓋
    for action in (REPO / ".github" / "actions").glob("*/action.y*ml"):
        expected["github-actions"].add(f"/.github/actions/{action.parent.name}")
    return expected


def test_every_dependency_manifest_in_the_repo_is_covered():
    missing = sorted(
        f"{ecosystem} {directory}"
        for ecosystem, directories in _expected_directories().items()
        for directory in directories
        if not _covered(ecosystem, directory)
    )
    assert not missing, f"dependabot.yml 沒有涵蓋：{missing}"


def test_every_update_waits_before_proposing_a_fresh_release():
    without = [u["package-ecosystem"] for u in _config()["updates"] if not (u.get("cooldown") or {}).get("default-days")]
    assert not without, f"沒有設 cooldown：{without}"


def test_tauri_packages_share_one_group_ahead_of_the_catch_all():
    for ecosystem, tauri_patterns in [("npm", {"@tauri-apps/*"}), ("cargo", {"tauri", "tauri-*"})]:
        (update,) = _updates(ecosystem)
        # 只看版本更新的 group；applies-to: security-updates 的另算
        groups = [
            (name, set(g.get("patterns", [])))
            for name, g in (update.get("groups") or {}).items()
            if g.get("applies-to", "version-updates") == "version-updates"
        ]
        holders = [i for i, (_, patterns) in enumerate(groups) if patterns & tauri_patterns]
        assert len(holders) == 1, f"{ecosystem}：tauri 的 pattern 要全部在同一個 group，現在分在 {[groups[i][0] for i in holders]}"
        (index,) = holders
        assert tauri_patterns <= groups[index][1], f"{ecosystem}：{groups[index][0]} 少了 {tauri_patterns - groups[index][1]}"
        catch_alls = [i for i, (_, patterns) in enumerate(groups) if "*" in patterns]
        assert all(index < i for i in catch_alls), f"{ecosystem}：tauri 的 group 要排在 catch-all 前面"


def test_node_types_major_follows_the_nvmrc():
    """@types/node 的 major 要等於 .nvmrc（test_node_version_single_source.py），Dependabot 提 major 一定會紅。"""
    (npm,) = _updates("npm")
    ignored = [
        i for i in npm.get("ignore", [])
        if i.get("dependency-name") == "@types/node" and "version-update:semver-major" in i.get("update-types", [])
    ]
    assert ignored


def _minor_locked_packages() -> set[str]:
    """requirements 檔裡刻意鎖在同一個 minor 的套件：上限是「下一個 minor」（>=2.1.1,<2.2），或 ~=X.Y.Z。"""
    locked: set[str] = set()
    for path in (REPO / "sidecar").glob("requirements*.txt"):
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.split("#")[0].strip()
            if not line or line.startswith("-"):
                continue
            requirement = Requirement(line)
            lower = [Version(s.version) for s in requirement.specifier if s.operator == ">="]
            upper = [Version(s.version) for s in requirement.specifier if s.operator == "<"]
            compatible = [s.version for s in requirement.specifier if s.operator == "~="]
            next_minor = lower and upper and (upper[0].major, upper[0].minor) == (lower[0].major, lower[0].minor + 1)
            if next_minor or any(len(Version(v).release) >= 3 for v in compatible):
                locked.add(canonicalize_name(requirement.name))
    return locked


def test_pip_keeps_the_declared_ranges():
    (pip,) = _updates("pip")
    # 範圍容得下新版時不改 requirements 檔：有理由的下限不被拉高
    assert pip.get("versioning-strategy") == "increase-if-necessary"

    # 兩邊要剛好一樣：Dependabot 容不下新版時會把上限往上推（ruff 變成 <0.18.0），範圍就不再鎖在一個 minor，
    # 這裡在那個 PR 上就會紅，提醒把範圍改回鎖在新的 minor
    locked = _minor_locked_packages()
    assert locked, "requirements 檔裡應該找得到鎖在同一個 minor 的套件"
    for name, group in (pip.get("groups") or {}).items():
        if "*" in group.get("patterns", []):
            excluded = {canonicalize_name(p) for p in group.get("exclude-patterns", [])}
            assert locked == excluded, (
                f"pip 的 {name} group 要剛好排除鎖在同一個 minor 的套件：漏排 {sorted(locked - excluded)}，"
                f"範圍已不再鎖在一個 minor {sorted(excluded - locked)}"
            )


def test_pull_requests_run_the_tests():
    workflow = yaml.safe_load((REPO / ".github" / "workflows" / "test.yml").read_text(encoding="utf-8"))
    # PyYAML 把 on 讀成布林值 True
    triggers = workflow.get("on", workflow.get(True))
    assert "pull_request" in triggers
