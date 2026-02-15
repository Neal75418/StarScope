from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from db.models import Repo

ERROR_REPO_NOT_FOUND = "Repository not found"


def get_repo_or_404(repo_id: int, db: Session) -> Repo:
    """依 ID 取得 repo，不存在則拋出 404。"""
    # noinspection PyTypeChecker
    repo: Optional[Repo] = db.query(Repo).filter(Repo.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail=ERROR_REPO_NOT_FOUND)
    return repo
