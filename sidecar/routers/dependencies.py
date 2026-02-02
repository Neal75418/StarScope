"""
Shared router dependencies and helper functions.
Eliminates duplication of common query helpers across routers.
"""

from fastapi import HTTPException
from sqlalchemy.orm import Session

from db.models import Repo

ERROR_REPO_NOT_FOUND = "Repository not found"


def get_repo_or_404(repo_id: int, db: Session) -> Repo:
    """Get repo by ID or raise 404."""
    repo = db.query(Repo).filter(Repo.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail=ERROR_REPO_NOT_FOUND)
    return repo
