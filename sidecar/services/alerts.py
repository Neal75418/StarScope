"""
Alert service for checking rules and triggering alerts.
"""

import logging
import operator as op
from typing import List, Optional, Callable

from sqlalchemy.orm import Session

from constants import ALERT_COOLDOWN_SECONDS
from db.models import AlertRule, TriggeredAlert, Signal, Repo, AlertOperator
from utils.time import utc_now

logger = logging.getLogger(__name__)

# Operator mapping
OPERATORS: dict[str, Callable[[float, float], bool]] = {
    AlertOperator.GT: op.gt,
    AlertOperator.LT: op.lt,
    AlertOperator.GTE: op.ge,
    AlertOperator.LTE: op.le,
    AlertOperator.EQ: op.eq,
}


def _is_in_cooldown(db: Session, rule_id: int, repo_id: int) -> bool:
    """Check if alert was triggered recently (within cooldown period)."""
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
    """Create and persist a triggered alert."""
    triggered = TriggeredAlert(
        rule_id=rule.id,
        repo_id=repo.id,
        signal_value=signal_value,
        triggered_at=utc_now(),
    )
    db.add(triggered)
    db.commit()

    logger.info(
        f"Alert triggered: {rule.name} for {repo.full_name} "
        f"({rule.signal_type}={signal_value} {rule.operator} {rule.threshold})"
    )

    return triggered


def evaluate_condition(value: float, operator_str: str, threshold: float) -> bool:
    """
    Evaluate a condition like 'value > threshold'.

    Args:
        value: The signal value to check
        operator_str: The operator (">", "<", ">=", "<=", "==")
        threshold: The threshold value

    Returns:
        True if the condition is met
    """
    operator_func = OPERATORS.get(operator_str)
    if operator_func is None:
        logger.warning(f"Unknown operator: {operator_str}")
        return False

    return operator_func(value, threshold)


def check_rule_for_repo(
    db: Session,
    rule: "AlertRule",
    repo: "Repo"
) -> Optional["TriggeredAlert"]:
    """
    Check if a rule is triggered for a specific repo.

    Args:
        db: Database session
        rule: The alert rule to check
        repo: The repo to check against

    Returns:
        TriggeredAlert if triggered, None otherwise
    """
    # Get the latest signal of the required type
    signal = (
        db.query(Signal)
        .filter(Signal.repo_id == repo.id, Signal.signal_type == rule.signal_type)
        .order_by(Signal.calculated_at.desc())
        .first()
    )

    if signal is None:
        logger.debug(f"No signal {rule.signal_type} for repo {repo.full_name}")
        return None

    signal_value = float(signal.value)
    threshold = float(rule.threshold)

    # Check if condition is met
    if not evaluate_condition(signal_value, rule.operator, threshold):
        return None

    # Check cooldown period
    if _is_in_cooldown(db, int(rule.id), int(repo.id)):
        logger.debug(f"Alert already triggered recently for {repo.full_name}")
        return None

    # Create and return triggered alert
    return _create_triggered_alert(db, rule, repo, signal_value)


def check_all_alerts(db: Session) -> List["TriggeredAlert"]:
    """
    Check all enabled alert rules and trigger any that match.

    Args:
        db: Database session

    Returns:
        List of triggered alerts
    """
    triggered_alerts: List["TriggeredAlert"] = []

    # Get all enabled rules
    rules = db.query(AlertRule).filter(AlertRule.enabled == True).all()

    if not rules:
        logger.debug("No enabled alert rules")
        return triggered_alerts

    for rule in rules:
        triggered_alerts.extend(_check_rule_alerts(db, rule))

    return triggered_alerts


def _check_rule_alerts(db: Session, rule: "AlertRule") -> List["TriggeredAlert"]:
    """Check a single rule against applicable repos."""
    alerts: List["TriggeredAlert"] = []

    try:
        repos = _get_repos_for_rule(db, rule)
        for repo in repos:
            triggered = check_rule_for_repo(db, rule, repo)
            if triggered:
                alerts.append(triggered)
    except Exception as e:
        logger.error(f"Error checking rule {rule.name}: {e}")

    return alerts


def _get_repos_for_rule(db: Session, rule: "AlertRule") -> List["Repo"]:
    """Get the repos that a rule applies to."""
    if rule.repo_id:
        # Rule for specific repo
        repo = db.query(Repo).filter(Repo.id == rule.repo_id).first()
        return [repo] if repo else []
    # Rule for all repos
    return db.query(Repo).all()


def get_unacknowledged_alerts(db: Session) -> List[TriggeredAlert]:
    """
    Get all unacknowledged (unseen) alerts.

    Args:
        db: Database session

    Returns:
        List of unacknowledged alerts
    """
    return (
        db.query(TriggeredAlert)
        .filter(TriggeredAlert.acknowledged == False)
        .order_by(TriggeredAlert.triggered_at.desc())
        .all()
    )


def acknowledge_alert(db: Session, alert_id: int) -> bool:
    """
    Mark an alert as acknowledged.

    Args:
        db: Database session
        alert_id: The alert ID to acknowledge

    Returns:
        True if successful
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
    Mark all unacknowledged alerts as acknowledged.

    Args:
        db: Database session

    Returns:
        Number of alerts acknowledged
    """
    count = (
        db.query(TriggeredAlert)
        .filter(TriggeredAlert.acknowledged == False)
        .update({
            TriggeredAlert.acknowledged: True,
            TriggeredAlert.acknowledged_at: utc_now(),
        })
    )
    db.commit()
    return count
