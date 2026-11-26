"""
Tests for services/alerts.py - Alert checking service.
"""

import pytest
from sqlalchemy.exc import SQLAlchemyError
from constants import AlertOperator
from db.models import AlertRule, TriggeredAlert, Signal, Repo
from services.alerts import (
    evaluate_condition,
    check_rule_for_repo,
    check_all_alerts,
    get_unacknowledged_alerts,
    acknowledge_alert,
    acknowledge_all_alerts,
)
# Import internal functions for unit testing (testing implementation details)
from services import alerts as alerts_module
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
        result = alerts_module._is_in_cooldown(test_db, rule_id=999, repo_id=mock_repo.id)
        assert result is False

    def test_recent_trigger_within_cooldown(self, test_db, mock_repo):
        """Test returns True when trigger is within cooldown window."""
        rule = AlertRule(
            name="Cooldown Rule",
            signal_type="velocity",
            operator=AlertOperator.GT,
            threshold=10.0,
            enabled=True,
        )
        test_db.add(rule)
        test_db.commit()

        # Create a trigger that just happened (within 1-hour cooldown)
        trigger = TriggeredAlert(
            rule_id=rule.id,
            repo_id=mock_repo.id,
            signal_value=15.0,
            triggered_at=utc_now(),
        )
        test_db.add(trigger)
        test_db.commit()

        result = alerts_module._is_in_cooldown(test_db, rule_id=rule.id, repo_id=mock_repo.id)
        assert result is True

    def test_old_trigger_outside_cooldown(self, test_db, mock_repo):
        """Test returns False when trigger is outside cooldown window."""
        from datetime import timedelta
        from constants import ALERT_COOLDOWN_SECONDS

        rule = AlertRule(
            name="Old Trigger Rule",
            signal_type="velocity",
            operator=AlertOperator.GT,
            threshold=10.0,
            enabled=True,
        )
        test_db.add(rule)
        test_db.commit()

        # Create a trigger that is older than the cooldown period
        trigger = TriggeredAlert(
            rule_id=rule.id,
            repo_id=mock_repo.id,
            signal_value=15.0,
            triggered_at=utc_now() - timedelta(seconds=ALERT_COOLDOWN_SECONDS + 60),
        )
        test_db.add(trigger)
        test_db.commit()

        result = alerts_module._is_in_cooldown(test_db, rule_id=rule.id, repo_id=mock_repo.id)
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

        triggered = alerts_module._create_triggered_alert(test_db, rule, mock_repo, 15.0)

        assert triggered is not None
        assert triggered.rule_id == rule.id
        assert triggered.repo_id == mock_repo.id
        assert triggered.signal_value == pytest.approx(15.0)

        # Verify persisted
        from_db = test_db.query(TriggeredAlert).filter(TriggeredAlert.id == triggered.id).first()
        assert from_db is not None


class TestGetReposForRule:
    """Tests for _get_repos_for_rule_from_map function."""

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

        all_repos = test_db.query(Repo).all()
        repo_map = {r.id: r for r in all_repos}
        repos = alerts_module._get_repos_for_rule_from_map(rule, repo_map, all_repos)
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

        all_repos = test_db.query(Repo).all()
        repo_map = {r.id: r for r in all_repos}
        repos = alerts_module._get_repos_for_rule_from_map(rule, repo_map, all_repos)
        assert len(repos) == 3

    def test_rule_bound_to_an_archived_repo_matches_nothing(self, test_db, mock_repo):
        """綁定的 repo 被封存後，規則不套用到任何 repo。

        外鍵開著的正式環境寫不進指向不存在 repo 的規則；repo 在、卻查不到的真實情況是它被封存了
        （全域封存過濾讓它不出現在 repo 清單裡）。
        """
        rule = AlertRule(
            name="Test Rule",
            signal_type="velocity",
            operator=AlertOperator.GT,
            threshold=10.0,
            enabled=True,
            repo_id=mock_repo.id,
        )
        test_db.add(rule)
        mock_repo.unstarred_at = utc_now()
        test_db.commit()
        test_db.expire_all()

        all_repos = test_db.query(Repo).all()
        repo_map = {r.id: r for r in all_repos}
        repos = alerts_module._get_repos_for_rule_from_map(rule, repo_map, all_repos)
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
        assert result.signal_value == pytest.approx(15.0)


class TestCheckAllAlerts:
    """Tests for check_all_alerts function."""

    def test_no_enabled_rules(self, test_db):
        """Test returns empty list when no enabled rules."""
        result = check_all_alerts(test_db)
        assert result.triggered == []

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
        assert len(result.triggered) == 2

    @staticmethod
    def _add_rule_and_signal(test_db, mock_repo, *, enabled=True):
        rule = AlertRule(
            name="Cooldown rule",
            signal_type="velocity",
            operator=AlertOperator.GT,
            threshold=5.0,
            enabled=enabled,
        )
        signal = Signal(
            repo_id=mock_repo.id,
            signal_type="velocity",
            value=10.0,
            calculated_at=utc_now(),
        )
        test_db.add_all([rule, signal])
        test_db.commit()
        return rule

    def test_second_run_suppressed_by_cooldown(self, test_db, mock_repo):
        """批次路徑的冷卻抑制：連跑兩次，第二次不得重複觸發（否則每個排程週期都轟炸）。"""
        self._add_rule_and_signal(test_db, mock_repo)

        first = check_all_alerts(test_db)
        assert len(first.triggered) == 1

        second = check_all_alerts(test_db)
        assert second.triggered == []
        assert test_db.query(TriggeredAlert).count() == 1

    def test_disabled_rule_not_checked(self, test_db, mock_repo):
        """停用規則即使條件符合也不觸發（批次路徑的 enabled 過濾）。"""
        self._add_rule_and_signal(test_db, mock_repo, enabled=False)

        result = check_all_alerts(test_db)
        assert result.triggered == []
        assert test_db.query(TriggeredAlert).count() == 0

    def test_reports_a_rule_it_could_not_check(self, test_db, mock_repo, monkeypatch):
        """某條規則讀寫失敗時照樣檢查其他規則，並回報沒檢查完的規則：呼叫端才說得出「沒有全部完成」。"""
        broken = self._add_rule_and_signal(test_db, mock_repo)
        working = AlertRule(
            name="Working rule",
            signal_type="velocity",
            operator=AlertOperator.GT,
            threshold=5.0,
            enabled=True,
        )
        test_db.add(working)
        test_db.commit()
        real_check = alerts_module._check_rule_batch

        def locked_for_broken(db, rule, repo, *args):
            if rule.id == broken.id:
                raise SQLAlchemyError("database is locked")
            return real_check(db, rule, repo, *args)

        monkeypatch.setattr(alerts_module, "_check_rule_batch", locked_for_broken)

        result = check_all_alerts(test_db)

        assert [a.rule_id for a in result.triggered] == [working.id]
        assert result.failed_rule_ids == [broken.id]

    def test_keeps_checking_when_a_rule_is_deleted_just_before_it_triggers(self, test_db, mock_repo, monkeypatch):
        """檢查途中規則被別處刪掉、它又剛好要觸發：寫觸發紀錄時外鍵失敗、rollback 讓物件過期，
        失敗處理裡再讀它會丟 ObjectDeletedError、整輪中斷。

        要用另一個 session 刪：同一個 session 刪的話物件跟著同步，重現不了。
        """
        from sqlalchemy.orm import Session

        deleted = self._add_rule_and_signal(test_db, mock_repo)
        deleted_id = deleted.id
        working = AlertRule(
            name="Working rule",
            signal_type="velocity",
            operator=AlertOperator.GT,
            threshold=5.0,
            enabled=True,
        )
        test_db.add(working)
        test_db.commit()
        real_check = alerts_module._check_rule_batch

        def deleted_elsewhere(db, rule, repo, *args):
            if rule.id == deleted_id:
                other = Session(bind=db.get_bind())
                other.query(AlertRule).filter(AlertRule.id == deleted_id).delete()
                other.commit()
                other.close()
            # 照常檢查：被刪的那條寫觸發紀錄時真的會外鍵失敗
            return real_check(db, rule, repo, *args)

        monkeypatch.setattr(alerts_module, "_check_rule_batch", deleted_elsewhere)

        result = check_all_alerts(test_db)

        assert result.failed_rule_ids == [deleted_id]
        assert [a.rule_id for a in result.triggered] == [working.id]

    def test_keeps_checking_when_a_rule_is_deleted_after_an_earlier_rule_failed(self, test_db, mock_repo, monkeypatch):
        """前一條規則失敗、rollback 讓所有物件過期，下一條已經被別處刪掉：輪到它之前就讀它的話（不是事先記下的 id），
        會在 try 外面丟 ObjectDeletedError、整輪中斷。正式環境前一條觸發後的 commit 也會讓物件過期，是同一條路
        """
        from sqlalchemy.orm import Session

        failing = self._add_rule_and_signal(test_db, mock_repo)
        deleted = AlertRule(
            name="Deleted rule", signal_type="velocity", operator=AlertOperator.GT,
            threshold=100.0, enabled=True,
        )
        working = AlertRule(
            name="Working rule", signal_type="velocity", operator=AlertOperator.GT,
            threshold=5.0, enabled=True,
        )
        test_db.add(deleted)
        test_db.commit()
        test_db.add(working)
        test_db.commit()
        failing_id, deleted_id, working_id = failing.id, deleted.id, working.id
        real_check = alerts_module._check_rule_batch

        def fail_and_delete_the_next(db, rule, repo, *args):
            if rule.id == failing_id:
                other = Session(bind=db.get_bind())
                other.query(AlertRule).filter(AlertRule.id == deleted_id).delete()
                other.commit()
                other.close()
                raise SQLAlchemyError("database is locked")
            return real_check(db, rule, repo, *args)

        monkeypatch.setattr(alerts_module, "_check_rule_batch", fail_and_delete_the_next)

        result = check_all_alerts(test_db)

        assert result.failed_rule_ids == [failing_id, deleted_id]
        assert [a.rule_id for a in result.triggered] == [working_id]

    def test_triggers_again_once_the_cooldown_has_passed(self, test_db, mock_repo):
        """冷卻過了就能再觸發：開頭的冷卻預載與寫入時的冷卻判斷都要有時間條件，
        少了的話同一組一輩子只觸發一次、之後靜默"""
        from datetime import timedelta
        from constants import ALERT_COOLDOWN_SECONDS

        rule = self._add_rule_and_signal(test_db, mock_repo)
        test_db.add(TriggeredAlert(
            rule_id=rule.id, repo_id=mock_repo.id, signal_value=10.0,
            triggered_at=utc_now() - timedelta(seconds=ALERT_COOLDOWN_SECONDS + 60),
        ))
        test_db.commit()

        result = check_all_alerts(test_db)

        assert len(result.triggered) == 1
        assert test_db.query(TriggeredAlert).count() == 2

    def test_reports_no_failed_rule_when_all_were_checked(self, test_db, mock_repo):
        self._add_rule_and_signal(test_db, mock_repo)

        result = check_all_alerts(test_db)

        assert len(result.triggered) == 1
        assert result.failed_rule_ids == []

    # 註：「同 repo 多筆同型 Signal 取最新」不需要測——schema 的
    # UNIQUE(repo_id, signal_type) 約束使該狀態不可能存在，
    # signal_lookup 的 calculated_at 比較是防禦性代碼。


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


class TestConcurrentChecksTriggerOnce:
    """排程、啟動時那一輪、立即檢查、背景收集器（另一個行程）都會跑 check_all_alerts，彼此沒有互斥：
    冷卻在每輪開頭一次讀好的話，兩輪重疊時同一組規則＋repo 會各觸發一則。
    用跟正式一樣的 engine（檔案、NullPool、各自一條連線），StaticPool 的記憶體資料庫測不到"""

    @pytest.fixture
    def db_file(self, tmp_path):
        from sqlalchemy.orm import sessionmaker
        from db.database import create_app_engine, sqlite_url
        from db.models import Base

        path = tmp_path / "alerts.db"
        engine = create_app_engine(sqlite_url(path))
        Base.metadata.create_all(engine)
        yield path, sessionmaker(autocommit=False, autoflush=False, bind=engine)
        engine.dispose()

    @staticmethod
    def _seed(factory, n_repos: int, n_rules: int) -> None:
        db = factory()
        repos = [
            Repo(owner=f"o{i}", name=f"r{i}", full_name=f"o{i}/r{i}", url=f"https://github.com/o{i}/r{i}")
            for i in range(n_repos)
        ]
        db.add_all(repos)
        db.commit()
        db.add_all([Signal(repo_id=r.id, signal_type="stars_delta_7d", value=100.0) for r in repos])
        db.add_all([
            AlertRule(name=f"rule{k}", signal_type="stars_delta_7d", operator=">", threshold=0.0, enabled=True)
            for k in range(n_rules)
        ])
        db.commit()
        db.close()

    def test_two_rounds_at_the_same_time_trigger_each_pair_once(self, db_file):
        import threading
        from collections import Counter

        _, factory = db_file
        self._seed(factory, n_repos=30, n_rules=3)
        barrier = threading.Barrier(2)
        errors: list[BaseException] = []
        failed: list[list[int]] = []

        def one_round():
            db = factory()
            try:
                barrier.wait()  # 只對齊起點，不安排兩輪內部的先後
                failed.append(check_all_alerts(db).failed_rule_ids)
            except BaseException as e:  # noqa: BLE001 — 例外要帶回主執行緒斷言
                errors.append(e)
            finally:
                db.close()

        rounds = [threading.Thread(target=one_round) for _ in range(2)]
        for t in rounds:
            t.start()
        for t in rounds:
            t.join()

        assert errors == []
        # 等不到寫入鎖會被收進 failed_rule_ids、不會丟出來：一輪全失敗時另一輪照樣寫完 90 組
        assert failed == [[], []]
        db = factory()
        counts = Counter((a.rule_id, a.repo_id) for a in db.query(TriggeredAlert).all())
        db.close()
        assert len(counts) == 90
        assert max(counts.values()) == 1

    def test_a_pair_another_round_just_triggered_is_not_triggered_again(self, db_file):
        """這一輪讀完冷卻之後，另一輪才觸發同一組：不再觸發、不算進這一輪的結果；
        而且不能一直拿著寫入鎖（立即檢查的 session 要等回應送出才關，其他寫入會卡住）"""
        import sqlite3
        from unittest.mock import patch

        path, factory = db_file
        self._seed(factory, n_repos=1, n_rules=1)
        other = factory()
        rule_id = other.query(AlertRule).one().id
        repo_id = other.query(Repo).one().id
        real = alerts_module._get_repos_for_rule_from_map

        def another_round_triggers_first(*args, **kwargs):
            other.add(TriggeredAlert(rule_id=rule_id, repo_id=repo_id, signal_value=100.0, triggered_at=utc_now()))
            other.commit()
            return real(*args, **kwargs)

        db = factory()
        with patch.object(alerts_module, "_get_repos_for_rule_from_map", side_effect=another_round_triggers_first):
            result = check_all_alerts(db)

        assert result.triggered == []
        assert result.failed_rule_ids == []
        assert other.query(TriggeredAlert).count() == 1
        probe = sqlite3.connect(path, timeout=0.2)
        try:
            probe.execute("BEGIN IMMEDIATE")  # 寫入鎖還被這一輪拿著的話：database is locked
            probe.rollback()
        finally:
            probe.close()
            db.close()
            other.close()

    def test_waits_for_another_round_holding_the_write_lock_then_skips_the_pair(self, db_file):
        """另一輪正拿著寫入鎖、寫了同一組但還沒 commit：這一輪要等到鎖、看到那筆再跳過，
        不能當成失敗，也不能再寫一筆"""
        import sqlite3
        import threading
        import time

        path, factory = db_file
        self._seed(factory, n_repos=1, n_rules=1)
        holding = threading.Event()

        def another_round():
            conn = sqlite3.connect(path, timeout=5)
            try:
                conn.execute("BEGIN IMMEDIATE")
                conn.execute(
                    "INSERT INTO triggered_alerts (rule_id, repo_id, signal_value, triggered_at, acknowledged) "
                    "VALUES (1, 1, 100.0, ?, 0)",
                    (utc_now().isoformat(sep=" ", timespec="microseconds"),),
                )
                holding.set()
                time.sleep(0.3)
                conn.commit()
            finally:
                conn.close()

        holder = threading.Thread(target=another_round)
        holder.start()
        assert holding.wait(5)
        db = factory()
        try:
            result = check_all_alerts(db)
        finally:
            db.close()
            holder.join()

        assert result.triggered == []
        assert result.failed_rule_ids == []
        db = factory()
        assert db.query(TriggeredAlert).count() == 1
        db.close()
