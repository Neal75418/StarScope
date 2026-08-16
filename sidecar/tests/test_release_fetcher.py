"""新版本抓取與 release notes 標記。

標記的目的是把「這禮拜有 14 個新版本」變成「這兩個你今天該點進去」。
所以判準不是「找得到多少」，而是「不該標的有沒有被標到」——全部都亮起來的
標記等於沒有標記。實測 60 個最新版本裡標了 13 個（22%），近 7 天的 14 個裡標了 2 個。
"""
from datetime import datetime

import pytest

from constants import ContextSignalType
from db.models import ContextSignal, Repo
from services.release_fetcher import (
    _ReleaseTarget,
    fetch_all_releases,
    store_release,
    tag_release_notes,
)


class TestTagReleaseNotes:
    def test_no_body_is_not_a_tag(self):
        assert tag_release_notes(None) is None
        assert tag_release_notes("") is None

    def test_ordinary_notes_get_nothing(self):
        assert tag_release_notes("Fixed a typo in the README and bumped deps") is None

    @pytest.mark.parametrize("body,expected", [
        ("This release contains a BREAKING CHANGE to the config format", "breaking"),
        ("Note: backwards incompatible change to the API", "breaking"),
        ("Includes a security fix for CVE-2026-1234", "security"),
        ("The old flag is deprecated, use --new instead", "deprecation"),
    ])
    def test_the_things_worth_interrupting_someone_for(self, body, expected):
        assert tag_release_notes(body) == expected

    def test_multiple_tags_are_sorted_and_joined(self):
        body = "BREAKING CHANGE: removed the v1 client. The v2 shim is deprecated."
        assert tag_release_notes(body) == "breaking,deprecation"

    def test_matching_is_case_insensitive(self):
        assert tag_release_notes("Security Fix included") == "security"

    @pytest.mark.parametrize("body", [
        # anchore/grype 是漏洞掃描工具，每一版的 notes 都在講 vulnerability。
        # 要求 security 後面接 fix/advisory/patch 才算，就是為了不讓這種 repo 每次都亮
        "Improved vulnerability matching for Alpine and added security scanning docs",
        # 「breaking」在英文裡到處都是
        "Record breaking performance: 2x faster than the previous release",
        "Fixed an issue where breaking out of the loop skipped the last item",
    ])
    def test_words_that_look_like_signals_but_are_not(self, body):
        assert tag_release_notes(body) is None


@pytest.fixture
def target(test_db):
    repo = Repo(owner="redis", name="jedis", full_name="redis/jedis",
                url="https://github.com/redis/jedis", github_id=1)
    test_db.add(repo)
    test_db.flush()
    return _ReleaseTarget(int(repo.id), "redis", "jedis", "redis/jedis")


def make_release(**overrides):
    return {
        "id": 12345,
        "tag_name": "v6.2.0",
        "name": "6.2.0",
        "html_url": "https://github.com/redis/jedis/releases/tag/v6.2.0",
        "published_at": "2026-08-10T12:00:00Z",
        "author": {"login": "someone"},
        "body": "Ordinary notes",
        **overrides,
    }


class TestStoreRelease:
    def test_stores_a_new_release(self, test_db, target):
        assert store_release(target, make_release(), test_db) is True
        test_db.commit()

        row = test_db.query(ContextSignal).one()
        assert row.signal_type == ContextSignalType.RELEASE
        assert row.external_id == "12345"
        assert row.published_at == datetime(2026, 8, 10, 12, 0)
        assert row.author == "someone"

    def test_the_same_release_is_not_stored_twice(self, test_db, target):
        store_release(target, make_release(), test_db)
        test_db.commit()

        assert store_release(target, make_release(), test_db) is False
        test_db.commit()
        assert test_db.query(ContextSignal).count() == 1

    def test_edited_notes_are_rescanned(self, test_db, target):
        """已發布的版本仍可能被補上 notes，標記要跟著更新。"""
        store_release(target, make_release(body="Initial notes"), test_db)
        test_db.commit()

        store_release(target, make_release(body="Actually this is a BREAKING CHANGE"), test_db)
        test_db.commit()

        assert test_db.query(ContextSignal).one().tags == "breaking"

    def test_identity_is_the_release_id_not_the_tag(self, test_db, target):
        """tag 可以被刪掉重推同名的，id 不會變。"""
        store_release(target, make_release(id=1, tag_name="v1.0"), test_db)
        store_release(target, make_release(id=2, tag_name="v1.0"), test_db)
        test_db.commit()

        assert test_db.query(ContextSignal).count() == 2

    def test_a_release_without_a_usable_id_is_skipped(self, test_db, target):
        assert store_release(target, make_release(id=None, tag_name=None), test_db) is False
        test_db.commit()
        assert test_db.query(ContextSignal).count() == 0

    @pytest.mark.parametrize("tag,name,expected", [
        # 三種寫法都是實測到的
        ("v0.19.1", "", "v0.19.1"),
        ("v6.2.0", "v6.2.0", "v6.2.0"),
        ("v1.9.0", "v1.9.0 - Command Code & safer specs", "v1.9.0 - Command Code & safer specs"),
        ("release-29.0.2", "Manticore Search 29.0.2", "release-29.0.2 Manticore Search 29.0.2"),
        ("autogpt-beta-v0.7.1", "Release `autogpt-beta-v0.7.1`", "Release `autogpt-beta-v0.7.1`"),
    ])
    def test_title_does_not_repeat_the_version(self, test_db, target, tag, name, expected):
        store_release(target, make_release(tag_name=tag, name=name), test_db)
        test_db.commit()
        assert test_db.query(ContextSignal).one().title == expected


class TestFetchAllReleases:
    @pytest.mark.asyncio
    async def test_repos_without_releases_are_counted_not_errors(
        self, test_db, target, monkeypatch
    ):
        """94 個 repo 有 34 個從沒發過版，那是常態不是失敗。"""
        class NoReleases:
            async def get_latest_release(self, owner, name):
                return None

        monkeypatch.setattr("services.release_fetcher.get_github_service", lambda: NoReleases())

        result = await fetch_all_releases(test_db)

        assert result["repos_without_releases"] == 1
        assert result["errors"] == 0
        assert result["new_releases"] == 0

    @pytest.mark.asyncio
    async def test_one_repos_failure_does_not_stop_the_others(self, test_db, monkeypatch):
        for i, name in enumerate(("good", "bad", "other"), start=2):
            test_db.add(Repo(owner="o", name=name, full_name=f"o/{name}",
                             url=f"https://github.com/o/{name}", github_id=i))
        test_db.commit()

        attempted: list[str] = []

        class Flaky:
            async def get_latest_release(self, owner, name):
                attempted.append(name)
                if name == "bad":
                    raise RuntimeError("boom")
                return make_release(id=abs(hash(name)) % 10000)

        monkeypatch.setattr("services.release_fetcher.get_github_service", lambda: Flaky())

        result = await fetch_all_releases(test_db)

        assert result["errors"] == 1
        assert result["new_releases"] == 2
        assert sorted(attempted) == ["bad", "good", "other"]
