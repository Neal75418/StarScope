"""scripts/check-staged-secrets.sh：commit 前擋下 staged 內容裡新增的 GitHub token、警告寫死的憑證。

token 與憑證字樣都在執行期才組出來：原始碼裡出現完整的樣子的話，提交這個檔案時會被這支檢查自己擋下或警告。
"""

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "check-staged-secrets.sh"
REAL_GIT = shutil.which("git")


def _token(prefix: str, length: int = 36) -> str:
    return prefix + "_" + ("Ab1" * 30)[:length]


def _fine_grained_token() -> str:
    return "github" + "_pat_" + ("Ab1" * 10)[:22] + "_" + ("Cd2" * 30)[:59]


def _git(repo: Path, *args: str, literal_paths: bool = False) -> None:
    env = _clean_env()
    if literal_paths:
        env["GIT_LITERAL_PATHSPECS"] = "1"
    subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True, env=env)


def _clean_env() -> dict[str, str]:
    # 在 git hook 裡跑測試時，外層的 GIT_DIR／GIT_INDEX_FILE 會讓指令跑到外層 repo；
    # 使用者的全域、系統設定（hooksPath、diff 工具等）也不能影響結果，要測的設定寫在臨時 repo 自己的設定裡
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env["GIT_CONFIG_NOSYSTEM"] = "1"
    env["GIT_CONFIG_GLOBAL"] = os.devnull
    return env


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    _git(tmp_path, "init", "-q")
    # 直接寫設定檔：每多一次 git 呼叫，這組測試就慢一截（macOS 的 git 經過 xcrun 轉一手）。
    # GIT_CONFIG_GLOBAL 擋不到 ~/.config/git 底下預設的 ignore 與 attributes，這裡明確指到空檔
    with (tmp_path / ".git" / "config").open("a", encoding="utf-8") as config:
        config.write(
            "[user]\n\temail = test@example.com\n\tname = test\n[commit]\n\tgpgsign = false\n"
            f"[core]\n\texcludesFile = {os.devnull}\n\tattributesFile = {os.devnull}\n"
        )
    return tmp_path


@pytest.fixture
def fake_bin(tmp_path_factory: pytest.TempPathFactory):
    """在 PATH 最前面放假的指令，模擬 git、grep 自己出錯。"""
    bin_dir = tmp_path_factory.mktemp("fake-bin")

    def make(name: str, body: str) -> Path:
        tool = bin_dir / name
        tool.write_text("#!/bin/sh\n" + body, encoding="utf-8")
        tool.chmod(0o755)
        return bin_dir

    return make


def _stage(repo: Path, name: str, text: str) -> None:
    (repo / name).write_text(text, encoding="utf-8")
    # 只在這裡把檔名當字面路徑：放進 _clean_env 的話，受測腳本自己少設也測不出來
    _git(repo, "add", name, literal_paths=True)


def _commit(repo: Path) -> None:
    _git(repo, "commit", "-q", "-m", "base")


def _check(repo: Path, locale: str | None = None, path_prefix: Path | None = None) -> subprocess.CompletedProcess[str]:
    env = _clean_env()
    if locale:
        env["LC_ALL"] = locale
    if path_prefix:
        env["PATH"] = f"{path_prefix}{os.pathsep}{env['PATH']}"
    # 腳本的暫存檔裡就是 staged 的祕密：每次給一個空的 TMPDIR，跑完（擋下或放行）都要是空的
    scratch = Path(tempfile.mkdtemp())
    env["TMPDIR"] = str(scratch)
    try:
        result = subprocess.run(["bash", str(SCRIPT)], cwd=repo, capture_output=True, text=True, env=env)
        leftovers = sorted(p.name for p in scratch.iterdir())
    finally:
        shutil.rmtree(scratch)
    assert not leftovers, f"腳本留下了暫存檔：{leftovers}"
    return result


@pytest.mark.parametrize("prefix", ["ghp", "gho", "ghu", "ghs", "ghr"])
def test_blocks_each_github_token_format_without_printing_it(repo: Path, prefix: str):
    """gho_ 是 app 透過 Device Flow（OAuth App）拿到的 token，跟 ghp_ 一樣要擋。"""
    token = _token(prefix)
    _stage(repo, "notes.txt", f"token = {token}\n")

    result = _check(repo)

    assert result.returncode != 0
    assert "notes.txt" in result.stdout
    # 命中的那行就是 token 本身：印出來等於再外洩一次（終端機記錄、IDE 的 commit 視窗）
    assert token not in result.stdout + result.stderr


def test_blocks_a_fine_grained_token(repo: Path):
    token = _fine_grained_token()
    _stage(repo, "config.env", f"GITHUB_TOKEN={token}\n")

    result = _check(repo)

    assert result.returncode != 0
    assert "config.env" in result.stdout
    assert token not in result.stdout + result.stderr


def test_allows_content_without_tokens(repo: Path):
    # 前綴對、長度不夠的不是 token（例如說明文字裡的 `gho_` 範例）
    _stage(repo, "README.md", f"OAuth token 以 gho_ 開頭，例如 {_token('gho', 35)}\n")

    assert _check(repo).returncode == 0


def test_allows_removing_a_token_that_was_committed(repo: Path):
    """修補外洩就是刪掉那行：連刪除的行也比對的話，修補本身會被擋。"""
    _stage(repo, "app.cfg", f"keep = 1\ntoken = {_token('ghp')}\n")
    _commit(repo)
    _stage(repo, "app.cfg", "keep = 1\n")

    assert _check(repo).returncode == 0


def test_allows_deleting_a_file_that_holds_a_token(repo: Path):
    _stage(repo, "leaked.txt", f"{_token('ghp')}\n")
    _commit(repo)
    _git(repo, "rm", "-q", "leaked.txt")

    assert _check(repo).returncode == 0


def test_names_only_the_offending_files_even_with_spaces(repo: Path):
    _stage(repo, "clean file.txt", "nothing here\n")
    _stage(repo, "my notes.txt", f"{_token('gho')}\n")

    result = _check(repo)

    assert result.returncode != 0
    assert "my notes.txt" in result.stdout
    assert "clean file.txt" not in result.stdout


def test_blocks_a_token_near_the_top_of_a_large_change(repo: Path):
    """token 在大量新增內容的最前面也要擋：以管線串 grep -q 又開 pipefail 的寫法，上游收到 SIGPIPE 會被當成沒找到。"""
    filler = "".join(f"line {i:06d} " + "x" * 60 + "\n" for i in range(20_000))
    _stage(repo, "dump.log", f"{_token('gho')}\n{filler}")

    result = _check(repo)

    assert result.returncode != 0
    assert "dump.log" in result.stdout


def test_warns_about_hardcoded_credentials_without_blocking_or_printing_them(repo: Path):
    """寫死的 password／api_key／secret 只警告、不擋（測試資料與文件範例常長這樣），但一樣不印內容。"""
    key = "API_" + "KEY"
    _stage(repo, "db.py", f'{key} = "hunter2-value"\n')

    result = _check(repo)

    assert result.returncode == 0
    assert "db.py" in result.stdout
    assert "hunter2-value" not in result.stdout + result.stderr


def test_does_not_warn_when_a_credential_line_is_removed(repo: Path):
    word = "pass" + "word"
    _stage(repo, "db.py", f'keep = 1\n{word} = "hunter2-value"\n')
    _commit(repo)
    _stage(repo, "db.py", "keep = 1\n")

    result = _check(repo)

    assert result.returncode == 0
    assert "db.py" not in result.stdout


def _configure(repo: Path, config: str, attributes: str = "") -> None:
    with (repo / ".git" / "config").open("a", encoding="utf-8") as f:
        f.write(config)
    if attributes:
        (repo / ".gitattributes").write_text(attributes, encoding="utf-8")


@pytest.mark.parametrize(
    ("config", "attributes"),
    [
        pytest.param("[diff]\n\texternal = true\n", "", id="external-diff"),
        pytest.param("[diff \"hide\"]\n\ttextconv = true\n", "*.txt diff=hide\n", id="textconv"),
        pytest.param("", "*.txt binary\n", id="binary-attribute"),
        pytest.param("[color]\n\tui = always\n", "", id="color-always"),
    ],
)
def test_blocks_tokens_whatever_the_diff_settings(repo: Path, config: str, attributes: str):
    """外部 diff 工具（例如 difftastic）、textconv、binary 屬性、強制上色都會讓 git diff 不給 + 開頭的新增行。"""
    _configure(repo, config, attributes)
    _stage(repo, "notes.txt", f"{_token('gho')}\n")

    result = _check(repo)

    assert result.returncode != 0
    assert "notes.txt" in result.stdout


@pytest.mark.parametrize(
    "content",
    [
        pytest.param(lambda tok: b"\x00\x01header\n" + tok + b"\n", id="own-line"),
        # SQLite、pickle 這類 binary 檔的 token 前面幾乎一定有 NUL、中間沒有換行。
        # GNU grep 判定 binary 後會把 NUL 當換行，token 那段就沒有行首的 +
        pytest.param(lambda tok: b"SQLite format 3\x00\x10\x00\x05" + tok + b"\x00\x00", id="after-nul-same-line"),
    ],
)
def test_blocks_a_token_in_a_file_with_nul_bytes(repo: Path, content):
    (repo / "blob.bin").write_bytes(content(_token("gho").encode()))
    _git(repo, "add", "blob.bin")

    result = _check(repo)

    assert result.returncode != 0
    assert "blob.bin" in result.stdout


def test_names_files_with_non_ascii_names(repo: Path):
    """git 預設把非 ASCII 檔名轉成八進位跳脫，拿那個字串回頭查 diff 會對不到檔。"""
    _stage(repo, "筆記.txt", f"{_token('gho')}\n")

    result = _check(repo)

    assert result.returncode != 0
    assert "筆記.txt" in result.stdout


def test_treats_file_names_literally(repo: Path):
    """以 : 開頭的檔名是 pathspec magic、含 [ ] 的是萬用字元：都要當成字面檔名。"""
    _stage(repo, ":notes.txt", f"{_token('gho')}\n")
    _stage(repo, "a.txt", f"{_token('ghp')}\n")
    _stage(repo, "[ab].txt", "nothing here\n")

    result = _check(repo)

    assert result.returncode != 0
    assert ":notes.txt" in result.stdout
    assert "a.txt" in result.stdout
    assert "[ab].txt" not in result.stdout


def test_allows_renaming_a_committed_file_that_holds_a_token(repo: Path):
    """純改名沒有新增任何一行。關掉 diff.renames：使用者的設定不能左右結果。"""
    _configure(repo, "[diff]\n\trenames = false\n")
    _stage(repo, "old.txt", f"{_token('ghp')}\n")
    _commit(repo)
    _git(repo, "mv", "old.txt", "new.txt")

    assert _check(repo).returncode == 0


def test_lists_files_that_add_a_token_not_ones_that_were_only_renamed(repo: Path):
    """擋下時列的是新增了 token 的檔：只改了名、token 原本就在的檔不列，免得去改一個沒問題的檔。"""
    _stage(repo, "old.txt", f"{_token('ghp')}\n")
    _commit(repo)
    _git(repo, "mv", "old.txt", "new.txt")
    _stage(repo, "fresh.txt", f"{_token('gho')}\n")

    result = _check(repo)

    assert result.returncode != 0
    assert "fresh.txt" in result.stdout
    assert "new.txt" not in result.stdout


def test_lists_a_renamed_file_that_adds_a_token(repo: Path):
    """改名又新加了 token 的檔要列出新的檔名：新舊路徑一起給 git，配成對之後新增的那行才看得到。"""
    # 原檔要夠長：加了 token 之後相似度仍要過 git 判定改名的門檻（預設 50%），不然會變成一刪一增、走不到改名那條路
    body = "".join(f"line {i:02d} of the original file\n" for i in range(20))
    _stage(repo, "old.txt", body)
    _commit(repo)
    _git(repo, "mv", "old.txt", "new.txt")
    _stage(repo, "new.txt", f"{body}{_token('gho')}\n")

    result = _check(repo)

    assert result.returncode != 0
    assert "new.txt" in result.stdout


def test_fails_instead_of_passing_when_git_fails(tmp_path: Path):
    """git 出錯（例如不在 repo 裡）時要擋下，不能當成「沒找到」而放行。"""
    result = _check(tmp_path)

    assert result.returncode != 0


@pytest.mark.parametrize(
    "listing",
    [
        pytest.param("exit 128", id="listing-fails"),
        pytest.param("exit 0", id="listing-is-empty"),
    ],
)
def test_blocks_when_the_offending_files_cannot_be_listed(repo: Path, fake_bin, listing: str):
    """整份 diff 裡有 token、列檔名那一步卻失敗或什麼都沒列出時，要擋下而不是放行。"""
    bin_dir = fake_bin(
        "git",
        f'case " $* " in *" --name-only "*|*" --name-status "*) {listing} ;; esac\nexec "{REAL_GIT}" "$@"\n',
    )
    _stage(repo, "notes.txt", f"{_token('gho')}\n")

    result = _check(repo, path_prefix=bin_dir)

    assert result.returncode != 0
    # 確認走的是「列不出來」這條路：假 git 沒被呼叫到的話，真的 git 照樣會擋下，只看結束碼分不出來
    assert "找不出是哪個檔" in result.stdout
    assert "notes.txt" not in result.stdout


def test_still_warns_about_credentials_when_files_cannot_be_listed(repo: Path, fake_bin):
    """憑證只警告、不擋，但列檔名那一步失敗時警告也不能不見。"""
    bin_dir = fake_bin("git", f'case " $* " in *" --name-status "*) exit 128 ;; esac\nexec "{REAL_GIT}" "$@"\n')
    word = "pass" + "word"
    _stage(repo, "db.py", f'{word} = "hunter2-value"\n')

    result = _check(repo, path_prefix=bin_dir)

    assert result.returncode == 0
    assert "寫死的" in result.stdout
    assert "找不出是哪個檔" in result.stdout


def test_fails_when_grep_itself_fails(repo: Path, fake_bin):
    """grep 出錯（結束碼 2）不能當成「沒找到」而放行。"""
    bin_dir = fake_bin("grep", "exit 2\n")
    _stage(repo, "notes.txt", f"{_token('gho')}\n")

    result = _check(repo, path_prefix=bin_dir)

    # 帶出 grep 的結束碼：真的 grep 擋下時是 1，分得出假 grep 有沒有被呼叫到
    assert result.returncode == 2


def test_blocks_a_token_after_bytes_that_are_not_valid_utf8(repo: Path):
    """UTF-8 locale 下，regex 的 . 不會跨過無效的位元組：token 前面同一行有 Big5、Latin-1 之類的字元時會漏掉。"""
    (repo / "legacy.txt").write_bytes(b"\xa4\xa4\xa4\xe5 note " + _token("gho").encode() + b"\n")
    _git(repo, "add", "legacy.txt")

    result = _check(repo, locale="C.UTF-8")

    assert result.returncode != 0
    assert "legacy.txt" in result.stdout
