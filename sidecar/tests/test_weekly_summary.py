"""
Tests for weekly summary endpoint and service.
"""

from datetime import timedelta

from constants import SignalType
from db.models import RepoSnapshot, TriggeredAlert, AlertRule, EarlySignal, ContextSignal
from utils.time import utc_now, utc_today


class TestWeeklySummaryEndpoint:
    """Test cases for GET /api/summary/weekly."""

    def test_empty_watchlist(self, client):
        """Test weekly summary with no repos."""
        response = client.get("/api/summary/weekly")
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["total_repos"] == 0
        assert data["total_new_stars"] == 0
        assert data["top_gainers"] == []
        assert data["top_losers"] == []
        assert data["alerts_triggered"] == 0
        assert data["early_signals_detected"] == 0
        assert data["hn_mentions"] == []

    def test_with_repo_and_snapshots(self, client, mock_repo, test_db):
        """Test weekly summary correctly calculates star deltas."""
        today = utc_today()
        now = utc_now()

        # Old snapshot (8 days ago) — just outside the window
        old_snap = RepoSnapshot(
            repo_id=mock_repo.id,
            snapshot_date=today - timedelta(days=8),
            fetched_at=now - timedelta(days=8),
            stars=1000, forks=50, watchers=10, open_issues=5,
        )
        # Latest snapshot (today)
        new_snap = RepoSnapshot(
            repo_id=mock_repo.id,
            snapshot_date=today,
            fetched_at=now,
            stars=1200, forks=55, watchers=12, open_issues=4,
        )
        test_db.add_all([old_snap, new_snap])
        test_db.commit()

        response = client.get("/api/summary/weekly")
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["total_repos"] == 1
        assert data["total_new_stars"] == 200  # 1200 - 1000
        assert len(data["top_gainers"]) == 1
        assert data["top_gainers"][0]["stars_delta_7d"] == 200

    def test_total_is_the_sum_across_repos_not_an_average(self, client, mock_repo, test_db):
        """兩個 repo 才分得出加總與平均。

        既有的 test_with_repo_and_snapshots 只有一個 repo，sum 與 sum//count
        給出同一個答案——實測把 total_new_stars 改成除以 repo 數，760 個測試
        全綠。加總 300 與平均 150 都是合理的數字，畫面上看不出哪個是對的。
        """
        from db.models import Repo

        today = utc_today()
        now = utc_now()
        second = Repo(owner="other", name="repo", full_name="other/repo",
                      url="https://github.com/other/repo", github_id=54321)
        test_db.add(second)
        test_db.commit()

        for repo_id, old_stars, new_stars in (
            (mock_repo.id, 1000, 1100),   # +100
            (second.id, 500, 700),        # +200
        ):
            test_db.add_all([
                RepoSnapshot(repo_id=repo_id, snapshot_date=today - timedelta(days=7),
                             fetched_at=now - timedelta(days=7), stars=old_stars,
                             forks=0, watchers=0, open_issues=0),
                RepoSnapshot(repo_id=repo_id, snapshot_date=today, fetched_at=now,
                             stars=new_stars, forks=0, watchers=0, open_issues=0),
            ])
        test_db.commit()

        data = client.get("/api/summary/weekly").json()["data"]
        assert data["total_new_stars"] == 300, "應為 100+200 的加總，不是平均 150"

    def test_top_losers(self, client, mock_repo, test_db):
        """Test that repos with negative delta appear in top_losers."""
        today = utc_today()
        now = utc_now()

        old_snap = RepoSnapshot(
            repo_id=mock_repo.id,
            snapshot_date=today - timedelta(days=8),
            fetched_at=now - timedelta(days=8),
            stars=1000, forks=50, watchers=10, open_issues=5,
        )
        new_snap = RepoSnapshot(
            repo_id=mock_repo.id,
            snapshot_date=today,
            fetched_at=now,
            stars=900, forks=50, watchers=10, open_issues=5,
        )
        test_db.add_all([old_snap, new_snap])
        test_db.commit()

        response = client.get("/api/summary/weekly")
        data = response.json()["data"]
        assert data["total_new_stars"] == -100
        assert len(data["top_losers"]) == 1
        assert data["top_losers"][0]["stars_delta_7d"] == -100
        assert data["top_gainers"] == []

    def test_alerts_triggered_count(self, client, mock_repo, test_db):
        """Test counting alerts triggered this week."""
        now = utc_now()

        rule = AlertRule(
            name="Test Rule",
            signal_type=SignalType.VELOCITY,
            operator=">",
            threshold=10.0,
        )
        test_db.add(rule)
        test_db.flush()

        # Recent alert (within 7 days)
        recent_alert = TriggeredAlert(
            rule_id=rule.id,
            repo_id=mock_repo.id,
            signal_value=50.0,
            triggered_at=now - timedelta(days=1),
        )
        # Old alert (outside 7 days)
        old_alert = TriggeredAlert(
            rule_id=rule.id,
            repo_id=mock_repo.id,
            signal_value=30.0,
            triggered_at=now - timedelta(days=10),
        )
        test_db.add_all([recent_alert, old_alert])
        test_db.commit()

        response = client.get("/api/summary/weekly")
        data = response.json()["data"]
        assert data["alerts_triggered"] == 1

    def test_early_signals_by_type(self, client, mock_repo, test_db):
        """Test early signals grouped by type."""
        now = utc_now()

        signals = [
            EarlySignal(
                repo_id=mock_repo.id, signal_type="rising_star", severity="high",
                description="Rising", detected_at=now - timedelta(days=1),
            ),
            EarlySignal(
                repo_id=mock_repo.id, signal_type="rising_star", severity="medium",
                description="Rising 2", detected_at=now - timedelta(days=2),
            ),
            EarlySignal(
                repo_id=mock_repo.id, signal_type="sudden_spike", severity="high",
                description="Spike", detected_at=now - timedelta(days=1),
            ),
            # Old signal — should NOT be counted
            EarlySignal(
                repo_id=mock_repo.id, signal_type="breakout", severity="low",
                description="Old", detected_at=now - timedelta(days=10),
            ),
        ]
        test_db.add_all(signals)
        test_db.commit()

        response = client.get("/api/summary/weekly")
        data = response.json()["data"]
        assert data["early_signals_detected"] == 3
        assert data["early_signals_by_type"]["rising_star"] == 2
        assert data["early_signals_by_type"]["sudden_spike"] == 1
        assert "breakout" not in data["early_signals_by_type"]

    def test_hn_mentions(self, client, mock_repo, test_db):
        """Test HN mentions in weekly summary.

        這條原本只設 fetched_at 就期待故事出現，等於把 bug 寫成規格：
        「本週」看的必須是故事何時發表，不是我們何時抓到它。
        """
        now = utc_now()

        hn = ContextSignal(
            repo_id=mock_repo.id,
            signal_type="hacker_news",
            external_id="hn_12345",
            title="Show HN: TestRepo",
            url="https://news.ycombinator.com/item?id=12345",
            score=150,
            comment_count=42,
            published_at=now - timedelta(days=1),
            fetched_at=now - timedelta(days=1),
        )
        test_db.add(hn)
        test_db.commit()

        response = client.get("/api/summary/weekly")
        data = response.json()["data"]
        assert len(data["hn_mentions"]) == 1
        assert data["hn_mentions"][0]["hn_title"] == "Show HN: TestRepo"
        assert data["hn_mentions"][0]["hn_score"] == 150

    def test_hn_mentions_excludes_old_stories_refetched_today(
        self, client, mock_repo, test_db
    ):
        """七年前的故事不該出現在「近 7 天」裡。

        抓取每半小時會把既有訊號的 fetched_at 更新成現在，所以拿 fetched_at
        當時間條件等於沒有條件。實測使用者的資料庫：1130 筆全部通過，
        而真正屬於這 7 天的只有 9 筆——面板因此是一份永遠不變的歷史最高分排行。
        """
        now = utc_now()

        test_db.add_all([
            ContextSignal(
                repo_id=mock_repo.id, signal_type="hacker_news", external_id="old",
                title="A uBlock Origin update was rejected from the Chrome Web Store",
                url="https://example.com/old", score=1757,
                published_at=now - timedelta(days=2500),  # 七年前
                fetched_at=now,                            # 剛剛才重新抓過
            ),
            ContextSignal(
                repo_id=mock_repo.id, signal_type="hacker_news", external_id="new",
                title="Something that actually happened this week",
                url="https://example.com/new", score=10,
                published_at=now - timedelta(days=2),
                fetched_at=now,
            ),
        ])
        test_db.commit()

        response = client.get("/api/summary/weekly")
        data = response.json()["data"]

        titles = [m["hn_title"] for m in data["hn_mentions"]]
        assert titles == ["Something that actually happened this week"], (
            "分數高的舊故事會排在前面，把真正本週的東西擠掉"
        )

    def test_accelerating_decelerating(self, client, mock_repo, test_db):
        """Test accelerating/decelerating repo counts."""
        from db.models import Signal

        signals = [
            Signal(repo_id=mock_repo.id, signal_type="acceleration", value=5.0),
        ]
        test_db.add_all(signals)
        test_db.commit()

        response = client.get("/api/summary/weekly")
        data = response.json()["data"]
        assert data["accelerating"] == 1
        assert data["decelerating"] == 0

    def test_period_dates(self, client):
        """Test that period_start and period_end are valid ISO dates."""
        response = client.get("/api/summary/weekly")
        data = response.json()["data"]
        assert "period_start" in data
        assert "period_end" in data
        # Should be parseable ISO date strings
        from datetime import date
        date.fromisoformat(data["period_start"])
        date.fromisoformat(data["period_end"])

    def test_period_label_spans_exactly_seven_calendar_days(self, client):
        """「近 7 天」的標籤兩端含入共 7 個日曆天。先前 period_start 用星數
        基準日（today−7），前端 (start – end) 顯示出來讀起來是 8 天。"""
        from datetime import date
        response = client.get("/api/summary/weekly")
        data = response.json()["data"]
        start = date.fromisoformat(data["period_start"])
        end = date.fromisoformat(data["period_end"])
        assert (end - start).days == 6  # 含兩端 = 7 天


class TestReposComparedDistinguishesNoDataFromNoChange:
    """total_new_stars 是 0 有兩種完全不同的原因，回應必須分得出來。

    實測時使用者的快照只有兩天，7 天前那一端撈不到任何東西，repo_deltas 是空的，
    sum({}) 就是 0——畫面因此顯示「0 近 7 天新增星數」「近 7 天無變動」，
    而同一個畫面的健康分數已經改口說「快照累積中」。
    """

    def test_no_baseline_reports_nothing_compared(self, test_db):
        from db.models import Repo
        from services.weekly_summary import get_weekly_summary
        repo = Repo(owner="a", name="b", full_name="a/b",
                    url="https://github.com/a/b", github_id=1)
        test_db.add(repo)
        test_db.flush()
        # 只有最近兩天，沒有 7 天前那一端
        today = utc_today()
        test_db.add_all([
            RepoSnapshot(repo_id=repo.id, stars=100, forks=1, snapshot_date=today - timedelta(days=1)),
            RepoSnapshot(repo_id=repo.id, stars=150, forks=1, snapshot_date=today),
        ])
        test_db.commit()

        result = get_weekly_summary(test_db)

        assert result["repos_compared"] == 0
        assert result["total_new_stars"] == 0, "沒有基準線時總和仍是 0，這正是要靠另一個欄位分辨的原因"

    def test_a_real_baseline_is_counted(self, test_db):
        from db.models import Repo
        from services.weekly_summary import get_weekly_summary
        repo = Repo(owner="a", name="c", full_name="a/c",
                    url="https://github.com/a/c", github_id=2)
        test_db.add(repo)
        test_db.flush()
        today = utc_today()
        test_db.add_all([
            RepoSnapshot(repo_id=repo.id, stars=100, forks=1, snapshot_date=today - timedelta(days=8)),
            RepoSnapshot(repo_id=repo.id, stars=180, forks=1, snapshot_date=today),
        ])
        test_db.commit()

        result = get_weekly_summary(test_db)

        assert result["repos_compared"] == 1
        assert result["total_new_stars"] == 80


class TestWeeklyReleases:
    """本週新版本。排序決定了它有沒有用：有標記的必須浮到最上面。"""

    def _add(self, test_db, repo_id, ext, title, days_ago, tags=None):
        from db.models import ContextSignal
        test_db.add(ContextSignal(
            repo_id=repo_id, signal_type="release", external_id=ext,
            title=title, url=f"https://example.com/{ext}",
            published_at=utc_now() - timedelta(days=days_ago), tags=tags,
        ))

    def test_tagged_releases_come_first_even_when_older(self, client, mock_repo, test_db):
        """一週 14 個新版本裡通常只有 1-2 個標記得到，那就是該先看的。

        單純照時間排的話，那一兩個會被埋在中間——等於沒有標記。
        """
        self._add(test_db, mock_repo.id, "a", "v3.0.0", days_ago=1)
        self._add(test_db, mock_repo.id, "b", "v2.9.0", days_ago=4, tags="breaking")
        self._add(test_db, mock_repo.id, "c", "v2.8.0", days_ago=2)
        test_db.commit()

        data = client.get("/api/summary/weekly").json()["data"]

        assert [r["title"] for r in data["releases"]] == ["v2.9.0", "v3.0.0", "v2.8.0"]
        assert data["releases"][0]["tags"] == ["breaking"]

    def test_untagged_releases_stay_newest_first(self, client, mock_repo, test_db):
        self._add(test_db, mock_repo.id, "a", "old", days_ago=5)
        self._add(test_db, mock_repo.id, "b", "new", days_ago=1)
        test_db.commit()

        data = client.get("/api/summary/weekly").json()["data"]

        assert [r["title"] for r in data["releases"]] == ["new", "old"]

    def test_last_months_release_is_not_this_week(self, client, mock_repo, test_db):
        self._add(test_db, mock_repo.id, "old", "v1.0.0", days_ago=30, tags="breaking")
        test_db.commit()

        data = client.get("/api/summary/weekly").json()["data"]

        assert data["releases"] == []

    def test_hn_mentions_and_releases_do_not_leak_into_each_other(
        self, client, mock_repo, test_db
    ):
        """兩者共用 context_signals，靠 signal_type 分開。"""
        from db.models import ContextSignal
        self._add(test_db, mock_repo.id, "rel", "v1.2.3", days_ago=1)
        test_db.add(ContextSignal(
            repo_id=mock_repo.id, signal_type="hacker_news", external_id="hn1",
            title="Show HN: something", url="https://example.com/hn", score=99,
            published_at=utc_now() - timedelta(days=1),
        ))
        test_db.commit()

        data = client.get("/api/summary/weekly").json()["data"]

        assert [r["title"] for r in data["releases"]] == ["v1.2.3"]
        assert [m["hn_title"] for m in data["hn_mentions"]] == ["Show HN: something"]


class TestWeeklyDeltaRespectsTheBacktrackLimit:
    """摘要原本沒有回溯上限，可以拿三個月前的快照當「七天前」。

    KPI 卡與摘要徽章顯示的是同一個概念，規則不同就會各說各話。

    回溯規則 = min(days // 2, 7)。對於 days=7 是 3 天，days=14 是 7 天。
    """

    def test_days_7_boundary_at_limit_inclusive(self, client, mock_repo, test_db):
        """days=7 回溯 3 天：today-10 (邊界) 算數，today-11 不算。"""
        today = utc_today()
        test_db.add_all([
            RepoSnapshot(repo_id=mock_repo.id, snapshot_date=today - timedelta(days=10),
                         fetched_at=utc_now(), stars=100, forks=0, watchers=0, open_issues=0),
            RepoSnapshot(repo_id=mock_repo.id, snapshot_date=today,
                         fetched_at=utc_now(), stars=1000, forks=0, watchers=0, open_issues=0),
        ])
        test_db.commit()

        data = client.get("/api/summary/weekly").json()["data"]
        assert data["repos_compared"] == 1, "today-10 應在 min(7//2, 7)=3 的回溯窗內"
        assert data["total_new_stars"] == 900

    def test_days_7_boundary_beyond_limit_exclusive(self, client, mock_repo, test_db):
        """days=7 回溯 3 天：today-11 超過邊界，不計入。"""
        today = utc_today()
        test_db.add_all([
            RepoSnapshot(repo_id=mock_repo.id, snapshot_date=today - timedelta(days=11),
                         fetched_at=utc_now(), stars=100, forks=0, watchers=0, open_issues=0),
            RepoSnapshot(repo_id=mock_repo.id, snapshot_date=today,
                         fetched_at=utc_now(), stars=1000, forks=0, watchers=0, open_issues=0),
        ])
        test_db.commit()

        data = client.get("/api/summary/weekly").json()["data"]
        assert data["repos_compared"] == 0, "today-11 超過 min(7//2, 7)=3 的回溯窗"
        assert data["total_new_stars"] == 0

    def test_days_14_boundary_at_limit_inclusive(self, client, mock_repo, test_db):
        """days=14 回溯 7 天：today-21 (邊界) 算數，today-22 不算。"""
        today = utc_today()
        test_db.add_all([
            RepoSnapshot(repo_id=mock_repo.id, snapshot_date=today - timedelta(days=21),
                         fetched_at=utc_now(), stars=100, forks=0, watchers=0, open_issues=0),
            RepoSnapshot(repo_id=mock_repo.id, snapshot_date=today,
                         fetched_at=utc_now(), stars=1000, forks=0, watchers=0, open_issues=0),
        ])
        test_db.commit()

        data = client.get("/api/summary/weekly?days=14").json()["data"]
        assert data["repos_compared"] == 1, "today-21 應在 min(14//2, 7)=7 的回溯窗內"
        assert data["total_new_stars"] == 900

    def test_days_14_boundary_beyond_limit_exclusive(self, client, mock_repo, test_db):
        """days=14 回溯 7 天：today-22 超過邊界，不計入。"""
        today = utc_today()
        test_db.add_all([
            RepoSnapshot(repo_id=mock_repo.id, snapshot_date=today - timedelta(days=22),
                         fetched_at=utc_now(), stars=100, forks=0, watchers=0, open_issues=0),
            RepoSnapshot(repo_id=mock_repo.id, snapshot_date=today,
                         fetched_at=utc_now(), stars=1000, forks=0, watchers=0, open_issues=0),
        ])
        test_db.commit()

        data = client.get("/api/summary/weekly?days=14").json()["data"]
        assert data["repos_compared"] == 0, "today-22 超過 min(14//2, 7)=7 的回溯窗"
        assert data["total_new_stars"] == 0


class TestLatestSideBoundToToday:
    """latest 端原本沒有下限，`func.max(snapshot_date)` 不管多舊都當「最新」。

    baseline 端已經有回溯上限（見 TestWeeklyDeltaRespectsTheBacktrackLimit），但那
    只保護了「基準抓太舊」；latest 端沒有下限的話，抓取斷了好幾天的 repo 照樣會
    被算進本週數字，跟 analyzer 那側「今天沒有精確快照就整個回 None」互相矛盾——
    同一頁上「近 7 天新增 900」與「還沒有可比較的成長」同時出現。
    """

    def test_stale_latest_snapshot_drops_the_repo_from_weekly_numbers(
        self, client, mock_repo, test_db
    ):
        """newest 快照停在 today-4（抓取已經斷 4 天），baseline 落在 today-9。

        修好之前：latest 端撿到 today-4 當「最新」，跟 today-9 配對出 900——
        實際只跨了 5 天，不是宣稱的 7 天。這個 repo 在 analyzer 那側因為今天
        沒有精確快照，stars_delta_7d/velocity 全部是 None；weekly_summary
        必須跟它站在同一邊，今天沒快照就整個不算。
        """
        today = utc_today()
        test_db.add_all([
            RepoSnapshot(repo_id=mock_repo.id, snapshot_date=today - timedelta(days=9),
                         fetched_at=utc_now(), stars=100, forks=0, watchers=0, open_issues=0),
            RepoSnapshot(repo_id=mock_repo.id, snapshot_date=today - timedelta(days=4),
                         fetched_at=utc_now(), stars=1000, forks=0, watchers=0, open_issues=0),
        ])
        test_db.commit()

        data = client.get("/api/summary/weekly").json()["data"]

        assert data["repos_compared"] == 0, "沒有今天的快照，這個 repo 不該被算進本週數字"
        assert data["total_new_stars"] == 0

    def test_latest_must_be_exact_not_merely_recent(self, client, mock_repo, test_db):
        """今天前一兩天也不夠——標準是精確等於 period_end，不是「離今天夠近」。

        如果誤把 baseline 端的回溯規則（min(days//2,7)=3 天）也套在 latest 端，
        today-2 會被誤判成「夠近，當最新」；但 analyzer 那側今天沒快照一律回
        None，沒有「夠近」這回事，latest 端不能另開一組容許範圍。
        """
        today = utc_today()
        test_db.add_all([
            RepoSnapshot(repo_id=mock_repo.id, snapshot_date=today - timedelta(days=7),
                         fetched_at=utc_now(), stars=100, forks=0, watchers=0, open_issues=0),
            RepoSnapshot(repo_id=mock_repo.id, snapshot_date=today - timedelta(days=2),
                         fetched_at=utc_now(), stars=1000, forks=0, watchers=0, open_issues=0),
        ])
        test_db.commit()

        data = client.get("/api/summary/weekly").json()["data"]

        assert data["repos_compared"] == 0, "today-2 不是精確的今天，不該被當成最新快照"
        assert data["total_new_stars"] == 0


class TestReleasesEverFetchedFlag:
    """releases=[] 沒辦法分辨「抓過、這週沒有版本」跟「抓取器根本沒跑過」，
    AttentionBar 需要這個旗標才能決定要顯示「本週無需注意」還是「正在檢查」。
    """

    def test_false_when_the_fetcher_has_never_run(self, client):
        data = client.get("/api/summary/weekly").json()["data"]
        assert data["releases_ever_fetched"] is False

    def test_true_after_the_fetcher_has_recorded_a_run(self, client, test_db):
        from db.models import AppSettingKey
        from services.settings import set_setting

        set_setting(AppSettingKey.LAST_RELEASE_FETCH_AT, utc_now().isoformat(), test_db)
        test_db.commit()

        data = client.get("/api/summary/weekly").json()["data"]
        assert data["releases_ever_fetched"] is True


class TestTheWireCarriesEveryField:
    """response_model 會濾掉沒宣告的欄位，而且不會有任何錯誤訊息。

    repos_compared 就是這樣掉的：service 算出來了、前端也讀了，中間被 Pydantic
    無聲擋下。而「欄位不存在」與「欄位為 0」在前端走同一個分支，所以畫面看起來
    完全正確——真正的症狀要等使用者累積滿 7 天快照才會出現，那時它會固執地
    繼續說「還沒得比」。
    """

    def test_every_key_the_service_produces_survives_the_endpoint(self, client, test_db):
        from services.weekly_summary import get_weekly_summary

        produced = set(get_weekly_summary(test_db).keys())
        delivered = set(client.get("/api/summary/weekly").json()["data"].keys())

        assert produced - delivered == set(), (
            f"service 算了但送不出去的欄位: {produced - delivered}"
        )


class TestEventWindowBoundary:
    """事件窗口從 period_start 當天 00:00（含）起算，不是 now − N×24h。

    兩種算法對 now−1d、now−10d 這種樣本給一樣的答案，先前的測試全落在那裡；
    只有「起點前一天的最後一秒」與「起點當天的 00:00」分得出來。
    """

    def test_midnight_of_period_start_counts_and_the_second_before_does_not(
        self, client, mock_repo, test_db
    ):
        from datetime import date, datetime, time, timedelta
        from unittest.mock import patch

        # 釘住服務端的「今天」：測試與服務各叫一次 utc_today()，跨 00:00 UTC 會不一致
        today = date(2026, 9, 5)
        period_start = today - timedelta(days=6)  # days=7：含今天共 7 個日曆天
        inside = datetime.combine(period_start, time.min)
        outside = inside - timedelta(seconds=1)
        test_db.add_all([
            EarlySignal(repo_id=mock_repo.id, signal_type="rising_star", severity="low",
                        description="in", detected_at=inside),
            EarlySignal(repo_id=mock_repo.id, signal_type="sudden_spike", severity="low",
                        description="out", detected_at=outside),
        ])
        test_db.commit()

        with patch("services.weekly_summary.utc_today", return_value=today):
            data = client.get("/api/summary/weekly").json()["data"]

        assert data["early_signals_detected"] == 1
        assert data["early_signals_by_type"] == {"rising_star": 1}

