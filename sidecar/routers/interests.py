"""興趣清單與 feed 黑名單 API。"""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Interest, ExcludeTerm, InterestKind
from schemas.response import ApiResponse, success_response
from services.feed_defaults import ensure_default_exclude_terms
from services.feed_generator import is_usable_exclude_term
from services.github import get_github_service
from services.trending_topics import (
    clear_progress,
    compute_trending_topics,
    load_cached,
    load_progress,
    save_cache,
    save_progress,
)
from middleware.rate_limit import limiter

router = APIRouter(prefix="/api/interests", tags=["interests"])


class InterestCreate(BaseModel):
    term: str = Field(..., min_length=1, max_length=100)
    kind: str = Field(InterestKind.TOPIC)
    weight: int = Field(2, ge=1, le=3)

    @field_validator("kind")
    @classmethod
    def validate_kind(cls, v: str) -> str:
        if v not in (InterestKind.TOPIC, InterestKind.LANGUAGE, InterestKind.KEYWORD):
            raise ValueError(f"kind must be one of {[k.value for k in InterestKind]}")
        return v

    @field_validator("term")
    @classmethod
    def normalize_term(cls, v: str) -> str:
        return v.strip().lower()


class InterestOut(BaseModel):
    id: int
    term: str
    kind: str
    weight: int


class InterestListResponse(BaseModel):
    interests: list[InterestOut]


class ExcludeTermCreate(BaseModel):
    term: str = Field(..., min_length=1, max_length=100)

    @field_validator("term")
    @classmethod
    def normalize_term(cls, v: str) -> str:
        normalized = v.strip().lower()
        # 比對時標點會被正規化掉（c++ → c、c# → c），塌成 1 字元的詞若放行，
        # 使用者會看到它列在黑名單裡卻毫無作用（或反過來誤擋 awesome-c）。
        # 在入口就擋掉，而不是存進去後在比對層靜默忽略。
        if not is_usable_exclude_term(normalized):
            raise ValueError(
                "term must contain at least 2 letters or digits after punctuation is stripped")
        return normalized


class ExcludeTermOut(BaseModel):
    id: int
    term: str


class ExclusionListResponse(BaseModel):
    exclusions: list[ExcludeTermOut]


def _to_out(row: Interest) -> InterestOut:
    return InterestOut(id=row.id, term=row.term, kind=row.kind, weight=row.weight)


@router.get("", response_model=ApiResponse[InterestListResponse])
def list_interests(db: Session = Depends(get_db)) -> dict:
    rows = db.query(Interest).order_by(Interest.weight.desc(), Interest.term).all()
    return success_response(InterestListResponse(interests=[_to_out(r) for r in rows]))


@router.post("", response_model=ApiResponse[InterestOut])
def create_interest(payload: InterestCreate, db: Session = Depends(get_db)) -> dict:
    exists = db.query(Interest).filter(
        Interest.term == payload.term, Interest.kind == payload.kind).first()
    if exists:
        raise HTTPException(status_code=409, detail="Interest already exists")
    row = Interest(term=payload.term, kind=payload.kind, weight=payload.weight)
    db.add(row)
    db.commit()
    db.refresh(row)
    return success_response(_to_out(row))


@router.put("/{interest_id}", response_model=ApiResponse[InterestOut])
def update_interest(interest_id: int, payload: InterestCreate,
                    db: Session = Depends(get_db)) -> dict:
    row = db.get(Interest, interest_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Interest not found")
    # Check for duplicate (term, kind) excluding self
    exists = db.query(Interest).filter(
        Interest.term == payload.term,
        Interest.kind == payload.kind,
        Interest.id != interest_id
    ).first()
    if exists:
        raise HTTPException(status_code=409, detail="Interest already exists")
    row.term, row.kind, row.weight = payload.term, payload.kind, payload.weight
    db.commit()
    db.refresh(row)
    return success_response(_to_out(row))


@router.delete("/{interest_id}", response_model=ApiResponse[dict])
def delete_interest(interest_id: int, db: Session = Depends(get_db)) -> dict:
    row = db.get(Interest, interest_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Interest not found")
    db.delete(row)
    db.commit()
    return success_response({"deleted": interest_id})


@router.get("/exclusions", response_model=ApiResponse[ExclusionListResponse])
def list_exclusions(db: Session = Depends(get_db)) -> dict:
    ensure_default_exclude_terms(db)
    rows = db.query(ExcludeTerm).order_by(ExcludeTerm.term).all()
    return success_response(ExclusionListResponse(
        exclusions=[ExcludeTermOut(id=r.id, term=r.term) for r in rows]))


@router.post("/exclusions", response_model=ApiResponse[ExcludeTermOut])
def add_exclusion(payload: ExcludeTermCreate, db: Session = Depends(get_db)) -> dict:
    exists = db.query(ExcludeTerm).filter(ExcludeTerm.term == payload.term).first()
    if exists:
        raise HTTPException(status_code=409, detail="Exclusion already exists")
    row = ExcludeTerm(term=payload.term)
    db.add(row)
    db.commit()
    db.refresh(row)
    return success_response(ExcludeTermOut(id=row.id, term=row.term))


@router.delete("/exclusions/{term_id}", response_model=ApiResponse[dict])
def remove_exclusion(term_id: int, db: Session = Depends(get_db)) -> dict:
    row = db.get(ExcludeTerm, term_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Exclusion not found")
    db.delete(row)
    db.commit()
    return success_response({"deleted": term_id})


# --- 熱門主題建議 ---


class TrendingTopicOut(BaseModel):
    topic: str
    sample_count: int
    global_count: int
    heat: float
    already_added: bool


class TrendingResponse(BaseModel):
    topics: list[TrendingTopicOut]
    computed_at: str | None  # None 代表從未計算過


class TrendingProgress(BaseModel):
    """重算進行中的進度；running 為 False 時其餘欄位無意義。"""
    running: bool
    phase: str = ""      # "sampling"（取樣）或 "counting"（查熱度）
    done: int = 0
    total: int = 0


@router.get("/trending", response_model=ApiResponse[TrendingResponse])
def get_trending(db: Session = Depends(get_db)) -> dict:
    """讀取上次算好的熱門主題。永遠回快取，不會自己去打 GitHub。

    刻意不自動更新：趨勢以週為單位變動，每日重算多半是在重算同一份答案，
    卻要吃掉與搜尋共用的每分鐘 30 次配額。由使用者按下更新才重算。
    """
    cached, computed_at = load_cached(db)
    return success_response(
        TrendingResponse(
            topics=[TrendingTopicOut(**row) for row in cached],
            computed_at=computed_at,
        )
    )


@router.post("/trending/refresh", response_model=ApiResponse[TrendingResponse])
@limiter.limit("2/minute")
async def refresh_trending(request: Request, db: Session = Depends(get_db)) -> dict:
    """重新計算熱門主題。會連打 6–36 次搜尋請求，故限流。

    限流理由：搜尋配額是每分鐘 30 次，且與 feed 產生、探索頁搜尋共用。
    連按更新會把配額吃光，症狀會出現在別的頁面（探索搜尋突然失敗），
    很難聯想到是這裡造成的。
    """
    _ = request  # 由 @limiter.limit decorator 隱式使用
    github = get_github_service()
    try:
        topics = await compute_trending_topics(
            db, github, on_progress=lambda phase, done, total: save_progress(db, phase, done, total)
        )
        computed_at = save_cache(db, topics)
    finally:
        # 失敗也要清，否則進度會永遠卡在中途，前端誤以為還在跑
        clear_progress(db)
    return success_response(
        TrendingResponse(
            topics=[TrendingTopicOut(**t.__dict__) for t in topics],
            computed_at=computed_at,
        )
    )


@router.get("/trending/progress", response_model=ApiResponse[TrendingProgress])
def get_trending_progress(db: Session = Depends(get_db)) -> dict:
    """重算進行中的進度，供前端輪詢。

    重算是一個長達一兩分鐘的單一請求，前端在等待期間拿不到任何中間狀態，
    只能顯示一句靜態文字——使用者無法分辨「還在跑」與「卡住了」。
    """
    progress = load_progress(db)
    if not progress:
        return success_response(TrendingProgress(running=False))
    return success_response(
        TrendingProgress(
            running=True,
            phase=str(progress.get("phase", "")),
            done=int(progress.get("done", 0)),
            total=int(progress.get("total", 0)),
        )
    )
