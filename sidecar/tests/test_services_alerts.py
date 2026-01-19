"""
Tests for services/alerts.py - Alert checking service.
"""

import pytest
from datetime import timedelta
from unittest.mock import MagicMock, patch

from services.alerts import (
    evaluate_condition,
    check_rule_for_repo,
    check_all_alerts,
    _is_in_cooldown,
    _create_triggered_alert,
    _get_repos_for_rule,
    _check_rule_alerts,
    get_unacknowledged_alerts,
    acknowledge_alert,
    acknowledge_all_alerts,
)
from db.models import AlertRule, AlertOperator, TriggeredAlert, Signal
from utils.time import utc_now


class TestEvaluateCondition:
    """Tests for evaluate_condition function."""

    def test_greater_than_true(self):
        """Test > operator returns True when condition is met."""
        assert evaluate_condition(10.0, AlertOperator.GT, 5.0) is True

    def test_greater_than_false(self):
        """Test > operator returns False when condition is not met."""
        assert evaluate_condition(5.0, AlertOperator.GT, 10.0) is False

    def test_greater_than_equal(self):
        """Test > operator returns False when equal."""
        assert evaluate_condition(5.0, AlertOperator.GT, 5.0) is False

    def test_less_than_true(self):
        """Test < operator returns True when condition is met."""
        assert evaluate_condition(5.0, AlertOperator.LT, 10.0) is True

    def test_less_than_false(self):
        """Test < operator returns False when condition is not met."""
        assert evaluate_condition(10.0, AlertOperator.LT, 5.0) is False

    def test_greater_than_or_equal_true(self):
        """Test >= operator returns True when greater."""
        assert evaluate_condition(10.0, AlertOperator.GTE, 5.0) is True

    def test_greater_than_or_equal_equal(self):
        """Test >= operator returns True when equal."""
        assert evaluate_condition(5.0, AlertOperator.GTE, 5.0) is True

    def test_greater_than_or_equal_false(self):
        """Test >= operator returns False when less."""
        assert evaluate_condition(4.0, AlertOperator.GTE, 5.0) is False

    def test_less_than_or_equal_true(self):
        """Test <= operator returns True when less."""
        assert evaluate_condition(5.0, AlertOperator.LTE, 10.0) is True

    def test_less_than_or_equal_equal(self):
        """Test <= operator returns True when equal."""
        assert evaluate_condition(5.0, AlertOperator.LTE, 5.0) is True

    def test_equal_true(self):
        """Test == operator returns True when equal."""
        assert evaluate_condition(5.0, AlertOperator.EQ, 5.0) is True

    def test_equal_false(self):
        """Test == operator returns False when not equal."""
        assert evaluate_condition(5.0, AlertOperator.EQ, 10.0) is False

    def test_unknown_operator(self):
        """Test unknown operator returns False."""
        assert evaluate_condition(5.0, "invalid", 5.0) is False


class TestIsInCooldown:
    """Tests for _is_in_cooldown function."""

    def test_no_previous_trigger(self, test_db, mock_repo):
        """Test returns False when no previous trigger."""
        result = _is_in_cooldown(test_db, rule_id=999, repo_id=mock_repo.id)
        assert result is False


class TestCreateTriggeredAlert:
    """Tests for _create_triggered_alert function."""

    def test_creates_alert(self, test_db, mock_repo):
        """Test that alert is created and persisted."""
        rule = AlertRule(
            name="Test Rule",
            signal_type="velocity",
            operator=AlertOperator.GT,
            threshold=10.0,
            enabled=True,
        )
        test_db.add(rule)
        test_db.commit()

        triggered = _create_triggered_alert(test_db, rule, mock_repo, 15.0)

        assert triggered is not None
        assert triggered.rule_id == rule.id
        assert triggered.repo_id == mock_repo.id
        assert triggered.signal_value == 15.0

        # Verify persisted
        from_db = test_db.query(TriggeredAlert).filter(TriggeredAlert.id == triggered.id).first()
        assert from_db is not None


class TestGetReposForRule:
    """Tests for _get_repos_for_rule function."""

    def test_specific_repo(self, test_db, mock_repo):
        """Test getting specific repo for rule."""
        rule = AlertRule(
            name="Test Rule",
            signal_type="velocity",
            operator=AlertOperator.GT,
            threshold=10.0,
            enabled=True,
            repo_id=mock_repo.id,
        )
        test_db.add(rule)
        test_db.commit()

        repos = _get_repos_for_rule(test_db, rule)
        assert len(repos) == 1
        assert repos[0].id == mock_repo.id

    def test_all_repos(self, test_db, mock_multiple_repos):
        """Test getting all repos for rule without repo_id."""
        rule = AlertRule(
            name="Test Rule",
            signal_type="velocity",
            operator=AlertOperator.GT,
            threshold=10.0,
            enabled=True,
            repo_id=None,
        )
        test_db.add(rule)
        test_db.commit()

        repos = _get_repos_for_rule(test_db, rule)
        assert len(repos) == 3

    def test_nonexistent_repo(self, test_db):
        """Test getting nonexistent repo returns empty list."""
        rule = AlertRule(
            name="Test Rule",
            signal_type="velocity",
            operator=AlertOperator.GT,
            threshold=10.0,
            enabled=True,
            repo_id=99999,  # Doesn't exist
        )
        test_db.add(rule)
        test_db.commit()

        repos = _get_repos_for_rule(test_db, rule)
        assert repos == []


class TestCheckRuleForRepo:
    """Tests for check_rule_for_repo function."""

    def test_no_signal(self, test_db, mock_repo):
        """Test returns None when no signal exists."""
        rule = AlertRule(
            name="Test Rule",
            signal_type="velocity",
            operator=AlertOperator.GT,
            threshold=10.0,
            enabled=True,
        )
        test_db.add(rule)
        test_db.commit()

        result = check_rule_for_repo(test_db, rule, mock_repo)
        assert result is None

    def test_condition_not_met(self, test_db, mock_repo):
        """Test returns None when condition is not met."""
        rule = AlertRule(
            name="Test Rule",
            signal_type="velocity",
            operator=AlertOperator.GT,
            threshold=100.0,  # High threshold
            enabled=True,
        )
        test_db.add(rule)

        # Create signal with value below threshold
        signal = Signal(
            repo_id=mock_repo.id,
            signal_type="velocity",
            value=5.0,
            calculated_at=utc_now(),
        )
        test_db.add(signal)
        test_db.commit()

        result = check_rule_for_repo(test_db, rule, mock_repo)
        assert result is None

    def test_triggers_alert(self, test_db, mock_repo):
        """Test triggers alert when condition is met."""
        rule = AlertRule(
            name="Test Rule",
            signal_type="velocity",
            operator=AlertOperator.GT,
            threshold=5.0,
            enabled=True,
        )
        test_db.add(rule)

        # Create signal with value above threshold
        signal = Signal(
            repo_id=mock_repo.id,
            signal_type="velocity",
            value=15.0,
            calculated_at=utc_now(),
        )
        test_db.add(signal)
        test_db.commit()

        result = check_rule_for_repo(test_db, rule, mock_repo)
        assert result is not None
        assert result.signal_value == 15.0


class TestCheckAllAlerts:
    """Tests for check_all_alerts function."""

    def test_no_enabled_rules(self, test_db):
        """Test returns empty list when no enabled rules."""
        result = check_all_alerts(test_db)
        assert result == []

    def test_checks_all_rules(self, test_db, mock_repo):
        """Test checks all enabled rules."""
        rule1 = AlertRule(
            name="Rule 1",
            signal_type="velocity",
            operator=AlertOperator.GT,
            threshold=5.0,
            enabled=True,
        )
        rule2 = AlertRule(
            name="Rule 2",
            signal_type="velocity",
            operator=AlertOperator.LT,
            threshold=100.0,
            enabled=True,
        )
        test_db.add_all([rule1, rule2])

        signal = Signal(
            repo_id=mock_repo.id,
            signal_type="velocity",
            value=10.0,
            calculated_at=utc_now(),
        )
        test_db.add(signal)
        test_db.commit()

        result = check_all_alerts(test_db)
        # Both rules should trigger (10 > 5 and 10 < 100)
        assert len(result) == 2


class TestGetUnacknowledgedAlerts:
    """Tests for get_unacknowledged_alerts function."""

    def test_returns_empty_when_no_alerts(self, test_db):
        """Test returns empty list when no alerts exist."""
        result = get_unacknowledged_alerts(test_db)
        assert result == []


class TestAcknowledgeAlert:
    """Tests for acknowledge_alert function."""

    def test_nonexistent_alert(self, test_db):
        """Test returns False for nonexistent alert."""
        result = acknowledge_alert(test_db, 99999)
        assert result is False


class TestAcknowledgeAllAlerts:
    """Tests for acknowledge_all_alerts function."""

    def test_acknowledges_all(self, test_db, mock_repo):
        """Test acknowledges all unacknowledged alerts."""
        rule = AlertRule(
            name="Test Rule",
            signal_type="velocity",
            operator=AlertOperator.GT,
            threshold=5.0,
            enabled=True,
        )
        test_db.add(rule)
        test_db.commit()

        alerts = [
            TriggeredAlert(
                rule_id=rule.id,
                repo_id=mock_repo.id,
                signal_value=10.0,
                acknowledged=False,
                triggered_at=utc_now(),
            ),
            TriggeredAlert(
                rule_id=rule.id,
                repo_id=mock_repo.id,
                signal_value=15.0,
                acknowledged=False,
                triggered_at=utc_now(),
            ),
        ]
        test_db.add_all(alerts)
        test_db.commit()

        count = acknowledge_all_alerts(test_db)
        assert count == 2

        # Verify all acknowledged
        unack = get_unacknowledged_alerts(test_db)
        assert len(unack) == 0
