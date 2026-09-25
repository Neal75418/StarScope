"""「自上次以來」摘要 API。分層與篩選規則在 services/digest.py。"""

from datetime import timezone
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from db.database import get_db
from routers.early_signals import EarlySignalResponse
from schemas.response import ApiResponse, success_response
from services.digest import DigestCursor, build_digest, load_cursor, save_cursor

router = APIRouter(prefix="/api/digest", tags=["digest"])


class DigestCursorModel(BaseModel):
    context_signal_id: int = Field(ge=0)
    early_signal_id: int = Field(ge=0)
    triggered_alert_id: int = Field(ge=0)


class DigestRepoRef(BaseModel):
    id: int
    full_name: str
    url: str


class DigestItem(BaseModel):
    # 這個 response_model 會濾掉沒宣告的欄位：services/digest.py 每新增一個欄位都要在這裡宣告
    key: str
    tier: Literal["highlight", "other"]
    kind: Literal["release", "hn", "signal", "alert"]
    repo: DigestRepoRef
    occurred_at: str
    url: str | None = None
    title: str | None = None
    tags: list[str] = []
    score: int | None = None
    signal: EarlySignalResponse | None = None
    rule_name: str | None = None
    signal_type: str | None = None
    operator: str | None = None
    threshold: float | None = None
    value: float | None = None


class DigestResponse(BaseModel):
    items: list[DigestItem]
    other_total: int
    cursor: DigestCursorModel
    last_seen_at: str | None
    releases_checked: bool


class MarkSeenRequest(BaseModel):
    cursor: DigestCursorModel


@router.get("", response_model=ApiResponse[DigestResponse])
def get_digest(db: Session = Depends(get_db)) -> dict:
    cursor, seen_at = load_cursor(db)
    data = build_digest(db, cursor)
    data["last_seen_at"] = seen_at.replace(tzinfo=timezone.utc).isoformat() if seen_at else None
    return success_response(data=data)


@router.post("/seen", response_model=ApiResponse[DigestCursorModel])
def mark_digest_seen(body: MarkSeenRequest, db: Session = Depends(get_db)) -> dict:
    """推進游標到前端這批回應的 cursor（不是送出當下的最大 id）；逐欄 max，重送無害。"""
    written = save_cursor(DigestCursor(**body.cursor.model_dump()), db)
    return success_response(data=DigestCursorModel(**written.__dict__))
