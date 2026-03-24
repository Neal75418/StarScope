"""警報服務，檢查規則並觸發警報。"""

import logging
import operator as op
from datetime import timedelta
from typing import Callable

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from constants import ALERT_COOLDOWN_SECONDS, MAX_ALERTS_PER_QUERY, AlertOperator
from db.models import AlertRule, TriggeredAlert, Signal, Repo
from utils.time import utc_now

logger = logging.getLogger(__name__)

# 運算子對應
OPERATORS: dict[str, Callable[[float, float], bool]] = {
    AlertOperator.GT: op.gt,
    AlertOperator.LT: op.lt,
    AlertOperator.GTE: op.ge,
    AlertOperator.LTE: op.le,
    AlertOperator.EQ: op.eq,
}


def _is_in_cooldown(db: Session, rule_id: int, repo_id: int) -> bool:
    """檢查警報是否近期已觸發（在冷卻期內）。"""
    recent_trigger = (
        db.query(TriggeredAlert)
        .filter(
            TriggeredAlert.rule_id == rule_id,
            TriggeredAlert.repo_id == repo_id,
        )
        .order_by(TriggeredAlert.triggered_at.desc())
        .first()
    )

    if not recent_trigger:
        return False

    time_diff = utc_now() - recent_trigger.triggered_at
    return time_diff.total_seconds() < ALERT_COOLDOWN_SECONDS


def _create_triggered_alert(
    db: Session,
    rule: "AlertRule",
    repo: "Repo",
    signal_value: float
) -> "TriggeredAlert":
    """建立並持久化已觸發的警報。"""
    triggered = TriggeredAlert(
        rule_id=rule.id,
        repo_id=repo.id,
        signal_value=signal_value,
        triggered_at=utc_now(),
    )
    db.add(triggered)
    db.flush()

    logger.info(
        f"[警報] 已觸發: {rule.name} (repo: {repo.full_name}, "
        f"{rule.signal_type}={signal_value} {rule.operator} {rule.threshold})"
    )

    return triggered


def evaluate_condition(value: float, operator_str: str, threshold: float) -> bool:
    """
    評估 'value > threshold' 之類的條件。

    Args:
        value: 要檢查的訊號值
        operator_str: 運算子（">"、"<"、">="、"<="、"=="）
        threshold: 門檻值

    Returns:
        條件滿足時回傳 True
    """
    operator_func = OPERATORS.get(operator_str)
    if operator_func is None:
        logger.warning(f"[警報] 未知的運算子: {operator_str}")
        return False

    return operator_func(value, threshold)


def check_rule_for_repo(
    db: Session,
    rule: "AlertRule",
    repo: "Repo"
) -> "TriggeredAlert | None":
    """
    檢查規則是否對特定 repo 觸發。

    Args:
        db: 資料庫 session
        rule: 要檢查的警報規則
        repo: 要比對的 repo

    Returns:
        觸發時回傳 TriggeredAlert，否則 None
    """
    # 取得所需類型的最新訊號
    signal = (
        db.query(Signal)
        .filter(Signal.repo_id == repo.id, Signal.signal_type == rule.signal_type)
        .order_by(Signal.calculated_at.desc())
        .first()
    )

    if signal is None:
        logger.debug(f"[警報] repo {repo.full_name} 無 {rule.signal_type} 訊號")
        return None

    # noinspection PyTypeChecker
    signal_value = float(signal.value)
    threshold = float(rule.threshold)

    # 檢查條件是否滿足
    if not evaluate_condition(signal_value, rule.operator, threshold):
        return None

    # 檢查冷卻期
    if _is_in_cooldown(db, int(rule.id), int(repo.id)):
        logger.debug(f"[警報] {repo.full_name} 近期已觸發過警報")
        return None

    # 建立並回傳已觸發的警報
    return _create_triggered_alert(db, rule, repo, signal_value)


def check_all_alerts(db: Session) -> list["TriggeredAlert"]:
    """
    檢查所有啟用的警報規則並觸發匹配者。
    使用批次預載避免 N+1 查詢。

    Args:
        db: 資料庫 session

    Returns:
        已觸發警報的列表
    """
    triggered_alerts: list["TriggeredAlert"] = []

    # 取得所有啟用的規則
    # noinspection PyTypeChecker
    rules: list[AlertRule] = db.query(AlertRule).filter(AlertRule.enabled.is_(True)).all()

    if not rules:
        logger.debug("[警報] 無啟用的警報規則")
        return triggered_alerts

    # 批次預載所有 repo（全域規則需要）
    # noinspection PyTypeChecker
    all_repos: list[Repo] = db.query(Repo).all()
    repo_map: dict[int, Repo] = {r.id: r for r in all_repos}

    # 批次預載所有相關 Signal（一次查詢取代 R×M 次）
    signal_types = {r.signal_type for r in rules}
    all_signals = db.query(Signal).filter(Signal.signal_type.in_(signal_types)).all()
    # signal_lookup: {(repo_id, signal_type): Signal} 查找表
    signal_lookup: dict[tuple[int, str], Signal] = {}
    for s in all_signals:
        key = (s.repo_id, s.signal_type)
        existing = signal_lookup.get(key)
        if existing is None or s.calculated_at > existing.calculated_at:
            signal_lookup[key] = s

    # 批次預載冷卻狀態（一次查詢取代 R×M 次）
    cutoff = utc_now() - timedelta(seconds=ALERT_COOLDOWN_SECONDS)
    recent_triggers = db.query(
        TriggeredAlert.rule_id, TriggeredAlert.repo_id
    ).filter(TriggeredAlert.triggered_at >= cutoff).all()
    in_cooldown: set[tuple[int, int]] = {(r.rule_id, r.repo_id) for r in recent_triggers}

    for rule in rules:
        try:
            repos = _get_repos_for_rule_from_map(rule, repo_map, all_repos)
            for repo in repos:
                triggered = _check_rule_batch(
                    db, rule, repo, signal_lookup, in_cooldown
                )
                if triggered:
                    triggered_alerts.append(triggered)
        except SQLAlchemyError as e:
            logger.error(f"[警報] 檢查規則 {rule.name} 失敗: {e}", exc_info=True)

    if triggered_alerts:
        db.commit()

    return triggered_alerts


def _get_repos_for_rule_from_map(
    rule: "AlertRule",
    repo_map: dict[int, "Repo"],
    all_repos: list["Repo"],
) -> list["Repo"]:
    """從預載的 repo map 取得規則適用的 repo（無 DB 查詢）。"""
    if rule.repo_id:
        repo = repo_map.get(rule.repo_id)
        return [repo] if repo else []
    return all_repos


def _check_rule_batch(
    db: Session,
    rule: "AlertRule",
    repo: "Repo",
    signal_lookup: dict[tuple[int, str], "Signal"],
    in_cooldown: set[tuple[int, int]],
) -> "TriggeredAlert | None":
    """使用預載資料檢查單一規則-repo 組合（無額外 DB 查詢）。"""
    signal = signal_lookup.get((repo.id, rule.signal_type))
    if signal is None:
        return None

    signal_value = float(signal.value)
    threshold = float(rule.threshold)

    if not evaluate_condition(signal_value, rule.operator, threshold):
        return None

    if (rule.id, repo.id) in in_cooldown:
        logger.debug(f"[警報] {repo.full_name} 近期已觸發過警報")
        return None

    return _create_triggered_alert(db, rule, repo, signal_value)


def get_unacknowledged_alerts(db: Session, limit: int = MAX_ALERTS_PER_QUERY) -> list[TriggeredAlert]:
    """
    取得所有未確認（未檢視）的警報。

    Args:
        db: 資料庫 session

    Returns:
        未確認警報的列表
    """
    # noinspection PyTypeChecker
    alerts: list[TriggeredAlert] = (
        db.query(TriggeredAlert)
        .filter(TriggeredAlert.acknowledged.is_(False))
        .order_by(TriggeredAlert.triggered_at.desc())
        .limit(limit)
        .all()
    )
    return alerts


def acknowledge_alert(db: Session, alert_id: int) -> bool:
    """
    標記警報為已確認。

    Args:
        db: 資料庫 session
        alert_id: 要確認的警報 ID

    Returns:
        成功時回傳 True
    """
    alert = db.query(TriggeredAlert).filter(TriggeredAlert.id == alert_id).first()
    if alert:
        alert.acknowledged = True
        alert.acknowledged_at = utc_now()
        db.commit()
        return True
    return False


def acknowledge_all_alerts(db: Session) -> int:
    """
    將所有未確認警報標記為已確認。

    Args:
        db: 資料庫 session

    Returns:
        已確認的警報數量
    """
    count = (
        db.query(TriggeredAlert)
        .filter(TriggeredAlert.acknowledged.is_(False))
        .update({
            TriggeredAlert.acknowledged: True,
            TriggeredAlert.acknowledged_at: utc_now(),
        })
    )
    db.commit()
    return count
