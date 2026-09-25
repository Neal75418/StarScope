# 「自上次以來」摘要 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dashboard 最上方的摘要面板取代 AttentionBar，列出追蹤清單裡的 repo 自上次看過之後發生的事，分「重點」與收合的「其他更新」。

**Architecture:** 後端 `services/digest.py` 讀取時即時從 `context_signals`／`early_signals`／`triggered_alerts` 計算，以三張表的資料列 id 當「看過」的游標，游標存 app settings。前端 `useDigest` 每次開 app 抓一批、顯示後推進游標、重整只附加；`DigestPanel` 呈現；`useStartupPage` 在有重點時讓 app 啟動落在 Dashboard。

**Tech Stack:** FastAPI + 同步 SQLAlchemy（SQLite）、pytest；React 19 + TanStack Query 5、vitest + Testing Library、Playwright。

**Spec:** `docs/superpowers/specs/2026-09-25-since-last-visit-digest-design.md`

## Global Constraints

- 重點：release 帶 `breaking` 或 `security`；early signal 嚴重度 `high`／`medium`；HN 分數 ≥ 50；觸發的警報。不設上限
- 其他更新：其餘 release（只帶 `deprecation` 的也在這裡）、`low` 的 early signal、HN 分數 < 50。只回最新 50 條＋總數
- 已有 `viral_hn` 訊號的 HN 討論只出現一次（同 repo，`early_signals.context_title == context_signals.title[:255]`）
- 「新」＝資料列 id 大於游標；不用 `fetched_at`（upsert 會刷新）也不用 `published_at`
- 沒有游標時顯示最近 3 天（`published_at`／`detected_at`／`triggered_at`，release 與 HN 的 `published_at` 為空時用 `fetched_at`）
- 游標只進不退（逐欄 max）；`POST /api/digest/seen` 帶 GET 回應裡的 cursor，不是送出當下的最大 id
- `POST /api/settings/reset-data` 必須一併刪除游標
- 已處理（`acknowledged`）的 early signal 與警報不列入摘要
- `occurred_at` 輸出帶 `+00:00` 的 ISO 字串（DB 存 naive UTC）
- 啟動頁：有重點→Dashboard；無重點／1 秒逾時／失敗→上次的頁面
- 後端 endpoint 沒有 await 就寫 `def`（`tests/test_endpoint_concurrency.py` 會擋）
- 後端日誌格式 `[摘要] 繁中訊息`；前端文案走 i18n，中英兩份都要有
- 跑後端測試一律：`cd sidecar && STARSCOPE_DATA_DIR=<暫存目錄> PYTHON_KEYRING_BACKEND=keyring.backends.null.Keyring GITHUB_TOKEN= .venv/bin/python -m pytest …`
- 本機 e2e 一律 `E2E_NO_TOKEN=1`
- Commit：Conventional Commits、純文字、不加 Co-Authored-By；**每個 commit 前先取得使用者授權**
- 階段閘門：Task 1–4（後端）完成後送 code-reviewer，修完才進 Task 5；Task 5–10（前端）完成後再送一次

## Review Focus

1. **重抓不會讓舊東西復活**：collector 每小時重抓 release／HN，upsert 刷新 `fetched_at` 與標題；已看過的那筆不能再出現（Task 3 的 upsert 回歸測試）。
2. **GET 與 POST 之間有新資料寫入**：collector 在使用者開著 Dashboard 時寫入新 release，POST 用 GET 的 cursor，新那筆下次一定看得到（Task 4）。
3. **API 失敗時不能說沒事**：摘要載入失敗必須顯示失敗＋重試，不能落到「沒有值得注意的變化」；失敗時也不能推進游標（Task 7、Task 8）。
4. **重整不清空正在看的那批**：按 ↻ 或排程抓取完成後，面板只附加新項目，不會因為重新查詢而換成只剩新東西（Task 7）。
5. **游標損壞或資料重設**：settings 裡的游標 JSON 壞掉時當作第一次使用（不 500）；重設資料後游標一起清掉，摘要不會空到 id 追上舊值（Task 2）。

---

### Task 1: 已處理但未過期的 early signal 不重建

**Files:**
- Modify: `sidecar/services/anomaly_detector.py:139-157`
- Test: `sidecar/tests/test_services_anomaly_detector.py`

**Interfaces:**
- Consumes: 無
- Produces: `_signal_already_active(repo_id, signal_type, db) -> bool` 與 `_build_active_signals_set(db) -> set[tuple[int, str]]` 語意改為「未過期即算存在」，簽名不變

- [ ] **Step 1: Write the failing tests**

在 `TestDetectAllForRepo` 裡 `test_skips_duplicate_signals` 之後加入（沿用同檔已 import 的 `EarlySignal`、`EarlySignalType`、`EarlySignalSeverity`、`RepoSnapshot`、`Signal`、`SignalType`、`utc_now`、`utc_today`、`timedelta`）：

```python
    def test_acknowledged_signal_is_not_recreated_before_it_expires(self, test_db, mock_repo):
        # 使用者按掉的訊號，條件仍成立時下一次抓取不能重建一筆——新的一筆會拿到新 id，
        # 在「自上次以來」摘要裡以新項目身分再出現一次
        acknowledged = EarlySignal(
            repo_id=mock_repo.id,
            signal_type=EarlySignalType.RISING_STAR,
            severity=EarlySignalSeverity.LOW,
            description="Acknowledged",
            detected_at=utc_now(),
            expires_at=utc_now() + timedelta(days=7),
            acknowledged=True,
            acknowledged_at=utc_now(),
        )
        test_db.add(acknowledged)
        test_db.query(RepoSnapshot).filter(RepoSnapshot.repo_id == mock_repo.id).delete()
        test_db.query(Signal).filter(Signal.repo_id == mock_repo.id).delete()
        test_db.add_all([
            RepoSnapshot(repo_id=mock_repo.id, snapshot_date=utc_today(), stars=1000),
            Signal(repo_id=mock_repo.id, signal_type=SignalType.VELOCITY, value=20.0,
                   calculated_at=utc_now()),
        ])
        test_db.commit()

        result = AnomalyDetector.detect_all_for_repo(mock_repo, test_db)

        assert [s for s in result if s.signal_type == EarlySignalType.RISING_STAR] == []

    def test_expired_acknowledged_signal_can_be_detected_again(self, test_db, mock_repo):
        # 對照組：過期之後條件仍成立就該重新偵測，否則按掉一次就永遠消失
        expired = EarlySignal(
            repo_id=mock_repo.id,
            signal_type=EarlySignalType.RISING_STAR,
            severity=EarlySignalSeverity.LOW,
            description="Expired",
            detected_at=utc_now() - timedelta(days=8),
            expires_at=utc_now() - timedelta(days=1),
            acknowledged=True,
            acknowledged_at=utc_now() - timedelta(days=7),
        )
        test_db.add(expired)
        test_db.query(RepoSnapshot).filter(RepoSnapshot.repo_id == mock_repo.id).delete()
        test_db.query(Signal).filter(Signal.repo_id == mock_repo.id).delete()
        test_db.add_all([
            RepoSnapshot(repo_id=mock_repo.id, snapshot_date=utc_today(), stars=1000),
            Signal(repo_id=mock_repo.id, signal_type=SignalType.VELOCITY, value=20.0,
                   calculated_at=utc_now()),
        ])
        test_db.commit()

        result = AnomalyDetector.detect_all_for_repo(mock_repo, test_db)

        assert len([s for s in result if s.signal_type == EarlySignalType.RISING_STAR]) == 1
```

並在檔案底部加一個測批次路徑的 class（`run_detection` 走 `_build_active_signals_set`）：

```python
class TestActiveSignalsSet:
    def test_acknowledged_unexpired_signal_counts_as_active(self, test_db, mock_repo):
        from services.anomaly_detector import _build_active_signals_set
        test_db.add(EarlySignal(
            repo_id=mock_repo.id, signal_type=EarlySignalType.SUDDEN_SPIKE,
            severity=EarlySignalSeverity.LOW, description="x",
            detected_at=utc_now(), expires_at=utc_now() + timedelta(days=3),
            acknowledged=True, acknowledged_at=utc_now(),
        ))
        test_db.commit()

        assert (mock_repo.id, EarlySignalType.SUDDEN_SPIKE) in _build_active_signals_set(test_db)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sidecar && STARSCOPE_DATA_DIR=$TMPDIR/ss PYTHON_KEYRING_BACKEND=keyring.backends.null.Keyring GITHUB_TOKEN= .venv/bin/python -m pytest tests/test_services_anomaly_detector.py -k "acknowledged" -v`
Expected: `test_acknowledged_signal_is_not_recreated_before_it_expires` 與 `test_acknowledged_unexpired_signal_counts_as_active` FAIL；`test_expired_acknowledged_signal_can_be_detected_again` PASS（它是對照組）

- [ ] **Step 3: Implement**

`sidecar/services/anomaly_detector.py` 兩處拿掉 `acknowledged` 條件並更新 docstring：

```python
def _signal_already_active(repo_id: int, signal_type: str, db: Session) -> bool:
    """檢查是否已存在未過期的同類型 signal（單次查詢 fallback）。

    已處理過的也算：按掉之後條件仍成立的話，重建的那筆會拿到新 id，
    在「自上次以來」摘要與 SignalSpotlight 裡以新訊號身分再出現。過期後才重新偵測。
    """
    return db.query(EarlySignal).filter(
        EarlySignal.repo_id == repo_id,
        EarlySignal.signal_type == signal_type,
        EarlySignal.expires_at > utc_now(),
    ).first() is not None


def _build_active_signals_set(db: Session) -> set[tuple[int, str]]:
    """一次性預載所有未過期的 early signals（含已處理），回傳 {(repo_id, signal_type)} set。"""
    rows = db.query(
        EarlySignal.repo_id, EarlySignal.signal_type
    ).filter(
        EarlySignal.expires_at > utc_now(),
    ).all()
    return {(int(row[0]), row[1]) for row in rows}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sidecar && STARSCOPE_DATA_DIR=$TMPDIR/ss PYTHON_KEYRING_BACKEND=keyring.backends.null.Keyring GITHUB_TOKEN= .venv/bin/python -m pytest tests/test_services_anomaly_detector.py -v`
Expected: 全部 PASS

- [ ] **Step 5: Commit**（先取得使用者授權）

```bash
git add sidecar/services/anomaly_detector.py sidecar/tests/test_services_anomaly_detector.py
git commit -m "fix(sidecar): acknowledged early signals are not recreated until they expire"
```

---

### Task 2: 摘要游標的存取與重設

**Files:**
- Modify: `sidecar/db/models.py:398-421`（`AppSettingKey`）
- Create: `sidecar/services/digest.py`（本 task 只放游標部分）
- Modify: `sidecar/routers/app_settings.py:318-345`（`reset_all_data`）
- Test: `sidecar/tests/test_digest_cursor.py`、`sidecar/tests/test_app_settings_router.py`

**Interfaces:**
- Consumes: `services.settings.get_setting(key, db)`、`set_setting(key, value, db)`、`delete_setting(key, db)`
- Produces:
  - `DigestCursor(context_signal_id: int, early_signal_id: int, triggered_alert_id: int)`（frozen dataclass），方法 `merged(other) -> DigestCursor`
  - `load_cursor(db) -> tuple[DigestCursor | None, datetime | None]`（第二個是 `seen_at`，naive UTC）
  - `save_cursor(cursor, db) -> DigestCursor`（逐欄 max 後寫回，回傳寫入值）
  - `clear_cursor(db) -> None`
  - `AppSettingKey.DIGEST_CURSOR = "digest_cursor"`

- [ ] **Step 1: Write the failing tests**

`sidecar/tests/test_digest_cursor.py`：

```python
"""摘要游標：存在 app settings，只進不退，壞掉時當作第一次使用。"""

from db.models import AppSetting, AppSettingKey
from services.digest import DigestCursor, clear_cursor, load_cursor, save_cursor


def test_no_cursor_means_first_visit(test_db):
    assert load_cursor(test_db) == (None, None)


def test_save_then_load_round_trips_and_records_when(test_db):
    save_cursor(DigestCursor(10, 3, 1), test_db)

    cursor, seen_at = load_cursor(test_db)

    assert cursor == DigestCursor(10, 3, 1)
    assert seen_at is not None


def test_cursor_never_moves_backwards(test_db):
    save_cursor(DigestCursor(10, 3, 1), test_db)

    written = save_cursor(DigestCursor(8, 5, 0), test_db)

    # 逐欄取 max：重送一個舊的 cursor 不能讓看過的東西再出現
    assert written == DigestCursor(10, 5, 1)
    assert load_cursor(test_db)[0] == DigestCursor(10, 5, 1)


def test_corrupt_cursor_is_treated_as_first_visit(test_db):
    test_db.add(AppSetting(key=AppSettingKey.DIGEST_CURSOR, value="{not json"))
    test_db.commit()

    assert load_cursor(test_db) == (None, None)


def test_cursor_missing_a_field_is_treated_as_first_visit(test_db):
    test_db.add(AppSetting(key=AppSettingKey.DIGEST_CURSOR, value='{"context_signal_id": 1}'))
    test_db.commit()

    assert load_cursor(test_db) == (None, None)


def test_clear_cursor(test_db):
    save_cursor(DigestCursor(1, 1, 1), test_db)

    clear_cursor(test_db)

    assert load_cursor(test_db) == (None, None)
```

`sidecar/tests/test_app_settings_router.py` 的 `reset-data` class 裡、`test_preserves_app_settings` 之後加入：

```python
    def test_clears_the_digest_cursor(self, client, test_db):
        # 三張表清空後 id 從頭算；游標留著的話摘要會空到 id 追上舊值為止
        from services.digest import DigestCursor, load_cursor, save_cursor
        save_cursor(DigestCursor(500, 40, 3), test_db)

        client.post("/api/settings/reset-data", json={"confirm": "RESET"})

        test_db.expire_all()
        assert load_cursor(test_db) == (None, None)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sidecar && STARSCOPE_DATA_DIR=$TMPDIR/ss PYTHON_KEYRING_BACKEND=keyring.backends.null.Keyring GITHUB_TOKEN= .venv/bin/python -m pytest tests/test_digest_cursor.py tests/test_app_settings_router.py -k "cursor or digest or first_visit" -v`
Expected: FAIL（`ModuleNotFoundError: No module named 'services.digest'`）

- [ ] **Step 3: Implement**

`sidecar/db/models.py` 的 `AppSettingKey` 最後加：

```python
    # 「自上次以來」摘要看到哪（services/digest.py）；JSON：三張表的最大 id＋seen_at
    DIGEST_CURSOR = "digest_cursor"
```

`sidecar/services/digest.py`：

```python
"""「自上次以來」摘要：追蹤清單裡的 repo 自上次看過之後發生了什麼。

「新」以資料列 id 判定，不用時間：release 與 HN 是 upsert，重抓會刷新 fetched_at；
published_at 又可能早於 StarScope 得知的時間（離線三天後才抓到四天前的 release）。
id 只有真的新增時才會變大。設計見 docs/superpowers/specs/2026-09-25-since-last-visit-digest-design.md
"""

import json
import logging
from dataclasses import asdict, dataclass
from datetime import datetime

from sqlalchemy.orm import Session

from db.models import AppSettingKey
from services.settings import delete_setting, get_setting, set_setting
from utils.time import utc_now

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class DigestCursor:
    """三張來源表各自看過的最大 id。"""

    context_signal_id: int
    early_signal_id: int
    triggered_alert_id: int

    def merged(self, other: "DigestCursor") -> "DigestCursor":
        return DigestCursor(
            context_signal_id=max(self.context_signal_id, other.context_signal_id),
            early_signal_id=max(self.early_signal_id, other.early_signal_id),
            triggered_alert_id=max(self.triggered_alert_id, other.triggered_alert_id),
        )


def load_cursor(db: Session) -> tuple[DigestCursor | None, datetime | None]:
    """讀游標與上次看過的時間；沒有或格式壞掉時回 (None, None)，視為第一次使用。"""
    raw = get_setting(AppSettingKey.DIGEST_CURSOR, db)
    if raw is None:
        return None, None
    try:
        data = json.loads(raw)
        cursor = DigestCursor(
            context_signal_id=int(data["context_signal_id"]),
            early_signal_id=int(data["early_signal_id"]),
            triggered_alert_id=int(data["triggered_alert_id"]),
        )
        seen_at = datetime.fromisoformat(data["seen_at"]) if data.get("seen_at") else None
    except (ValueError, KeyError, TypeError):
        logger.warning("[摘要] 游標格式錯誤，視為第一次使用：%r", raw)
        return None, None
    return cursor, seen_at


def save_cursor(cursor: DigestCursor, db: Session) -> DigestCursor:
    """逐欄取 max 後寫回，回傳實際寫入的游標。重送舊的 cursor 不會讓游標倒退。"""
    current, _ = load_cursor(db)
    merged = cursor if current is None else current.merged(cursor)
    set_setting(
        AppSettingKey.DIGEST_CURSOR,
        json.dumps({**asdict(merged), "seen_at": utc_now().isoformat()}),
        db,
    )
    return merged


def clear_cursor(db: Session) -> None:
    delete_setting(AppSettingKey.DIGEST_CURSOR, db)
```

`sidecar/routers/app_settings.py` 的 `reset_all_data`，在 `db.commit()` 之後、`return` 之前：

```python
    # 三張來源表清空後 id 從頭算，留著舊游標的話摘要會一直空到 id 追上舊值
    clear_cursor(db)
```

並在檔案上方 import：`from services.digest import clear_cursor`

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sidecar && STARSCOPE_DATA_DIR=$TMPDIR/ss PYTHON_KEYRING_BACKEND=keyring.backends.null.Keyring GITHUB_TOKEN= .venv/bin/python -m pytest tests/test_digest_cursor.py tests/test_app_settings_router.py -v`
Expected: 全部 PASS

- [ ] **Step 5: Commit**（先取得使用者授權）

```bash
git add sidecar/db/models.py sidecar/services/digest.py sidecar/routers/app_settings.py sidecar/tests/test_digest_cursor.py sidecar/tests/test_app_settings_router.py
git commit -m "feat(sidecar): store the digest cursor in app settings and clear it on data reset"
```

---

### Task 3: `build_digest` 分層與篩選

**Files:**
- Modify: `sidecar/constants.py`（新增摘要常數）
- Modify: `sidecar/services/digest.py`
- Test: `sidecar/tests/test_digest_service.py`

**Interfaces:**
- Consumes: Task 2 的 `DigestCursor`；`release_fetcher.store_release`（只在測試用）
- Produces: `build_digest(db: Session, cursor: DigestCursor | None) -> dict`，回傳：
  ```
  {"items": [item, ...], "other_total": int, "cursor": {"context_signal_id", "early_signal_id", "triggered_alert_id"}, "releases_checked": bool}
  ```
  每個 item 共同欄位：`key: str`、`tier: "highlight" | "other"`、`kind: "release" | "hn" | "signal" | "alert"`、`repo: {"id", "full_name", "url"}`、`occurred_at: str`（帶 `+00:00`）、`url: str | None`
  - release：`title: str`、`tags: list[str]`
  - hn：`title: str`、`score: int | None`
  - signal：`signal: dict`（欄位同 `routers/early_signals.EarlySignalResponse`）
  - alert：`rule_name`、`signal_type`、`operator`、`threshold: float`、`value: float`
  - items 排序：重點在前（新到舊），接著其他更新（新到舊，最多 50）

- [ ] **Step 1: Write the failing tests**

`sidecar/tests/test_digest_service.py`：

```python
"""build_digest：分層、去重、篩選、上限。"""

from datetime import timedelta

from constants import ContextSignalType, EarlySignalSeverity, EarlySignalType
from db.models import AlertRule, AppSettingKey, ContextSignal, EarlySignal, Repo, TriggeredAlert
from services.digest import DigestCursor, build_digest
from services.release_fetcher import _ReleaseTarget, store_release
from services.settings import set_setting
from utils.time import utc_now

ZERO = DigestCursor(0, 0, 0)


def _release(db, repo, *, tags=None, external_id="1", published_days_ago=0.0):
    row = ContextSignal(
        repo_id=repo.id, signal_type=ContextSignalType.RELEASE, external_id=external_id,
        title=f"v{external_id}", url=f"https://github.com/{repo.full_name}/releases/{external_id}",
        tags=tags, published_at=utc_now() - timedelta(days=published_days_ago),
    )
    db.add(row)
    db.commit()
    return row


def _hn(db, repo, *, score, external_id="h1", title="Show HN: thing"):
    row = ContextSignal(
        repo_id=repo.id, signal_type=ContextSignalType.HACKER_NEWS, external_id=external_id,
        title=title, url=f"https://news.ycombinator.com/item?id={external_id}",
        score=score, published_at=utc_now(),
    )
    db.add(row)
    db.commit()
    return row


def _signal(db, repo, *, severity, signal_type=EarlySignalType.SUDDEN_SPIKE,
            context_title=None, acknowledged=False, detected_days_ago=0.0):
    row = EarlySignal(
        repo_id=repo.id, signal_type=signal_type, severity=severity, description="d",
        velocity_value=300.0, baseline_value=40.0, star_count=5000, context_title=context_title,
        detected_at=utc_now() - timedelta(days=detected_days_ago),
        expires_at=utc_now() + timedelta(days=3), acknowledged=acknowledged,
    )
    db.add(row)
    db.commit()
    return row


def _keys(digest, tier=None):
    return [i["key"] for i in digest["items"] if tier is None or i["tier"] == tier]


class TestTiers:
    def test_breaking_or_security_release_is_a_highlight(self, test_db, mock_repo):
        a = _release(test_db, mock_repo, tags="breaking", external_id="1")
        b = _release(test_db, mock_repo, tags="deprecation,security", external_id="2")

        digest = build_digest(test_db, ZERO)

        assert set(_keys(digest, "highlight")) == {f"release:{a.id}", f"release:{b.id}"}

    def test_plain_and_deprecation_only_releases_are_other(self, test_db, mock_repo):
        plain = _release(test_db, mock_repo, tags=None, external_id="1")
        deprecation = _release(test_db, mock_repo, tags="deprecation", external_id="2")

        digest = build_digest(test_db, ZERO)

        assert set(_keys(digest, "other")) == {f"release:{plain.id}", f"release:{deprecation.id}"}
        item = next(i for i in digest["items"] if i["key"] == f"release:{deprecation.id}")
        assert item["tags"] == ["deprecation"]

    def test_hn_threshold_is_50(self, test_db, mock_repo):
        low = _hn(test_db, mock_repo, score=49, external_id="a")
        high = _hn(test_db, mock_repo, score=50, external_id="b")

        digest = build_digest(test_db, ZERO)

        assert _keys(digest, "highlight") == [f"hn:{high.id}"]
        assert _keys(digest, "other") == [f"hn:{low.id}"]

    def test_signal_severity_decides_the_tier(self, test_db, mock_repo):
        low = _signal(test_db, mock_repo, severity=EarlySignalSeverity.LOW)
        medium = _signal(test_db, mock_repo, severity=EarlySignalSeverity.MEDIUM,
                         signal_type=EarlySignalType.BREAKOUT)

        digest = build_digest(test_db, ZERO)

        assert _keys(digest, "highlight") == [f"signal:{medium.id}"]
        assert _keys(digest, "other") == [f"signal:{low.id}"]
        sig = next(i for i in digest["items"] if i["key"] == f"signal:{medium.id}")["signal"]
        # 前端用 formatSignalDescription 渲染，欄位要跟 EarlySignalResponse 一致
        assert sig["repo_name"] == mock_repo.full_name
        assert sig["baseline_value"] == 40.0

    def test_triggered_alert_is_a_highlight(self, test_db, mock_repo):
        rule = AlertRule(name="fast", signal_type="velocity", operator=">", threshold=10.0,
                         repo_id=None, enabled=True)
        test_db.add(rule)
        test_db.commit()
        alert = TriggeredAlert(rule_id=rule.id, repo_id=mock_repo.id, signal_value=42.0)
        test_db.add(alert)
        test_db.commit()

        digest = build_digest(test_db, ZERO)

        item = next(i for i in digest["items"] if i["key"] == f"alert:{alert.id}")
        assert item["tier"] == "highlight"
        assert (item["rule_name"], item["operator"], item["threshold"], item["value"]) == (
            "fast", ">", 10.0, 42.0)


class TestFiltering:
    def test_viral_hn_story_appears_once_as_the_signal(self, test_db, mock_repo):
        title = "Show HN: " + "x" * 300  # 超過 255：context_title 寫入時被截斷
        story = _hn(test_db, mock_repo, score=320, title=title)
        viral = _signal(test_db, mock_repo, severity=EarlySignalSeverity.HIGH,
                        signal_type=EarlySignalType.VIRAL_HN, context_title=title[:255])

        digest = build_digest(test_db, ZERO)

        assert f"signal:{viral.id}" in _keys(digest)
        assert f"hn:{story.id}" not in _keys(digest)

    def test_acknowledged_signals_are_left_out(self, test_db, mock_repo):
        _signal(test_db, mock_repo, severity=EarlySignalSeverity.HIGH, acknowledged=True)

        assert build_digest(test_db, ZERO)["items"] == []

    def test_acknowledged_alerts_are_left_out(self, test_db, mock_repo):
        # 在通知中心按掉的警報已經看過了
        rule = AlertRule(name="fast", signal_type="velocity", operator=">", threshold=10.0,
                         repo_id=None, enabled=True)
        test_db.add(rule)
        test_db.commit()
        test_db.add(TriggeredAlert(rule_id=rule.id, repo_id=mock_repo.id, signal_value=42.0,
                                   acknowledged=True, acknowledged_at=utc_now()))
        test_db.commit()

        assert build_digest(test_db, ZERO)["items"] == []

    def test_unstarred_repos_are_left_out(self, test_db, mock_repo):
        _release(test_db, mock_repo, tags="security")
        mock_repo.unstarred_at = utc_now()
        test_db.commit()

        assert build_digest(test_db, ZERO)["items"] == []

    def test_only_rows_newer_than_the_cursor(self, test_db, mock_repo):
        old = _release(test_db, mock_repo, external_id="1")
        new = _release(test_db, mock_repo, external_id="2")

        digest = build_digest(test_db, DigestCursor(old.id, 0, 0))

        assert _keys(digest) == [f"release:{new.id}"]
        assert digest["cursor"]["context_signal_id"] == new.id

    def test_refetching_a_seen_release_does_not_bring_it_back(self, test_db, mock_repo):
        # collector 每小時重抓：upsert 會刷新 fetched_at 與標題，id 不變
        target = _ReleaseTarget(mock_repo.id, mock_repo.owner, mock_repo.name, mock_repo.full_name)
        release = {"id": 777, "tag_name": "v1.0.0", "name": "v1.0.0",
                   "html_url": "https://example.com/r", "published_at": "2026-09-20T00:00:00Z",
                   "body": "BREAKING CHANGE: everything"}
        store_release(target, release, test_db)
        test_db.commit()
        seen = build_digest(test_db, ZERO)["cursor"]

        store_release(target, {**release, "name": "v1.0.0 (edited)"}, test_db)
        test_db.commit()

        assert build_digest(test_db, DigestCursor(**seen))["items"] == []

    def test_first_visit_shows_only_the_last_three_days(self, test_db, mock_repo):
        _release(test_db, mock_repo, external_id="old", published_days_ago=5)
        recent = _release(test_db, mock_repo, external_id="new", published_days_ago=1)
        _signal(test_db, mock_repo, severity=EarlySignalSeverity.HIGH, detected_days_ago=4)

        digest = build_digest(test_db, None)

        assert _keys(digest) == [f"release:{recent.id}"]

    def test_first_visit_cursor_covers_everything_that_exists(self, test_db, mock_repo):
        # 窗口外的舊列也要被游標蓋過，否則下次打開會把全部歷史倒出來
        old = _release(test_db, mock_repo, external_id="old", published_days_ago=30)
        old_signal = _signal(test_db, mock_repo, severity=EarlySignalSeverity.LOW,
                             detected_days_ago=30)

        cursor = build_digest(test_db, None)["cursor"]

        assert cursor["context_signal_id"] == old.id
        assert cursor["early_signal_id"] == old_signal.id


class TestShape:
    def test_other_is_capped_at_50_with_a_total(self, test_db, mock_repo):
        for n in range(55):
            _release(test_db, mock_repo, external_id=str(n))
        _release(test_db, mock_repo, tags="security", external_id="sec")

        digest = build_digest(test_db, ZERO)

        assert len(_keys(digest, "other")) == 50
        assert digest["other_total"] == 55
        assert len(_keys(digest, "highlight")) == 1

    def test_cursor_skips_past_items_beyond_the_cap(self, test_db, mock_repo):
        rows = [_release(test_db, mock_repo, external_id=str(n)) for n in range(55)]

        digest = build_digest(test_db, ZERO)

        assert digest["cursor"]["context_signal_id"] == max(r.id for r in rows)

    def test_highlights_come_first_newest_first(self, test_db, mock_repo):
        older = _release(test_db, mock_repo, tags="security", external_id="1", published_days_ago=2)
        newer = _release(test_db, mock_repo, tags="breaking", external_id="2", published_days_ago=1)
        plain = _release(test_db, mock_repo, external_id="3", published_days_ago=0)

        assert _keys(build_digest(test_db, ZERO)) == [
            f"release:{newer.id}", f"release:{older.id}", f"release:{plain.id}"]

    def test_occurred_at_carries_the_utc_offset(self, test_db, mock_repo):
        _release(test_db, mock_repo)

        item = build_digest(test_db, ZERO)["items"][0]

        assert item["occurred_at"].endswith("+00:00")

    def test_signal_items_link_to_the_repo(self, test_db, mock_repo):
        _signal(test_db, mock_repo, severity=EarlySignalSeverity.HIGH)

        item = build_digest(test_db, ZERO)["items"][0]

        assert item["url"] is None
        assert item["repo"]["url"] == mock_repo.url

    def test_releases_checked_follows_the_last_fetch_setting(self, test_db):
        assert build_digest(test_db, ZERO)["releases_checked"] is False
        set_setting(AppSettingKey.LAST_RELEASE_FETCH_AT, utc_now().isoformat(), test_db)
        assert build_digest(test_db, ZERO)["releases_checked"] is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sidecar && STARSCOPE_DATA_DIR=$TMPDIR/ss PYTHON_KEYRING_BACKEND=keyring.backends.null.Keyring GITHUB_TOKEN= .venv/bin/python -m pytest tests/test_digest_service.py -v`
Expected: FAIL（`ImportError: cannot import name 'build_digest'`）

- [ ] **Step 3: Implement**

`sidecar/constants.py`（放在 `EarlySignalSeverity` 之後）：

```python
# 「自上次以來」摘要（services/digest.py）。門檻依 2026-09-25 真實資料 30 天的頻率訂：
# 98 個 repo 每天約 4 個 release，帶這兩種標記的 30 天共 10 次；HN ≥ 50 分 30 天 7 次
DIGEST_HIGHLIGHT_RELEASE_TAGS = frozenset({"breaking", "security"})
DIGEST_HIGHLIGHT_SEVERITIES = frozenset({EarlySignalSeverity.HIGH, EarlySignalSeverity.MEDIUM})
DIGEST_HN_HIGHLIGHT_MIN_SCORE = 50
DIGEST_OTHER_LIMIT = 50
DIGEST_INITIAL_WINDOW_DAYS = 3
```

`sidecar/services/digest.py` 追加（import 併到檔案上方）：

```python
from datetime import timedelta, timezone
from typing import Any

from sqlalchemy import func

from constants import (
    DIGEST_HIGHLIGHT_RELEASE_TAGS,
    DIGEST_HIGHLIGHT_SEVERITIES,
    DIGEST_HN_HIGHLIGHT_MIN_SCORE,
    DIGEST_INITIAL_WINDOW_DAYS,
    DIGEST_OTHER_LIMIT,
    ContextSignalType,
    EarlySignalType,
)
from db.models import AlertRule, ContextSignal, EarlySignal, Repo, TriggeredAlert


def _iso_utc(dt: datetime) -> str:
    # DB 存 naive UTC；不帶時區的字串會被前端 new Date() 當成本地時間
    return dt.replace(tzinfo=timezone.utc).isoformat()


def _repo_ref(repo: Repo) -> dict[str, Any]:
    return {"id": repo.id, "full_name": repo.full_name, "url": repo.url}


def _current_max_ids(db: Session) -> DigestCursor:
    return DigestCursor(
        context_signal_id=db.query(func.max(ContextSignal.id)).scalar() or 0,
        early_signal_id=db.query(func.max(EarlySignal.id)).scalar() or 0,
        triggered_alert_id=db.query(func.max(TriggeredAlert.id)).scalar() or 0,
    )


def _signal_payload(signal: EarlySignal, repo: Repo) -> dict[str, Any]:
    """欄位與 routers/early_signals.EarlySignalResponse 一致，前端直接套 formatSignalDescription。"""
    return {
        "id": signal.id,
        "repo_id": signal.repo_id,
        "repo_name": repo.full_name,
        "signal_type": signal.signal_type,
        "severity": signal.severity,
        "description": signal.description,
        "velocity_value": signal.velocity_value,
        "star_count": signal.star_count,
        "baseline_value": signal.baseline_value,
        "context_title": signal.context_title,
        "percentile_rank": signal.percentile_rank,
        "detected_at": signal.detected_at,
        "expires_at": signal.expires_at,
        "acknowledged": bool(signal.acknowledged),
        "acknowledged_at": signal.acknowledged_at,
    }


def build_digest(db: Session, cursor: DigestCursor | None) -> dict[str, Any]:
    """算出 id 大於 cursor 的所有事件，分成重點與其他更新。

    cursor 為 None（第一次使用）時只取最近 DIGEST_INITIAL_WINDOW_DAYS 天，但回傳的 cursor
    仍是三張表目前的最大 id——窗口外的舊列也要被蓋過，否則下次打開會把歷史全部倒出來。
    """
    # 先取上界，之後的查詢都夾在 (下界, 上界]：查詢途中剛寫入的列 id 會大於上界，
    # 這一批不含它、回傳的 cursor 也不會越過它，下一次一定看得到
    upper = _current_max_ids(db)
    lower = cursor or DigestCursor(0, 0, 0)
    since = None if cursor is not None else utc_now() - timedelta(days=DIGEST_INITIAL_WINDOW_DAYS)

    items: list[dict[str, Any]] = []

    signal_q = (
        db.query(EarlySignal, Repo)
        .join(Repo, Repo.id == EarlySignal.repo_id)
        .filter(
            EarlySignal.id > lower.early_signal_id,
            EarlySignal.id <= upper.early_signal_id,
            EarlySignal.acknowledged.is_(False),
        )
    )
    if since is not None:
        signal_q = signal_q.filter(EarlySignal.detected_at >= since)
    viral_titles: set[tuple[int, str]] = set()
    for signal, repo in signal_q.all():
        if signal.signal_type == EarlySignalType.VIRAL_HN and signal.context_title:
            viral_titles.add((signal.repo_id, signal.context_title))
        items.append({
            "key": f"signal:{signal.id}",
            "tier": "highlight" if signal.severity in DIGEST_HIGHLIGHT_SEVERITIES else "other",
            "kind": "signal",
            "repo": _repo_ref(repo),
            "occurred_at": _iso_utc(signal.detected_at),
            "url": None,
            "signal": _signal_payload(signal, repo),
        })

    context_q = (
        db.query(ContextSignal, Repo)
        .join(Repo, Repo.id == ContextSignal.repo_id)
        .filter(
            ContextSignal.id > lower.context_signal_id,
            ContextSignal.id <= upper.context_signal_id,
        )
    )
    if since is not None:
        context_q = context_q.filter(
            func.coalesce(ContextSignal.published_at, ContextSignal.fetched_at) >= since)
    for row, repo in context_q.all():
        occurred = row.published_at or row.fetched_at
        base = {"repo": _repo_ref(repo), "occurred_at": _iso_utc(occurred), "url": row.url,
                "title": row.title}
        if row.signal_type == ContextSignalType.RELEASE:
            tags = [t for t in (row.tags or "").split(",") if t]
            highlight = any(t in DIGEST_HIGHLIGHT_RELEASE_TAGS for t in tags)
            items.append({**base, "key": f"release:{row.id}", "kind": "release", "tags": tags,
                          "tier": "highlight" if highlight else "other"})
        elif row.signal_type == ContextSignalType.HACKER_NEWS:
            # viral_hn 訊號的 context_title 寫入時截到 255 字
            if (row.repo_id, row.title[:255]) in viral_titles:
                continue
            highlight = (row.score or 0) >= DIGEST_HN_HIGHLIGHT_MIN_SCORE
            items.append({**base, "key": f"hn:{row.id}", "kind": "hn", "score": row.score,
                          "tier": "highlight" if highlight else "other"})

    alert_q = (
        db.query(TriggeredAlert, AlertRule, Repo)
        .join(AlertRule, AlertRule.id == TriggeredAlert.rule_id)
        .join(Repo, Repo.id == TriggeredAlert.repo_id)
        .filter(
            TriggeredAlert.id > lower.triggered_alert_id,
            TriggeredAlert.id <= upper.triggered_alert_id,
            TriggeredAlert.acknowledged.is_(False),
        )
    )
    if since is not None:
        alert_q = alert_q.filter(TriggeredAlert.triggered_at >= since)
    for alert, rule, repo in alert_q.all():
        items.append({
            "key": f"alert:{alert.id}",
            "tier": "highlight",
            "kind": "alert",
            "repo": _repo_ref(repo),
            "occurred_at": _iso_utc(alert.triggered_at),
            "url": None,
            "rule_name": rule.name,
            "signal_type": rule.signal_type,
            "operator": rule.operator,
            "threshold": rule.threshold,
            "value": alert.signal_value,
        })

    def newest_first(group: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return sorted(group, key=lambda i: i["occurred_at"], reverse=True)

    highlights = newest_first([i for i in items if i["tier"] == "highlight"])
    others = newest_first([i for i in items if i["tier"] == "other"])
    return {
        "items": highlights + others[:DIGEST_OTHER_LIMIT],
        "other_total": len(others),
        "cursor": asdict(lower.merged(upper)),
        "releases_checked": get_setting(AppSettingKey.LAST_RELEASE_FETCH_AT, db) is not None,
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sidecar && STARSCOPE_DATA_DIR=$TMPDIR/ss PYTHON_KEYRING_BACKEND=keyring.backends.null.Keyring GITHUB_TOKEN= .venv/bin/python -m pytest tests/test_digest_service.py tests/test_digest_cursor.py -v`
Expected: 全部 PASS。`test_unstarred_repos_are_left_out` 依賴 conftest 註冊的全域 archive filter；若它失敗，表示 filter 沒套到 join 的 `Repo`，在三個查詢加上 `Repo.unstarred_at.is_(None)`，並把 spec「不必自己再寫一次條件」那句改掉。

- [ ] **Step 5: Commit**（先取得使用者授權）

```bash
git add sidecar/constants.py sidecar/services/digest.py sidecar/tests/test_digest_service.py
git commit -m "feat(sidecar): build the since-last-visit digest from release, HN, signal and alert rows"
```

---

### Task 4: `/api/digest` router

**Files:**
- Create: `sidecar/routers/digest.py`
- Modify: `sidecar/routers/__init__.py`、`sidecar/main.py`（router 清單加 `digest`）
- Test: `sidecar/tests/test_digest_router.py`

**Interfaces:**
- Consumes: Task 2–3 的 `build_digest`、`load_cursor`、`save_cursor`、`DigestCursor`
- Produces:
  - `GET /api/digest` → `ApiResponse[DigestResponse]`，`data = {items, other_total, cursor, last_seen_at, releases_checked}`；`last_seen_at` 是帶 `+00:00` 的 ISO 字串或 null
  - `POST /api/digest/seen`，body `{"cursor": {"context_signal_id": int, "early_signal_id": int, "triggered_alert_id": int}}` → `ApiResponse[DigestCursorModel]`（寫入後的游標）

- [ ] **Step 1: Write the failing tests**

`sidecar/tests/test_digest_router.py`：

```python
"""/api/digest：GET 取這批、POST 推進游標；游標只進不退。"""

from constants import ContextSignalType
from db.models import ContextSignal
from utils.time import utc_now


def _add_release(db, repo, external_id):
    row = ContextSignal(repo_id=repo.id, signal_type=ContextSignalType.RELEASE,
                        external_id=external_id, title=f"v{external_id}",
                        url="https://example.com", published_at=utc_now())
    db.add(row)
    db.commit()
    return row


def test_get_returns_the_batch_and_cursor(client, test_db, mock_repo):
    row = _add_release(test_db, mock_repo, "1")

    data = client.get("/api/digest").json()["data"]

    assert [i["key"] for i in data["items"]] == [f"release:{row.id}"]
    assert data["cursor"]["context_signal_id"] == row.id
    assert data["last_seen_at"] is None
    assert data["other_total"] == 1


def test_seen_hides_the_batch_next_time(client, test_db, mock_repo):
    _add_release(test_db, mock_repo, "1")
    data = client.get("/api/digest").json()["data"]

    client.post("/api/digest/seen", json={"cursor": data["cursor"]})
    again = client.get("/api/digest").json()["data"]

    assert again["items"] == []
    assert again["last_seen_at"].endswith("+00:00")


def test_row_written_between_get_and_post_still_shows_next_time(client, test_db, mock_repo):
    _add_release(test_db, mock_repo, "1")
    cursor = client.get("/api/digest").json()["data"]["cursor"]
    late = _add_release(test_db, mock_repo, "2")  # collector 在使用者看的時候寫進來

    client.post("/api/digest/seen", json={"cursor": cursor})

    keys = [i["key"] for i in client.get("/api/digest").json()["data"]["items"]]
    assert keys == [f"release:{late.id}"]


def test_seen_never_moves_the_cursor_backwards(client, test_db, mock_repo):
    _add_release(test_db, mock_repo, "1")
    cursor = client.get("/api/digest").json()["data"]["cursor"]
    client.post("/api/digest/seen", json={"cursor": cursor})

    resp = client.post("/api/digest/seen", json={"cursor": {
        "context_signal_id": 0, "early_signal_id": 0, "triggered_alert_id": 0}})

    assert resp.json()["data"]["context_signal_id"] == cursor["context_signal_id"]
    assert client.get("/api/digest").json()["data"]["items"] == []


def test_seen_rejects_negative_ids(client):
    resp = client.post("/api/digest/seen", json={"cursor": {
        "context_signal_id": -1, "early_signal_id": 0, "triggered_alert_id": 0}})

    assert resp.status_code == 422
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sidecar && STARSCOPE_DATA_DIR=$TMPDIR/ss PYTHON_KEYRING_BACKEND=keyring.backends.null.Keyring GITHUB_TOKEN= .venv/bin/python -m pytest tests/test_digest_router.py -v`
Expected: FAIL（404）

- [ ] **Step 3: Implement**

`sidecar/routers/digest.py`：

```python
"""「自上次以來」摘要 API。分層與篩選規則在 services/digest.py。"""

from datetime import timezone
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from db.database import get_db
from routers.early_signals import EarlySignalResponse
from schemas.response import ApiResponse, success_response
from services.digest import DigestCursor, build_digest, load_cursor, save_cursor

router = APIRouter(prefix="/api/digest", tags=["digest"])


class DigestCursorModel(BaseModel):
    context_signal_id: int = Field(ge=0)
    early_signal_id: int = Field(ge=0)
    triggered_alert_id: int = Field(ge=0)


class DigestRepoRef(BaseModel):
    id: int
    full_name: str
    url: str


class DigestItem(BaseModel):
    # 這個 response_model 會濾掉沒宣告的欄位：services/digest.py 每新增一個欄位都要在這裡宣告
    key: str
    tier: Literal["highlight", "other"]
    kind: Literal["release", "hn", "signal", "alert"]
    repo: DigestRepoRef
    occurred_at: str
    url: str | None = None
    title: str | None = None
    tags: list[str] = []
    score: int | None = None
    signal: EarlySignalResponse | None = None
    rule_name: str | None = None
    signal_type: str | None = None
    operator: str | None = None
    threshold: float | None = None
    value: float | None = None


class DigestResponse(BaseModel):
    items: list[DigestItem]
    other_total: int
    cursor: DigestCursorModel
    last_seen_at: str | None
    releases_checked: bool


class MarkSeenRequest(BaseModel):
    cursor: DigestCursorModel


@router.get("", response_model=ApiResponse[DigestResponse])
def get_digest(db: Session = Depends(get_db)) -> dict:
    cursor, seen_at = load_cursor(db)
    data = build_digest(db, cursor)
    data["last_seen_at"] = seen_at.replace(tzinfo=timezone.utc).isoformat() if seen_at else None
    return success_response(data=data)


@router.post("/seen", response_model=ApiResponse[DigestCursorModel])
def mark_digest_seen(body: MarkSeenRequest, db: Session = Depends(get_db)) -> dict:
    """推進游標到前端這批回應的 cursor（不是送出當下的最大 id）；逐欄 max，重送無害。"""
    written = save_cursor(DigestCursor(**body.cursor.model_dump()), db)
    return success_response(data=DigestCursorModel(**written.__dict__))
```

`sidecar/routers/__init__.py`：在 `from . import app_settings` 後加 `from . import digest`，`__all__` 加 `"digest"`。

`sidecar/main.py:36` 的 import 清單加 `digest`；`main.py` 註冊 router 的清單（`for _module in [...]`，`app_settings, interests, feed,` 那一行）加 `digest,`。

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sidecar && STARSCOPE_DATA_DIR=$TMPDIR/ss PYTHON_KEYRING_BACKEND=keyring.backends.null.Keyring GITHUB_TOKEN= .venv/bin/python -m pytest tests/test_digest_router.py tests/test_endpoint_concurrency.py -v`
Expected: 全部 PASS（`test_endpoint_concurrency` 確認兩支都是 `def`）

- [ ] **Step 5: 後端全套檢查**

Run: `cd sidecar && .venv/bin/ruff check . && .venv/bin/mypy . --config-file mypy.ini && STARSCOPE_DATA_DIR=$TMPDIR/ss PYTHON_KEYRING_BACKEND=keyring.backends.null.Keyring GITHUB_TOKEN= .venv/bin/python -m pytest tests/ -q`
Expected: ruff／mypy 無錯誤，pytest 全過

- [ ] **Step 6: Commit**（先取得使用者授權）

```bash
git add sidecar/routers/digest.py sidecar/routers/__init__.py sidecar/main.py sidecar/tests/test_digest_router.py
git commit -m "feat(sidecar): GET /api/digest and POST /api/digest/seen"
```

- [ ] **Step 7: 階段閘門**——送 code-reviewer 審 Task 1–4，findings 修完（並重新驗證）才進 Task 5

---

### Task 5: 前端型別、API client、query key、合併函式

**Files:**
- Modify: `src/api/types.ts`、`src/api/client.ts`、`src/lib/react-query.ts`
- Create: `src/utils/digest.ts`
- Test: `src/utils/__tests__/digest.test.ts`

**Interfaces:**
- Consumes: Task 4 的 API
- Produces:
  - 型別 `DigestCursor`、`DigestRepoRef`、`DigestItem`（`kind` 為 discriminant 的 union）、`DigestResponse`（皆經 `src/api/client.ts` 的 `export * from "./types"` 對外）
  - `getDigest(signal?: AbortSignal): Promise<DigestResponse>`、`markDigestSeen(cursor: DigestCursor): Promise<DigestCursor>`
  - `queryKeys.digest.session()` → `["digest", "session"]`（**不在** `queryKeys.dashboard.all` 底下：Dashboard 的 refresh 會 invalidate 那一整棵，重抓只會回新項目、把這批蓋掉）
  - `mergeDigest(prev: DigestResponse, next: DigestResponse): DigestResponse`、`hasHighlights(d: DigestResponse | undefined): boolean`

- [ ] **Step 1: Write the failing test**

`src/utils/__tests__/digest.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { mergeDigest, hasHighlights } from "../digest";
import type { DigestItem, DigestResponse } from "../../api/client";

const repo = { id: 1, full_name: "o/r", url: "https://github.com/o/r" };

function release(key: string, tier: "highlight" | "other", occurredAt: string): DigestItem {
  return { key, tier, kind: "release", repo, occurred_at: occurredAt, url: null, title: key, tags: [] };
}

function digest(items: DigestItem[], over: Partial<DigestResponse> = {}): DigestResponse {
  return {
    items,
    other_total: items.filter((i) => i.tier === "other").length,
    cursor: { context_signal_id: 1, early_signal_id: 0, triggered_alert_id: 0 },
    last_seen_at: "2026-09-22T00:00:00+00:00",
    releases_checked: true,
    ...over,
  };
}

describe("mergeDigest", () => {
  it("appends new items, keeps the session's last_seen_at, takes the newer cursor", () => {
    const prev = digest([release("release:1", "other", "2026-09-24T00:00:00+00:00")]);
    const next = digest([release("release:2", "highlight", "2026-09-25T00:00:00+00:00")], {
      cursor: { context_signal_id: 2, early_signal_id: 0, triggered_alert_id: 0 },
      last_seen_at: "2026-09-25T09:00:00+00:00",
    });

    const merged = mergeDigest(prev, next);

    // 重點在前，接著其他更新；同層新到舊
    expect(merged.items.map((i) => i.key)).toEqual(["release:2", "release:1"]);
    expect(merged.cursor.context_signal_id).toBe(2);
    // 「上次看過」要停在這次開 app 之前的那個時間，不能被剛剛自己推進的游標蓋掉
    expect(merged.last_seen_at).toBe("2026-09-22T00:00:00+00:00");
    expect(merged.other_total).toBe(1);
  });

  it("does not duplicate an item that arrives twice", () => {
    const item = release("release:1", "other", "2026-09-24T00:00:00+00:00");

    const merged = mergeDigest(digest([item]), digest([item]));

    expect(merged.items).toHaveLength(1);
    expect(merged.other_total).toBe(1);
  });
});

describe("hasHighlights", () => {
  it("is true only when there is at least one highlight", () => {
    expect(hasHighlights(undefined)).toBe(false);
    expect(hasHighlights(digest([release("release:1", "other", "2026-09-24T00:00:00+00:00")]))).toBe(false);
    expect(hasHighlights(digest([release("release:1", "highlight", "2026-09-24T00:00:00+00:00")]))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/digest.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 3: Implement**

`src/api/types.ts` 末尾：

```ts
/** 「自上次以來」摘要看到哪：三張來源表各自的最大 id */
export interface DigestCursor {
  context_signal_id: number;
  early_signal_id: number;
  triggered_alert_id: number;
}

export interface DigestRepoRef {
  id: number;
  full_name: string;
  url: string;
}

interface DigestItemBase {
  /** `來源:id`，例如 `release:1290` */
  key: string;
  tier: "highlight" | "other";
  repo: DigestRepoRef;
  /** 事件本身的時間，帶 +00:00 */
  occurred_at: string;
  /** release／HN 的網址；訊號與警報為 null（點擊改開 repo.url） */
  url: string | null;
}

export interface DigestReleaseItem extends DigestItemBase {
  kind: "release";
  title: string;
  tags: string[];
}

export interface DigestHnItem extends DigestItemBase {
  kind: "hn";
  title: string;
  score: number | null;
}

export interface DigestSignalItem extends DigestItemBase {
  kind: "signal";
  signal: EarlySignal;
}

export interface DigestAlertItem extends DigestItemBase {
  kind: "alert";
  rule_name: string;
  signal_type: string;
  operator: string;
  threshold: number;
  value: number;
}

export type DigestItem = DigestReleaseItem | DigestHnItem | DigestSignalItem | DigestAlertItem;

export interface DigestResponse {
  items: DigestItem[];
  /** 其他更新的總數；items 裡最多只有 50 條 */
  other_total: number;
  cursor: DigestCursor;
  last_seen_at: string | null;
  releases_checked: boolean;
}
```

`src/api/client.ts`（放在 `getWeeklySummary` 之後）：

```ts
/** 自上次看過之後的事件；不會推進游標 */
export async function getDigest(signal?: AbortSignal): Promise<DigestResponse> {
  return apiCall<DigestResponse>("/digest", { signal });
}

/** 推進游標到這批回應的 cursor（不是送出當下的最大 id，見 spec） */
export async function markDigestSeen(cursor: DigestCursor): Promise<DigestCursor> {
  return apiCall<DigestCursor>("/digest/seen", {
    method: "POST",
    body: JSON.stringify({ cursor }),
  });
}
```

並把 `DigestCursor`、`DigestResponse` 加進 `client.ts:77` 那個 `from "./types"` 的具名 import。

`src/lib/react-query.ts` 的 `queryKeys` 加：

```ts
  // 「自上次以來」摘要：刻意不放在 dashboard 底下——Dashboard 的 refresh 會 invalidate
  // 整個 dashboard，重抓只會回新項目，會把使用者正在看的這批蓋掉
  digest: {
    session: () => ["digest", "session"] as const,
  },
```

`src/utils/digest.ts`：

```ts
/**
 * 「自上次以來」摘要的純函式。
 */
import type { DigestItem, DigestResponse } from "../api/client";

function byTierThenNewest(a: DigestItem, b: DigestItem): number {
  if (a.tier !== b.tier) return a.tier === "highlight" ? -1 : 1;
  return b.occurred_at.localeCompare(a.occurred_at);
}

/** 重整後把新抓到的附加到這次開 app 的那批；last_seen_at 保留開 app 當時的值 */
export function mergeDigest(prev: DigestResponse, next: DigestResponse): DigestResponse {
  const seen = new Set(prev.items.map((i) => i.key));
  const added = next.items.filter((i) => !seen.has(i.key));
  const addedOthers = added.filter((i) => i.tier === "other").length;
  return {
    items: [...prev.items, ...added].sort(byTierThenNewest),
    other_total: prev.other_total + addedOthers,
    cursor: {
      context_signal_id: Math.max(prev.cursor.context_signal_id, next.cursor.context_signal_id),
      early_signal_id: Math.max(prev.cursor.early_signal_id, next.cursor.early_signal_id),
      triggered_alert_id: Math.max(prev.cursor.triggered_alert_id, next.cursor.triggered_alert_id),
    },
    last_seen_at: prev.last_seen_at,
    releases_checked: next.releases_checked,
  };
}

export function hasHighlights(digest: DigestResponse | undefined): boolean {
  return digest?.items.some((i) => i.tier === "highlight") ?? false;
}
```

注意 `other_total` 的合併：後端 `other_total` 含被 50 條上限截掉的；附加時只加「這次真的新增進來」的其他更新數，對應 `next` 被截掉的部分會遺失計數。附加的量是一次重整之間的新事件（每天約 4 個 release），不會碰到 50 的上限，接受這個簡化。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/__tests__/digest.test.ts && npm run type-check`
Expected: PASS，型別無錯

- [ ] **Step 5: Commit**（先取得使用者授權）

```bash
git add src/api/types.ts src/api/client.ts src/lib/react-query.ts src/utils/digest.ts src/utils/__tests__/digest.test.ts
git commit -m "feat: digest API client, types and merge helper"
```

---

### Task 6: 摘要文案與 i18n

**Files:**
- Modify: `src/i18n/translations.ts`（`en.dashboard` 與 `zh-TW.dashboard` 各加 `digest`）
- Create: `src/utils/digestCopy.ts`
- Test: `src/utils/__tests__/digestCopy.test.ts`

**Interfaces:**
- Consumes: Task 5 的 `DigestItem`；`formatSignalDescription(signal, t)`（`src/utils/signalCopy.ts`）；`getSignalDisplayName(type, t.dashboard.signals.types)`（`src/utils/signalTypeHelpers.ts`）；`t.dashboard.weekly.releaseTags`
- Produces: `describeDigestItem(item: DigestItem, t: TranslationKeys): { icon: string; summary: string }`；`t.dashboard.digest.*` 鍵：`title`、`none`、`lastSeen`、`firstVisit`、`checking`、`noAlertRules`、`loadFailed`、`retry`、`others`、`moreOthers`、`appendFailed`、`hnSummary`、`alertSummary`

- [ ] **Step 1: Write the failing test**

`src/utils/__tests__/digestCopy.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { translations } from "../../i18n/translations";
import { describeDigestItem } from "../digestCopy";
import type { DigestItem } from "../../api/client";

const t = translations.en;
const repo = { id: 1, full_name: "o/r", url: "https://github.com/o/r" };
const base = { repo, occurred_at: "2026-09-25T00:00:00+00:00", url: null, tier: "highlight" as const };

describe("describeDigestItem", () => {
  it("release: title plus localized tags", () => {
    const item: DigestItem = { ...base, key: "release:1", kind: "release", title: "v3.0.0", tags: ["breaking", "security"] };
    expect(describeDigestItem(item, t).summary).toBe("v3.0.0 — breaking · security");
  });

  it("release without tags is just the title", () => {
    const item: DigestItem = { ...base, key: "release:1", kind: "release", title: "v1.2.3", tags: [] };
    expect(describeDigestItem(item, t).summary).toBe("v1.2.3");
  });

  it("hn: score and title", () => {
    const item: DigestItem = { ...base, key: "hn:1", kind: "hn", title: "uv is fast", score: 312 };
    expect(describeDigestItem(item, t).summary).toBe("HN discussion, 312 points: uv is fast");
  });

  it("signal: reuses the early signal copy", () => {
    const item: DigestItem = {
      ...base, key: "signal:1", kind: "signal",
      signal: {
        id: 1, repo_id: 1, repo_name: "o/r", signal_type: "sudden_spike", severity: "high",
        description: "fallback", velocity_value: 1240, star_count: 9000, percentile_rank: null,
        baseline_value: 80, context_title: null, detected_at: "2026-09-25T00:00:00",
        expires_at: null, acknowledged: false, acknowledged_at: null,
      },
    };
    expect(describeDigestItem(item, t).summary).toContain("1,240");
  });

  it("alert: rule name and the value that triggered it", () => {
    const item: DigestItem = {
      ...base, key: "alert:1", kind: "alert", rule_name: "fast", signal_type: "velocity",
      operator: ">", threshold: 10, value: 42,
    };
    expect(describeDigestItem(item, t).summary).toContain("fast");
    expect(describeDigestItem(item, t).summary).toContain("42");
  });

  it("zh-TW has every digest key the English copy has", () => {
    expect(Object.keys(translations["zh-TW"].dashboard.digest).sort()).toEqual(
      Object.keys(translations.en.dashboard.digest).sort()
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/digestCopy.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

`src/i18n/translations.ts`：`en.dashboard` 裡、`attention` 之後加：

```ts
      digest: {
        title: "{count} new since your last visit",
        none: "Nothing worth your attention since your last visit",
        lastSeen: "last visit {time} ago",
        firstVisit: "last 3 days",
        checking: "Still checking — releases not fetched yet",
        noAlertRules: "no alert rules set",
        loadFailed: "Couldn't load what's new",
        retry: "Retry",
        others: "Other updates ({count})",
        moreOthers: "{count} more not shown",
        appendFailed: "Couldn't check for newer updates — they'll show next time",
        hnSummary: "HN discussion, {score} points: {title}",
        alertSummary: "{rule}: {signal} {operator} {threshold} (now {value})",
      },
```

`zh-TW.dashboard` 同位置：

```ts
      digest: {
        title: "自上次以來有 {count} 件事",
        none: "自上次以來沒有值得注意的變化",
        lastSeen: "上次看過 {time}前",
        firstVisit: "最近 3 天",
        checking: "正在檢查（版本資料尚未抓取）",
        noAlertRules: "未設定警報規則",
        loadFailed: "摘要載入失敗",
        retry: "重試",
        others: "其他更新（{count}）",
        moreOthers: "還有 {count} 條未顯示",
        appendFailed: "無法檢查更新的項目，下次開啟會補上",
        hnSummary: "HN 討論 {score} 分：{title}",
        alertSummary: "{rule}：{signal} {operator} {threshold}（目前 {value}）",
      },
```

`src/utils/digestCopy.ts`：

```ts
/**
 * 摘要每一列的圖示與一句話結論。後端只給結構化欄位，文案在這裡依語系產生。
 */
import type { DigestItem } from "../api/client";
import { interpolate, type TranslationKeys } from "../i18n";
import { formatNumber } from "./format";
import { formatSignalDescription } from "./signalCopy";
import { getSignalDisplayName } from "./signalTypeHelpers";

const ICONS: Record<DigestItem["kind"], string> = {
  release: "📦",
  hn: "💬",
  signal: "🔥",
  alert: "🔔",
};

export function describeDigestItem(
  item: DigestItem,
  t: TranslationKeys
): { icon: string; summary: string } {
  const copy = t.dashboard.digest;
  switch (item.kind) {
    case "release": {
      const tags = item.tags
        .map(
          (tag) =>
            t.dashboard.weekly.releaseTags[tag as keyof typeof t.dashboard.weekly.releaseTags] ?? tag
        )
        .join(" · ");
      const security = item.tags.includes("security") || item.tags.includes("breaking");
      return { icon: security ? "🔴" : ICONS.release, summary: tags ? `${item.title} — ${tags}` : item.title };
    }
    case "hn":
      return {
        icon: ICONS.hn,
        summary: interpolate(copy.hnSummary, {
          score: item.score == null ? "?" : formatNumber(item.score),
          title: item.title,
        }),
      };
    case "signal":
      return { icon: ICONS.signal, summary: formatSignalDescription(item.signal, t) };
    case "alert":
      return {
        icon: ICONS.alert,
        summary: interpolate(copy.alertSummary, {
          rule: item.rule_name,
          signal: getSignalDisplayName(item.signal_type, t.dashboard.signals.types),
          operator: item.operator,
          threshold: item.threshold,
          value: item.value,
        }),
      };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/__tests__/digestCopy.test.ts && npm run type-check`
Expected: PASS

- [ ] **Step 5: Commit**（先取得使用者授權）

```bash
git add src/i18n/translations.ts src/utils/digestCopy.ts src/utils/__tests__/digestCopy.test.ts
git commit -m "feat: digest row copy in English and Traditional Chinese"
```

---

### Task 7: `useDigest` hook

**Files:**
- Create: `src/hooks/useDigest.ts`
- Test: `src/hooks/__tests__/useDigest.test.tsx`

**Interfaces:**
- Consumes: Task 5 的 `getDigest`、`markDigestSeen`、`queryKeys.digest.session()`、`mergeDigest`
- Produces: `useDigest({ isFetchInProgress }: { isFetchInProgress: boolean }) => { digest: DigestResponse | undefined; isLoading: boolean; isError: boolean; retry: () => void; appendNew: () => Promise<void>; appendFailed: boolean }`

行為：
- query 設定：`staleTime: Infinity`、`gcTime: Infinity`、`refetchOnWindowFocus: false`、`refetchOnReconnect: false`、`refetchOnMount: false`——整個 app session 只抓一次
- 每個尚未送過的 `digest.cursor` 送一次 `markDigestSeen`（hook 掛在 Dashboard 上＝使用者看得到的時候才送）；query 失敗時不送
- `appendNew()`：`getDigest()` → `setQueryData(mergeDigest(prev, next))`；失敗時 `appendFailed = true`、不動既有這批
- `isFetchInProgress` 由 `true` 轉 `false`（排程或手動抓取完成）時自動 `appendNew()`

- [ ] **Step 1: Write the failing test**

`src/hooks/__tests__/useDigest.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useDigest } from "../useDigest";
import { getDigest, markDigestSeen } from "../../api/client";
import type { DigestResponse } from "../../api/client";

vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  getDigest: vi.fn(),
  markDigestSeen: vi.fn(),
}));

const repo = { id: 1, full_name: "o/r", url: "https://github.com/o/r" };

function batch(key: string, cursorId: number): DigestResponse {
  return {
    items: [{ key, tier: "highlight", kind: "release", repo, occurred_at: "2026-09-25T00:00:00+00:00", url: null, title: key, tags: ["security"] }],
    other_total: 0,
    cursor: { context_signal_id: cursorId, early_signal_id: 0, triggered_alert_id: 0 },
    last_seen_at: "2026-09-22T00:00:00+00:00",
    releases_checked: true,
  };
}

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useDigest", () => {
  beforeEach(() => {
    vi.mocked(getDigest).mockReset();
    vi.mocked(markDigestSeen).mockReset();
    vi.mocked(markDigestSeen).mockImplementation(async (c) => c);
  });

  it("marks the batch it received as seen, exactly once", async () => {
    vi.mocked(getDigest).mockResolvedValue(batch("release:1", 1));

    const { result, rerender } = renderHook(() => useDigest({ isFetchInProgress: false }), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.digest).toBeDefined());
    rerender();
    await waitFor(() => expect(markDigestSeen).toHaveBeenCalledTimes(1));
    expect(markDigestSeen).toHaveBeenCalledWith({ context_signal_id: 1, early_signal_id: 0, triggered_alert_id: 0 });
  });

  it("does not mark anything seen when loading fails", async () => {
    vi.mocked(getDigest).mockRejectedValue(new Error("500"));

    const { result } = renderHook(() => useDigest({ isFetchInProgress: false }), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(markDigestSeen).not.toHaveBeenCalled();
  });

  it("appendNew keeps what is on screen and adds the newer items", async () => {
    vi.mocked(getDigest).mockResolvedValueOnce(batch("release:1", 1)).mockResolvedValueOnce(batch("release:2", 2));

    const { result } = renderHook(() => useDigest({ isFetchInProgress: false }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.digest).toBeDefined());

    await act(() => result.current.appendNew());

    expect(result.current.digest?.items.map((i) => i.key).sort()).toEqual(["release:1", "release:2"]);
    await waitFor(() =>
      expect(markDigestSeen).toHaveBeenLastCalledWith({ context_signal_id: 2, early_signal_id: 0, triggered_alert_id: 0 })
    );
  });

  it("a failed append keeps the batch and says so", async () => {
    vi.mocked(getDigest).mockResolvedValueOnce(batch("release:1", 1)).mockRejectedValueOnce(new Error("offline"));

    const { result } = renderHook(() => useDigest({ isFetchInProgress: false }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.digest).toBeDefined());

    await act(() => result.current.appendNew());

    expect(result.current.digest?.items.map((i) => i.key)).toEqual(["release:1"]);
    expect(result.current.appendFailed).toBe(true);
  });

  it("appends automatically when a fetch finishes", async () => {
    vi.mocked(getDigest).mockResolvedValueOnce(batch("release:1", 1)).mockResolvedValueOnce(batch("release:2", 2));

    const { result, rerender } = renderHook(
      ({ busy }: { busy: boolean }) => useDigest({ isFetchInProgress: busy }),
      { wrapper: wrapper(), initialProps: { busy: false } }
    );
    await waitFor(() => expect(result.current.digest).toBeDefined());

    rerender({ busy: true });
    rerender({ busy: false });

    await waitFor(() => expect(result.current.digest?.items).toHaveLength(2));
  });

  it("does not append on the first render just because the fetch flag starts false", async () => {
    vi.mocked(getDigest).mockResolvedValue(batch("release:1", 1));

    renderHook(() => useDigest({ isFetchInProgress: false }), { wrapper: wrapper() });

    await waitFor(() => expect(getDigest).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(getDigest).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/__tests__/useDigest.test.tsx`
Expected: FAIL（module not found）

- [ ] **Step 3: Implement**

`src/hooks/useDigest.ts`：

```ts
/**
 * 「自上次以來」摘要：整個 app session 抓一次，顯示後推進游標，重整只附加。
 *
 * 這個 hook 掛在 Dashboard 上——掛上＝使用者看得到，才送 seen。啟動頁的預抓
 * （useStartupPage）只讀同一個 query key，不送 seen。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDigest, markDigestSeen } from "../api/client";
import type { DigestResponse } from "../api/client";
import { queryKeys } from "../lib/react-query";
import { mergeDigest } from "../utils/digest";
import { logger } from "../utils/logger";

interface UseDigestOptions {
  /** diagnostics 的 fetch_in_progress；由 true 轉 false＝抓取完成，附加新項目 */
  isFetchInProgress: boolean;
}

export function useDigest({ isFetchInProgress }: UseDigestOptions) {
  const qc = useQueryClient();
  const key = queryKeys.digest.session();
  const [appendFailed, setAppendFailed] = useState(false);

  const query = useQuery<DigestResponse>({
    queryKey: key,
    queryFn: ({ signal }) => getDigest(signal),
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  // 每個 cursor 只送一次；StrictMode 重跑 effect、rerender 都不重送
  const sentCursorRef = useRef<string | null>(null);
  useEffect(() => {
    if (!query.data) return;
    const cursorKey = JSON.stringify(query.data.cursor);
    if (sentCursorRef.current === cursorKey) return;
    sentCursorRef.current = cursorKey;
    markDigestSeen(query.data.cursor).catch((err: unknown) => {
      // 送不出去只代表下次會再看到同一批，不影響這次的畫面
      logger.warn("[Digest] 推進游標失敗:", err);
    });
  }, [query.data]);

  const appendNew = useCallback(async () => {
    try {
      const next = await getDigest();
      qc.setQueryData<DigestResponse>(key, (prev) => (prev ? mergeDigest(prev, next) : next));
      setAppendFailed(false);
    } catch (err) {
      logger.warn("[Digest] 附加新項目失敗:", err);
      setAppendFailed(true);
    }
    // key 是常數陣列，每次 render 新建；以 qc 為依賴即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc]);

  const wasFetchingRef = useRef(isFetchInProgress);
  useEffect(() => {
    const was = wasFetchingRef.current;
    wasFetchingRef.current = isFetchInProgress;
    if (was && !isFetchInProgress && query.data) void appendNew();
  }, [isFetchInProgress, appendNew, query.data]);

  return {
    digest: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    retry: () => void query.refetch(),
    appendNew,
    appendFailed,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/__tests__/useDigest.test.tsx && npm run lint`
Expected: PASS；lint 無警告（若 `eslint-disable` 那行被判為多餘，改成把 `key` 移到 hook 外的模組常數 `const DIGEST_KEY = queryKeys.digest.session();` 並拿掉 disable）

- [ ] **Step 5: Commit**（先取得使用者授權）

```bash
git add src/hooks/useDigest.ts src/hooks/__tests__/useDigest.test.tsx
git commit -m "feat: useDigest keeps one batch per app session and appends after fetches"
```

---

### Task 8: `DigestPanel` 元件

**Files:**
- Create: `src/components/dashboard/DigestPanel.tsx`
- Modify: `src/App.css:4638-4722`（`.attention-*` 改名為 `.digest-*`，並新增收合區塊樣式）
- Test: `src/components/dashboard/__tests__/DigestPanel.test.tsx`

**Interfaces:**
- Consumes: Task 5 型別、Task 6 `describeDigestItem`、`formatRelativeTime(input, { justNowText, suffix })`（`src/utils/format.ts`）、`safeOpenUrl`（`src/utils/url.ts`）
- Produces: `DigestPanel` props：
  ```ts
  interface DigestPanelProps {
    digest: DigestResponse | undefined;
    isLoading: boolean;
    isError: boolean;
    appendFailed: boolean;
    onRetry: () => void;
    totalRepos: number;
    hasAlertRules: boolean;
    updatedLabel: string;
    isRefreshing: boolean;
    onRefresh: () => void;
  }
  ```
  `data-testid`：`digest-panel`、`digest-item`、`digest-others-toggle`、`digest-retry`

- [ ] **Step 1: Write the failing test**

`src/components/dashboard/__tests__/DigestPanel.test.tsx`：

```tsx
/**
 * 這是整頁唯一「你可以不看」的地方：宣稱沒事之前要先確定檢查跑得起來，
 * 失敗時更不能落到「沒事」。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DigestPanel } from "../DigestPanel";
import type { DigestItem, DigestResponse } from "../../../api/client";
import { safeOpenUrl } from "../../../utils/url";

vi.mock("../../../utils/url", () => ({ safeOpenUrl: vi.fn() }));

const repo = { id: 1, full_name: "tauri-apps/tauri", url: "https://github.com/tauri-apps/tauri" };

function item(key: string, tier: "highlight" | "other", over: Partial<DigestItem> = {}): DigestItem {
  return { key, tier, kind: "release", repo, occurred_at: new Date().toISOString(), url: "https://example.com/" + key, title: key, tags: [], ...over } as DigestItem;
}

function digest(items: DigestItem[], over: Partial<DigestResponse> = {}): DigestResponse {
  return {
    items,
    other_total: items.filter((i) => i.tier === "other").length,
    cursor: { context_signal_id: 1, early_signal_id: 0, triggered_alert_id: 0 },
    last_seen_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    releases_checked: true,
    ...over,
  };
}

const base = {
  isLoading: false, isError: false, appendFailed: false, onRetry: () => {},
  totalRepos: 98, hasAlertRules: true, updatedLabel: "5m", isRefreshing: false, onRefresh: () => {},
};

describe("DigestPanel", () => {
  it("while loading it never says nothing happened", () => {
    render(<DigestPanel {...base} digest={undefined} isLoading />);
    expect(screen.getByTestId("digest-panel")).not.toHaveTextContent(/nothing worth/i);
  });

  it("a failed load shows the failure and a retry, not 'nothing'", () => {
    const onRetry = vi.fn();
    render(<DigestPanel {...base} digest={undefined} isError onRetry={onRetry} />);

    const panel = screen.getByTestId("digest-panel");
    expect(panel).toHaveTextContent(/couldn't load/i);
    expect(panel).not.toHaveTextContent(/nothing worth/i);
    fireEvent.click(screen.getByTestId("digest-retry"));
    expect(onRetry).toHaveBeenCalled();
  });

  it("before releases were ever fetched it says it is still checking", () => {
    render(<DigestPanel {...base} digest={digest([], { releases_checked: false })} />);
    expect(screen.getByTestId("digest-panel")).toHaveTextContent(/still checking/i);
    expect(screen.getByTestId("digest-panel")).not.toHaveTextContent(/nothing worth/i);
  });

  it("empty: says so, with when you last looked", () => {
    render(<DigestPanel {...base} digest={digest([])} />);
    const panel = screen.getByTestId("digest-panel");
    expect(panel).toHaveTextContent(/nothing worth your attention/i);
    expect(panel).toHaveTextContent(/3d/);
    expect(panel).not.toHaveTextContent(/no alert rules/i);
  });

  it("empty without alert rules says that too", () => {
    render(<DigestPanel {...base} hasAlertRules={false} digest={digest([])} />);
    expect(screen.getByTestId("digest-panel")).toHaveTextContent(/no alert rules/i);
  });

  it("highlights are listed; others are collapsed with a count", () => {
    render(<DigestPanel {...base} digest={digest([item("release:1", "highlight", { tags: ["security"] } as Partial<DigestItem>), item("release:2", "other"), item("release:3", "other")])} />);

    expect(screen.getAllByTestId("digest-item")).toHaveLength(1);
    const toggle = screen.getByTestId("digest-others-toggle");
    expect(toggle).toHaveTextContent("2");
    fireEvent.click(toggle);
    expect(screen.getAllByTestId("digest-item")).toHaveLength(3);
  });

  it("says how many others were cut off", () => {
    render(<DigestPanel {...base} digest={digest([item("release:2", "other")], { other_total: 60 })} />);
    fireEvent.click(screen.getByTestId("digest-others-toggle"));
    expect(screen.getByTestId("digest-panel")).toHaveTextContent(/59 more/i);
  });

  it("clicking a release opens its page; a signal opens the repo on GitHub", () => {
    render(<DigestPanel {...base} digest={digest([
      item("release:1", "highlight", { tags: ["breaking"] } as Partial<DigestItem>),
      item("signal:1", "highlight", {
        kind: "signal", url: null,
        signal: { id: 1, repo_id: 1, repo_name: repo.full_name, signal_type: "breakout", severity: "high", description: "d", velocity_value: 30, star_count: 1, percentile_rank: null, baseline_value: 10, context_title: null, detected_at: "2026-09-25T00:00:00", expires_at: null, acknowledged: false, acknowledged_at: null },
      } as Partial<DigestItem>),
    ])} />);

    const [release, signal] = screen.getAllByTestId("digest-item");
    fireEvent.click(release.querySelector("a") as HTMLAnchorElement);
    fireEvent.click(signal.querySelector("a") as HTMLAnchorElement);
    expect(safeOpenUrl).toHaveBeenNthCalledWith(1, "https://example.com/release:1");
    expect(safeOpenUrl).toHaveBeenNthCalledWith(2, repo.url);
  });

  it("a failed append is visible", () => {
    render(<DigestPanel {...base} appendFailed digest={digest([])} />);
    expect(screen.getByTestId("digest-panel")).toHaveTextContent(/next time/i);
  });

  it("keeps the tracking count, freshness and the refresh button", () => {
    const onRefresh = vi.fn();
    render(<DigestPanel {...base} onRefresh={onRefresh} digest={digest([])} />);
    const panel = screen.getByTestId("digest-panel");
    expect(panel).toHaveTextContent("98");
    expect(panel).toHaveTextContent("5m");
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(onRefresh).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/dashboard/__tests__/DigestPanel.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement**

`src/components/dashboard/DigestPanel.tsx`：

```tsx
/**
 * 段一：自上次以來。取代 AttentionBar。
 *
 * 必須經常是空的——每天都亮的東西等於壁紙，所以一般 release 收在「其他更新」。
 * 而空的時候不能只說「沒事」：這是整頁唯一「你可以不看」的承諾，
 * 載入中、release 從未抓過、API 失敗時都不能宣稱沒事。
 */
import { memo, useState } from "react";
import type { DigestItem, DigestResponse } from "../../api/client";
import { useI18n, interpolate } from "../../i18n";
import { describeDigestItem } from "../../utils/digestCopy";
import { formatRelativeTime } from "../../utils/format";
import { safeOpenUrl } from "../../utils/url";

interface DigestPanelProps {
  digest: DigestResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  appendFailed: boolean;
  onRetry: () => void;
  totalRepos: number;
  hasAlertRules: boolean;
  updatedLabel: string;
  isRefreshing: boolean;
  onRefresh: () => void;
}

function DigestRow({ item }: { item: DigestItem }) {
  const { t } = useI18n();
  const { icon, summary } = describeDigestItem(item, t);
  const target = item.url ?? item.repo.url;
  return (
    <li className="digest-item" data-testid="digest-item">
      <span className="digest-item-icon" aria-hidden="true">{icon}</span>
      <a
        href={target}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          e.preventDefault();
          void safeOpenUrl(target);
        }}
      >
        {item.repo.full_name}
      </a>
      <span className="digest-item-summary">{summary}</span>
      <span className="digest-item-time">{formatRelativeTime(item.occurred_at)}</span>
    </li>
  );
}

export const DigestPanel = memo(function DigestPanel({
  digest,
  isLoading,
  isError,
  appendFailed,
  onRetry,
  totalRepos,
  hasAlertRules,
  updatedLabel,
  isRefreshing,
  onRefresh,
}: DigestPanelProps) {
  const { t } = useI18n();
  const copy = t.dashboard.digest;
  const [othersOpen, setOthersOpen] = useState(false);

  const highlights = digest?.items.filter((i) => i.tier === "highlight") ?? [];
  const others = digest?.items.filter((i) => i.tier === "other") ?? [];
  const since = digest?.last_seen_at
    ? interpolate(copy.lastSeen, { time: formatRelativeTime(digest.last_seen_at) })
    : copy.firstVisit;

  let status: string;
  if (isError) status = copy.loadFailed;
  else if (isLoading || !digest) status = "";
  else if (!digest.releases_checked && highlights.length === 0) status = copy.checking;
  else if (highlights.length > 0) status = interpolate(copy.title, { count: highlights.length });
  else status = hasAlertRules ? copy.none : `${copy.none} · ${copy.noAlertRules}`;

  return (
    <section className="digest-panel" data-testid="digest-panel" aria-busy={isLoading}>
      <div className="digest-status">
        <span className="digest-status-text">
          {isLoading ? <span className="skeleton skeleton-text" /> : status}
        </span>
        {digest && !isError && <span className="digest-status-since">{since}</span>}
        {isError && (
          <button type="button" className="digest-retry" data-testid="digest-retry" onClick={onRetry}>
            {copy.retry}
          </button>
        )}
        <span className="digest-status-meta">
          {interpolate(t.dashboard.attention.tracking, { count: totalRepos })} ·{" "}
          {isRefreshing ? t.dashboard.attention.fetching : updatedLabel}
        </span>
        <button
          type="button"
          className="digest-refresh"
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-busy={isRefreshing}
          aria-label={t.common.refresh}
        >
          ↻
        </button>
      </div>
      {appendFailed && <p className="digest-append-failed">{copy.appendFailed}</p>}
      {highlights.length > 0 && (
        <ul className="digest-list">
          {highlights.map((item) => (
            <DigestRow key={item.key} item={item} />
          ))}
        </ul>
      )}
      {digest && digest.other_total > 0 && (
        <div className="digest-others">
          <button
            type="button"
            className="digest-others-toggle"
            data-testid="digest-others-toggle"
            aria-expanded={othersOpen}
            onClick={() => setOthersOpen((open) => !open)}
          >
            {othersOpen ? "▾" : "▸"} {interpolate(copy.others, { count: digest.other_total })}
          </button>
          {othersOpen && (
            <ul className="digest-list digest-list--others">
              {others.map((item) => (
                <DigestRow key={item.key} item={item} />
              ))}
              {digest.other_total > others.length && (
                <li className="digest-more">
                  {interpolate(copy.moreOthers, { count: digest.other_total - others.length })}
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </section>
  );
});
```

`src/App.css:4638-4722`：把 `.attention-bar`、`.attention-status`、`.attention-status-text`、`.attention-status-meta`、`.attention-refresh`（含 `:hover`、`:disabled`）、`.attention-list`、`.attention-item`、`.attention-item-detail` 依序改名為 `.digest-panel`、`.digest-status`、`.digest-status-text`、`.digest-status-meta`、`.digest-refresh`、`.digest-list`、`.digest-item`、`.digest-item-summary`，規則內容不變；接著在同一區塊末尾加：

```css
.digest-status-since,
.digest-item-time,
.digest-more {
  font-size: 13px;
  color: var(--fg-muted);
}

.digest-item-icon {
  flex: none;
}

.digest-others-toggle,
.digest-retry {
  background: none;
  border: none;
  color: var(--fg-muted);
  cursor: pointer;
  padding: 0;
  font: inherit;
}

.digest-append-failed {
  font-size: 13px;
  color: var(--warning-fg);
  margin: 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/dashboard/__tests__/DigestPanel.test.tsx && npm run lint && npm run type-check`
Expected: PASS

- [ ] **Step 5: Commit**（先取得使用者授權）

```bash
git add src/components/dashboard/DigestPanel.tsx src/components/dashboard/__tests__/DigestPanel.test.tsx src/App.css
git commit -m "feat: DigestPanel shows what changed since the last visit"
```

---

### Task 9: Dashboard 換上 DigestPanel，移除 AttentionBar

**Files:**
- Modify: `src/pages/Dashboard.tsx:180-360`
- Modify: `src/hooks/useDashboard.ts:262-310`（移除 `attentionItems`、`releasesChecked`）
- Delete: `src/components/dashboard/AttentionBar.tsx`、`src/components/dashboard/__tests__/AttentionBar.test.tsx`
- Modify: `src/components/dashboard/WidgetCustomizer.tsx:33`（註解裡的 AttentionBar 改成 DigestPanel）
- Modify: `src/pages/__tests__/Dashboard.test.tsx`、`src/hooks/__tests__/useDashboard.test.ts`

**Interfaces:**
- Consumes: Task 7 `useDigest({ isFetchInProgress })`、Task 8 `DigestPanel`
- Produces: Dashboard 最上方渲染 `DigestPanel`；`useDashboard` 不再回傳 `attentionItems` 與 `releasesChecked`

- [ ] **Step 1: 改 Dashboard 測試成預期的新行為（先紅）**

`src/pages/__tests__/Dashboard.test.tsx`：
- 移除 `AttentionItem` import 與 mock 回傳值裡的 `attentionItems`、`releasesChecked`
- 在檔案上方 mock `useDigest`（`vi.hoisted` 讓 factory 拿得到 `mockAppendNew`）：

```tsx
const { mockAppendNew } = vi.hoisted(() => ({ mockAppendNew: vi.fn(async () => {}) }));

vi.mock("../../hooks/useDigest", () => ({
  useDigest: () => ({
    digest: {
      items: [],
      other_total: 0,
      cursor: { context_signal_id: 0, early_signal_id: 0, triggered_alert_id: 0 },
      last_seen_at: null,
      releases_checked: true,
    },
    isLoading: false,
    isError: false,
    retry: () => {},
    appendNew: mockAppendNew,
    appendFailed: false,
  }),
}));
```

- 所有 `getByTestId("attention-bar")` 改為 `getByTestId("digest-panel")`；`"not fetched yet"`、`"fetch status unavailable"`、`"fetching from github"`、`"42m"` 這些斷言照舊（新鮮度標籤仍在面板上）
- 區段順序測試（原 `["attention-bar", "movers-empty", "weekly-releases"]`）改為 `["digest-panel", "movers-empty", "weekly-releases"]`
- 原本測「↻ 真的去 GitHub 抓再 invalidate」那條照舊（按鈕仍叫 refresh），在它的斷言最後加
  `expect(mockAppendNew).toHaveBeenCalledTimes(1);`，並另加一條把理由寫清楚：

```tsx
  it("refreshing appends newer digest items instead of invalidating the batch on screen", async () => {
    // 摘要若跟著 invalidate 重抓，只會拿到新項目，使用者正在看的那批會被整個換掉
    const user = userEvent.setup();
    render(<Dashboard />);
    await user.click(screen.getByRole("button", { name: /refresh/i }));
    expect(mockAppendNew).toHaveBeenCalledTimes(1);
  });
```

（每個測試前 `mockAppendNew.mockClear()`，放進該檔既有的 `beforeEach`。）

`src/hooks/__tests__/useDashboard.test.ts`：刪除所有 `attentionItems`／`releasesChecked` 的測試與斷言。

Run: `npx vitest run src/pages/__tests__/Dashboard.test.tsx`
Expected: FAIL（`digest-panel` 找不到）

- [ ] **Step 2: Implement**

`src/hooks/useDashboard.ts`：刪除 `attentionItems` 的 `useMemo`（`// 段一：只收「值得打斷你」的` 那段）與 `releasesChecked` 常數及其上方註解，並從 return 物件與回傳型別中移除這兩個欄位；`AttentionItem` 的 import 一併刪除。`weekly` 查詢保留（`WeeklySummary` widget 仍在用）。

`src/pages/Dashboard.tsx`：
- import：刪 `AttentionBar`，加 `import { DigestPanel } from "../components/dashboard/DigestPanel";` 與 `import { useDigest } from "../hooks/useDigest";`
- 解構 `useDashboard()` 時刪掉 `attentionItems`、`releasesChecked`
- 在 `isRefreshing` 之後：

```tsx
  const digest = useDigest({ isFetchInProgress });
```

- `handleRefresh` 改為：

```tsx
  const handleRefresh = useCallback(async () => {
    await refreshAll();
    refresh();
    // 摘要不走 invalidate：重抓只會回新項目，會把正在看的這批蓋掉
    await digest.appendNew();
  }, [refreshAll, refresh, digest]);
```

- `<AttentionBar … />` 整段換成：

```tsx
      <DigestPanel
        digest={digest.digest}
        isLoading={digest.isLoading}
        isError={digest.isError}
        appendFailed={digest.appendFailed}
        onRetry={digest.retry}
        totalRepos={stats.totalRepos}
        hasAlertRules={hasAlertRules}
        updatedLabel={freshnessLabel}
        isRefreshing={isRefreshing}
        onRefresh={handleRefresh}
      />
```

並把上方註解的「段一：需要注意」改為「段一：自上次以來」，其餘說明（取代統計卡、更新時間與重整只在這裡、不放進 FadeIn）保留。

刪除 `src/components/dashboard/AttentionBar.tsx` 與 `src/components/dashboard/__tests__/AttentionBar.test.tsx`；`WidgetCustomizer.tsx:33` 註解改為「DigestPanel 的狀態列」。

- [ ] **Step 3: 掃殘留引用**

Run: `git grep -nE "AttentionBar|attentionItems|releasesChecked|attention-bar|attention-item|attention-refresh|attention-status" -- src e2e`
Expected: 只剩 `src/i18n/translations.ts` 的 `attention` 文案鍵（`tracking`、`fetching` 仍被 DigestPanel 使用）；`title`／`clear`／`noAlertRules`／`checking` 若已無引用就從中英兩份刪掉，並再跑一次這條 grep 確認

- [ ] **Step 4: Run tests**

Run: `npx vitest run && npm run lint && npm run type-check`
Expected: 全部 PASS

- [ ] **Step 5: Commit**（先取得使用者授權）

```bash
git add -A src/pages src/hooks src/components/dashboard src/i18n
git commit -m "feat: the dashboard opens with the since-last-visit digest instead of the attention bar"
```

---

### Task 10: 有重點時啟動落在 Dashboard

**Files:**
- Create: `src/hooks/useStartupPage.ts`
- Modify: `src/App.tsx:59-117`
- Test: `src/hooks/__tests__/useStartupPage.test.tsx`

**Interfaces:**
- Consumes: `queryClient`（`src/lib/react-query.ts` 匯出、App 用的同一個實例）、`queryKeys.digest.session()`、`getDigest`、`hasHighlights`、`STORAGE_KEYS.PAGE`
- Produces: `resolveStartupPage(saved: Page, fetchDigest: () => Promise<DigestResponse>, timeoutMs = 1000): Promise<Page>`；`useStartupPage(saved: Page): Page | null`（null＝還在決定）

- [ ] **Step 1: Write the failing test**

`src/hooks/__tests__/useStartupPage.test.tsx`：

```tsx
import { describe, it, expect, vi } from "vitest";
import { resolveStartupPage } from "../useStartupPage";
import type { DigestResponse } from "../../api/client";

const repo = { id: 1, full_name: "o/r", url: "https://github.com/o/r" };
const withTier = (tier: "highlight" | "other"): DigestResponse => ({
  items: [{ key: "release:1", tier, kind: "release", repo, occurred_at: "2026-09-25T00:00:00+00:00", url: null, title: "v1", tags: [] }],
  other_total: tier === "other" ? 1 : 0,
  cursor: { context_signal_id: 1, early_signal_id: 0, triggered_alert_id: 0 },
  last_seen_at: null,
  releases_checked: true,
});

describe("resolveStartupPage", () => {
  it("opens the dashboard when there are highlights", async () => {
    expect(await resolveStartupPage("watchlist", async () => withTier("highlight"))).toBe("dashboard");
  });

  it("keeps the last page when there are only other updates", async () => {
    expect(await resolveStartupPage("watchlist", async () => withTier("other"))).toBe("watchlist");
  });

  it("keeps the last page when the digest fails", async () => {
    expect(await resolveStartupPage("trends", async () => { throw new Error("down"); })).toBe("trends");
  });

  it("keeps the last page when the digest takes longer than the timeout", async () => {
    vi.useFakeTimers();
    const pending = resolveStartupPage("compare", () => new Promise(() => {}), 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toBe("compare");
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/__tests__/useStartupPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement**

`src/hooks/useStartupPage.ts`：

```ts
/**
 * 啟動時落在哪一頁：有重點→Dashboard，否則回上次的頁面。
 *
 * 先等 digest 再決定，不先畫上次的頁再跳走；本機 API 是毫秒級，最多等 1 秒。
 * 抓到的結果放進與 useDigest 相同的 query key，Dashboard 不會再打一次。
 * 這裡不送 seen：沒落在 Dashboard 的話使用者根本沒看到。
 */
import { useEffect, useState } from "react";
import { getDigest } from "../api/client";
import type { DigestResponse } from "../api/client";
import { queryClient, queryKeys } from "../lib/react-query";
import type { Page } from "../types/navigation";
import { hasHighlights } from "../utils/digest";

export async function resolveStartupPage(
  saved: Page,
  fetchDigest: () => Promise<DigestResponse>,
  timeoutMs = 1000
): Promise<Page> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const digest = await Promise.race([fetchDigest(), timeout]);
    return digest && hasHighlights(digest) ? "dashboard" : saved;
  } catch {
    return saved;
  } finally {
    clearTimeout(timer);
  }
}

export function useStartupPage(saved: Page): Page | null {
  const [page, setPage] = useState<Page | null>(saved === "dashboard" ? "dashboard" : null);

  useEffect(() => {
    if (page !== null) return;
    let cancelled = false;
    void resolveStartupPage(saved, () =>
      queryClient.fetchQuery({
        queryKey: queryKeys.digest.session(),
        queryFn: ({ signal }) => getDigest(signal),
        staleTime: Infinity,
      })
    ).then((resolved) => {
      if (!cancelled) setPage(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [saved, page]);

  return page;
}
```

（`queryClient` 若不是從 `src/lib/react-query.ts` 匯出，照 `App.tsx` 現有的 import 路徑；`Page` 型別路徑照 `NavigationContext.tsx` 的 `../types/navigation`。）

`src/App.tsx`：
- 把原本 `useState<Page>(() => {…})` 的初始值邏輯抽成同檔的 `function readSavedPage(): Page`（內容不變）
- 改為：

```tsx
  const savedPage = useMemo(readSavedPage, []);
  const startupPage = useStartupPage(savedPage);
  const [chosenPage, setChosenPage] = useState<Page | null>(null);
  const currentPage = chosenPage ?? startupPage;

  const handlePageChange = useCallback((page: Page) => {
    setChosenPage(page);
    try {
      localStorage.setItem(STORAGE_KEYS.PAGE, page);
    } catch {
      // QuotaExceededError — 靜默忽略，不影響導航功能
    }
  }, []);
```

- `AppHeader` 的 `currentPage` 與 `<PageContent page={…} />`：`currentPage` 為 null 時渲染 `<PageLoader text={t.common.loading} />` 取代 `PageContent`，`AppHeader` 傳 `currentPage ?? savedPage`

- [ ] **Step 4: Run tests**

Run: `npx vitest run && npm run lint && npm run type-check`
Expected: 全部 PASS

- [ ] **Step 5: e2e 與瀏覽器實測**

Run: `E2E_NO_TOKEN=1 npx playwright test --project=chromium --project=firefox --project=webkit`
Expected: 全過；`dashboard-widgets.spec.ts` 的引導卡測試照舊通過（空資料庫時 digest 無重點，啟動頁回上次的頁面／預設 Dashboard）

瀏覽器實測（隔離的 sidecar 與資料目錄，不碰 `~/.starscope`）：
1. 起一個 `STARSCOPE_DATA_DIR=<暫存目錄> PYTHON_KEYRING_BACKEND=keyring.backends.null.Keyring GITHUB_TOKEN=` 的 sidecar 與 Vite
2. 以 sqlite 在暫存 DB 插入一個 repo、一筆帶 `security` 的 release、兩筆一般 release
3. 開 app：應落在 Dashboard、面板顯示 1 條重點、「其他更新（2）」可展開
4. 重新整理頁面：面板變成「沒有值得注意的變化」且「上次看過」有值
5. 停在 Watchlist 後重開、DB 只加一般 release：應回到 Watchlist

- [ ] **Step 6: 真實資料驗證**（先徵得使用者同意讀取）

用唯讀拷貝（`mode=ro&immutable=1` 的 SQLite backup 到暫存區）對真實資料跑 `build_digest(db, None)` 與「假設游標停在 N 天前各表的最大 id」各一次，回報重點與其他更新的條數；確認「重點平均每天不到一條」成立，量完刪除拷貝。

- [ ] **Step 7: 文件**

`CLAUDE.md` 的「前端架構模式」加一節「自上次以來摘要」：游標語意（id 不用時間、seen 帶 GET 的 cursor、只進不退）、`queryKeys.digest` 刻意不在 dashboard 底下、`useDigest` 掛在 Dashboard 才送 seen。以 claude-md-management skill 提案，使用者同意後才改。

- [ ] **Step 8: Commit**（先取得使用者授權）

```bash
git add src/hooks/useStartupPage.ts src/hooks/__tests__/useStartupPage.test.tsx src/App.tsx CLAUDE.md
git commit -m "feat: open on the dashboard when there is something new worth seeing"
```

- [ ] **Step 9: 階段閘門**——送 code-reviewer 審 Task 5–10，findings 修完並重新驗證
