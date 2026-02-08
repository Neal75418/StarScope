"""
早期訊號 API 端點。
提供偵測到的異常與早期訊號存取。
"""

from typing import Dict, List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import case, func

from db.database import get_db
from db.models import EarlySignal, Repo
from services.anomaly_detector import run_detection
from utils.time import utc_now

router = APIRouter(prefix="/early-signals", tags=["early-signals"])

# severity 欄位是字串，字母序 ≠ 語意順序，需用 CASE 映射
_SEVERITY_ORDER = case(
    (EarlySignal.severity == "high", 0),
    (EarlySignal.severity == "medium", 1),
    (EarlySignal.severity == "low", 2),
    else_=3,
)


# 回應 schema
class EarlySignalResponse(BaseModel):
    """早期訊號的 schema。"""
    id: int
    repo_id: int
    repo_name: str
    signal_type: str
    severity: str
    description: str
    velocity_value: Optional[float]
    star_count: Optional[int]
    percentile_rank: Optional[float]
    detected_at: datetime
    expires_at: Optional[datetime]
    acknowledged: bool
    acknowledged_at: Optional[datetime]

    class Config:
        from_attributes = True


class EarlySignalListResponse(BaseModel):
    """訊號列表的回應。"""
    signals: List[EarlySignalResponse]
    total: int


class SignalSummary(BaseModel):
    """依類型與嚴重等級的訊號摘要。"""
    total_active: int
    by_type: dict
    by_severity: dict
    repos_with_signals: int


class DetectionResultResponse(BaseModel):
    """偵測執行的回應。"""
    repos_scanned: int
    signals_detected: int
    by_type: dict


# 輔助函式
def _signal_to_response(signal: EarlySignal) -> EarlySignalResponse:
    """將 EarlySignal model 轉換為回應。自動映射同名欄位。"""
    return EarlySignalResponse(
        **{
            field: getattr(signal, field)
            for field in EarlySignalResponse.model_fields
            if field not in ("repo_name", "acknowledged")
        },
        repo_name=signal.repo.full_name,
        acknowledged=bool(signal.acknowledged),
    )


# 端點
@router.get("/", response_model=EarlySignalListResponse)
async def list_early_signals(
    signal_type: Optional[str] = Query(None, description="Filter by signal type"),
    severity: Optional[str] = Query(None, description="Filter by severity"),
    include_acknowledged: bool = Query(False, description="Include acknowledged signals"),
    include_expired: bool = Query(False, description="Include expired signals"),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db)
):
    """
    列出所有早期訊號。
    預設僅顯示活躍且未確認的訊號。
    """
    query = db.query(EarlySignal).options(joinedload(EarlySignal.repo))

    if signal_type:
        query = query.filter(EarlySignal.signal_type == signal_type)

    if severity:
        query = query.filter(EarlySignal.severity == severity)

    if not include_acknowledged:
        query = query.filter(EarlySignal.acknowledged == False)

    if not include_expired:
        query = query.filter(
            (EarlySignal.expires_at == None) | (EarlySignal.expires_at > utc_now())
        )

    signals = query.order_by(
        _SEVERITY_ORDER,  # High severity first
        EarlySignal.detected_at.desc()
    ).limit(limit).all()

    return EarlySignalListResponse(
        signals=[_signal_to_response(s) for s in signals],
        total=len(signals),
    )


@router.get("/repo/{repo_id}", response_model=EarlySignalListResponse)
async def get_repo_signals(
    repo_id: int,
    include_acknowledged: bool = Query(False),
    include_expired: bool = Query(False),
    db: Session = Depends(get_db)
):
    """
    取得特定 repo 的早期訊號。
    """
    repo = db.query(Repo).filter(Repo.id == repo_id).first()
    if not repo:
        raise HTTPException(status_code=404, detail="Repository not found")

    query = db.query(EarlySignal).options(joinedload(EarlySignal.repo)).filter(EarlySignal.repo_id == repo_id)

    if not include_acknowledged:
        query = query.filter(EarlySignal.acknowledged == False)

    if not include_expired:
        query = query.filter(
            (EarlySignal.expires_at == None) | (EarlySignal.expires_at > utc_now())
        )

    signals = query.order_by(EarlySignal.detected_at.desc()).all()

    return EarlySignalListResponse(
        signals=[_signal_to_response(s) for s in signals],
        total=len(signals),
    )


@router.get("/summary", response_model=SignalSummary)
async def get_signal_summary(
    db: Session = Depends(get_db)
):
    """
    取得活躍訊號的摘要統計。
    """
    now = utc_now()

    # 活躍訊號（未確認、未過期）
    active_query = db.query(EarlySignal).filter(
        EarlySignal.acknowledged == False,
        (EarlySignal.expires_at == None) | (EarlySignal.expires_at > now)
    )

    total_active = active_query.count()

    # 依類型
    by_type = {}
    type_counts = active_query.with_entities(
        EarlySignal.signal_type,
        func.count(EarlySignal.id)
    ).group_by(EarlySignal.signal_type).all()
    for signal_type, count in type_counts:
        by_type[signal_type] = count

    # 依嚴重等級
    by_severity = {}
    severity_counts = active_query.with_entities(
        EarlySignal.severity,
        func.count(EarlySignal.id)
    ).group_by(EarlySignal.severity).all()
    for severity, count in severity_counts:
        by_severity[severity] = count

    # 有訊號的 repo
    repos_with_signals = active_query.with_entities(
        EarlySignal.repo_id
    ).distinct().count()

    return SignalSummary(
        total_active=total_active,
        by_type=by_type,
        by_severity=by_severity,
        repos_with_signals=repos_with_signals,
    )


@router.post("/{signal_id}/acknowledge")
async def acknowledge_signal(
    signal_id: int,
    db: Session = Depends(get_db)
):
    """
    確認早期訊號（標記為已檢視）。
    """
    signal = db.query(EarlySignal).filter(EarlySignal.id == signal_id).first()
    if not signal:
        raise HTTPException(status_code=404, detail="Signal not found")

    signal.acknowledged = True
    signal.acknowledged_at = utc_now()
    db.commit()

    return {"status": "ok", "message": "Signal acknowledged"}


@router.post("/acknowledge-all")
async def acknowledge_all_signals(
    signal_type: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """
    確認所有活躍訊號。
    可選擇依訊號類型篩選。
    """
    query = db.query(EarlySignal).filter(EarlySignal.acknowledged == False)

    if signal_type:
        query = query.filter(EarlySignal.signal_type == signal_type)

    now = utc_now()
    count = query.update({
        EarlySignal.acknowledged: True,
        EarlySignal.acknowledged_at: now,
    })
    db.commit()

    return {"status": "ok", "message": f"{count} signals acknowledged"}


@router.post("/detect", response_model=DetectionResultResponse)
async def trigger_detection(
    db: Session = Depends(get_db)
):
    """
    手動觸發所有 repo 的異常偵測。
    """
    result = run_detection(db)

    return DetectionResultResponse(
        repos_scanned=result["repos_scanned"],
        signals_detected=result["signals_detected"],
        by_type=result["by_type"],
    )


@router.delete("/{signal_id}")
async def delete_signal(
    signal_id: int,
    db: Session = Depends(get_db)
):
    """
    刪除早期訊號。
    """
    signal = db.query(EarlySignal).filter(EarlySignal.id == signal_id).first()
    if not signal:
        raise HTTPException(status_code=404, detail="Signal not found")

    db.delete(signal)
    db.commit()

    return {"status": "ok", "message": "Signal deleted"}


class BatchSignalsRequest(BaseModel):
    """批次取得訊號的請求。"""
    repo_ids: List[int]


class BatchSignalsResponse(BaseModel):
    """批次取得訊號的回應，key 為 repo_id 字串。"""
    results: Dict[str, EarlySignalListResponse]


@router.post("/batch", response_model=BatchSignalsResponse)
async def get_repo_signals_batch(
    request: BatchSignalsRequest,
    db: Session = Depends(get_db)
):
    """
    批次取得多個 repo 的早期訊號。
    用單一查詢取代 N 次個別請求。
    """
    repo_ids = request.repo_ids
    if not repo_ids:
        return BatchSignalsResponse(results={})

    now = utc_now()
    signals = db.query(EarlySignal).options(
        joinedload(EarlySignal.repo)
    ).filter(
        EarlySignal.repo_id.in_(repo_ids),
        EarlySignal.acknowledged == False,
        (EarlySignal.expires_at == None) | (EarlySignal.expires_at > now)
    ).order_by(
        _SEVERITY_ORDER,
        EarlySignal.detected_at.desc()
    ).all()

    # 按 repo_id 分組
    grouped: Dict[int, List[EarlySignalResponse]] = {}
    for s in signals:
        if s.repo_id not in grouped:
            grouped[s.repo_id] = []
        grouped[s.repo_id].append(_signal_to_response(s))

    # 組裝結果（含空結果 repo）
    results: Dict[str, EarlySignalListResponse] = {}
    for rid in repo_ids:
        signal_list = grouped.get(rid, [])
        results[str(rid)] = EarlySignalListResponse(
            signals=signal_list, total=len(signal_list)
        )

    return BatchSignalsResponse(results=results)
