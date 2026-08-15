"""追蹤清單與 GitHub star 的同步。

比對鍵是 github_id 而非 full_name：repo 在 GitHub 上改名時 full_name 會變、
github_id 不變，用 full_name 比對會把改名判成「舊的消失 + 新的出現」，於是封存舊列
並建立新列，歷史快照從此斷成兩截。
"""
from dataclasses import dataclass, field
from datetime import datetime

from db.models import Repo


@dataclass
class RemoteStar:
    """GitHub 上的一個 star。payload 是原始的 repo 物件，用來建立本機列。"""
    github_id: int
    full_name: str
    owner: str
    name: str
    starred_at: datetime | None
    payload: dict


@dataclass
class SyncDiff:
    added: list[RemoteStar] = field(default_factory=list)
    restored: list[tuple[Repo, RemoteStar]] = field(default_factory=list)
    renamed: list[tuple[Repo, RemoteStar]] = field(default_factory=list)
    archived: list[Repo] = field(default_factory=list)


def diff_starred(local: list[Repo], remote: list[RemoteStar]) -> SyncDiff:
    """算出本機要做哪些改動才會與遠端一致。不做任何寫入。

    local 必須包含已封存的列，否則重新 star 會被誤判成新增，而 full_name 是唯一鍵，
    新增會直接撞鍵。
    """
    by_id = {r.github_id: r for r in local if r.github_id is not None}
    diff = SyncDiff()
    seen: set[int] = set()

    for star in remote:
        seen.add(star.github_id)
        existing = by_id.get(star.github_id)
        if existing is None:
            diff.added.append(star)
            continue
        if existing.unstarred_at is not None:
            diff.restored.append((existing, star))
        if existing.full_name != star.full_name:
            diff.renamed.append((existing, star))

    for repo in local:
        # 沒有 github_id 就無從判斷遠端有沒有它，不能當成「已取消 star」
        if repo.github_id is None:
            continue
        if repo.github_id not in seen and repo.unstarred_at is None:
            diff.archived.append(repo)

    return diff
