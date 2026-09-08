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

    def test_zero_baseline_growth_is_undefined_not_plus_one(self, test_db, mock_repo):
        # 上週完全沒動、本週開始漲：週對週比例沒有定義。先前回 +1.0，前端顯示成 +100%，
        # 跟「每天 5 顆變 10 顆」的真實 +100% 撞在同一個值上，永遠分不出來
        self._seed(test_db, mock_repo.id, two_weeks_ago=1000, one_week_ago=1000, today_stars=1070)
        assert calculate_acceleration(mock_repo.id, test_db) is None

    def test_zero_baseline_decline_is_undefined_not_minus_one(self, test_db, mock_repo):
        self._seed(test_db, mock_repo.id, two_weeks_ago=1000, one_week_ago=1000, today_stars=930)
        assert calculate_acceleration(mock_repo.id, test_db) is None

    def test_both_weeks_flat_is_zero_change(self, test_db, mock_repo):
        # 兩週都沒動：「velocity 沒有變」是真的，0 是誠實的，不該跟「沒有定義」混在一起
        self._seed(test_db, mock_repo.id, two_weeks_ago=1000, one_week_ago=1000, today_stars=1000)
        assert calculate_acceleration(mock_repo.id, test_db) == 0.0

    def test_stale_sentinel_row_is_removed_when_acceleration_becomes_undefined(self, test_db, mock_repo):
        # 上一版把 +1.0 寫進 signals；改回 None 之後若只是「不寫」，舊列會永遠留著，
        # docker-elk 那種零活動的 repo 會一直顯示 -100%
        from constants import SignalType
        from db.models import Signal
        from utils.time import utc_now

        self._seed(test_db, mock_repo.id, two_weeks_ago=1000, one_week_ago=1000, today_stars=1070)
        test_db.add(Signal(repo_id=mock_repo.id, signal_type=SignalType.ACCELERATION,
                           value=1.0, calculated_at=utc_now()))
        test_db.commit()

        calculate_signals(mock_repo.id, test_db)
        test_db.commit()

        stale = test_db.query(Signal).filter_by(
            repo_id=mock_repo.id, signal_type=SignalType.ACCELERATION).all()
        assert stale == [], "過時的暗號列必須被刪掉，不是留著等下一次覆寫"

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


class TestRatesAreNormalisedByActualDaySpan:
    """速率（velocity／acceleration）必須除以兩個快照的實際間隔，不是「要求的天數」。

    抓取只在 App 或 collector 執行時進行，所以快照缺口是常態而非例外——
    analyzer 的兩條路徑都會回溯到更早的快照（DB 路徑用 get_snapshot_for_date 的
    allow_earlier，預載路徑用 _find_snapshot 的 backtrack），但接著一律除以
    **名目**天數。跨了 9 天的成長被當成 7 天，速率就少算 22%。

    這個 bug class 在 AnomalyDetector 已經修過一次（見該檔的
    TestDeltasAreNormalisedByActualDaySpan，起因是 2026-08-26 tensorflow 的誤報），
    但 analyzer 沒有跟上。

    2026-09-08 的真實後果：08-24／08-25 兩天沒有快照，而那天的 today-14 正好落在
    08-25，回溯到 08-23 之後上週 velocity 被灌水 9/7 倍，於是 97 個 repo 裡有 55 個
    被標成「動能下降」（三天前是 30 個）。畫面上完全看不出那是量測假象。

    計數類（calculate_delta）刻意不在此列：它回報的是「我實際有的兩個快照之間增加了
    多少」，把 9 天的真實成長縮放成 7 天等於發明資料。回溯上限本身就是那個近似的界線
    （見 weekly_summary._fetch_snapshot_deltas 的同款註解）。
    """

    @staticmethod
    def _seed(db, repo_id, points):
        """points: [(幾天前, 星數)]。只造指定的時間點，中間刻意留缺口。"""
        from datetime import timedelta
        from db.models import RepoSnapshot
        from utils.time import utc_now, utc_today

        today = utc_today()
        for days_ago, stars in points:
            db.add(RepoSnapshot(
                repo_id=repo_id, stars=stars, forks=0, watchers=0, open_issues=0,
                snapshot_date=today - timedelta(days=days_ago),
                fetched_at=utc_now() - timedelta(days=days_ago),
            ))
        db.commit()

    @staticmethod
    def _preloaded(db, repo_id):
        """production 走的是預載路徑（calculate_signals 一次撈 31 天）。"""
        from db.models import RepoSnapshot
        return {s.snapshot_date: s
                for s in db.query(RepoSnapshot).filter(RepoSnapshot.repo_id == repo_id).all()}

    def test_velocity_divides_by_the_real_gap_not_the_requested_days(self, test_db, mock_repo):
        # 只有 today 與 today-9：跨距 9 天、+90 顆 ⇒ 每天 10.0
        # 除以名目的 7 會得到 12.857，把成長灌水 29%
        self._seed(test_db, mock_repo.id, [(9, 1000), (0, 1090)])

        assert calculate_velocity(mock_repo.id, test_db, days=7) == pytest.approx(10.0)
        assert calculate_velocity(
            mock_repo.id, test_db, days=7,
            snap_by_date=self._preloaded(test_db, mock_repo.id),
        ) == pytest.approx(10.0), "預載路徑（production 走這條）也要一致"

    def test_delta_keeps_the_raw_count_over_the_real_gap(self, test_db, mock_repo):
        """對照組：計數不縮放。同一份資料，delta 仍是 90——
        它們一起改才是錯的，這條釘住「只有速率被正規化」。"""
        self._seed(test_db, mock_repo.id, [(9, 1000), (0, 1090)])

        assert calculate_delta(mock_repo.id, 7, test_db) == pytest.approx(90.0)

    def test_acceleration_uses_each_weeks_real_span(self, test_db, mock_repo):
        """重現 2026-09-08 的假象：today-14 缺，回溯到 today-16。

        兩週的**每日**速率其實一模一樣（都是 10.0/天），所以加速度應該是 0。
        兩邊都除以 7 的話：本週 70/7=10、上週 90/7=12.857
        ⇒ (10-12.857)/12.857 = -0.222，一個不存在的 22% 減速。
        """
        self._seed(test_db, mock_repo.id, [(16, 1000), (7, 1090), (0, 1160)])

        assert calculate_acceleration(mock_repo.id, test_db) == pytest.approx(0.0)
        assert calculate_acceleration(
            mock_repo.id, test_db,
            snap_by_date=self._preloaded(test_db, mock_repo.id),
        ) == pytest.approx(0.0), "預載路徑（production 走這條）也要一致"

    def test_the_artifact_does_not_flip_trend_to_declining(self, test_db, mock_repo):
        """同一份資料端到端：不該被標成「動能下降」。

        這是使用者實際看到的東西——Watchlist 與 Trends 的 ↓ 箭頭讀的是 trend。
        """
        self._seed(test_db, mock_repo.id, [(16, 1000), (7, 1090), (0, 1160)])
        velocity = calculate_velocity(mock_repo.id, test_db)
        acceleration = calculate_acceleration(mock_repo.id, test_db)

        assert calculate_trend(velocity, acceleration) == 1, (
            "每天穩定 +10 顆星的 repo 不能因為中間少了兩天快照就變成下降"
        )

    def test_only_todays_snapshot_is_insufficient_data_not_zero(self, test_db, mock_repo):
        """只有今天一筆：沒有可比的過去，回 None（資料不足）而不是 0（沒有變化）。"""
        self._seed(test_db, mock_repo.id, [(0, 1000)])

        assert calculate_velocity(mock_repo.id, test_db, days=7) is None
        assert calculate_acceleration(mock_repo.id, test_db) is None

    def test_one_day_span_is_a_real_rate_not_zero(self, test_db, mock_repo):
        """span == 1 是合法的每日速率，不是「沒有變化」。

        目前 production 只用 days=7 所以打不到，但 delta 那一側對 span==1 有明確語意
        （回傳真實差值），速率這一側要對齊——否則有人加一個 1 日 velocity 就會靜默回 0。
        """
        self._seed(test_db, mock_repo.id, [(1, 1000), (0, 1010)])

        assert calculate_velocity(mock_repo.id, test_db, days=1) == pytest.approx(10.0)

    def test_zero_span_does_not_divide_by_zero(self, test_db, mock_repo):
        """跨距為 0 的防禦性守衛。

        預載路徑（production 走這條）走不到：兩端的回溯範圍不重疊。但 DB 路徑的
        get_snapshot_for_date 是無上限回溯，夠舊的資料就構造得出來。一旦兩端撞在
        同一筆快照上，除以零會讓整輪收集掛掉——而 collector 的心跳只會寫一行 FAILED，
        使用者要等到發現資料不再更新才會知道。用人工構造的 dict 直接測那個守衛。
        """
        from datetime import timedelta
        from utils.time import utc_today

        self._seed(test_db, mock_repo.id, [(0, 1000)])
        today = utc_today()
        only = self._preloaded(test_db, mock_repo.id)[today]
        crafted = {today: only, today - timedelta(days=7): only, today - timedelta(days=14): only}

        assert calculate_velocity(mock_repo.id, test_db, days=7, snap_by_date=crafted) == 0.0
        assert calculate_acceleration(mock_repo.id, test_db, snap_by_date=crafted) is None

    def test_acceleration_guards_each_span_independently(self, test_db, mock_repo):
        """只有單邊跨距為 0 也要擋——先前只有「兩邊同時為 0」被釘住，
        把 `or` 寫成 `and` 的突變會靜默通過。"""
        from datetime import timedelta
        from utils.time import utc_today

        self._seed(test_db, mock_repo.id, [(14, 1000), (0, 1100)])
        today = utc_today()
        snaps = self._preloaded(test_db, mock_repo.id)
        cur, old_snap = snaps[today], snaps[today - timedelta(days=14)]

        # this_span == 0（今天與「一週前」是同一筆），last_span == 14
        assert calculate_acceleration(
            mock_repo.id, test_db,
            snap_by_date={today: cur, today - timedelta(days=7): cur,
                          today - timedelta(days=14): old_snap},
        ) is None

        # last_span == 0（「一週前」與「兩週前」是同一筆），this_span == 14
        assert calculate_acceleration(
            mock_repo.id, test_db,
            snap_by_date={today: cur, today - timedelta(days=7): old_snap,
                          today - timedelta(days=14): old_snap},
        ) is None

