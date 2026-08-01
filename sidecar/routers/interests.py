"""興趣清單與 feed 黑名單 API。"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Interest, ExcludeTerm, InterestKind
from schemas.response import ApiResponse, success_response
from services.feed_defaults import ensure_default_exclude_terms

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
