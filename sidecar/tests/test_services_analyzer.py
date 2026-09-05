"""
Tests for services/analyzer.py - Signal calculation engine.
"""

import pytest
from datetime import date, timedelta

from db.models import RepoSnapshot
from utils.time import utc_today

from services.analyzer import (
    get_snapshot_for_date,
    calculate_delta,
    calculate_velocity,
    calculate_acceleration,
    calculate_trend,
    calculate_signals,
)


class TestCalculateTrend:
    """Tests for calculate_trend function."""

    def test_trend_upward_positive_velocity(self):
        """Test upward trend with positive velocity."""
        assert calculate_trend(5.0, 0.1) == 1

    def test_trend_upward_positive_velocity_no_acceleration(self):
        """Test upward trend with positive velocity and no acceleration data."""
        assert calculate_trend(1.0, None) == 1

    def test_trend_downward_negative_velocity(self):
        """Test downward trend with negative velocity."""
        assert calculate_trend(-1.0, 0.0) == -1

    def test_trend_downward_strong_negative_acceleration(self):
        """Test downward trend with strong negative acceleration."""
        assert calculate_trend(0.3, -0.5) == -1

    def test_trend_stable_low_velocity(self):
        """Test stable trend with low velocity."""
        assert calculate_trend(0.2, 0.0) == 0

    def test_trend_stable_zero_velocity(self):
        """Test stable trend with zero velocity."""
        assert calculate_trend(0.0, 0.0) == 0

    def test_trend_none_velocity(self):
        """Test stable when velocity is None."""
        assert calculate_trend(None, 0.5) == 0

    def test_trend_upward_strong_velocity_weak_negative_acceleration(self):
        """Test upward trend even with slightly negative acceleration."""
        assert calculate_trend(2.0, -0.05) == 1

    def test_high_velocity_with_collapsed_growth_is_downward(self):
        """docstring 的招牌案例：每日仍 +363 顆星，但成長率掉 75% ⇒ -1。既有的 -1 測試
        velocity 都很低，把「先看 velocity 再看 acceleration」寫反了也抓不到。"""
        assert calculate_trend(363.0, -0.75) == -1

    def test_acceleration_thresholds_are_exact(self):
        """-0.1（上升要求未明顯減速）與 -0.3（強烈衰退）兩個門檻各自的邊界。"""
        assert calculate_trend(2.0, -0.09) == 1
        assert calculate_trend(2.0, -0.1) == 0
        assert calculate_trend(2.0, -0.3) == 0
        assert calculate_trend(2.0, -0.31) == -1


class TestGetSnapshotForDate:
    """Tests for get_snapshot_for_date function."""

    def test_exact_match(self, test_db, mock_repo_with_snapshots):
        """Test getting snapshot with exact date match."""
        repo, snapshots = mock_repo_with_snapshots
        target_date = snapshots[0].snapshot_date

        result = get_snapshot_for_date(repo.id, target_date, test_db)
        assert result is not None
        assert result.snapshot_date == target_date

    def test_no_match_returns_none_when_not_allowing_earlier(self, test_db, mock_repo):
        """Test returns None when no exact match and not allowing earlier."""
        future_date = utc_today() + timedelta(days=100)
        result = get_snapshot_for_date(mock_repo.id, future_date, test_db, allow_earlier=False)
        assert result is None

    def test_returns_earlier_snapshot_when_allowed(self, test_db, mock_repo_with_snapshots):
        """Test returns earlier snapshot when exact match not found."""
        repo, snapshots = mock_repo_with_snapshots
        # Request a date between snapshots
        future_date = utc_today() + timedelta(days=1)
        result = get_snapshot_for_date(repo.id, future_date, test_db, allow_earlier=True)
        assert result is not None
        # 回傳的 snapshot 日期不應超過目標日期
        assert result.snapshot_date <= future_date
        # 應回傳最近的 snapshot（最大日期）
        latest_date = max(s.snapshot_date for s in snapshots)
        assert result.snapshot_date == latest_date


class TestCalculateDelta:
    """Tests for calculate_delta function."""

    def test_calculate_delta_with_snapshots(self, test_db, mock_repo_with_snapshots):
        """Test delta calculation with historical data."""
        repo, _ = mock_repo_with_snapshots
        delta = calculate_delta(repo.id, 7, test_db)
        # Snapshots: day -30 to today (day 0), 50 stars/day growth
        # Day 0: 2500 stars, Day -7: 2150 stars → delta = 350
        assert delta == 350

    def test_calculate_delta_no_data(self, test_db, mock_repo):
        """Test delta calculation with no snapshot data."""
        result = calculate_delta(mock_repo.id, 7, test_db)
        assert result is None


class TestCalculateVelocity:
    """Tests for calculate_velocity function."""

    def test_calculate_velocity_with_data(self, test_db, mock_repo_with_snapshots):
        """Test velocity calculation."""
        repo, _ = mock_repo_with_snapshots
        velocity = calculate_velocity(repo.id, test_db, days=7)
        # 350 stars over 7 days = 50 stars/day
        assert velocity == pytest.approx(350.0 / 7)

    def test_calculate_velocity_no_data(self, test_db, mock_repo):
        """Test velocity returns None with no data."""
        result = calculate_velocity(mock_repo.id, test_db)
        assert result is None


class TestCalculateAcceleration:
    """Tests for calculate_acceleration function."""

    def test_calculate_acceleration_with_data(self, test_db, mock_repo_with_snapshots):
        """Test acceleration calculation."""
        repo, _ = mock_repo_with_snapshots
        acceleration = calculate_acceleration(repo.id, test_db)
        # Linear growth with constant 50 stars/day
        # this_week (day 0 to day -7): 350 stars / 7 = 50 stars/day
        # last_week (day -7 to day -14): 350 stars / 7 = 50 stars/day
        # acceleration = (50 - 50) / 50 = 0
        assert acceleration == pytest.approx(0.0)

    def test_calculate_acceleration_no_data(self, test_db, mock_repo):
        """Test acceleration returns None with no data."""
        result = calculate_acceleration(mock_repo.id, test_db)
        assert result is None


class TestAccelerationDirectionAndMagnitude:
    """加速度的**方向**與**量級**，不是「有回傳數字」。

    唯一的既有測試用線性成長（每天固定 50 顆星）⇒ 本週 velocity == 上週 ⇒
    加速度為 0。而 0 對每一種寫錯都是不變量：兩週對調是 0、正負整個反轉是 0、
    分母拿掉 abs() 還是 0。實測那條測試對四種突變全部不動聲色。

    加速度會存成 SignalType.ACCELERATION，被警報規則、對比頁與匯出消費——
    正負號寫反的話，減速中的 repo 會看起來在加速，而數字本身完全合理。
    """

    @staticmethod
    def _seed(db, repo_id, *, two_weeks_ago: int, one_week_ago: int, today_stars: int):
        """只造加速度真正會讀的三個時間點，避免被中間值干擾。"""
        from datetime import timedelta
        from db.models import RepoSnapshot
        from utils.time import utc_now

        today = utc_now().date()
        for days, stars in ((14, two_weeks_ago), (7, one_week_ago), (0, today_stars)):
            db.add(RepoSnapshot(
                repo_id=repo_id, stars=stars, forks=0, watchers=0, open_issues=0,
                snapshot_date=today - timedelta(days=days),
                fetched_at=utc_now() - timedelta(days=days),
            ))
        db.commit()

    def test_speeding_up_is_positive(self, test_db, mock_repo):
        # 上週 +70（10/天），本週 +140（20/天）⇒ (20-10)/10 = +1.0
        self._seed(test_db, mock_repo.id, two_weeks_ago=1000, one_week_ago=1070, today_stars=1210)
        assert calculate_acceleration(mock_repo.id, test_db) == pytest.approx(1.0)

    def test_slowing_down_is_negative(self, test_db, mock_repo):
        # 上週 +140（20/天），本週 +70（10/天）⇒ (10-20)/20 = -0.5
        # 這條與上一條互為鏡像：兩週對調會讓兩條同時錯，方向就釘住了
        self._seed(test_db, mock_repo.id, two_weeks_ago=1000, one_week_ago=1140, today_stars=1210)
        assert calculate_acceleration(mock_repo.id, test_db) == pytest.approx(-0.5)

    def test_zero_baseline_growth_returns_plus_one(self, test_db, mock_repo):
        # 上週完全沒動，本週開始漲 ⇒ 除以零的特例，回 +1.0
        self._seed(test_db, mock_repo.id, two_weeks_ago=1000, one_week_ago=1000, today_stars=1070)
        assert calculate_acceleration(mock_repo.id, test_db) == pytest.approx(1.0)

    def test_zero_baseline_decline_returns_minus_one(self, test_db, mock_repo):
        self._seed(test_db, mock_repo.id, two_weeks_ago=1000, one_week_ago=1000, today_stars=930)
        assert calculate_acceleration(mock_repo.id, test_db) == pytest.approx(-1.0)

    def test_negative_baseline_keeps_the_numerator_sign(self, test_db, mock_repo):
        """上週是負成長時，分母必須取絕對值，否則正負號會被翻掉。

        上週 -70（-10/天），本週 +70（+10/天）⇒ (10-(-10))/|-10| = +2.0。
        少了 abs() 會得到 -2.0——「從掉星轉為漲星」被報成強烈減速。
        """
        self._seed(test_db, mock_repo.id, two_weeks_ago=1070, one_week_ago=1000, today_stars=1070)
        assert calculate_acceleration(mock_repo.id, test_db) == pytest.approx(2.0)


class TestCalculateSignals:
    """Tests for calculate_signals function."""

    def test_calculate_signals_stores_to_db(self, test_db, mock_repo_with_snapshots):
        """Test that signals are stored in database."""
        from db.models import Signal

        repo, _ = mock_repo_with_snapshots
        signals = calculate_signals(repo.id, test_db)

        # Check signals were returned
        assert isinstance(signals, dict)

        # Check signals were stored in DB (one per SignalType)
        db_signals = test_db.query(Signal).filter(Signal.repo_id == repo.id).all()
        assert len(db_signals) >= 1
        signal_types = {s.signal_type for s in db_signals}
        # Core signal types must always be present
        assert "velocity" in signal_types
        assert "stars_delta_7d" in signal_types

    def test_calculate_signals_upsert(self, test_db, mock_repo_with_snapshots):
        """Test that signals are upserted (not duplicated)."""
        from db.models import Signal

        repo, _ = mock_repo_with_snapshots

        # Calculate signals twice
        calculate_signals(repo.id, test_db)
        calculate_signals(repo.id, test_db)

        # Should have no duplicate signal types after two calculations
        db_signals = test_db.query(Signal).filter(Signal.repo_id == repo.id).all()
        signal_types = [s.signal_type for s in db_signals]
        assert len(signal_types) >= 1, "Expected at least one signal to be stored"
        assert len(signal_types) == len(set(signal_types))  # No duplicates


class TestBacktrackScalesWithWindow:
    """回溯上限寫死七天時，單日窗會拿七天前的快照冒充「一天」。

    段二的排行完全按相對成長排序，被放大七倍的成長會直接變成假的第一名，
    而畫面上看不出任何異常。
    """

    def _snap(self, day: date, stars: int) -> RepoSnapshot:
        return RepoSnapshot(repo_id=1, stars=stars, forks=0,
                            watchers=0, open_issues=0, snapshot_date=day)

    def test_one_day_window_requires_an_exact_match(self, test_db):
        today = utc_today()
        # 今天有、昨天沒有、七天前有
        snap_by_date = {
            today: self._snap(today, 1000),
            today - timedelta(days=7): self._snap(today - timedelta(days=7), 100),
        }

        result = calculate_delta(1, 1, test_db, snap_by_date=snap_by_date)

        assert result is None, "昨天沒有快照時應回 None，不得拿七天前的來比"

    def test_one_day_window_works_when_yesterday_exists(self, test_db):
        today = utc_today()
        snap_by_date = {
            today: self._snap(today, 1000),
            today - timedelta(days=1): self._snap(today - timedelta(days=1), 900),
        }

        assert calculate_delta(1, 1, test_db, snap_by_date=snap_by_date) == 100.0

    def test_seven_day_window_backtracks_at_most_three_days(self, test_db):
        today = utc_today()
        # 目標是 today-7，往前三天內（today-8..today-10）有；再更早的不算
        near = {today: self._snap(today, 1000),
                today - timedelta(days=10): self._snap(today - timedelta(days=10), 500)}
        far = {today: self._snap(today, 1000),
               today - timedelta(days=11): self._snap(today - timedelta(days=11), 500)}

        assert calculate_delta(1, 7, test_db, snap_by_date=near) == 500.0
        assert calculate_delta(1, 7, test_db, snap_by_date=far) is None

    def test_thirty_day_window_keeps_the_existing_seven_day_cap(self, test_db):
        """days // 2 會把三十日窗放寬到十五天回溯；min(..., 7) 必須擋住。"""
        today = utc_today()
        at_cap = {today: self._snap(today, 1000),
                  today - timedelta(days=37): self._snap(today - timedelta(days=37), 500)}
        beyond = {today: self._snap(today, 1000),
                  today - timedelta(days=38): self._snap(today - timedelta(days=38), 500)}

        assert calculate_delta(1, 30, test_db, snap_by_date=at_cap) == 500.0
        assert calculate_delta(1, 30, test_db, snap_by_date=beyond) is None

    def test_current_snapshot_requires_an_exact_match_regardless_of_window(self, test_db):
        """current 側的回溯上限寫死是 0（_find_snapshot(snap_by_date, today, 0)），
        不隨 days 變動——這條專門把它釘住。

        現有的 test_one_day_window_requires_an_exact_match 測不出這件事：那條測試
        today 本身就有快照，就算 current 側的 0 被誤改成別的數字，「今天」的精確
        比對還是會先命中，數字不會變。這裡刻意讓 today 完全沒有快照，只在
        today-3（days=7 的回溯上限 min(7//2,7)=3 之內）跟 today-7（baseline 的
        精確落點）放快照：如果 current 側的上限被放寬到 >= 3，就會錯把 today-3
        的快照當成「現在」，算出一個非 None 的值；只有維持精確比對才會整體回
        None。
        """
        today = utc_today()
        snap_by_date = {
            today - timedelta(days=3): self._snap(today - timedelta(days=3), 1000),
            today - timedelta(days=7): self._snap(today - timedelta(days=7), 500),
        }

        result = calculate_delta(1, 7, test_db, snap_by_date=snap_by_date)

        assert result is None, "today 沒有精確快照時必須整體回 None，不能拿 today-3 冒充「現在」"


class TestAccelerationBacktrackCaps:
    """驗證 calculate_acceleration 的回溯上限實際生效。

    加速度計算調用 _find_snapshot 三次：today (backtrack=0)、one_week_ago (backtrack=3)、two_weeks_ago (backtrack=7)。
    當快照有間隙時，這些上限需要被強制執行，不能因為快照密集就忽略。
    """

    def _snap(self, day: date, stars: int) -> RepoSnapshot:
        return RepoSnapshot(repo_id=1, stars=stars, forks=0,
                            watchers=0, open_issues=0, snapshot_date=day)

    def test_acceleration_week_ago_backtrack_cap_fires(self, test_db):
        """one_week_ago 回溯上限為 3 天；超過 3 天的快照不應被用。"""
        from services.analyzer import calculate_acceleration

        today = utc_today()
        # 今天有、一週前時間點沒有，但往前 3 天內（day -7 到 day -10 之間）有
        near = {today: self._snap(today, 1000),
                today - timedelta(days=9): self._snap(today - timedelta(days=9), 500),
                today - timedelta(days=14): self._snap(today - timedelta(days=14), 200)}
        far = {today: self._snap(today, 1000),
               today - timedelta(days=11): self._snap(today - timedelta(days=11), 500),
               today - timedelta(days=14): self._snap(today - timedelta(days=14), 200)}

        # near 有 day -9 快照，在回溯 3 天的範圍內（target: day -7，搜 day -7..-10）
        result_near = calculate_acceleration(1, test_db, snap_by_date=near)
        assert result_near is not None

        # far 最近的是 day -11，超過回溯 3 天限制（target: day -7，搜 day -7..-10，day -11 不在範圍）
        result_far = calculate_acceleration(1, test_db, snap_by_date=far)
        assert result_far is None

    def test_acceleration_two_weeks_ago_backtrack_cap_fires(self, test_db):
        """two_weeks_ago 回溯上限為 7 天；超過 7 天的快照不應被用。"""
        from services.analyzer import calculate_acceleration

        today = utc_today()
        # 今天、一週前、兩週前都有
        near = {today: self._snap(today, 1000),
                today - timedelta(days=7): self._snap(today - timedelta(days=7), 900),
                today - timedelta(days=20): self._snap(today - timedelta(days=20), 500)}
        far = {today: self._snap(today, 1000),
               today - timedelta(days=7): self._snap(today - timedelta(days=7), 900),
               today - timedelta(days=22): self._snap(today - timedelta(days=22), 500)}

        # near day -20，在回溯 7 天的範圍內（target: day -14，搜 -14..-21）
        result_near = calculate_acceleration(1, test_db, snap_by_date=near)
        assert result_near is not None

        # far day -22，超過回溯 7 天限制（target: day -14，搜 -14..-21，day -22 不在範圍）
        result_far = calculate_acceleration(1, test_db, snap_by_date=far)
        assert result_far is None

    def test_current_snapshot_requires_an_exact_match_regardless_of_the_other_caps(self, test_db):
        """current（今天）的回溯上限寫死是 0，跟 week_ago(3) / two_weeks_ago(7)
        不一樣——那兩個本來就非零，這條專門釘住「今天」不能被放寬。

        today 完全沒有快照，只在 today-2（一個小的、容易被誤放寬吃進去的距離）
        放一筆；week_ago 與 two_weeks_ago 兩側都給精確命中，排除其他兩個上限
        造成 None 的可能性，這樣結果如果不是 None，唯一原因只能是 current 側
        的 0 被放寬了。
        """
        from services.analyzer import calculate_acceleration

        today = utc_today()
        snap_by_date = {
            today - timedelta(days=2): self._snap(today - timedelta(days=2), 1000),
            today - timedelta(days=7): self._snap(today - timedelta(days=7), 900),
            today - timedelta(days=14): self._snap(today - timedelta(days=14), 500),
        }

        result = calculate_acceleration(1, test_db, snap_by_date=snap_by_date)

        assert result is None, "today 沒有精確快照時必須整體回 None，不能拿 today-2 冒充「現在」"


class TestOneDayStarDelta:
    def test_signals_include_a_one_day_star_delta(self, test_db, mock_repo):
        """段二在七日資料出現前只有單日窗可用。"""
        from datetime import timedelta

        from db.models import RepoSnapshot
        from services.analyzer import calculate_signals
        from utils.time import utc_today

        today = utc_today()
        test_db.add_all([
            RepoSnapshot(repo_id=mock_repo.id, stars=900, forks=0, watchers=0,
                         open_issues=0, snapshot_date=today - timedelta(days=1)),
            RepoSnapshot(repo_id=mock_repo.id, stars=1000, forks=0, watchers=0,
                         open_issues=0, snapshot_date=today),
        ])
        test_db.commit()

        signals = calculate_signals(mock_repo.id, test_db)

        assert signals["stars_delta_1d"] == 100.0

    def test_one_day_delta_is_absent_without_yesterday(self, test_db, mock_repo):
        """只存有值的訊號是既有行為，缺資料時該鍵不存在而不是 0。"""
        from db.models import RepoSnapshot
        from services.analyzer import calculate_signals
        from utils.time import utc_today

        test_db.add(RepoSnapshot(repo_id=mock_repo.id, stars=1000, forks=0, watchers=0,
                                 open_issues=0, snapshot_date=utc_today()))
        test_db.commit()

        assert "stars_delta_1d" not in calculate_signals(mock_repo.id, test_db)
