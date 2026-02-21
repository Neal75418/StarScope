"""
警報 API 端點，管理警報規則與檢視已觸發的警報。
"""

from datetime import datetime
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from db.database import get_db
from constants import SignalType
from db.models import AlertRule, TriggeredAlert, Repo
from schemas.response import ApiResponse, StatusResponse, success_response
from services.alerts import (
    acknowledge_alert,
    acknowledge_all_alerts,
    check_all_alerts,
)

# 從 model 常數衍生的 Literal 型別 — Pydantic 自動驗證。
ValidSignalType = Literal[
    "stars_delta_7d", "stars_delta_30d", "velocity", "acceleration", "trend"
]
ValidOperator = Literal[">", "<", ">=", "<=", "=="]

# 錯誤訊息常數
ERROR_RULE_NOT_FOUND = "Rule not found"
ERROR_ALERT_NOT_FOUND = "Alert not found"

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


# --- Schema ---

class AlertRuleCreate(BaseModel):
    """建立警報規則的 schema。"""
    name: str
    description: Optional[str] = None
    repo_id: Optional[int] = None  # None = 適用於所有 repo
    signal_type: ValidSignalType
    operator: ValidOperator
    threshold: float
    enabled: bool = True


class AlertRuleUpdate(BaseModel):
    """更新警報規則的 schema。"""
    name: Optional[str] = None
    description: Optional[str] = None
    repo_id: Optional[int] = None
    signal_type: Optional[ValidSignalType] = None
    operator: Optional[ValidOperator] = None
    threshold: Optional[float] = None
    enabled: Optional[bool] = None


class AlertRuleResponse(BaseModel):
    """警報規則的回應 schema。"""
    id: int
    name: str
    description: Optional[str]
    repo_id: Optional[int]
    repo_name: Optional[str]
    signal_type: str
    operator: str
    threshold: float
    enabled: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class TriggeredAlertResponse(BaseModel):
    """已觸發警報的回應 schema。"""
    id: int
    rule_id: int
    rule_name: str
    repo_id: int
    repo_name: str
    signal_type: str
    signal_value: float
    threshold: float
    operator: str
    triggered_at: datetime
    acknowledged: bool
    acknowledged_at: Optional[datetime]

    class Config:
        from_attributes = True


class SignalTypeInfo(BaseModel):
    """訊號類型資訊。"""
    type: str
    name: str
    description: str


class TriggeredAlertBrief(BaseModel):
    """警報檢查中觸發的警報簡要資訊。"""
    id: int
    rule_id: int
    repo_id: int
    signal_value: float


class CheckAlertsResponse(BaseModel):
    """警報檢查結果。"""
    status: str
    triggered_count: int
    triggered: List[TriggeredAlertBrief]


# --- 輔助函式 ---

def _to_alert_rule_response(rule: AlertRule) -> AlertRuleResponse:
    """將 AlertRule model 轉換為 AlertRuleResponse。"""
    return AlertRuleResponse(
        id=rule.id,
        name=rule.name,
        description=rule.description,
        repo_id=rule.repo_id,
        repo_name=rule.repo.full_name if rule.repo else None,
        signal_type=rule.signal_type,
        operator=rule.operator,
        threshold=rule.threshold,
        enabled=bool(rule.enabled),
        created_at=rule.created_at,
        updated_at=rule.updated_at,
    )


def _to_triggered_alert_response(alert: TriggeredAlert) -> TriggeredAlertResponse:
    """將 TriggeredAlert model 轉換為 TriggeredAlertResponse。"""
    return TriggeredAlertResponse(
        id=alert.id,
        rule_id=alert.rule_id,
        rule_name=alert.rule.name,
        repo_id=alert.repo_id,
        repo_name=alert.repo.full_name,
        signal_type=alert.rule.signal_type,
        signal_value=alert.signal_value,
        threshold=alert.rule.threshold,
        operator=alert.rule.operator,
        triggered_at=alert.triggered_at,
        acknowledged=bool(alert.acknowledged),
        acknowledged_at=alert.acknowledged_at,
    )




# --- 端點 ---

@router.get("/signal-types", response_model=ApiResponse[List[SignalTypeInfo]])
async def list_signal_types():
    """列出警報規則可用的訊號類型。"""
    signal_types = [
        SignalTypeInfo(
            type=SignalType.STARS_DELTA_7D,
            name="7-Day Star Delta",
            description="Number of stars gained in the last 7 days"
        ),
        SignalTypeInfo(
            type=SignalType.STARS_DELTA_30D,
            name="30-Day Star Delta",
            description="Number of stars gained in the last 30 days"
        ),
        SignalTypeInfo(
            type=SignalType.VELOCITY,
            name="Star Velocity",
            description="Average stars per day (7-day average)"
        ),
        SignalTypeInfo(
            type=SignalType.ACCELERATION,
            name="Acceleration",
            description="Rate of change in velocity"
        ),
        SignalTypeInfo(
            type=SignalType.TREND,
            name="Trend",
            description="Overall trend direction (-1=down, 0=stable, 1=up)"
        ),
    ]
    return success_response(data=signal_types)


@router.get("/rules", response_model=ApiResponse[List[AlertRuleResponse]])
async def list_rules(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    """
    列出所有警報規則（含分頁）。

    Args:
        skip: 跳過的紀錄數（預設 0）
        limit: 回傳的最大紀錄數（預設 100，上限 500）
        db: 資料庫 session
    """
    # 限制上限以防止過量資料擷取
    limit = min(limit, 500)

    # 使用 joinedload 避免存取 rule.repo 時的 N+1 查詢
    # noinspection PyTypeChecker
    rules: List[AlertRule] = (
        db.query(AlertRule)
        .options(joinedload(AlertRule.repo))
        .offset(skip)
        .limit(limit)
        .all()
    )

    return success_response(data=[_to_alert_rule_response(rule) for rule in rules])


@router.post("/rules", response_model=ApiResponse[AlertRuleResponse])
async def create_rule(rule: AlertRuleCreate, db: Session = Depends(get_db)):
    """建立新警報規則。
    signal_type 與 operator 由 Pydantic Literal 型別驗證。
    """
    # 驗證指定的 repo 是否存在
    if rule.repo_id:
        repo = db.query(Repo).filter(Repo.id == rule.repo_id).first()
        if not repo:
            raise HTTPException(status_code=404, detail=f"Repo not found: {rule.repo_id}")

    # 建立規則
    db_rule = AlertRule(
        name=rule.name,
        description=rule.description,
        repo_id=rule.repo_id,
        signal_type=rule.signal_type,
        operator=rule.operator,
        threshold=rule.threshold,
        enabled=rule.enabled,
    )
    db.add(db_rule)
    db.commit()
    db.refresh(db_rule)

    return success_response(data=_to_alert_rule_response(db_rule))


@router.get("/rules/{rule_id}", response_model=ApiResponse[AlertRuleResponse])
async def get_rule(rule_id: int, db: Session = Depends(get_db)):
    """取得特定警報規則。"""
    rule: Optional[AlertRule] = db.query(AlertRule).filter(AlertRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail=ERROR_RULE_NOT_FOUND)

    return success_response(data=_to_alert_rule_response(rule))


@router.patch("/rules/{rule_id}", response_model=ApiResponse[AlertRuleResponse])
async def update_rule(rule_id: int, update: AlertRuleUpdate, db: Session = Depends(get_db)):
    """更新警報規則。"""
    rule: Optional[AlertRule] = db.query(AlertRule).filter(AlertRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail=ERROR_RULE_NOT_FOUND)

    # signal_type 與 operator 由 Pydantic Literal 型別驗證。
    if update.signal_type is not None:
        rule.signal_type = update.signal_type

    if update.operator is not None:
        rule.operator = update.operator

    if update.name is not None:
        rule.name = update.name
    if update.description is not None:
        rule.description = update.description
    if update.repo_id is not None:
        # 更新前驗證 repo 是否存在
        if update.repo_id:
            repo = db.query(Repo).filter(Repo.id == update.repo_id).first()
            if not repo:
                raise HTTPException(status_code=404, detail=f"Repo not found: {update.repo_id}")
        rule.repo_id = update.repo_id
    if update.threshold is not None:
        rule.threshold = update.threshold
    if update.enabled is not None:
        rule.enabled = update.enabled

    db.commit()
    db.refresh(rule)

    return success_response(data=_to_alert_rule_response(rule))


@router.delete("/rules/{rule_id}", response_model=ApiResponse[StatusResponse])
async def delete_rule(rule_id: int, db: Session = Depends(get_db)):
    """刪除警報規則。"""
    rule = db.query(AlertRule).filter(AlertRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail=ERROR_RULE_NOT_FOUND)

    db.delete(rule)
    db.commit()

    return success_response(data=StatusResponse(status="deleted", id=rule_id))


@router.get("/triggered", response_model=ApiResponse[List[TriggeredAlertResponse]])
async def list_triggered_alerts(
    unacknowledged_only: bool = False,
    limit: int = 50,
    db: Session = Depends(get_db)
):
    """列出已觸發的警報。"""
    # 使用 joinedload 避免存取 alert.rule 與 alert.repo 時的 N+1 查詢
    query = (
        db.query(TriggeredAlert)
        .options(
            joinedload(TriggeredAlert.rule),
            joinedload(TriggeredAlert.repo)
        )
        .order_by(TriggeredAlert.triggered_at.desc())
    )

    if unacknowledged_only:
        query = query.filter(TriggeredAlert.acknowledged.is_(False))

    # noinspection PyTypeChecker
    alerts: List[TriggeredAlert] = query.limit(limit).all()

    return success_response(data=[_to_triggered_alert_response(alert) for alert in alerts])


@router.post("/triggered/{alert_id}/acknowledge", response_model=ApiResponse[StatusResponse])
async def acknowledge_single_alert(alert_id: int, db: Session = Depends(get_db)):
    """確認已觸發的警報。"""
    if acknowledge_alert(db, alert_id):
        return success_response(data=StatusResponse(status="acknowledged", id=alert_id))
    raise HTTPException(status_code=404, detail=ERROR_ALERT_NOT_FOUND)


@router.post("/triggered/acknowledge-all", response_model=ApiResponse[StatusResponse])
async def acknowledge_all(db: Session = Depends(get_db)):
    """確認所有未確認的警報。"""
    count = acknowledge_all_alerts(db)
    return success_response(data=StatusResponse(status="acknowledged", count=count))


@router.post("/check", response_model=ApiResponse[CheckAlertsResponse])
async def check_alerts_now(db: Session = Depends(get_db)):
    """手動觸發警報檢查。"""
    triggered = check_all_alerts(db)
    check_result = CheckAlertsResponse(
        status="checked",
        triggered_count=len(triggered),
        triggered=[
            TriggeredAlertBrief(
                id=alert.id,
                rule_id=alert.rule_id,
                repo_id=alert.repo_id,
                signal_value=alert.signal_value,
            )
            for alert in triggered
        ],
    )
    return success_response(data=check_result)
