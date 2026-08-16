"""HN 故事與 repo 的關聯判定。

每一條都對應實際存進資料庫、並且真的出現在儀表板上的資料，不是推測出來的情境。
原本的規則是「標題或 URL 含 repo 名的子字串」，1369 筆訊號裡有 48 則故事同時掛在
多個 repo 上，儀表板前六名有四則跟該 repo 無關。
"""
import pytest

from services.hacker_news import is_relevant_story

GH = "https://github.com"


class TestSubstringMatchingWasTheBug:
    """子字串比對讓一個名字命中包含它的每一個更長的字。"""

    def test_java_does_not_match_javascript(self):
        # 決定性證據：這則真的被存成 TheAlgorithms/Java 的訊號
        assert not is_relevant_story(
            "Yarn – A new package manager for JavaScript", "", "TheAlgorithms", "Java"
        )

    @pytest.mark.parametrize("title", [
        "Court issues permanent injunction in Epic vs. Apple case",
        "Bob Cassette Rewinder: Hacking Detergent DRM",
        "Facebook Buying WhatsApp for $16B in Cash and Stock Plus $3B in RSUs",
        "In our cashless society, we need to take digital jail seriously",
    ])
    def test_a_three_letter_name_does_not_match_longer_words(self, title):
        # apereo/cas 的 40 筆訊號全部長這樣，沒有一筆是對的
        assert not is_relevant_story(title, "", "apereo", "cas")


class TestOrdinaryWordsNeedCorroboration:
    """repo 名字是普通字時，光是出現那個字不足以認定故事在講它。"""

    @pytest.mark.parametrize("owner,name,title", [
        ("TheAlgorithms", "Java", "Google's copying of the Java SE API was fair use [pdf]"),
        ("TheAlgorithms", "Python", "Uv is the best thing to happen to the Python ecosystem"),
        ("geekcomputers", "Python", "Uv is the best thing to happen to the Python ecosystem"),
        ("modelcontextprotocol", "registry",
         "Claude Code's source code has been leaked via a map file in their NPM registry"),
        ("mattpocock", "skills",
         "Tech sector job interviews assess anxiety, not software skills: study"),
    ])
    def test_the_six_wrong_entries_that_were_on_the_dashboard(self, owner, name, title):
        assert not is_relevant_story(title, "", owner, name)

    def test_the_owner_appearing_is_enough_corroboration(self):
        # apache/kafka ← 「Apache Kafka」。kafka 是普通字，但 owner 就在標題裡
        assert is_relevant_story(
            "I wrote a children's book / illustrated guide to Apache Kafka",
            "", "apache", "kafka",
        )

    def test_a_project_named_after_itself_needs_no_corroboration(self):
        """owner 含 repo 名時，要求 owner 出現不會多提供任何證據。

        例子必須同時滿足三件事才測得到這個分支：名字是通用字（ruby 在名單上）、
        owner 含有它、而 owner 本身沒出現在標題裡。用 godot 或 axios 都測不到——
        那兩個名字本來就不是通用字，走不到需要佐證的那一步。
        """
        assert is_relevant_story("Ruby 3.4 released", "", "ruby-lang", "ruby")


class TestDistinctiveNamesStandAlone:
    """名字夠特殊時單獨出現就算數——過度嚴格會讓真正的提及消失。"""

    def test_a_dictionary_word_that_is_still_a_project_name(self):
        # 我第一版把 stagehand 列進通用字，這則真正的發表就被刪掉了
        assert is_relevant_story(
            "Show HN: Stagehand – the open source SDK for browser agents",
            "", "browserbase", "stagehand",
        )

    def test_ublock_without_its_owner(self):
        assert is_relevant_story(
            "uBlock Origin is no longer available on the Chrome Store", "", "gorhill", "uBlock"
        )

    def test_a_js_suffix_still_counts_as_the_project(self):
        # 詞邊界太嚴會漏掉黏在一起的寫法
        assert is_relevant_story(
            "The Unreasonable Effectiveness of Sequence Diagrams in MermaidJS",
            "", "mermaid-js", "mermaid",
        )

    def test_the_plural_of_a_name_is_not_the_name(self):
        assert not is_relevant_story(
            "MSN replaced journalists with AI publishing fake news about mermaids",
            "", "mermaid-js", "mermaid",
        )


class TestStrongestSignals:
    def test_a_link_to_the_repo_beats_the_generic_name_rule(self):
        """連結指向該 repo 時，即使名字是通用字、標題什麼都沒提，也算數。

        用 Python 這種通用字才測得到：換成 uBlock 的話，光靠裸名就會通過，
        這條測試不管完整名稱那層在不在都會綠。
        """
        assert is_relevant_story(
            "A neat collection I keep coming back to",
            f"{GH}/TheAlgorithms/Python",
            "TheAlgorithms",
            "Python",
        )

    def test_the_full_name_in_the_title_always_counts(self):
        assert is_relevant_story(
            "TheAlgorithms/Python hits 200k stars", "", "TheAlgorithms", "Python"
        )

    def test_a_link_to_a_different_repo_does_not_count(self):
        assert not is_relevant_story(
            "Some other project", f"{GH}/someone/else", "gorhill", "uBlock"
        )

    def test_matching_is_case_insensitive(self):
        assert is_relevant_story("UBLOCK ORIGIN update", "", "gorhill", "uBlock")


class TestExistingSignalsGetCleanedUp:
    """收緊規則之後，已經存進來的錯誤訊號也要消失。

    只改過濾器不夠：那些訊號往往分數很高（借用普通字命中的都是熱門故事），
    會一直霸佔畫面前幾名直到過期。
    """

    def test_cleanup_removes_signals_that_no_longer_match(self, test_db):
        from datetime import datetime

        from db.models import ContextSignal, Repo
        from services.context_fetcher import cleanup_old_context_signals

        repo = Repo(owner="TheAlgorithms", name="Java", full_name="TheAlgorithms/Java",
                    url="https://github.com/TheAlgorithms/Java", github_id=1)
        test_db.add(repo)
        test_db.flush()

        test_db.add_all([
            ContextSignal(
                repo_id=repo.id, signal_type="hacker_news", external_id="bad",
                title="Google's copying of the Java SE API was fair use",
                url="https://example.com/a", score=4103,
                published_at=datetime(2026, 8, 1),
            ),
            ContextSignal(
                repo_id=repo.id, signal_type="hacker_news", external_id="good",
                title="TheAlgorithms/Java crosses 60k stars",
                url="https://example.com/b", score=10,
                published_at=datetime(2026, 8, 1),
            ),
        ])
        test_db.commit()

        stats = cleanup_old_context_signals(test_db)

        assert stats["deleted_as_irrelevant"] == 1
        remaining = test_db.query(ContextSignal).all()
        assert [s.external_id for s in remaining] == ["good"]

    def test_cleanup_leaves_a_healthy_table_alone(self, test_db):
        from datetime import datetime

        from db.models import ContextSignal, Repo
        from services.context_fetcher import cleanup_old_context_signals

        repo = Repo(owner="gorhill", name="uBlock", full_name="gorhill/uBlock",
                    url="https://github.com/gorhill/uBlock", github_id=2)
        test_db.add(repo)
        test_db.flush()
        test_db.add(ContextSignal(
            repo_id=repo.id, signal_type="hacker_news", external_id="ok",
            title="uBlock Origin is no longer available on the Chrome Store",
            url="https://example.com/c", score=1972,
            published_at=datetime(2026, 8, 1),
        ))
        test_db.commit()

        stats = cleanup_old_context_signals(test_db)

        assert stats["deleted_as_irrelevant"] == 0
        assert test_db.query(ContextSignal).count() == 1
