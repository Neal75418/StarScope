# For You Feed — Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Discovery 頁預設畫面改為個人化每日 feed：依使用者興趣清單搜尋 GitHub、以「興趣匹配 × 新鮮度 × 粗略動能」評分，每日產出 15–20 條含推薦理由的項目。

**Architecture:** sidecar 新增 5 張表（interests / exclude_terms / feed_candidates / feed_items / seen_repos）、純函數評分器、feed 產生管線（重用 `GitHubService.search_repos`）與兩個新 router；scheduler 加每日任務，前端加 useFeed / useInterests hooks、Discovery feed UI 與 Settings 興趣管理區塊。設計依據：`docs/superpowers/specs/2026-08-01-for-you-feed-design.md`。

**Tech Stack:** Python 3.12 / FastAPI / SQLAlchemy 2.0 (Mapped) / APScheduler；React 19 / TypeScript / TanStack Query / Vitest / Playwright。

## Global Constraints

- 表結構由 `Base.metadata.create_all`（`db/database.py:init_db`）於啟動時自動建立——與現有 runtime 機制一致，**不需要** Alembic revision。
- 所有 API 端點回傳 `ApiResponse[T]` envelope（`schemas/response.py` 的 `success_response`）。
- 評分權重（抄自 spec，不得改動）：topic ×1.0、language ×0.6、keyword ×0.4；freshness 30 天內 = 1.0、180 天 = 0.0 線性衰減；momentum = log1p(stars ÷ 存在天數)。
- Feed 每日上限 20 條；同一 term 來源最多 7 條（= ceil(20/3) 多樣性上限）。
- 黑名單初始值（抄自 spec）：`awesome`、`interview`、`roadmap`、`tutorial`。
- i18n：所有新 UI 字串必須同時提供 `en` 與 `zh-TW`（`src/i18n/translations.ts`）。
- Commit 遵循 Conventional Commits；每個 commit 前跑該任務對應的測試。
- 後端測試用 `tests/conftest.py` 現有 fixtures（`test_db`、in-memory SQLite）；前端測試放各目錄 `__tests__/`。

---

### Task 1: DB models — 5 張新表

**Files:**
- Modify: `sidecar/db/models.py`（檔尾追加）
- Test: `sidecar/tests/test_feed_models.py`

**Interfaces:**
- Produces: `Interest(term, kind, weight)`、`ExcludeTerm(term)`、`FeedCandidate(github_id, full_name, …)`、`FeedItem(candidate_id, feed_date, score, reason_json, feedback)`、`SeenRepo(github_id, dismissed)`；enums `InterestKind(TOPIC/LANGUAGE/KEYWORD)`、`FeedFeedback(STARRED/DISMISSED)`

- [ ] **Step 1: Write the failing test**

```python
# sidecar/tests/test_feed_models.py
"""Feed 相關資料表的模型測試。"""
from datetime import date

from db.models import (
    Interest, InterestKind, ExcludeTerm, FeedCandidate, FeedItem, SeenRepo,
)


def test_interest_crud(test_db):
    test_db.add(Interest(term="tauri", kind=InterestKind.TOPIC, weight=3))
    test_db.commit()
    row = test_db.query(Interest).one()
    assert (row.term, row.kind, row.weight) == ("tauri", "topic", 3)
    assert row.created_at is not None


def test_interest_defaults(test_db):
    test_db.add(Interest(term="rust"))
    test_db.commit()
    row = test_db.query(Interest).one()
    assert row.kind == InterestKind.TOPIC
    assert row.weight == 2


def test_feed_item_links_candidate(test_db):
    cand = FeedCandidate(
        github_id=1, full_name="a/b", owner="a", name="b",
        url="https://github.com/a/b", stars=10, forks=1,
    )
    test_db.add(cand)
    test_db.commit()
    item = FeedItem(candidate_id=cand.id, feed_date=date(2026, 8, 1),
                    score=1.5, reason_json="{}")
    test_db.add(item)
    test_db.commit()
    assert test_db.query(FeedItem).one().candidate.full_name == "a/b"


def test_seen_repo_dismiss_default_false(test_db):
    test_db.add(SeenRepo(github_id=1, full_name="a/b"))
    test_db.commit()
    assert test_db.query(SeenRepo).one().dismissed is False


def test_exclude_term(test_db):
    test_db.add(ExcludeTerm(term="awesome"))
    test_db.commit()
    assert test_db.query(ExcludeTerm).one().term == "awesome"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && pytest tests/test_feed_models.py -v`
Expected: FAIL — `ImportError: cannot import name 'Interest'`

- [ ] **Step 3: Write the models**

在 `sidecar/db/models.py` 檔尾追加（`Boolean` 需補進檔頭的 sqlalchemy import）：

```python
# --- For You Feed (Phase A) ---

class InterestKind(StrEnum):
    """興趣項目的匹配種類。"""
    TOPIC = "topic"
    LANGUAGE = "language"
    KEYWORD = "keyword"


class FeedFeedback(StrEnum):
    """Feed 項目的使用者回饋。"""
    STARRED = "starred"
    DISMISSED = "dismissed"


class Interest(Base):
    """使用者興趣清單，驅動 feed 候選搜尋與評分。"""
    __tablename__ = "interests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    term: Mapped[str] = mapped_column(String(100), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default=InterestKind.TOPIC)
    weight: Mapped[int] = mapped_column(Integer, nullable=False, default=2)  # 1–3
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    __table_args__ = (UniqueConstraint("term", "kind", name="uq_interests_term_kind"),)


class ExcludeTerm(Base):
    """Feed 黑名單關鍵字，命中者不進 feed。"""
    __tablename__ = "exclude_terms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    term: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)


class FeedCandidate(Base):
    """搜尋到的候選 repo（metadata 暫存池，與 watchlist 的 repos 表無關）。"""
    __tablename__ = "feed_candidates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    github_id: Mapped[int] = mapped_column(Integer, nullable=False, unique=True)
    full_name: Mapped[str] = mapped_column(String(512), nullable=False)
    owner: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    language: Mapped[str | None] = mapped_column(String(100), nullable=True)
    topics: Mapped[str | None] = mapped_column(String(2048), nullable=True)  # JSON 陣列
    stars: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    forks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    url: Mapped[str] = mapped_column(String(1024), nullable=False)
    owner_avatar_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    repo_created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    repo_pushed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    feed_items: Mapped[list["FeedItem"]] = relationship(
        "FeedItem", back_populates="candidate", cascade=CASCADE_DELETE_ORPHAN)


class FeedItem(Base):
    """每日 feed 產出項目，含評分與可回溯的推薦理由。"""
    __tablename__ = "feed_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    candidate_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("feed_candidates.id"), nullable=False)
    feed_date: Mapped[date] = mapped_column(Date, nullable=False)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    reason_json: Mapped[str] = mapped_column(String(2048), nullable=False)
    feedback: Mapped[str | None] = mapped_column(String(20), nullable=True)  # FeedFeedback
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    candidate: Mapped["FeedCandidate"] = relationship(
        "FeedCandidate", back_populates="feed_items")

    __table_args__ = (
        UniqueConstraint("candidate_id", "feed_date", name="uq_feed_items_candidate_date"),
        Index("ix_feed_items_feed_date", "feed_date"),
    )


class SeenRepo(Base):
    """已在 feed 出現過的 repo；推過不再推，dismissed 者永不回鍋。"""
    __tablename__ = "seen_repos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    github_id: Mapped[int] = mapped_column(Integer, nullable=False, unique=True)
    full_name: Mapped[str] = mapped_column(String(512), nullable=False)
    last_shown_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    dismissed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sidecar && pytest tests/test_feed_models.py -v`
Expected: 5 PASS

- [ ] **Step 5: Run mypy 與既有全套後端測試（確認未破壞）**

Run: `cd sidecar && mypy db/models.py && pytest tests/ -q`
Expected: mypy clean；全數 PASS

- [ ] **Step 6: Commit**

```bash
git add sidecar/db/models.py sidecar/tests/test_feed_models.py
git commit -m "feat(feed): add interests/exclude_terms/feed_candidates/feed_items/seen_repos models"
```

---

### Task 2: 評分器（純函數，窮舉測試）

**Files:**
- Create: `sidecar/services/feed_scoring.py`
- Test: `sidecar/tests/test_feed_scoring.py`

**Interfaces:**
- Consumes: `Interest`, `InterestKind`（Task 1）
- Produces:
  - `compute_interest_match(topics: list[str], language: str | None, name: str, description: str | None, interests: list[Interest]) -> tuple[float, list[str]]`（回傳 (分數, 命中標籤列表如 `["topic:tauri"]`)）
  - `compute_freshness(pushed_at: datetime | None, now: datetime) -> float`
  - `compute_momentum_lite(stars: int, created_at: datetime | None, now: datetime) -> float`
  - `score_candidate(topics, language, name, description, stars, created_at, pushed_at, interests, now) -> ScoreBreakdown`（dataclass：`score, interest_score, freshness, momentum, matched_terms`）

- [ ] **Step 1: Write the failing tests（門檻與邊界窮舉）**

```python
# sidecar/tests/test_feed_scoring.py
"""Feed 評分器單元測試 — 純函數，窮舉邊界。"""
import math
from datetime import datetime, timedelta

from db.models import Interest, InterestKind
from services.feed_scoring import (
    compute_interest_match, compute_freshness, compute_momentum_lite, score_candidate,
)

NOW = datetime(2026, 8, 1, 12, 0, 0)


def _interest(term, kind, weight=2):
    return Interest(term=term, kind=kind, weight=weight)


# --- interest_match：三種 kind × 命中/未命中 ---

def test_topic_match_full_weight():
    score, matched = compute_interest_match(
        ["tauri", "rust"], None, "x", None, [_interest("tauri", InterestKind.TOPIC, 3)])
    assert score == 3 * 1.0
    assert matched == ["topic:tauri"]


def test_topic_match_case_insensitive():
    score, _ = compute_interest_match(
        ["Tauri"], None, "x", None, [_interest("tauri", InterestKind.TOPIC, 1)])
    assert score == 1.0


def test_language_match_weight_06():
    score, matched = compute_interest_match(
        [], "Rust", "x", None, [_interest("rust", InterestKind.LANGUAGE, 2)])
    assert score == 2 * 0.6
    assert matched == ["language:rust"]


def test_keyword_match_in_name_weight_04():
    score, _ = compute_interest_match(
        [], None, "my-quant-tool", None, [_interest("quant", InterestKind.KEYWORD, 2)])
    assert score == 2 * 0.4


def test_keyword_match_in_description():
    score, _ = compute_interest_match(
        [], None, "x", "a quant backtester", [_interest("quant", InterestKind.KEYWORD, 1)])
    assert score == 0.4


def test_keyword_no_description_no_crash():
    score, matched = compute_interest_match(
        [], None, "x", None, [_interest("quant", InterestKind.KEYWORD, 1)])
    assert score == 0.0 and matched == []


def test_multiple_hits_sum():
    interests = [
        _interest("tauri", InterestKind.TOPIC, 3),
        _interest("rust", InterestKind.LANGUAGE, 2),
    ]
    score, matched = compute_interest_match(["tauri"], "Rust", "x", None, interests)
    assert score == 3 * 1.0 + 2 * 0.6
    assert matched == ["topic:tauri", "language:rust"]


def test_no_interests_zero():
    assert compute_interest_match(["tauri"], "Rust", "x", None, []) == (0.0, [])


# --- freshness：30 天全額 → 180 天歸零，端點窮舉 ---

def test_freshness_none_pushed_at_is_zero():
    assert compute_freshness(None, NOW) == 0.0


def test_freshness_today():
    assert compute_freshness(NOW, NOW) == 1.0


def test_freshness_at_exactly_30_days():
    assert compute_freshness(NOW - timedelta(days=30), NOW) == 1.0


def test_freshness_at_105_days_is_half():
    # 30→180 線性：105 天位於中點
    assert abs(compute_freshness(NOW - timedelta(days=105), NOW) - 0.5) < 1e-9


def test_freshness_at_180_days_is_zero():
    assert compute_freshness(NOW - timedelta(days=180), NOW) == 0.0


def test_freshness_beyond_180_days_clamped_zero():
    assert compute_freshness(NOW - timedelta(days=400), NOW) == 0.0


# --- momentum：log1p(stars/age)，邊界窮舉 ---

def test_momentum_created_today_age_floor_one_day():
    # age 下限 1 天，避免除以零
    assert compute_momentum_lite(100, NOW, NOW) == math.log1p(100.0)


def test_momentum_zero_stars():
    assert compute_momentum_lite(0, NOW - timedelta(days=10), NOW) == 0.0


def test_momentum_none_created_at_is_zero():
    assert compute_momentum_lite(500, None, NOW) == 0.0


def test_momentum_typical():
    got = compute_momentum_lite(380, NOW - timedelta(days=45), NOW)
    assert abs(got - math.log1p(380 / 45)) < 1e-9


# --- score_candidate：乘法組合 ---

def test_score_is_product_of_three_factors():
    b = score_candidate(
        topics=["tauri"], language="Rust", name="x", description=None,
        stars=380, created_at=NOW - timedelta(days=45),
        pushed_at=NOW - timedelta(days=5),
        interests=[_interest("tauri", InterestKind.TOPIC, 2)], now=NOW)
    assert abs(b.score - b.interest_score * b.freshness * b.momentum) < 1e-9
    assert b.matched_terms == ["topic:tauri"]


def test_score_zero_when_no_interest_match():
    b = score_candidate(
        topics=[], language=None, name="x", description=None,
        stars=1000, created_at=NOW - timedelta(days=10),
        pushed_at=NOW, interests=[_interest("tauri", InterestKind.TOPIC, 3)], now=NOW)
    assert b.score == 0.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sidecar && pytest tests/test_feed_scoring.py -v`
Expected: FAIL — `ModuleNotFoundError: services.feed_scoring`

- [ ] **Step 3: Write the implementation**

```python
# sidecar/services/feed_scoring.py
"""
For You feed 評分器 — 純函數，無 I/O。

score = interest_match × freshness × momentum_lite
權重與衰減參數定義見 docs/superpowers/specs/2026-08-01-for-you-feed-design.md。
"""
import math
from dataclasses import dataclass
from datetime import datetime

from db.models import Interest, InterestKind

KIND_MULTIPLIER: dict[str, float] = {
    InterestKind.TOPIC: 1.0,
    InterestKind.LANGUAGE: 0.6,
    InterestKind.KEYWORD: 0.4,
}
FRESH_FULL_DAYS = 30.0   # 此天數內 pushed 視為滿分
FRESH_ZERO_DAYS = 180.0  # 此天數以上歸零


@dataclass(frozen=True)
class ScoreBreakdown:
    score: float
    interest_score: float
    freshness: float
    momentum: float
    matched_terms: list[str]


def compute_interest_match(
    topics: list[str],
    language: str | None,
    name: str,
    description: str | None,
    interests: list[Interest],
) -> tuple[float, list[str]]:
    topics_lower = {t.lower() for t in topics}
    name_lower = name.lower()
    desc_lower = (description or "").lower()
    lang_lower = (language or "").lower()

    total = 0.0
    matched: list[str] = []
    for interest in interests:
        term = interest.term.lower()
        kind = interest.kind
        hit = (
            (kind == InterestKind.TOPIC and term in topics_lower)
            or (kind == InterestKind.LANGUAGE and lang_lower == term)
            or (kind == InterestKind.KEYWORD and (term in name_lower or term in desc_lower))
        )
        if hit:
            total += interest.weight * KIND_MULTIPLIER[kind]
            matched.append(f"{kind}:{interest.term}")
    return total, matched


def compute_freshness(pushed_at: datetime | None, now: datetime) -> float:
    if pushed_at is None:
        return 0.0
    days = max(0.0, (now - pushed_at).total_seconds() / 86400)
    if days <= FRESH_FULL_DAYS:
        return 1.0
    if days >= FRESH_ZERO_DAYS:
        return 0.0
    return 1.0 - (days - FRESH_FULL_DAYS) / (FRESH_ZERO_DAYS - FRESH_FULL_DAYS)


def compute_momentum_lite(stars: int, created_at: datetime | None, now: datetime) -> float:
    if created_at is None:
        return 0.0
    age_days = max(1.0, (now - created_at).total_seconds() / 86400)
    return math.log1p(max(0, stars) / age_days)


def score_candidate(
    topics: list[str],
    language: str | None,
    name: str,
    description: str | None,
    stars: int,
    created_at: datetime | None,
    pushed_at: datetime | None,
    interests: list[Interest],
    now: datetime,
) -> ScoreBreakdown:
    interest_score, matched = compute_interest_match(topics, language, name, description, interests)
    freshness = compute_freshness(pushed_at, now)
    momentum = compute_momentum_lite(stars, created_at, now)
    return ScoreBreakdown(
        score=interest_score * freshness * momentum,
        interest_score=interest_score,
        freshness=freshness,
        momentum=momentum,
        matched_terms=matched,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sidecar && pytest tests/test_feed_scoring.py -v && mypy services/feed_scoring.py`
Expected: 19 PASS；mypy clean

- [ ] **Step 5: Commit**

```bash
git add sidecar/services/feed_scoring.py sidecar/tests/test_feed_scoring.py
git commit -m "feat(feed): add pure scoring functions (interest match, freshness, momentum)"
```

---

### Task 3: Interests router（CRUD + 黑名單 + 預設值）

**Files:**
- Create: `sidecar/routers/interests.py`
- Create: `sidecar/services/feed_defaults.py`
- Test: `sidecar/tests/test_interests_router.py`

**Interfaces:**
- Consumes: `Interest`, `ExcludeTerm`, `InterestKind`（Task 1）
- Produces:
  - REST：`GET/POST /api/interests`、`PUT/DELETE /api/interests/{interest_id}`、`GET/POST /api/interests/exclusions`、`DELETE /api/interests/exclusions/{term_id}`
  - `ensure_default_exclude_terms(db: Session) -> None`（`services/feed_defaults.py`，Task 4 也會用）
  - Pydantic：`InterestOut(id, term, kind, weight)`、`InterestCreate(term, kind, weight)`、`ExcludeTermOut(id, term)`

- [ ] **Step 1: Write the failing tests**

```python
# sidecar/tests/test_interests_router.py
"""Interests CRUD 與黑名單 API 測試。"""
from db.models import Interest, ExcludeTerm, InterestKind

BASE = "/api/interests"


def test_list_empty(client):
    resp = client.get(BASE)
    assert resp.status_code == 200
    assert resp.json()["data"]["interests"] == []


def test_create_interest(client):
    resp = client.post(BASE, json={"term": "tauri", "kind": "topic", "weight": 3})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["term"] == "tauri" and data["weight"] == 3


def test_create_duplicate_term_kind_conflict(client):
    client.post(BASE, json={"term": "tauri", "kind": "topic", "weight": 2})
    resp = client.post(BASE, json={"term": "tauri", "kind": "topic", "weight": 1})
    assert resp.status_code == 409


def test_create_invalid_weight_rejected(client):
    resp = client.post(BASE, json={"term": "x", "kind": "topic", "weight": 4})
    assert resp.status_code == 422


def test_create_invalid_kind_rejected(client):
    resp = client.post(BASE, json={"term": "x", "kind": "banana", "weight": 2})
    assert resp.status_code == 422


def test_update_interest(client):
    created = client.post(BASE, json={"term": "rust", "kind": "language", "weight": 1})
    iid = created.json()["data"]["id"]
    resp = client.put(f"{BASE}/{iid}", json={"term": "rust", "kind": "language", "weight": 3})
    assert resp.status_code == 200
    assert resp.json()["data"]["weight"] == 3


def test_update_missing_404(client):
    resp = client.put(f"{BASE}/999", json={"term": "x", "kind": "topic", "weight": 1})
    assert resp.status_code == 404


def test_delete_interest(client):
    created = client.post(BASE, json={"term": "rust", "kind": "language", "weight": 1})
    iid = created.json()["data"]["id"]
    assert client.delete(f"{BASE}/{iid}").status_code == 200
    assert client.get(BASE).json()["data"]["interests"] == []


def test_exclusions_seeded_with_defaults(client):
    resp = client.get(f"{BASE}/exclusions")
    terms = {e["term"] for e in resp.json()["data"]["exclusions"]}
    assert terms == {"awesome", "interview", "roadmap", "tutorial"}


def test_add_and_remove_exclusion(client):
    resp = client.post(f"{BASE}/exclusions", json={"term": "boilerplate"})
    assert resp.status_code == 200
    tid = resp.json()["data"]["id"]
    assert client.delete(f"{BASE}/exclusions/{tid}").status_code == 200
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sidecar && pytest tests/test_interests_router.py -v`
Expected: FAIL（404 — router 未註冊）。注意 `client` fixture 在 conftest 中掛的是完整 app，本任務需同步把 router 掛進 `main.py`（Step 3）。

- [ ] **Step 3: Write defaults service + router，並註冊進 main.py**

```python
# sidecar/services/feed_defaults.py
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
```

```python
# sidecar/routers/interests.py
"""興趣清單與 feed 黑名單 API。"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Interest, ExcludeTerm, InterestKind
from schemas.response import ApiResponse, success_response
from services.feed_defaults import ensure_default_exclude_terms

router = APIRouter(prefix="/api/interests", tags=["interests"])
logger = logging.getLogger(__name__)


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
        return v.strip().lower()


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
```

`sidecar/main.py` 兩處修改：import 區加 `interests`，`include_router` 清單加 `interests`（放在 `app_settings` 之後）。

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sidecar && pytest tests/test_interests_router.py -v && mypy routers/interests.py services/feed_defaults.py`
Expected: 11 PASS；mypy clean

- [ ] **Step 5: Commit**

```bash
git add sidecar/routers/interests.py sidecar/services/feed_defaults.py \
        sidecar/tests/test_interests_router.py sidecar/main.py
git commit -m "feat(feed): add interests CRUD and exclusion list API with seeded defaults"
```

---

### Task 4: Feed 產生管線

**Files:**
- Create: `sidecar/services/feed_generator.py`
- Test: `sidecar/tests/test_feed_generator.py`

**Interfaces:**
- Consumes: Task 1 models、Task 2 `score_candidate`、Task 3 `ensure_default_exclude_terms`、現有 `GitHubService.search_repos`（duck-typed，測試用 fake）、現有 `Repo`（watchlist 排除）
- Produces: `async def generate_feed(db: Session, github, feed_date: date, now: datetime | None = None) -> int`（回傳寫入的 feed_items 數；當日已存在則直接回傳既有數量，不重打 API）

- [ ] **Step 1: Write the failing tests**

```python
# sidecar/tests/test_feed_generator.py
"""Feed 產生管線整合測試 — fake GitHubService，不打真 API。"""
from datetime import date, datetime, timedelta

import pytest

from db.models import (
    Interest, InterestKind, ExcludeTerm, FeedItem, SeenRepo, Repo, FeedCandidate,
)
from services.feed_generator import generate_feed, FEED_SIZE, MAX_PER_TERM

NOW = datetime(2026, 8, 1, 12, 0, 0)
TODAY = date(2026, 8, 1)


def _gh_item(gid: int, full_name: str, *, topics=None, language="Rust",
             stars=200, days_old=30, days_since_push=3):
    owner, name = full_name.split("/")
    return {
        "id": gid, "full_name": full_name, "name": name,
        "owner": {"login": owner, "avatar_url": f"https://a/{owner}"},
        "description": f"desc of {name}", "language": language,
        "topics": topics or [], "stargazers_count": stars, "forks_count": 5,
        "html_url": f"https://github.com/{full_name}",
        "created_at": (NOW - timedelta(days=days_old)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "pushed_at": (NOW - timedelta(days=days_since_push)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "updated_at": NOW.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "open_issues_count": 0, "license": None,
    }


class FakeGitHub:
    def __init__(self, items_by_term: dict[str, list[dict]]):
        self.items_by_term = items_by_term
        self.calls: list[dict] = []

    async def search_repos(self, **kwargs):
        self.calls.append(kwargs)
        term = kwargs.get("topic") or kwargs.get("language") or kwargs.get("query", "").split()[0]
        return {"items": self.items_by_term.get(term, []), "total_count": 0}


@pytest.mark.asyncio
async def test_no_interests_returns_zero(test_db):
    count = await generate_feed(test_db, FakeGitHub({}), TODAY, now=NOW)
    assert count == 0


@pytest.mark.asyncio
async def test_generates_scored_items_with_reason(test_db):
    test_db.add(Interest(term="tauri", kind=InterestKind.TOPIC, weight=3))
    test_db.commit()
    gh = FakeGitHub({"tauri": [_gh_item(1, "a/one", topics=["tauri"])]})
    count = await generate_feed(test_db, gh, TODAY, now=NOW)
    assert count == 1
    item = test_db.query(FeedItem).one()
    assert item.score > 0
    assert "topic:tauri" in item.reason_json
    assert test_db.query(SeenRepo).count() == 1  # 進 feed 即記入 seen


@pytest.mark.asyncio
async def test_seen_repo_not_recommended_again(test_db):
    test_db.add(Interest(term="tauri", kind=InterestKind.TOPIC, weight=3))
    test_db.add(SeenRepo(github_id=1, full_name="a/one"))
    test_db.commit()
    gh = FakeGitHub({"tauri": [_gh_item(1, "a/one", topics=["tauri"])]})
    assert await generate_feed(test_db, gh, TODAY, now=NOW) == 0


@pytest.mark.asyncio
async def test_excluded_term_filtered(test_db):
    test_db.add(Interest(term="tauri", kind=InterestKind.TOPIC, weight=3))
    test_db.add(ExcludeTerm(term="awesome"))
    test_db.commit()
    gh = FakeGitHub({"tauri": [
        _gh_item(1, "a/awesome-tauri", topics=["tauri"]),           # 名稱命中黑名單
        _gh_item(2, "a/ok", topics=["tauri", "awesome-list"]),      # topic 命中黑名單
        _gh_item(3, "a/fine", topics=["tauri"]),
    ]})
    assert await generate_feed(test_db, gh, TODAY, now=NOW) == 1
    assert test_db.query(FeedItem).one().candidate.full_name == "a/fine"


@pytest.mark.asyncio
async def test_watchlist_repo_excluded(test_db):
    test_db.add(Interest(term="tauri", kind=InterestKind.TOPIC, weight=3))
    test_db.add(Repo(owner="a", name="one", full_name="a/one",
                     url="https://github.com/a/one", github_id=1))
    test_db.commit()
    gh = FakeGitHub({"tauri": [_gh_item(1, "a/one", topics=["tauri"])]})
    assert await generate_feed(test_db, gh, TODAY, now=NOW) == 0


@pytest.mark.asyncio
async def test_single_term_capped_at_max_per_term(test_db):
    # 只有一個興趣時，多樣性上限就是 feed 上限
    test_db.add(Interest(term="rust", kind=InterestKind.LANGUAGE, weight=3))
    test_db.commit()
    items = [_gh_item(i, f"a/r{i}", language="Rust", stars=100 + i) for i in range(40)]
    gh = FakeGitHub({"rust": items})
    assert await generate_feed(test_db, gh, TODAY, now=NOW) == MAX_PER_TERM


@pytest.mark.asyncio
async def test_feed_size_cap_with_multiple_terms(test_db):
    # 三個興趣各給 40 個候選 → 各自被 MAX_PER_TERM 截斷後仍超過 FEED_SIZE → 總數 = FEED_SIZE
    for lang in ("rust", "go", "python"):
        test_db.add(Interest(term=lang, kind=InterestKind.LANGUAGE, weight=2))
    test_db.commit()
    gh = FakeGitHub({
        lang: [_gh_item(base + i, f"{lang}/r{i}", language=lang.capitalize(),
                        stars=100 + i) for i in range(40)]
        for base, lang in ((0, "rust"), (100, "go"), (200, "python"))
    })
    assert await generate_feed(test_db, gh, TODAY, now=NOW) == FEED_SIZE


@pytest.mark.asyncio
async def test_diversity_cap_per_term(test_db):
    # tauri 來源給 20 個、rust 來源給 20 個 → tauri 最多 MAX_PER_TERM 條
    test_db.add(Interest(term="tauri", kind=InterestKind.TOPIC, weight=3))
    test_db.add(Interest(term="rust", kind=InterestKind.LANGUAGE, weight=1))
    test_db.commit()
    gh = FakeGitHub({
        "tauri": [_gh_item(i, f"t/r{i}", topics=["tauri"], language=None, stars=500)
                  for i in range(20)],
        "rust": [_gh_item(100 + i, f"r/r{i}", language="Rust", stars=50)
                 for i in range(20)],
    })
    await generate_feed(test_db, gh, TODAY, now=NOW)
    items = test_db.query(FeedItem).all()
    tauri_count = sum(1 for it in items if "topic:tauri" in it.reason_json)
    assert tauri_count == MAX_PER_TERM


@pytest.mark.asyncio
async def test_idempotent_same_day(test_db):
    test_db.add(Interest(term="tauri", kind=InterestKind.TOPIC, weight=3))
    test_db.commit()
    gh = FakeGitHub({"tauri": [_gh_item(1, "a/one", topics=["tauri"])]})
    assert await generate_feed(test_db, gh, TODAY, now=NOW) == 1
    assert await generate_feed(test_db, gh, TODAY, now=NOW) == 1  # 回既有數量
    assert len(gh.calls) == 1  # 第二次不再打 API


@pytest.mark.asyncio
async def test_zero_score_items_dropped(test_db):
    # 只命中興趣但 momentum=0（zero stars）→ score 0 → 不進 feed
    test_db.add(Interest(term="tauri", kind=InterestKind.TOPIC, weight=3))
    test_db.commit()
    gh = FakeGitHub({"tauri": [_gh_item(1, "a/dead", topics=["tauri"], stars=0)]})
    assert await generate_feed(test_db, gh, TODAY, now=NOW) == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sidecar && pytest tests/test_feed_generator.py -v`
Expected: FAIL — `ModuleNotFoundError: services.feed_generator`

- [ ] **Step 3: Write the implementation**

```python
# sidecar/services/feed_generator.py
"""
For You feed 產生管線。

每日流程：讀興趣 → 每個興趣打一次 GitHub search →
去重/黑名單/seen/watchlist 過濾 → 評分排序 → 多樣性上限 → 寫 feed_items + seen_repos。
"""
import json
import logging
import math
from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from db.models import (
    Interest, InterestKind, ExcludeTerm, FeedCandidate, FeedItem, SeenRepo, Repo,
)
from services.feed_defaults import ensure_default_exclude_terms
from services.feed_scoring import score_candidate
from utils.time import utc_now

logger = logging.getLogger(__name__)

FEED_SIZE = 20
MAX_PER_TERM = math.ceil(FEED_SIZE / 3)  # 同一 term 來源的多樣性上限（=7）
CANDIDATE_WINDOW_DAYS = 60   # 只搜此天數內建立的 repo
MIN_STARS = 20               # 過濾雜訊下限
PER_QUERY_RESULTS = 30


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")


def _is_excluded(item: dict, exclude: set[str]) -> bool:
    haystacks = [item["full_name"].lower(), *[t.lower() for t in item.get("topics", [])]]
    return any(term in hay for term in exclude for hay in haystacks)


async def _fetch_candidates(github, interests: list[Interest],
                            created_after: str) -> dict[int, dict]:
    """每個興趣打一次 search，以 github_id 去重合併。"""
    merged: dict[int, dict] = {}
    for interest in interests:
        base_q = f"created:>{created_after}"
        kwargs: dict = {
            "query": base_q, "min_stars": MIN_STARS,
            "sort": "stars", "order": "desc",
            "page": 1, "per_page": PER_QUERY_RESULTS, "hide_archived": True,
        }
        if interest.kind == InterestKind.TOPIC:
            kwargs["topic"] = interest.term
        elif interest.kind == InterestKind.LANGUAGE:
            kwargs["language"] = interest.term
        else:  # keyword
            kwargs["query"] = f"{interest.term} {base_q}"
        try:
            result = await github.search_repos(**kwargs)
        except Exception as e:  # 單一查詢失敗不拖垮整批
            logger.warning(f"[feed] 興趣 {interest.term} 搜尋失敗: {e}")
            continue
        for item in result.get("items", []):
            merged.setdefault(item["id"], item)
    return merged


def _upsert_candidate(db: Session, item: dict) -> FeedCandidate:
    cand = db.query(FeedCandidate).filter(
        FeedCandidate.github_id == item["id"]).first()
    if cand is None:
        cand = FeedCandidate(github_id=item["id"])
        db.add(cand)
    cand.full_name = item["full_name"]
    cand.owner = item["owner"]["login"]
    cand.name = item["name"]
    cand.description = (item.get("description") or "")[:2048] or None
    cand.language = item.get("language")
    cand.topics = json.dumps(item.get("topics", []))
    cand.stars = item.get("stargazers_count", 0)
    cand.forks = item.get("forks_count", 0)
    cand.url = item["html_url"]
    cand.owner_avatar_url = item["owner"].get("avatar_url")
    cand.repo_created_at = _parse_dt(item.get("created_at"))
    cand.repo_pushed_at = _parse_dt(item.get("pushed_at"))
    return cand


async def generate_feed(db: Session, github, feed_date: date,
                        now: datetime | None = None) -> int:
    """產生指定日期的 feed。當日已存在則回傳既有數量（不重打 API）。"""
    existing = db.query(FeedItem).filter(FeedItem.feed_date == feed_date).count()
    if existing > 0:
        return existing

    now = now or utc_now()
    interests = db.query(Interest).all()
    if not interests:
        return 0

    ensure_default_exclude_terms(db)
    exclude = {e.term.lower() for e in db.query(ExcludeTerm).all()}
    seen_ids = {s.github_id for s in db.query(SeenRepo).all()}
    watchlist_ids = {r.github_id for r in db.query(Repo).all() if r.github_id}
    watchlist_names = {r.full_name.lower() for r in db.query(Repo).all()}

    created_after = (now - timedelta(days=CANDIDATE_WINDOW_DAYS)).date().isoformat()
    merged = await _fetch_candidates(github, interests, created_after)

    scored: list[tuple[float, dict, list[str]]] = []
    for item in merged.values():
        if item["id"] in seen_ids or item["id"] in watchlist_ids:
            continue
        if item["full_name"].lower() in watchlist_names:
            continue
        if _is_excluded(item, exclude):
            continue
        breakdown = score_candidate(
            topics=item.get("topics", []),
            language=item.get("language"),
            name=item["name"],
            description=item.get("description"),
            stars=item.get("stargazers_count", 0),
            created_at=_parse_dt(item.get("created_at")),
            pushed_at=_parse_dt(item.get("pushed_at")),
            interests=interests,
            now=now,
        )
        if breakdown.score <= 0:
            continue
        scored.append((breakdown.score, item, breakdown.matched_terms))

    scored.sort(key=lambda t: t[0], reverse=True)

    # 多樣性上限：以首個命中 term 為該項目的來源分組
    per_term_count: dict[str, int] = {}
    written = 0
    for score, item, matched in scored:
        if written >= FEED_SIZE:
            break
        primary = matched[0] if matched else "unknown"
        if per_term_count.get(primary, 0) >= MAX_PER_TERM:
            continue
        cand = _upsert_candidate(db, item)
        db.flush()  # 取得 cand.id
        age_days = None
        if cand.repo_created_at:
            age_days = int((now - cand.repo_created_at).total_seconds() // 86400)
        reason = {
            "matched": matched,
            "stars": cand.stars,
            "age_days": age_days,
            "pushed_at": item.get("pushed_at"),
        }
        db.add(FeedItem(candidate_id=cand.id, feed_date=feed_date,
                        score=score, reason_json=json.dumps(reason)))
        db.add(SeenRepo(github_id=cand.github_id, full_name=cand.full_name,
                        last_shown_at=now))
        per_term_count[primary] = per_term_count.get(primary, 0) + 1
        written += 1

    db.commit()
    logger.info(f"[feed] {feed_date} 產生 {written} 條（候選 {len(merged)}）")
    return written
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sidecar && pytest tests/test_feed_generator.py -v && mypy services/feed_generator.py`
Expected: 9 PASS；mypy clean。若 `pytest.mark.asyncio` 報未知 marker，確認 `pytest.ini` 已有 asyncio 設定（repo 既有 async 測試應已配置；如無，於 pytest.ini 加 `asyncio_mode = auto`）。

- [ ] **Step 5: Commit**

```bash
git add sidecar/services/feed_generator.py sidecar/tests/test_feed_generator.py
git commit -m "feat(feed): add daily feed generation pipeline with dedupe, exclusion and diversity cap"
```

---

### Task 5: Feed router（GET / generate / feedback）

**Files:**
- Create: `sidecar/routers/feed.py`
- Test: `sidecar/tests/test_feed_router.py`
- Modify: `sidecar/main.py`（import + include_router 清單加 `feed`）

**Interfaces:**
- Consumes: Task 1 models、Task 4 `generate_feed`、現有 `get_github_service`
- Produces:
  - `GET /api/feed?feed_date=YYYY-MM-DD`（省略 = 今天）→ `ApiResponse[FeedResponse]`，`FeedResponse{feed_date: str, items: list[FeedItemOut]}`
  - `POST /api/feed/generate` → `ApiResponse[GenerateResult]`，`GenerateResult{feed_date: str, generated: int}`
  - `POST /api/feed/items/{item_id}/feedback` body `{"action": "starred" | "dismissed"}` → `ApiResponse[FeedItemOut]`
  - `FeedItemOut{id, github_id, full_name, owner, name, description, language, topics: list[str], stars, forks, url, owner_avatar_url, score, reason: {matched: list[str], stars: int, age_days: int | None}, feedback: str | null}`

- [ ] **Step 1: Write the failing tests**

```python
# sidecar/tests/test_feed_router.py
"""Feed API 端點測試。generate 以 patch generate_feed 隔離，不打真 API。"""
import json
from datetime import date
from unittest.mock import AsyncMock, patch

from db.models import FeedCandidate, FeedItem, SeenRepo

TODAY = date(2026, 8, 1)


def _seed_item(db, gid=1, full_name="a/one", feedback=None):
    cand = FeedCandidate(github_id=gid, full_name=full_name, owner="a",
                         name=full_name.split("/")[1],
                         url=f"https://github.com/{full_name}",
                         stars=100, forks=2, topics=json.dumps(["tauri"]))
    db.add(cand)
    db.flush()
    item = FeedItem(candidate_id=cand.id, feed_date=TODAY, score=2.5,
                    reason_json=json.dumps({"matched": ["topic:tauri"],
                                            "stars": 100, "age_days": 45}),
                    feedback=feedback)
    db.add(item)
    db.add(SeenRepo(github_id=gid, full_name=full_name))
    db.commit()
    return item


def test_get_feed_empty(client):
    resp = client.get("/api/feed", params={"feed_date": "2026-08-01"})
    assert resp.status_code == 200
    assert resp.json()["data"]["items"] == []


def test_get_feed_returns_items_with_reason(client, test_db):
    _seed_item(test_db)
    resp = client.get("/api/feed", params={"feed_date": "2026-08-01"})
    items = resp.json()["data"]["items"]
    assert len(items) == 1
    assert items[0]["full_name"] == "a/one"
    assert items[0]["reason"]["matched"] == ["topic:tauri"]
    assert items[0]["topics"] == ["tauri"]


def test_get_feed_invalid_date_422(client):
    assert client.get("/api/feed", params={"feed_date": "not-a-date"}).status_code == 422


def test_generate_calls_pipeline(client):
    with patch("routers.feed.generate_feed", new=AsyncMock(return_value=7)) as mock_gen:
        resp = client.post("/api/feed/generate")
    assert resp.status_code == 200
    assert resp.json()["data"]["generated"] == 7
    mock_gen.assert_awaited_once()


def test_feedback_dismiss_marks_seen_dismissed(client, test_db):
    item = _seed_item(test_db)
    resp = client.post(f"/api/feed/items/{item.id}/feedback",
                       json={"action": "dismissed"})
    assert resp.status_code == 200
    assert resp.json()["data"]["feedback"] == "dismissed"
    assert test_db.query(SeenRepo).one().dismissed is True


def test_feedback_starred(client, test_db):
    item = _seed_item(test_db)
    resp = client.post(f"/api/feed/items/{item.id}/feedback",
                       json={"action": "starred"})
    assert resp.json()["data"]["feedback"] == "starred"


def test_feedback_invalid_action_422(client, test_db):
    item = _seed_item(test_db)
    assert client.post(f"/api/feed/items/{item.id}/feedback",
                       json={"action": "meh"}).status_code == 422


def test_feedback_missing_item_404(client):
    assert client.post("/api/feed/items/999/feedback",
                       json={"action": "dismissed"}).status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sidecar && pytest tests/test_feed_router.py -v`
Expected: FAIL（404 — router 不存在）

- [ ] **Step 3: Write the router，並註冊進 main.py**

```python
# sidecar/routers/feed.py
"""For You feed API 端點。"""
import json
import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import FeedItem, SeenRepo, FeedFeedback
from schemas.response import ApiResponse, success_response
from services.feed_generator import generate_feed
from services.github import get_github_service
from utils.time import utc_now

router = APIRouter(prefix="/api/feed", tags=["feed"])
logger = logging.getLogger(__name__)


class FeedReason(BaseModel):
    matched: list[str] = []
    stars: int = 0
    age_days: int | None = None


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
        ),
        feedback=item.feedback,
    )


@router.get("", response_model=ApiResponse[FeedResponse])
def get_feed(feed_date: date | None = Query(None),
             db: Session = Depends(get_db)) -> dict:
    target = feed_date or utc_now().date()
    items = (db.query(FeedItem)
             .filter(FeedItem.feed_date == target)
             .order_by(FeedItem.score.desc())
             .all())
    return success_response(FeedResponse(
        feed_date=target.isoformat(), items=[_to_out(i) for i in items]))


@router.post("/generate", response_model=ApiResponse[GenerateResult])
async def trigger_generate(db: Session = Depends(get_db)) -> dict:
    target = utc_now().date()
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
```

`sidecar/main.py`：import 區加 `feed`，`include_router` 清單加 `feed`。

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sidecar && pytest tests/test_feed_router.py -v && mypy routers/feed.py`
Expected: 8 PASS；mypy clean

- [ ] **Step 5: Commit**

```bash
git add sidecar/routers/feed.py sidecar/tests/test_feed_router.py sidecar/main.py
git commit -m "feat(feed): add feed API endpoints (get/generate/feedback)"
```

---

### Task 6: Scheduler 每日任務

**Files:**
- Modify: `sidecar/services/scheduler.py`
- Test: `sidecar/tests/test_services_scheduler.py`（追加，不改既有測試）

**Interfaces:**
- Consumes: Task 4 `generate_feed`、現有 `_job_context`、`get_scheduler`、`start_scheduler`、`get_db_session`、`get_github_service`
- Produces: `async def generate_feed_job() -> None`；`_register_feed_job(scheduler)`（CronTrigger 每日 07:30，job id `"daily_feed"`），在 `start_scheduler` 內呼叫

- [ ] **Step 1: Write the failing tests（追加到既有測試檔尾）**

```python
# 追加至 sidecar/tests/test_services_scheduler.py
from unittest.mock import AsyncMock, patch as _patch


class TestFeedJob:
    """每日 feed 產生任務。"""

    @pytest.mark.asyncio
    async def test_generate_feed_job_invokes_pipeline(self):
        with _patch("services.scheduler.generate_feed",
                    new=AsyncMock(return_value=5)) as mock_gen:
            from services.scheduler import generate_feed_job
            await generate_feed_job()
        mock_gen.assert_awaited_once()

    def test_feed_job_registered(self):
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        from services.scheduler import _register_feed_job
        scheduler = AsyncIOScheduler()
        _register_feed_job(scheduler)
        job = scheduler.get_job("daily_feed")
        assert job is not None
```

（若既有檔案未 import pytest/AsyncMock，依檔內慣例補齊。）

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sidecar && pytest tests/test_services_scheduler.py -k Feed -v`
Expected: FAIL — `ImportError: generate_feed_job`

- [ ] **Step 3: Write the implementation**

在 `sidecar/services/scheduler.py` 加（import 區補 `from services.feed_generator import generate_feed`、`from apscheduler.triggers.cron import CronTrigger` 若檔頭沒有）：

```python
async def generate_feed_job() -> None:
    """每日產生 For You feed。當日已存在時 generate_feed 內部直接跳過。"""
    from db.database import get_db_session
    from services.github import get_github_service
    from utils.time import utc_now

    with _job_context("daily_feed"):
        with get_db_session() as db:
            github = get_github_service()
            count = await generate_feed(db, github, utc_now().date())
            logger.info(f"[排程] daily_feed 完成，寫入 {count} 條")


def _register_feed_job(scheduler) -> None:
    """每日 07:30 產生 feed（app 未開機時由前端開啟時的 on-demand generate 補位）。"""
    scheduler.add_job(
        generate_feed_job,
        CronTrigger(hour=7, minute=30),
        id="daily_feed",
        replace_existing=True,
        misfire_grace_time=3600,
    )
```

並在 `start_scheduler` 內（其他 `_register_*` 呼叫旁）加一行 `_register_feed_job(scheduler)`。

注意：`_job_context` 與 `get_db_session` 的實際簽名以檔內既有 job（如 `fetch_all_repos_job`）為準——實作時**模仿同檔案中最相近的既有 job 寫法**，上述程式碼的 context manager 用法若與既有慣例不符，以既有慣例為準改寫，測試不變。

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sidecar && pytest tests/test_services_scheduler.py -v && mypy services/scheduler.py`
Expected: 既有 + 新增全 PASS；mypy clean

- [ ] **Step 5: Commit**

```bash
git add sidecar/services/scheduler.py sidecar/tests/test_services_scheduler.py
git commit -m "feat(feed): register daily feed generation job at 07:30"
```

---

### Task 7: 前端 API client 與型別

**Files:**
- Modify: `src/api/types.ts`（檔尾追加）
- Modify: `src/api/client.ts`（檔尾追加）
- Modify: `src/lib/react-query.ts`（`queryKeys` 加 `feed` 與 `interests` 區塊）
- Test: `src/api/__tests__/feedClient.test.ts`

**Interfaces:**
- Consumes: 後端 API（Task 3、5）；現有 `apiCall<T>` helper
- Produces（供 Task 8–10 使用）:
  - Types: `Interest{id, term, kind, weight}`、`InterestCreate{term, kind, weight}`、`InterestKind = "topic" | "language" | "keyword"`、`ExcludeTerm{id, term}`、`FeedReason{matched: string[], stars: number, age_days: number | null}`、`FeedItem{id, github_id, full_name, owner, name, description, language, topics, stars, forks, url, owner_avatar_url, score, reason, feedback}`、`FeedResponse{feed_date, items}`、`GenerateFeedResult{feed_date, generated}`
  - Client: `getInterests(signal?)`, `createInterest(input)`, `updateInterest(id, input)`, `deleteInterest(id)`, `getExclusions(signal?)`, `addExclusion(term)`, `removeExclusion(id)`, `getFeed(signal?)`, `generateFeed()`, `sendFeedFeedback(itemId, action)`
  - queryKeys: `queryKeys.feed.today()`, `queryKeys.interests.list()`, `queryKeys.interests.exclusions()`

- [ ] **Step 1: Write the failing test**

```typescript
// src/api/__tests__/feedClient.test.ts
/**
 * Feed / Interests API client 測試。
 * 模式沿用同目錄既有 client 測試：mock fetch，驗證 method、路徑與 body。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getInterests, createInterest, deleteInterest,
  getFeed, generateFeed, sendFeedFeedback,
} from "../client";

// 依同目錄既有測試檔的 fetch mock 佈局初始化（envelope: {success, data}）
function mockFetchOnce(data: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data, message: null, error: null }),
  }));
}

beforeEach(() => vi.restoreAllMocks());

describe("interests client", () => {
  it("getInterests calls GET /interests", async () => {
    mockFetchOnce({ interests: [] });
    await getInterests();
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("/interests");
  });

  it("createInterest posts body", async () => {
    mockFetchOnce({ id: 1, term: "tauri", kind: "topic", weight: 3 });
    const result = await createInterest({ term: "tauri", kind: "topic", weight: 3 });
    expect(result.term).toBe("tauri");
    const opts = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string).weight).toBe(3);
  });

  it("deleteInterest calls DELETE with id", async () => {
    mockFetchOnce({ deleted: 5 });
    await deleteInterest(5);
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("/interests/5");
  });
});

describe("feed client", () => {
  it("getFeed calls GET /feed", async () => {
    mockFetchOnce({ feed_date: "2026-08-01", items: [] });
    const result = await getFeed();
    expect(result.items).toEqual([]);
  });

  it("generateFeed posts to /feed/generate", async () => {
    mockFetchOnce({ feed_date: "2026-08-01", generated: 12 });
    const result = await generateFeed();
    expect(result.generated).toBe(12);
  });

  it("sendFeedFeedback posts action to item endpoint", async () => {
    mockFetchOnce({ id: 3, feedback: "dismissed" });
    await sendFeedFeedback(3, "dismissed");
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("/feed/items/3/feedback");
  });
});
```

**注意**：先閱讀 `src/api/__tests__/` 內既有測試檔的 fetch mock 寫法（含 session secret header 處理），上述 `mockFetchOnce` 若與既有 harness 不合，改用既有 harness，斷言不變。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/api/__tests__/feedClient.test.ts`
Expected: FAIL — client.ts 無這些 export

- [ ] **Step 3: Write types、client functions、queryKeys**

`src/api/types.ts` 檔尾追加：

```typescript
// --- For You Feed (Phase A) ---

export type InterestKind = "topic" | "language" | "keyword";

export interface Interest {
  id: number;
  term: string;
  kind: InterestKind;
  weight: number;
}

export interface InterestCreate {
  term: string;
  kind: InterestKind;
  weight: number;
}

export interface InterestListResponse {
  interests: Interest[];
}

export interface ExcludeTerm {
  id: number;
  term: string;
}

export interface ExclusionListResponse {
  exclusions: ExcludeTerm[];
}

export interface FeedReason {
  matched: string[];
  stars: number;
  age_days: number | null;
}

export type FeedFeedbackAction = "starred" | "dismissed";

export interface FeedItem {
  id: number;
  github_id: number;
  full_name: string;
  owner: string;
  name: string;
  description: string | null;
  language: string | null;
  topics: string[];
  stars: number;
  forks: number;
  url: string;
  owner_avatar_url: string | null;
  score: number;
  reason: FeedReason;
  feedback: FeedFeedbackAction | null;
}

export interface FeedResponse {
  feed_date: string;
  items: FeedItem[];
}

export interface GenerateFeedResult {
  feed_date: string;
  generated: number;
}
```

`src/api/client.ts` 檔尾追加（沿用 `apiCall` helper）：

```typescript
// --- For You Feed (Phase A) ---

/** 取得興趣清單。 */
export async function getInterests(signal?: AbortSignal): Promise<InterestListResponse> {
  return apiCall<InterestListResponse>("/interests", { signal });
}

/** 新增興趣。 */
export async function createInterest(input: InterestCreate): Promise<Interest> {
  return apiCall<Interest>("/interests", { method: "POST", body: JSON.stringify(input) });
}

/** 更新興趣。 */
export async function updateInterest(id: number, input: InterestCreate): Promise<Interest> {
  return apiCall<Interest>(`/interests/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

/** 刪除興趣。 */
export async function deleteInterest(id: number): Promise<void> {
  return apiCall<void>(`/interests/${id}`, { method: "DELETE" });
}

/** 取得黑名單。 */
export async function getExclusions(signal?: AbortSignal): Promise<ExclusionListResponse> {
  return apiCall<ExclusionListResponse>("/interests/exclusions", { signal });
}

/** 新增黑名單關鍵字。 */
export async function addExclusion(term: string): Promise<ExcludeTerm> {
  return apiCall<ExcludeTerm>("/interests/exclusions", {
    method: "POST", body: JSON.stringify({ term }),
  });
}

/** 移除黑名單關鍵字。 */
export async function removeExclusion(id: number): Promise<void> {
  return apiCall<void>(`/interests/exclusions/${id}`, { method: "DELETE" });
}

/** 取得今日 feed。 */
export async function getFeed(signal?: AbortSignal): Promise<FeedResponse> {
  return apiCall<FeedResponse>("/feed", { signal });
}

/** 觸發今日 feed 產生（已存在則後端直接回傳既有數量）。 */
export async function generateFeed(): Promise<GenerateFeedResult> {
  return apiCall<GenerateFeedResult>("/feed/generate", { method: "POST" });
}

/** 送出 feed 項目回饋。 */
export async function sendFeedFeedback(
  itemId: number,
  action: FeedFeedbackAction,
): Promise<FeedItem> {
  return apiCall<FeedItem>(`/feed/items/${itemId}/feedback`, {
    method: "POST", body: JSON.stringify({ action }),
  });
}
```

（types 的 import 依 client.ts 檔頭既有 `import type {...} from "./types"` 樣式補進同一處。）

`src/lib/react-query.ts` 的 `queryKeys` 物件追加：

```typescript
  feed: {
    all: ["feed"] as const,
    today: () => [...queryKeys.feed.all, "today"] as const,
  },
  interests: {
    all: ["interests"] as const,
    list: () => [...queryKeys.interests.all, "list"] as const,
    exclusions: () => [...queryKeys.interests.all, "exclusions"] as const,
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/api/__tests__/feedClient.test.ts && npx tsc --noEmit`
Expected: 6 PASS；tsc clean

- [ ] **Step 5: Commit**

```bash
git add src/api/types.ts src/api/client.ts src/lib/react-query.ts \
        src/api/__tests__/feedClient.test.ts
git commit -m "feat(feed): add frontend API client, types and query keys for feed/interests"
```

---

### Task 8: useFeed 與 useInterests hooks

**Files:**
- Create: `src/hooks/useFeed.ts`
- Create: `src/hooks/useInterests.ts`
- Test: `src/hooks/__tests__/useFeed.test.tsx`、`src/hooks/__tests__/useInterests.test.tsx`

**Interfaces:**
- Consumes: Task 7 client functions 與 queryKeys
- Produces:
  - `useFeed()` → `{ items, feedDate, isLoading, isGenerating, feedback, refresh }`；內部：query 今日 feed → 空且今天未產生過 → 自動觸發 `generateFeed` mutation 後 invalidate
  - `useInterests()` → `{ interests, exclusions, isLoading, create, update, remove, addExclude, removeExclude }`（各 mutation 成功後 invalidate 對應 key）

- [ ] **Step 1: Write the failing tests**

```typescript
// src/hooks/__tests__/useFeed.test.tsx
/**
 * useFeed hook 測試：空 feed 自動觸發 generate、有資料不觸發。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useFeed } from "../useFeed";
import * as client from "../../api/client";

vi.mock("../../api/client");

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const FEED_ITEM = {
  id: 1, github_id: 10, full_name: "a/one", owner: "a", name: "one",
  description: null, language: "Rust", topics: ["tauri"], stars: 100, forks: 1,
  url: "https://github.com/a/one", owner_avatar_url: null, score: 2.5,
  reason: { matched: ["topic:tauri"], stars: 100, age_days: 45 }, feedback: null,
};

beforeEach(() => vi.clearAllMocks());

describe("useFeed", () => {
  it("returns items when feed is non-empty and does not generate", async () => {
    vi.mocked(client.getFeed).mockResolvedValue({
      feed_date: "2026-08-01", items: [FEED_ITEM],
    });
    const { result } = renderHook(() => useFeed(), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(client.generateFeed).not.toHaveBeenCalled();
  });

  it("auto-generates when today's feed is empty", async () => {
    vi.mocked(client.getFeed)
      .mockResolvedValueOnce({ feed_date: "2026-08-01", items: [] })
      .mockResolvedValue({ feed_date: "2026-08-01", items: [FEED_ITEM] });
    vi.mocked(client.generateFeed).mockResolvedValue({
      feed_date: "2026-08-01", generated: 1,
    });
    const { result } = renderHook(() => useFeed(), { wrapper });
    await waitFor(() => expect(client.generateFeed).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
  });

  it("generate is not retriggered when result is still empty (no interests)", async () => {
    vi.mocked(client.getFeed).mockResolvedValue({ feed_date: "2026-08-01", items: [] });
    vi.mocked(client.generateFeed).mockResolvedValue({
      feed_date: "2026-08-01", generated: 0,
    });
    renderHook(() => useFeed(), { wrapper });
    await waitFor(() => expect(client.generateFeed).toHaveBeenCalledTimes(1));
    // 再等一輪確認沒有第二次呼叫（防 infinite generate loop）
    await new Promise((r) => setTimeout(r, 50));
    expect(client.generateFeed).toHaveBeenCalledTimes(1);
  });

  it("feedback calls API", async () => {
    vi.mocked(client.getFeed).mockResolvedValue({
      feed_date: "2026-08-01", items: [FEED_ITEM],
    });
    vi.mocked(client.sendFeedFeedback).mockResolvedValue({
      ...FEED_ITEM, feedback: "dismissed",
    });
    const { result } = renderHook(() => useFeed(), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    result.current.feedback(1, "dismissed");
    await waitFor(() =>
      expect(client.sendFeedFeedback).toHaveBeenCalledWith(1, "dismissed"));
  });
});
```

```typescript
// src/hooks/__tests__/useInterests.test.tsx
/**
 * useInterests hook 測試：讀取與 CRUD mutations。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useInterests } from "../useInterests";
import * as client from "../../api/client";

vi.mock("../../api/client");

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(client.getInterests).mockResolvedValue({
    interests: [{ id: 1, term: "tauri", kind: "topic", weight: 3 }],
  });
  vi.mocked(client.getExclusions).mockResolvedValue({
    exclusions: [{ id: 1, term: "awesome" }],
  });
});

describe("useInterests", () => {
  it("loads interests and exclusions", async () => {
    const { result } = renderHook(() => useInterests(), { wrapper });
    await waitFor(() => expect(result.current.interests).toHaveLength(1));
    expect(result.current.exclusions[0].term).toBe("awesome");
  });

  it("create calls API and refetches", async () => {
    vi.mocked(client.createInterest).mockResolvedValue(
      { id: 2, term: "rust", kind: "language", weight: 2 });
    const { result } = renderHook(() => useInterests(), { wrapper });
    await waitFor(() => expect(result.current.interests).toHaveLength(1));
    result.current.create({ term: "rust", kind: "language", weight: 2 });
    await waitFor(() => expect(client.createInterest).toHaveBeenCalled());
  });

  it("remove calls API", async () => {
    vi.mocked(client.deleteInterest).mockResolvedValue(undefined);
    const { result } = renderHook(() => useInterests(), { wrapper });
    await waitFor(() => expect(result.current.interests).toHaveLength(1));
    result.current.remove(1);
    await waitFor(() => expect(client.deleteInterest).toHaveBeenCalledWith(1));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hooks/__tests__/useFeed.test.tsx src/hooks/__tests__/useInterests.test.tsx`
Expected: FAIL — 模組不存在

- [ ] **Step 3: Write the hooks**

```typescript
// src/hooks/useFeed.ts
/**
 * For You feed 資料 Hook。
 * 今日 feed 為空時自動觸發一次產生（處理「app 在排程時間未開機」的情境）。
 */
import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { generateFeed, getFeed, sendFeedFeedback } from "../api/client";
import type { FeedFeedbackAction } from "../api/types";
import { queryKeys } from "../lib/react-query";

export function useFeed() {
  const queryClient = useQueryClient();
  // 每次 mount 至多自動 generate 一次，防 no-interests 時無限迴圈
  const autoGenerated = useRef(false);

  const query = useQuery({
    queryKey: queryKeys.feed.today(),
    queryFn: ({ signal }) => getFeed(signal),
  });

  const generateMutation = useMutation({
    mutationFn: generateFeed,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.feed.today() });
    },
  });

  const feedbackMutation = useMutation({
    mutationFn: ({ itemId, action }: { itemId: number; action: FeedFeedbackAction }) =>
      sendFeedFeedback(itemId, action),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.feed.today() });
    },
  });

  const isEmpty = query.data !== undefined && query.data.items.length === 0;

  useEffect(() => {
    if (isEmpty && !autoGenerated.current && !generateMutation.isPending) {
      autoGenerated.current = true;
      generateMutation.mutate();
    }
  }, [isEmpty, generateMutation]);

  return {
    items: query.data?.items ?? [],
    feedDate: query.data?.feed_date ?? null,
    isLoading: query.isLoading || generateMutation.isPending,
    isGenerating: generateMutation.isPending,
    feedback: (itemId: number, action: FeedFeedbackAction) =>
      feedbackMutation.mutate({ itemId, action }),
    refresh: () => generateMutation.mutate(),
  };
}
```

```typescript
// src/hooks/useInterests.ts
/**
 * 興趣清單與黑名單管理 Hook。
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addExclusion, createInterest, deleteInterest, getExclusions,
  getInterests, removeExclusion, updateInterest,
} from "../api/client";
import type { InterestCreate } from "../api/types";
import { queryKeys } from "../lib/react-query";

export function useInterests() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.interests.all });
  };

  const interestsQuery = useQuery({
    queryKey: queryKeys.interests.list(),
    queryFn: ({ signal }) => getInterests(signal),
  });

  const exclusionsQuery = useQuery({
    queryKey: queryKeys.interests.exclusions(),
    queryFn: ({ signal }) => getExclusions(signal),
  });

  const createMutation = useMutation({ mutationFn: createInterest, onSuccess: invalidate });
  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: number; input: InterestCreate }) =>
      updateInterest(id, input),
    onSuccess: invalidate,
  });
  const removeMutation = useMutation({ mutationFn: deleteInterest, onSuccess: invalidate });
  const addExcludeMutation = useMutation({ mutationFn: addExclusion, onSuccess: invalidate });
  const removeExcludeMutation = useMutation({
    mutationFn: removeExclusion, onSuccess: invalidate,
  });

  return {
    interests: interestsQuery.data?.interests ?? [],
    exclusions: exclusionsQuery.data?.exclusions ?? [],
    isLoading: interestsQuery.isLoading || exclusionsQuery.isLoading,
    create: (input: InterestCreate) => createMutation.mutate(input),
    update: (id: number, input: InterestCreate) => updateMutation.mutate({ id, input }),
    remove: (id: number) => removeMutation.mutate(id),
    addExclude: (term: string) => addExcludeMutation.mutate(term),
    removeExclude: (id: number) => removeExcludeMutation.mutate(id),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/hooks/__tests__/useFeed.test.tsx src/hooks/__tests__/useInterests.test.tsx && npx tsc --noEmit`
Expected: 7 PASS；tsc clean

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useFeed.ts src/hooks/useInterests.ts src/hooks/__tests__/
git commit -m "feat(feed): add useFeed and useInterests hooks with auto-generate on empty"
```

---

### Task 9: Settings 興趣管理區塊 + i18n

**Files:**
- Create: `src/components/settings/InterestsSection.tsx`
- Modify: `src/components/settings/index.ts`（export）
- Modify: `src/pages/Settings.tsx`（掛進頁面，放在 `SignalThresholdsSection` 附近）
- Modify: `src/i18n/translations.ts`（`en` 與 `zh-TW` 各加 `settings.interests.*`）
- Test: `src/components/settings/__tests__/InterestsSection.test.tsx`

**Interfaces:**
- Consumes: Task 8 `useInterests()`
- Produces: `<InterestsSection onToast={(msg, type?) => void} />`；`data-testid="interests-section"`（E2E 用）

- [ ] **Step 1: 加 i18n 字串**

`translations.ts` 的 `en.settings` 物件內加：

```typescript
      interests: {
        title: "Feed Interests",
        subtitle: "Terms that drive your daily For You feed",
        addPlaceholder: "e.g. tauri, rust, quant",
        kindTopic: "Topic",
        kindLanguage: "Language",
        kindKeyword: "Keyword",
        weightLabel: "Weight",
        add: "Add",
        remove: "Remove",
        empty: "No interests yet. Add 3–5 terms to activate your feed.",
        exclusionsTitle: "Excluded terms",
        exclusionsSubtitle: "Repos matching these terms never appear in your feed",
        toast: { added: "Interest added", removed: "Interest removed", error: "Operation failed" },
      },
```

`zh-TW.settings` 物件內加：

```typescript
      interests: {
        title: "Feed 興趣清單",
        subtitle: "驅動每日 For You feed 的興趣項目",
        addPlaceholder: "例如 tauri、rust、quant",
        kindTopic: "Topic",
        kindLanguage: "語言",
        kindKeyword: "關鍵字",
        weightLabel: "權重",
        add: "新增",
        remove: "移除",
        empty: "尚無興趣項目。新增 3–5 個以啟用你的 feed。",
        exclusionsTitle: "黑名單",
        exclusionsSubtitle: "命中這些關鍵字的 repo 永不出現在 feed",
        toast: { added: "已新增興趣", removed: "已移除興趣", error: "操作失敗" },
      },
```

Run: `npx tsc --noEmit`（`TranslationKeys` 的 DeepStringify 會在 en/zh 結構不一致時報錯）
Expected: clean

- [ ] **Step 2: Write the failing component test**

```typescript
// src/components/settings/__tests__/InterestsSection.test.tsx
/**
 * InterestsSection 測試：列表渲染、新增、移除。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { InterestsSection } from "../InterestsSection";
import * as client from "../../../api/client";

vi.mock("../../../api/client");

function renderWithClient(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(client.getInterests).mockResolvedValue({
    interests: [{ id: 1, term: "tauri", kind: "topic", weight: 3 }],
  });
  vi.mocked(client.getExclusions).mockResolvedValue({
    exclusions: [{ id: 1, term: "awesome" }],
  });
});

describe("InterestsSection", () => {
  it("renders interests and exclusions", async () => {
    renderWithClient(<InterestsSection onToast={vi.fn()} />);
    expect(await screen.findByText("tauri")).toBeInTheDocument();
    expect(await screen.findByText("awesome")).toBeInTheDocument();
  });

  it("adds an interest via form", async () => {
    vi.mocked(client.createInterest).mockResolvedValue(
      { id: 2, term: "rust", kind: "language", weight: 2 });
    renderWithClient(<InterestsSection onToast={vi.fn()} />);
    await screen.findByText("tauri");
    fireEvent.change(screen.getByTestId("interest-term-input"),
      { target: { value: "rust" } });
    fireEvent.click(screen.getByTestId("interest-add-btn"));
    await waitFor(() => expect(client.createInterest).toHaveBeenCalled());
  });

  it("removes an interest", async () => {
    vi.mocked(client.deleteInterest).mockResolvedValue(undefined);
    renderWithClient(<InterestsSection onToast={vi.fn()} />);
    await screen.findByText("tauri");
    fireEvent.click(screen.getByTestId("interest-remove-1"));
    await waitFor(() => expect(client.deleteInterest).toHaveBeenCalledWith(1));
  });
});
```

Run: `npx vitest run src/components/settings/__tests__/InterestsSection.test.tsx`
Expected: FAIL — 元件不存在

- [ ] **Step 3: Write the component**

```typescript
// src/components/settings/InterestsSection.tsx
/**
 * Feed 興趣清單設定區塊：興趣 CRUD 與黑名單管理。
 */
import { useState } from "react";
import { useI18n } from "../../i18n";
import { useInterests } from "../../hooks/useInterests";
import type { InterestKind } from "../../api/types";
import { Skeleton } from "../Skeleton";

interface InterestsSectionProps {
  onToast: (message: string, type?: "success" | "error") => void;
}

export function InterestsSection({ onToast }: InterestsSectionProps) {
  const { t } = useI18n();
  const {
    interests, exclusions, isLoading,
    create, remove, addExclude, removeExclude,
  } = useInterests();
  const [term, setTerm] = useState("");
  const [kind, setKind] = useState<InterestKind>("topic");
  const [weight, setWeight] = useState(2);
  const [excludeTerm, setExcludeTerm] = useState("");

  const handleAdd = () => {
    const trimmed = term.trim();
    if (!trimmed) return;
    create({ term: trimmed, kind, weight });
    setTerm("");
    onToast(t.settings.interests.toast.added, "success");
  };

  const handleAddExclude = () => {
    const trimmed = excludeTerm.trim();
    if (!trimmed) return;
    addExclude(trimmed);
    setExcludeTerm("");
  };

  if (isLoading) return <Skeleton />;

  return (
    <section data-testid="interests-section">
      <h3>{t.settings.interests.title}</h3>
      <p>{t.settings.interests.subtitle}</p>

      <div>
        <input
          data-testid="interest-term-input"
          value={term}
          placeholder={t.settings.interests.addPlaceholder}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
        />
        <select value={kind} onChange={(e) => setKind(e.target.value as InterestKind)}>
          <option value="topic">{t.settings.interests.kindTopic}</option>
          <option value="language">{t.settings.interests.kindLanguage}</option>
          <option value="keyword">{t.settings.interests.kindKeyword}</option>
        </select>
        <select
          aria-label={t.settings.interests.weightLabel}
          value={weight}
          onChange={(e) => setWeight(Number(e.target.value))}
        >
          <option value={1}>1</option>
          <option value={2}>2</option>
          <option value={3}>3</option>
        </select>
        <button data-testid="interest-add-btn" onClick={handleAdd}>
          {t.settings.interests.add}
        </button>
      </div>

      {interests.length === 0 ? (
        <p>{t.settings.interests.empty}</p>
      ) : (
        <ul>
          {interests.map((i) => (
            <li key={i.id}>
              <span>{i.term}</span>
              <span>{i.kind} · w{i.weight}</span>
              <button
                data-testid={`interest-remove-${i.id}`}
                aria-label={t.settings.interests.remove}
                onClick={() => {
                  remove(i.id);
                  onToast(t.settings.interests.toast.removed, "success");
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <h4>{t.settings.interests.exclusionsTitle}</h4>
      <p>{t.settings.interests.exclusionsSubtitle}</p>
      <div>
        <input
          value={excludeTerm}
          onChange={(e) => setExcludeTerm(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAddExclude()}
        />
        <button onClick={handleAddExclude}>{t.settings.interests.add}</button>
      </div>
      <ul>
        {exclusions.map((e) => (
          <li key={e.id}>
            <span>{e.term}</span>
            <button onClick={() => removeExclude(e.id)}>✕</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

**樣式**：以上為結構骨架；實作時參照同目錄 `SignalThresholdsSection.tsx` 的 className / CSS module 用法補上一致的樣式類名，不自創新樣式系統。

`src/components/settings/index.ts` 加 `export { InterestsSection } from "./InterestsSection";`
`src/pages/Settings.tsx`：import 區與 JSX 中（`SignalThresholdsSection` 之後）加 `<InterestsSection onToast={handleDataToast} />`。

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/settings/__tests__/InterestsSection.test.tsx && npx tsc --noEmit`
Expected: 3 PASS；tsc clean

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/InterestsSection.tsx src/components/settings/index.ts \
        src/pages/Settings.tsx src/i18n/translations.ts \
        src/components/settings/__tests__/InterestsSection.test.tsx
git commit -m "feat(feed): add interests management section in settings"
```

---

### Task 10: Discovery For You feed UI

**Files:**
- Create: `src/components/discovery/ForYouFeed.tsx`
- Create: `src/components/discovery/FeedItemCard.tsx`
- Modify: `src/components/discovery/index.ts`（exports）
- Modify: `src/pages/Discovery.tsx`（無搜尋關鍵字時預設顯示 ForYouFeed）
- Modify: `src/i18n/translations.ts`（`discovery.forYou.*`，en 與 zh-TW）
- Test: `src/components/discovery/__tests__/ForYouFeed.test.tsx`

**Interfaces:**
- Consumes: Task 8 `useFeed()`、現有 `addRepo`（⭐ 時加入 watchlist）、現有 `useI18n`
- Produces: `<ForYouFeed onAddToWatchlist={(item: FeedItem) => void} />`；`data-testid="for-you-feed"`、每卡 `data-testid="feed-item-{id}"`

- [ ] **Step 1: 加 i18n 字串**

`en.discovery` 內加：

```typescript
      forYou: {
        title: "For You",
        subtitle: "Daily picks matched to your interests",
        empty: "No feed today. Add interests in Settings to activate.",
        generating: "Building today's feed…",
        reason: {
          matched: "matched", stars: "stars", daysOld: "days old",
        },
        addToWatchlist: "Track",
        dismiss: "Not interested",
        refresh: "Refresh",
      },
```

`zh-TW.discovery` 內加：

```typescript
      forYou: {
        title: "為你推薦",
        subtitle: "根據你的興趣挑選的每日專案",
        empty: "今天沒有 feed。到設定頁新增興趣以啟用。",
        generating: "正在產生今日 feed…",
        reason: {
          matched: "命中", stars: "stars", daysOld: "天前建立",
        },
        addToWatchlist: "追蹤",
        dismiss: "不感興趣",
        refresh: "重新整理",
      },
```

Run: `npx tsc --noEmit` → clean

- [ ] **Step 2: Write the failing tests**

```typescript
// src/components/discovery/__tests__/ForYouFeed.test.tsx
/**
 * ForYouFeed 測試：渲染、推薦理由、回饋動作。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ForYouFeed } from "../ForYouFeed";
import * as client from "../../../api/client";

vi.mock("../../../api/client");

function renderWithClient(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const ITEM = {
  id: 1, github_id: 10, full_name: "a/one", owner: "a", name: "one",
  description: "a tauri app", language: "Rust", topics: ["tauri"],
  stars: 380, forks: 4, url: "https://github.com/a/one",
  owner_avatar_url: null, score: 2.5,
  reason: { matched: ["topic:tauri"], stars: 380, age_days: 45 },
  feedback: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(client.getFeed).mockResolvedValue({
    feed_date: "2026-08-01", items: [ITEM],
  });
});

describe("ForYouFeed", () => {
  it("renders feed items with reason line", async () => {
    renderWithClient(<ForYouFeed onAddToWatchlist={vi.fn()} />);
    expect(await screen.findByText("a/one")).toBeInTheDocument();
    expect(screen.getByText(/topic:tauri/)).toBeInTheDocument();
  });

  it("dismiss button sends feedback", async () => {
    vi.mocked(client.sendFeedFeedback).mockResolvedValue(
      { ...ITEM, feedback: "dismissed" });
    renderWithClient(<ForYouFeed onAddToWatchlist={vi.fn()} />);
    await screen.findByText("a/one");
    fireEvent.click(screen.getByTestId("feed-dismiss-1"));
    await waitFor(() =>
      expect(client.sendFeedFeedback).toHaveBeenCalledWith(1, "dismissed"));
  });

  it("track button calls onAddToWatchlist and sends starred feedback", async () => {
    vi.mocked(client.sendFeedFeedback).mockResolvedValue(
      { ...ITEM, feedback: "starred" });
    const onAdd = vi.fn();
    renderWithClient(<ForYouFeed onAddToWatchlist={onAdd} />);
    await screen.findByText("a/one");
    fireEvent.click(screen.getByTestId("feed-star-1"));
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    expect(client.sendFeedFeedback).toHaveBeenCalledWith(1, "starred");
  });

  it("shows empty state when no items and generation done", async () => {
    vi.mocked(client.getFeed).mockResolvedValue({ feed_date: "2026-08-01", items: [] });
    vi.mocked(client.generateFeed).mockResolvedValue({
      feed_date: "2026-08-01", generated: 0,
    });
    renderWithClient(<ForYouFeed onAddToWatchlist={vi.fn()} />);
    expect(await screen.findByTestId("feed-empty-state")).toBeInTheDocument();
  });
});
```

Run: `npx vitest run src/components/discovery/__tests__/ForYouFeed.test.tsx`
Expected: FAIL — 元件不存在

- [ ] **Step 3: Write the components 並接進 Discovery.tsx**

```typescript
// src/components/discovery/FeedItemCard.tsx
/**
 * Feed 單卡：repo 資訊 + 推薦理由行 + 回饋動作。
 */
import { useI18n } from "../../i18n";
import type { FeedItem } from "../../api/types";

interface FeedItemCardProps {
  item: FeedItem;
  onStar: (item: FeedItem) => void;
  onDismiss: (item: FeedItem) => void;
}

export function FeedItemCard({ item, onStar, onDismiss }: FeedItemCardProps) {
  const { t } = useI18n();
  const reasonParts = [
    item.reason.matched.join(", "),
    `${item.reason.stars.toLocaleString()} ${t.discovery.forYou.reason.stars}`,
    item.reason.age_days !== null
      ? `${item.reason.age_days} ${t.discovery.forYou.reason.daysOld}` : null,
  ].filter(Boolean);

  return (
    <article data-testid={`feed-item-${item.id}`}>
      <a href={item.url} target="_blank" rel="noreferrer">
        <h4>{item.full_name}</h4>
      </a>
      {item.description && <p>{item.description}</p>}
      <p data-testid={`feed-reason-${item.id}`}>{reasonParts.join(" · ")}</p>
      <div>
        <button data-testid={`feed-star-${item.id}`} onClick={() => onStar(item)}>
          ⭐ {t.discovery.forYou.addToWatchlist}
        </button>
        <button data-testid={`feed-dismiss-${item.id}`} onClick={() => onDismiss(item)}>
          🚫 {t.discovery.forYou.dismiss}
        </button>
      </div>
    </article>
  );
}
```

```typescript
// src/components/discovery/ForYouFeed.tsx
/**
 * For You feed 清單：Discovery 頁預設畫面。
 */
import { useI18n } from "../../i18n";
import { useFeed } from "../../hooks/useFeed";
import type { FeedItem } from "../../api/types";
import { FeedItemCard } from "./FeedItemCard";
import { Skeleton } from "../Skeleton";

interface ForYouFeedProps {
  onAddToWatchlist: (item: FeedItem) => void;
}

export function ForYouFeed({ onAddToWatchlist }: ForYouFeedProps) {
  const { t } = useI18n();
  const { items, isLoading, isGenerating, feedback, refresh } = useFeed();

  if (isLoading) {
    return (
      <div data-testid="for-you-feed">
        {isGenerating && <p>{t.discovery.forYou.generating}</p>}
        <Skeleton />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div data-testid="feed-empty-state">
        <p>{t.discovery.forYou.empty}</p>
      </div>
    );
  }

  const visible = items.filter((i) => i.feedback !== "dismissed");

  return (
    <div data-testid="for-you-feed">
      <header>
        <h3>{t.discovery.forYou.title}</h3>
        <p>{t.discovery.forYou.subtitle}</p>
        <button onClick={refresh}>{t.discovery.forYou.refresh}</button>
      </header>
      {visible.map((item) => (
        <FeedItemCard
          key={item.id}
          item={item}
          onStar={(it) => {
            onAddToWatchlist(it);
            feedback(it.id, "starred");
          }}
          onDismiss={(it) => feedback(it.id, "dismissed")}
        />
      ))}
    </div>
  );
}
```

`src/components/discovery/index.ts` 加兩個 export。

`src/pages/Discovery.tsx` 接線（關鍵改動）：

- import `ForYouFeed`；
- 在現有 JSX 中，`DiscoveryResults` 只在「有搜尋關鍵字或有篩選」時渲染（沿用現有 `discovery` hook 的 keyword 狀態判斷）；無搜尋狀態時渲染 `<ForYouFeed onAddToWatchlist={handleFeedAdd} />`；
- `handleFeedAdd` 用現有 `addRepo` API（頁面已 import）；型別用 `import type { FeedItem as FeedItemType } from "../api/types"`（避免與元件名稱混淆）：

```typescript
  const handleFeedAdd = useCallback(async (item: FeedItemType) => {
    try {
      await addRepo({ owner: item.owner, name: item.name });
      toast.success(t.discovery.forYou.addToWatchlist);
      void handleRefreshAll();
    } catch {
      toast.error(t.common.error);
    }
  }, [toast, t, handleRefreshAll]);
```

（`addRepo` 的實際 payload 形狀以 `RepoCreate` 型別為準——實作時查 `src/api/types.ts`，若需要 `full_name` 或 `url` 欄位則照型別補齊。`t.common.error` 若不存在，用 translations 中既有的通用錯誤 key。）

**樣式**：參照同目錄 `DiscoveryResultCard.tsx` 與 `Discovery.module.css` 的既有類名，讓 feed 卡與搜尋結果卡視覺一致。

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/discovery/__tests__/ForYouFeed.test.tsx && npx tsc --noEmit && npx vitest run src/pages`
Expected: 新測試 4 PASS；tsc clean；Discovery 頁既有測試不破（若既有 Discovery 測試假設預設渲染搜尋結果，依新行為更新該測試的前置條件——加上關鍵字輸入步驟）

- [ ] **Step 5: Commit**

```bash
git add src/components/discovery/ForYouFeed.tsx src/components/discovery/FeedItemCard.tsx \
        src/components/discovery/index.ts src/pages/Discovery.tsx src/i18n/translations.ts \
        src/components/discovery/__tests__/ForYouFeed.test.tsx
git commit -m "feat(feed): show For You feed as Discovery default view"
```

---

### Task 11: E2E、全套驗證與文件同步

**Files:**
- Create: `e2e/for-you-feed.spec.ts`
- Modify: `README.md`（功能一覽加 For You feed 一行）
- Modify: `CHANGELOG.md`（Unreleased 段加 feature 條目）

**Interfaces:**
- Consumes: Task 9 `data-testid="interests-section"`、Task 10 `data-testid="for-you-feed"` / `feed-empty-state`

- [ ] **Step 1: Write the E2E spec**

```typescript
// e2e/for-you-feed.spec.ts
/**
 * For You Feed E2E 測試。
 * 驗證 Discovery 預設顯示 feed（或空狀態）、Settings 興趣管理可操作。
 */
import { test, expect } from "@playwright/test";

test.describe("For You Feed", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="page-title"]', { timeout: 15000 });
  });

  test("discovery page defaults to feed or empty state", async ({ page }) => {
    await page.locator('[data-testid="nav-discovery"]').click();
    const feed = page.locator('[data-testid="for-you-feed"]');
    const empty = page.locator('[data-testid="feed-empty-state"]');
    await expect(feed.or(empty)).toBeVisible({ timeout: 15000 });
  });

  test("interests section visible in settings and accepts a term", async ({ page }) => {
    await page.locator('[data-testid="nav-settings"]').click();
    const section = page.locator('[data-testid="interests-section"]');
    await expect(section).toBeVisible({ timeout: 10000 });

    await section.locator('[data-testid="interest-term-input"]').fill("tauri");
    await section.locator('[data-testid="interest-add-btn"]').click();
    await expect(section.locator("li", { hasText: "tauri" }).first())
      .toBeVisible({ timeout: 10000 });
  });

  test("search still works from discovery search bar", async ({ page }) => {
    await page.locator('[data-testid="nav-discovery"]').click();
    // 輸入關鍵字後應切回搜尋結果視圖（feed 隱藏）
    const searchInput = page.locator('input[type="search"], input[placeholder*="earch"]').first();
    await searchInput.fill("rust");
    await searchInput.press("Enter");
    await expect(page.locator('[data-testid="for-you-feed"]')).toBeHidden({ timeout: 10000 });
  });
});
```

（nav 的 data-testid 以 `e2e/navigation.spec.ts` 既有選擇器為準；若與上述不同，沿用既有。）

- [ ] **Step 2: Run E2E**

Run: `npx playwright test e2e/for-you-feed.spec.ts`
Expected: 3 PASS（依 repo 既有 E2E 啟動方式，見 `playwright.config.ts`）

- [ ] **Step 3: 全套回歸**

Run:
```bash
cd sidecar && pytest tests/ -q && mypy . && cd .. && \
npx vitest run && npx tsc --noEmit && npx playwright test
```
Expected: 全數 PASS（既有 1,670 + 新增約 60 個測試）

- [ ] **Step 4: 文件同步**

- `README.md` 功能一覽的「📡 追蹤與分析」行加「For You 每日個人化推薦」；測試數字依實際 grep 精算後更新（不得估算）。
- `CHANGELOG.md` 加 `feat: For You daily personalized feed (Phase A)` 條目，只寫使用者可感知的變更。

- [ ] **Step 5: Final commit**

```bash
git add e2e/for-you-feed.spec.ts README.md CHANGELOG.md
git commit -m "feat(feed): add For You feed e2e tests and docs"
```

---

## 驗收與閘門

Phase A 完成定義：上述 11 個任務全數 commit、全套測試綠。之後進入使用閘門：

> **連續使用 7 天，打開 ≥ 4 天 → 開 Phase B 計畫（影子池 + 訊號評分 + OS 通知）；未達 → 停損，不以加功能救場。**

Phase B 不在本計畫內；其第一個任務固定為「掛 rate_limiter 計數實測一天 API 消耗，再定影子池上限」。
