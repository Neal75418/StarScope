"""
Alert service for checking rules and triggering alerts.
"""

import logging
import operator as op
from datetime import datetime
from typing import List, Optional, Callable

from sqlalchemy.orm import Session

from db.models import AlertRule, TriggeredAlert, Signal, Repo, AlertOperator

logger = logging.getLogger(__name__)

# Operator mapping
OPERATORS: dict[str, Callable[[float, float], bool]] = {
    AlertOperator.GT: op.gt,
    AlertOperator.LT: op.lt,
    AlertOperator.GTE: op.ge,
    AlertOperator.LTE: op.le,
    AlertOperator.EQ: op.eq,
}


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
    rule: AlertRule,
    repo: Repo
) -> Optional[TriggeredAlert]:
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

    # Check if condition is met
    if evaluate_condition(signal.value, rule.operator, rule.threshold):
        # Check if we already triggered this alert recently (within last hour)
        recent_trigger = (
            db.query(TriggeredAlert)
            .filter(
                TriggeredAlert.rule_id == rule.id,
                TriggeredAlert.repo_id == repo.id,
            )
            .order_by(TriggeredAlert.triggered_at.desc())
            .first()
        )

        # Don't trigger if already triggered in the last hour
        if recent_trigger:
            time_diff = datetime.utcnow() - recent_trigger.triggered_at
            if time_diff.total_seconds() < 3600:  # 1 hour
                logger.debug(f"Alert already triggered recently for {repo.full_name}")
                return None

        # Create triggered alert
        triggered = TriggeredAlert(
            rule_id=rule.id,
            repo_id=repo.id,
            signal_value=signal.value,
            triggered_at=datetime.utcnow(),
        )
        db.add(triggered)
        db.commit()

        logger.info(
            f"Alert triggered: {rule.name} for {repo.full_name} "
            f"({rule.signal_type}={signal.value} {rule.operator} {rule.threshold})"
        )

        return triggered

    return None


async def check_all_alerts(db: Session) -> List[TriggeredAlert]:
    """
    Check all enabled alert rules and trigger any that match.

    Args:
        db: Database session

    Returns:
        List of triggered alerts
    """
    triggered_alerts = []

    # Get all enabled rules
    rules = db.query(AlertRule).filter(AlertRule.enabled == True).all()

    if not rules:
        logger.debug("No enabled alert rules")
        return triggered_alerts

    for rule in rules:
        try:
            if rule.repo_id:
                # Rule for specific repo
                repo = db.query(Repo).filter(Repo.id == rule.repo_id).first()
                if repo:
                    triggered = check_rule_for_repo(db, rule, repo)
                    if triggered:
                        triggered_alerts.append(triggered)
            else:
                # Rule for all repos
                repos = db.query(Repo).all()
                for repo in repos:
                    triggered = check_rule_for_repo(db, rule, repo)
                    if triggered:
                        triggered_alerts.append(triggered)

        except Exception as e:
            logger.error(f"Error checking rule {rule.name}: {e}")
            continue

    return triggered_alerts


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
        alert.acknowledged_at = datetime.utcnow()
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
            TriggeredAlert.acknowledged_at: datetime.utcnow(),
        })
    )
    db.commit()
    return count
