"""Feed 黑名單預設值 — 首次存取時播種。"""
from sqlalchemy.orm import Session

from db.models import ExcludeTerm

DEFAULT_EXCLUDE_TERMS = ["awesome", "interview", "roadmap", "tutorial"]


def ensure_default_exclude_terms(db: Session) -> None:
    """exclude_terms 為空時播種預設黑名單；已有資料則不動。"""
    if db.query(ExcludeTerm).first() is not None:
        return
    for term in DEFAULT_EXCLUDE_TERMS:
        db.add(ExcludeTerm(term=term))
    db.commit()
