"""For You feed API 端點。"""
import json
import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import FeedItem, SeenRepo, FeedFeedback
from middleware.rate_limit import limiter
from schemas.response import ApiResponse, success_response
from services.feed_generator import generate_feed
from services.github import get_github_service
from utils.time import local_today

router = APIRouter(prefix="/api/feed", tags=["feed"])
logger = logging.getLogger(__name__)


class FeedReason(BaseModel):
    matched: list[str] = []
    stars: int = 0
    age_days: int | None = None
    # repo 最後一次 push 的時間；判斷「這專案還活著嗎」的關鍵依據，
    # 產生 feed 時就已寫入 reason_json，此處只是把它輸出給前端。
    pushed_at: str | None = None


class FeedItemOut(BaseModel):
    id: int
    github_id: int
    full_name: str
    owner: str
    name: str
    description: str | None
    language: str | None
    topics: list[str]
    stars: int
    forks: int
    url: str
    owner_avatar_url: str | None
    score: float
    reason: FeedReason
    feedback: str | None


class FeedResponse(BaseModel):
    feed_date: str
    items: list[FeedItemOut]


class GenerateResult(BaseModel):
    feed_date: str
    generated: int


class FeedbackPayload(BaseModel):
    action: str

    @field_validator("action")
    @classmethod
    def validate_action(cls, v: str) -> str:
        if v not in (FeedFeedback.STARRED, FeedFeedback.DISMISSED):
            raise ValueError("action must be 'starred' or 'dismissed'")
        return v


def _to_out(item: FeedItem) -> FeedItemOut:
    cand = item.candidate
    reason_raw = json.loads(item.reason_json) if item.reason_json else {}
    return FeedItemOut(
        id=item.id,
        github_id=cand.github_id,
        full_name=cand.full_name,
        owner=cand.owner,
        name=cand.name,
        description=cand.description,
        language=cand.language,
        topics=json.loads(cand.topics) if cand.topics else [],
        stars=cand.stars,
        forks=cand.forks,
        url=cand.url,
        owner_avatar_url=cand.owner_avatar_url,
        score=item.score,
        reason=FeedReason(
            matched=reason_raw.get("matched", []),
            stars=reason_raw.get("stars", 0),
            age_days=reason_raw.get("age_days"),
            pushed_at=reason_raw.get("pushed_at"),
        ),
        feedback=item.feedback,
    )


@router.get("", response_model=ApiResponse[FeedResponse])
def get_feed(feed_date: date | None = Query(None),
             db: Session = Depends(get_db)) -> dict:
    # feed_date 用本機日期而非 UTC 日期：cron 產生批次與使用者查詢
    # 必須用同一套日曆日鍵，否則在 UTC+8 等時區會整段時間對不上（見 local_today）
    target = feed_date or local_today()
    items = (db.query(FeedItem)
             .filter(FeedItem.feed_date == target)
             .order_by(FeedItem.score.desc())
             .all())
    return success_response(FeedResponse(
        feed_date=target.isoformat(), items=[_to_out(i) for i in items]))


@router.post("/generate", response_model=ApiResponse[GenerateResult])
@limiter.limit("6/minute")
async def trigger_generate(request: Request, db: Session = Depends(get_db)) -> dict:
    """觸發當日 feed 產生。

    限流理由：本端點會對每個興趣各打一次 GitHub search，而前端在 feed 為空時
    每次掛載 Discovery 都會自動呼叫；不限流時幾次換頁就能把與搜尋共用的
    30 次/分鐘配額吃光。
    """
    _ = request  # 由 @limiter.limit decorator 隱式使用
    target = local_today()
    github = get_github_service()
    count = await generate_feed(db, github, target)
    return success_response(GenerateResult(feed_date=target.isoformat(), generated=count))


@router.post("/items/{item_id}/feedback", response_model=ApiResponse[FeedItemOut])
def submit_feedback(item_id: int, payload: FeedbackPayload,
                    db: Session = Depends(get_db)) -> dict:
    item = db.get(FeedItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Feed item not found")
    item.feedback = payload.action
    if payload.action == FeedFeedback.DISMISSED:
        seen = db.query(SeenRepo).filter(
            SeenRepo.github_id == item.candidate.github_id).first()
        if seen:
            seen.dismissed = True
    db.commit()
    db.refresh(item)
    return success_response(_to_out(item))
