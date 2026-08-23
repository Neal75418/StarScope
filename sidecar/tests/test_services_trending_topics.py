"""
熱門主題的計算邏輯。

先前這個模組只有 33% 覆蓋率，而且涵蓋到的全是模組常數與快取存取——
compute_trending_topics 的邏輯一條測試都沒有。掃描時五個突變全部存活：
heat 分子分母顛倒、結果反向排序、交集改聯集、候選排序反轉、
global_count 為 0 也照算。

這裡的重點是 heat 的**方向**。heat = 取樣數 / 全站總量，量的是「這個主題
在最近新建的 repo 裡有多超額」——顛倒之後會選出「整體很大但最近沒人用」
的老牌主題，而清單上只是一排主題名稱，使用者看不出哪個版本是對的。
這個功能存在的意義正是使用者分不出來，所以「人會自己審核」不構成防護。

它產出的主題會經由 TrendingTopics 的 onAdd 進入興趣清單，而興趣清單是
For You feed 的評分輸入。
"""
from unittest.mock import AsyncMock, patch

import pytest

from services.trending_topics import compute_trending_topics


def _run(db, *, head, tail, global_counts):
    """用受控的取樣結果與全站總量跑一次計算。"""
    async def fake_sample(github, facet, created_after, on_progress, done_offset=0):
        return head if facet == ">=100" else tail

    async def fake_probe(github, query, per_page=1):
        topic = query.removeprefix("topic:")
        return {"total_count": global_counts.get(topic, 0)}

    with patch("services.trending_topics._sample_facet", new=fake_sample), \
         patch("services.trending_topics._paced_search", new=fake_probe), \
         patch("services.trending_topics._load_global_cache", return_value={}), \
         patch("services.trending_topics._save_global_cache"):
        import asyncio
        return asyncio.run(compute_trending_topics(db, AsyncMock()))


class TestHeatDirection:
    def test_a_small_topic_with_many_new_repos_outranks_a_huge_established_one(self, test_db):
        """兩個主題取樣數相同，全站總量小的才是「在竄升」。

        niche：全站 1,000 個 repo，最近 60 天的樣本裡出現 20 次
        giant：全站 500,000 個 repo，同樣出現 20 次
        後者只是本來就大。heat 顛倒的話 giant 會排到第一。
        """
        results = _run(
            test_db,
            head={"niche": 10, "giant": 10},
            tail={"niche": 10, "giant": 10},
            global_counts={"niche": 1_000, "giant": 500_000},
        )

        assert [r.topic for r in results] == ["niche", "giant"]
        assert results[0].heat > results[1].heat

    def test_heat_is_the_sample_share_of_the_global_total(self, test_db):
        """具體數值，不只是順序——顛倒之後順序可能碰巧相同，數值不會。"""
        results = _run(test_db, head={"x": 5}, tail={"x": 5},
                       global_counts={"x": 10_000})

        # (5+5) / 10000 * 100000 = 100.0
        assert results[0].heat == pytest.approx(100.0)


class TestCandidateSelection:
    def test_a_topic_in_only_one_facet_is_dropped(self, test_db):
        """交集而非聯集：只在單一切面出現的主題被排除。

        兩個切面（star >=100 與 30..99）都出現過，才算是跨規模的真實訊號，
        而不是某一段搜尋結果的抽樣雜訊。
        """
        results = _run(
            test_db,
            head={"both": 5, "head_only": 99},
            tail={"both": 5, "tail_only": 99},
            global_counts={"both": 1_000, "head_only": 1_000, "tail_only": 1_000},
        )

        assert [r.topic for r in results] == ["both"]

    def test_topics_with_no_global_count_are_dropped_not_divided_by_zero(self, test_db):
        """查不到全站總量的主題要跳過。照算的話會除以零。"""
        results = _run(test_db, head={"known": 5, "unknown": 5},
                       tail={"known": 5, "unknown": 5},
                       global_counts={"known": 1_000})  # unknown 回 0

        assert [r.topic for r in results] == ["known"]

    def test_truncation_keeps_the_most_sampled_candidates_not_the_least(self, test_db):
        """候選超過 MAX_CANDIDATES 時，留下的必須是取樣數最多的那批。

        本檔前面幾條測試的候選都只有兩三個，遠低於上限 30——截斷根本不會
        發生，所以「候選排序寫反」對它們是隱形的（實測那個突變在只有這幾條
        時仍然全綠）。要看得見截斷，樣本數就得超過上限。
        """
        n = 35
        head = {f"t{i:02d}": (n - i) for i in range(n)}
        tail = dict(head)
        globals_ = {t: 10_000 for t in head}

        results = _run(test_db, head=head, tail=tail, global_counts=globals_)
        topics = [r.topic for r in results]

        # 取樣最多的 t00 必須活下來；排序寫反的話它會第一個被截掉
        assert topics[0] == "t00"
        # 取樣最少的那幾個不該擠進來
        assert "t34" not in topics

    def test_no_overlap_between_facets_yields_nothing_rather_than_guessing(self, test_db):
        results = _run(test_db, head={"a": 5}, tail={"b": 5},
                       global_counts={"a": 100, "b": 100})
        assert results == []
