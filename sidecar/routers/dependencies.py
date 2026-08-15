"""共用路由依賴注入（驗證、取得 Repo 等）。"""

from fastapi import HTTPException
from sqlalchemy.orm import Session

from db.models import Repo
from db.soft_delete import include_archived

ERROR_REPO_NOT_FOUND = "Repository not found"


def get_repo_or_404(repo_id: int, db: Session, allow_archived: bool = False) -> Repo:
    """依 ID 取得 repo，不存在則拋出 404。

    allow_archived 供封存清單的檢視、復原與永久刪除使用——預設過濾會讓封存的
    repo 一律 404。
    """
    query = db.query(Repo)
    if allow_archived:
        query = include_archived(query)
    # noinspection PyTypeChecker
    repo: Repo | None = query.filter(Repo.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail=ERROR_REPO_NOT_FOUND)
    return repo
