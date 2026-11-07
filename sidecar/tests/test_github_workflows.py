"""GitHub Actions 的供應鏈規則，以及 release 的 publish 步驟只有打 tag 才跑的分支邏輯。

- 外部 action 一律釘 commit SHA 並註明版本：tag 可以被改指到別的 commit
- checkout 一律不保留憑證：沒有任何步驟要用 git 推送，留在 git 設定裡的 token 只會被後面的步驟讀到
- publish 的 shell 平常跑不到，寫錯要到正式發版才知道：這裡用假的 gh 把每條路走一次
"""

import os
import re
import subprocess
from pathlib import Path
from typing import Any

import pytest
import yaml

REPO = Path(__file__).resolve().parents[2]
WORKFLOW_FILES = sorted((REPO / ".github").rglob("*.y*ml"))
USES_LINE = re.compile(r"^\s*(?:-\s+)?uses:\s*(?P<ref>\S+)(?P<rest>.*)$")


def _steps(document: dict[str, Any]) -> list[dict[str, Any]]:
    """workflow 各 job 的 steps，加上 composite action 的 runs.steps。"""
    jobs: dict[str, Any] = document.get("jobs") or {}
    runs: dict[str, Any] = document.get("runs") or {}
    steps: list[dict[str, Any]] = [step for job in jobs.values() for step in job.get("steps", [])]
    return steps + list(runs.get("steps", []))


def test_there_are_workflow_files_to_check():
    assert any(p.name == "release.yml" for p in WORKFLOW_FILES)
    assert any(p.name == "action.yml" for p in WORKFLOW_FILES)


def test_every_external_action_is_pinned_to_a_commit_with_its_version():
    problems = []
    for path in WORKFLOW_FILES:
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            match = USES_LINE.match(line)
            if not match or match["ref"].startswith("./"):
                continue
            pinned = re.fullmatch(r"[\w.-]+/[\w./-]+@[0-9a-f]{40}", match["ref"])
            labelled = re.fullmatch(r"\s+# v\d+\.\d+\.\d+", match["rest"])
            if not (pinned and labelled):
                problems.append(f"{path.relative_to(REPO)}:{number}: {line.strip()}")
    assert not problems, "外部 action 要寫成 owner/repo@<40 字元 SHA> # vX.Y.Z：\n" + "\n".join(problems)


def test_every_checkout_drops_its_credentials():
    problems = []
    for path in WORKFLOW_FILES:
        for step in _steps(yaml.safe_load(path.read_text(encoding="utf-8"))):
            if str(step.get("uses", "")).startswith("actions/checkout@"):
                if (step.get("with") or {}).get("persist-credentials") is not False:
                    problems.append(str(path.relative_to(REPO)))
    assert not problems, f"checkout 沒有設 persist-credentials: false：{problems}"


def test_the_packaging_environment_installs_only_hash_checked_wheels():
    """打包環境的每個套件都要對過雜湊、都是預先編好的 wheel：從原始碼建置時抓的建置依賴不驗雜湊。

    pip 本身也不另外升級：setup-python 內建的那一版就夠，升級等於多裝一個沒鎖版本的套件。
    """
    action = yaml.safe_load((REPO / ".github" / "actions" / "setup-sidecar" / "action.yml").read_text(encoding="utf-8"))
    installs = [
        line.strip()
        for step in _steps(action)
        for line in str(step.get("run", "")).splitlines()
        if "pip install" in line and not line.strip().startswith("#")
    ]
    assert len(installs) == 1, installs
    (install,) = installs
    for required in ("--require-hashes", "--only-binary :all:", "-r sidecar/packaging.lock"):
        assert required in install, install


def _release_step(job: str, name: str) -> dict[str, Any]:
    release = yaml.safe_load((REPO / ".github" / "workflows" / "release.yml").read_text(encoding="utf-8"))
    (step,) = [s for s in release["jobs"][job]["steps"] if s.get("name") == name]
    return dict(step)


def test_release_builds_do_not_restore_the_rust_cache():
    """快取裡是編好的依賴，cargo 不驗內容，而 default branch 上其他 workflow 寫的快取 tag 的 run 讀得到。"""
    assert "github.ref_type != 'tag'" in _release_step("build", "Cache Rust dependencies").get("if", "")


def test_dmg_keeps_its_finder_layout_on_ci():
    """CI=true 時 tauri 打 dmg 會跳過排版：打開 dmg 沒有把 app 拖進 Applications 的樣子。"""
    assert _release_step("build", "Build installers")["env"]["TAURI_BUNDLER_DMG_IGNORE_CI"] == "true"


def _publish_script() -> str:
    step = _release_step("publish", "Create draft release")
    assert "shell" not in step  # 沒寫 shell 的 run 在 Linux 上是 bash -e（沒有 pipefail），下面照這樣跑
    script: str = step["run"]
    return script


# 假的 gh：查 release 清單（REST）時，依 FAKE_STATE 回這個 tag 的 draft 欄位，一筆一行；其他指令只記下來
FAKE_GH = """#!/bin/sh
echo "$*" >> "$GH_LOG"
if [ "$1" = "api" ]; then
  case "$FAKE_STATE" in
    missing) ;;
    error) echo "HTTP 502: Bad Gateway (https://api.github.com/repos/owner/repo/releases)" >&2; exit 1 ;;
    *) printf '%s\\n' $FAKE_STATE ;;
  esac
fi
"""


def _run_publish(tmp_path: Path, state: str) -> tuple[subprocess.CompletedProcess[str], list[str]]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    gh = bin_dir / "gh"
    gh.write_text(FAKE_GH, encoding="utf-8")
    gh.chmod(0o755)
    work = tmp_path / "work"
    (work / "release-assets" / "release-assets-x86_64-unknown-linux-gnu").mkdir(parents=True)
    (work / "release-assets" / "release-assets-x86_64-unknown-linux-gnu" / "StarScope_1.1.1_amd64.deb").write_bytes(b"x")
    runner_temp = tmp_path / "runner-temp"
    runner_temp.mkdir()
    log = tmp_path / "gh.log"
    env = {
        **os.environ,
        "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
        "GH_LOG": str(log),
        "FAKE_STATE": state,
        "TAG": "v1.1.1",
        "GITHUB_REPOSITORY": "owner/repo",
        "RUNNER_TEMP": str(runner_temp),
        "NOTES": "release notes",
        "GH_TOKEN": "not-a-real-token",
    }
    result = subprocess.run(["bash", "-e", "-c", _publish_script()], cwd=work, env=env, capture_output=True, text=True)
    calls = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
    return result, calls


def test_publish_uploads_to_an_existing_draft(tmp_path: Path):
    """上次建好 draft、上傳到一半失敗後重跑：補傳到同一個 draft。"""
    result, calls = _run_publish(tmp_path, "true")

    assert result.returncode == 0, result.stderr
    (upload,) = [c for c in calls if c.startswith("release upload")]
    assert "release-assets/release-assets-x86_64-unknown-linux-gnu/StarScope_1.1.1_amd64.deb" in upload
    assert "--clobber" in upload
    assert not any(c.startswith("release create") for c in calls)


def test_publish_asks_for_every_release_of_this_tag(tmp_path: Path):
    """判斷完全靠這一個查詢：要翻完所有頁、只看這個 tag。漏了過濾會把別的版本的已發佈 release 當成這一版的。"""
    _, calls = _run_publish(tmp_path, "missing")

    (query,) = [c for c in calls if c.startswith("api ")]
    assert "--paginate" in query
    assert "releases?per_page=100" in query
    assert "select(.tag_name == env.TAG) | .draft" in query


def test_publish_creates_a_draft_when_there_is_no_release(tmp_path: Path):
    result, calls = _run_publish(tmp_path, "missing")

    assert result.returncode == 0, result.stderr
    (create,) = [c for c in calls if c.startswith("release create")]
    assert "release-assets/release-assets-x86_64-unknown-linux-gnu/StarScope_1.1.1_amd64.deb" in create
    assert "--draft" in create
    assert "--verify-tag" in create


@pytest.mark.parametrize(
    "state",
    [
        pytest.param("false", id="already-published"),
        pytest.param("true true", id="two-drafts"),
    ],
)
def test_publish_leaves_existing_releases_alone(tmp_path: Path, state: str):
    """已經發佈、或同一個 tag 有不只一個 release 時不動手，並說出實際查到的狀態。"""
    result, calls = _run_publish(tmp_path, state)

    assert result.returncode != 0
    assert not any(c.startswith(("release create", "release upload")) for c in calls)
    assert f"draft={' '.join(state.split())}" in result.stdout.replace("\n", " ")


def test_publish_stops_when_the_release_list_cannot_be_read(tmp_path: Path):
    """查不到清單（網路、權限）不能當成「沒有 release」而再建一個 draft，也不能說成已經發佈。"""
    result, calls = _run_publish(tmp_path, "error")

    assert result.returncode != 0
    assert "HTTP 502" in result.stderr
    assert "已經有" not in result.stdout
    assert not any(c.startswith(("release create", "release upload")) for c in calls)
