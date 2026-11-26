"""警報服務，檢查規則並觸發警報。"""

import logging
import operator as op
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable

from sqlalchemy import exists, insert, literal, select
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
) -> "TriggeredAlert | None":
    """建立已觸發的警報；冷卻期內已經有同一組（同時跑的另一輪檢查剛觸發）時不建立、回 None。

    冷卻檢查與寫入是同一條 INSERT … SELECT … WHERE NOT EXISTS：SQLite 一次只有一個寫入者，這條拿到寫入鎖
    之後才判斷，所以同時跑的檢查（排程、啟動時那一輪、立即檢查、背景收集器那個行程）不會各觸發一則。
    前提是這條 INSERT 是它那個交易的第一條 statement（pysqlite 只在 DML 前隱式 BEGIN，之前的 SELECT 不開交易）：
    交易裡先有讀快照的話，另一輪 commit 之後這條會直接 database is locked、不等鎖，同時跑的檢查變成規則失敗。
    呼叫端要結束交易：沒寫入時交易也已經開始、拿著寫入鎖。
    """
    now = utc_now()
    columns = TriggeredAlert.__table__.c
    triggered_recently = exists().where(
        TriggeredAlert.rule_id == rule.id,
        TriggeredAlert.repo_id == repo.id,
        TriggeredAlert.triggered_at >= now - timedelta(seconds=ALERT_COOLDOWN_SECONDS),
    )
    # 欄位的 Python 端預設值（triggered_at、acknowledged）在 INSERT … SELECT 不會套用，這裡自己給
    row = select(
        literal(rule.id, columns.rule_id.type),
        literal(repo.id, columns.repo_id.type),
        literal(signal_value, columns.signal_value.type),
        literal(now, columns.triggered_at.type),
        literal(False, columns.acknowledged.type),
    ).where(~triggered_recently)
    new_id = db.execute(
        insert(TriggeredAlert)
        .from_select(["rule_id", "repo_id", "signal_value", "triggered_at", "acknowledged"], row)
        .returning(TriggeredAlert.id)
    ).scalar_one_or_none()
    if new_id is None:
        logger.debug(f"[警報] {repo.full_name} 同時跑的另一輪檢查剛觸發過 {rule.name}")
        return None
    triggered = db.get(TriggeredAlert, new_id)

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


@dataclass
class AlertCheckResult:
    """一輪檢查的結果。failed_rule_ids：讀寫失敗、沒檢查完的規則（那條規則先檢查的 repo 可能已經觸發，算在 triggered 裡）"""

    triggered: list["TriggeredAlert"]
    failed_rule_ids: list[int]


def check_all_alerts(db: Session) -> AlertCheckResult:
    """
    檢查所有啟用的警報規則並觸發匹配者。
    使用批次預載避免 N+1 查詢。一條規則讀寫失敗時照樣檢查其他規則，並記在 failed_rule_ids：
    呼叫端要說出「沒有全部完成」

    Args:
        db: 資料庫 session

    Returns:
        觸發的警報與沒檢查完的規則
    """
    triggered_alerts: list["TriggeredAlert"] = []
    failed_rule_ids: list[int] = []

    # 取得所有啟用的規則
    # noinspection PyTypeChecker
    rules: list[AlertRule] = db.query(AlertRule).filter(AlertRule.enabled.is_(True)).all()

    if not rules:
        logger.debug("[警報] 無啟用的警報規則")
        return AlertCheckResult(triggered=triggered_alerts, failed_rule_ids=failed_rule_ids)
    # 先記下 id 與名稱：rollback 之後（正式環境每次 commit 之後也是）物件的屬性全部過期、再讀會重新查詢；
    # 規則在檢查途中被別處刪掉的話，失敗處理裡讀它會丟 ObjectDeletedError，整輪檢查跟著中斷
    labelled_rules = [(r, r.id, r.name) for r in rules]

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

    for rule, rule_id, rule_name in labelled_rules:
        try:
            repos = _get_repos_for_rule_from_map(rule, repo_map, all_repos)
            for repo in repos:
                check = _check_rule_batch(db, rule, repo, signal_lookup, in_cooldown)
                if check.attempted_write:
                    # 寫進去或沒寫進去（同時跑的另一輪剛觸發過）都立即 commit：避免後續 rollback 連鎖失效，
                    # 沒寫進去時也要放掉寫入鎖
                    db.commit()
                    in_cooldown.add((rule.id, repo.id))  # 同步更新冷卻狀態
                if check.triggered is not None:
                    triggered_alerts.append(check.triggered)
        except SQLAlchemyError as e:
            db.rollback()
            failed_rule_ids.append(rule_id)
            logger.exception(f"[警報] 檢查規則 {rule_name} 失敗: {e}")

    return AlertCheckResult(triggered=triggered_alerts, failed_rule_ids=failed_rule_ids)


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


@dataclass(frozen=True)
class _PairCheck:
    """一組規則-repo 的檢查結果。attempted_write：試過寫入（不論同時跑的另一輪有沒有先觸發），呼叫端要結束交易"""
    attempted_write: bool
    triggered: "TriggeredAlert | None" = None


_NOT_TRIGGERED = _PairCheck(attempted_write=False)


def _check_rule_batch(
    db: Session,
    rule: "AlertRule",
    repo: "Repo",
    signal_lookup: dict[tuple[int, str], "Signal"],
    in_cooldown: set[tuple[int, int]],
) -> _PairCheck:
    """使用預載資料檢查單一規則-repo 組合，要觸發時寫入。

    in_cooldown 是這一輪開頭讀的：同時跑的另一輪之後才觸發的，由 _create_triggered_alert 寫入時擋下。
    """
    signal = signal_lookup.get((repo.id, rule.signal_type))
    if signal is None:
        return _NOT_TRIGGERED

    signal_value = float(signal.value)
    threshold = float(rule.threshold)

    if not evaluate_condition(signal_value, rule.operator, threshold):
        return _NOT_TRIGGERED

    if (rule.id, repo.id) in in_cooldown:
        logger.debug(f"[警報] {repo.full_name} 近期已觸發過警報")
        return _NOT_TRIGGERED

    return _PairCheck(attempted_write=True, triggered=_create_triggered_alert(db, rule, repo, signal_value))


def get_unacknowledged_alerts(db: Session, limit: int = MAX_ALERTS_PER_QUERY) -> list[TriggeredAlert]:
    """
    取得所有未確認（未檢視）的警報。

    Args:
        db: 資料庫 session
        limit: 最多回傳幾筆（預設 MAX_ALERTS_PER_QUERY）

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


def acknowledge_alert(db: Session, alert_id: int, listed_triggered_at: datetime | None = None) -> bool:
    """
    標記警報為已確認。

    Args:
        db: 資料庫 session
        alert_id: 要確認的警報 ID
        listed_triggered_at: 呼叫端看到的觸發時間。id 會重用（沒有 AUTOINCREMENT）：舊的那則刪掉後新警報可能
            拿到同一個 id，對不上就當成看到的那則已經不在，不去確認別的警報。不帶就不比對

    Returns:
        成功時回傳 True；找不到，或觸發時間對不上時回傳 False
    """
    alert = _find_listed_alert(db, alert_id, listed_triggered_at)
    if alert is None:
        return False
    alert.acknowledged = True
    alert.acknowledged_at = utc_now()
    db.commit()
    return True


def dismiss_alert(db: Session, alert_id: int, listed_triggered_at: datetime | None = None) -> bool:
    """
    在通知中心清除警報：還沒確認的一併確認（已確認的保留原本的確認時間），並記下清除時間。

    找不到或觸發時間對不上時回傳 False，規則同 acknowledge_alert。
    """
    alert = _find_listed_alert(db, alert_id, listed_triggered_at)
    if alert is None:
        return False
    now = utc_now()
    if not alert.acknowledged:
        alert.acknowledged = True
        alert.acknowledged_at = now
    alert.dismissed_at = now
    db.commit()
    return True


def _find_listed_alert(
    db: Session, alert_id: int, listed_triggered_at: datetime | None
) -> TriggeredAlert | None:
    """用 id 找呼叫端看到的那則；帶了觸發時間而對不上（id 已被新警報重用）就當成不在。"""
    alert = db.query(TriggeredAlert).filter(TriggeredAlert.id == alert_id).first()
    if alert is None:
        return None
    if listed_triggered_at is not None and alert.triggered_at != _as_naive_utc(listed_triggered_at):
        return None
    return alert


def _as_naive_utc(value: datetime) -> datetime:
    """資料庫存 naive UTC；帶時區的換成 UTC 再拿掉時區，不帶的當成 UTC。"""
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


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
