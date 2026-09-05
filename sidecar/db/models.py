"""
StarScope 的 SQLAlchemy ORM 模型。

Tables:
- repos: 被追蹤的 GitHub repo
- repo_snapshots: repo 統計數據的歷史快照
- signals: 計算後的訊號（velocity、delta 等）
"""

from datetime import datetime, date
from enum import StrEnum
from sqlalchemy import Integer, String, Float, DateTime, Date, ForeignKey, Index, UniqueConstraint, Boolean
from sqlalchemy.orm import DeclarativeBase, relationship, Mapped, mapped_column

from utils.time import utc_now  # noqa: F401 — 用於 mapped_column default/onupdate callable

# 避免程式碼重複警告的常數
CASCADE_DELETE_ORPHAN = "all, delete-orphan"
FK_REPOS_ID = "repos.id"
FK_CATEGORIES_ID = "categories.id"
FK_ALERT_RULES_ID = "alert_rules.id"


class Base(DeclarativeBase):
    """所有模型的基底類別。"""
    pass


class Repo(Base):
    """被追蹤的 GitHub repo。"""
    __tablename__ = "repos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    url: Mapped[str] = mapped_column(String(1024), nullable=False)
    description: Mapped[str | None] = mapped_column(String(2048), nullable=True)

    # GitHub 中繼資料
    github_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    default_branch: Mapped[str | None] = mapped_column(String(255), nullable=True)
    language: Mapped[str | None] = mapped_column(String(100), nullable=True)
    topics: Mapped[str | None] = mapped_column(String(2048), nullable=True)  # GitHub topics 的 JSON 陣列

    # 時間戳記
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # GitHub 建立日期
    added_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)  # 加入追蹤清單的時間
    # 封存標記。NULL 表示仍在追蹤清單中。取消 star 時寫入而非刪除列——快照與訊號
    # 要保留，重新 star 時才能整組回來。
    unstarred_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # GitHub 上 star 的時間。added_at 在批次同步後全部是同一天，表達不了收藏時長，
    # 而「star 很久＝有價值」是判斷去留的依據。
    starred_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)

    # 關聯
    snapshots: Mapped[list["RepoSnapshot"]] = relationship("RepoSnapshot", back_populates="repo", cascade=CASCADE_DELETE_ORPHAN)
    signals: Mapped[list["Signal"]] = relationship("Signal", back_populates="repo", cascade=CASCADE_DELETE_ORPHAN)
    context_signals: Mapped[list["ContextSignal"]] = relationship("ContextSignal", back_populates="repo", cascade=CASCADE_DELETE_ORPHAN)
    early_signals: Mapped[list["EarlySignal"]] = relationship("EarlySignal", back_populates="repo", cascade=CASCADE_DELETE_ORPHAN)

    # 索引
    __table_args__ = (
        Index("ix_repos_owner_name", "owner", "name"),
    )

    def __repr__(self) -> str:
        return f"<Repo {self.full_name}>"


class RepoSnapshot(Base):
    """
    repo 統計數據的時間點快照。
    用於計算 delta 與 velocity。
    """
    __tablename__ = "repo_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    repo_id: Mapped[int] = mapped_column(Integer, ForeignKey(FK_REPOS_ID, ondelete="CASCADE"), nullable=False)

    # 該時間點的統計
    stars: Mapped[int] = mapped_column(Integer, nullable=False)
    forks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    watchers: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    open_issues: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # 時間戳記
    snapshot_date: Mapped[date] = mapped_column(Date, nullable=False)  # 快照日期（每日一筆）
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    # 關聯
    repo: Mapped["Repo"] = relationship("Repo", back_populates="snapshots")

    # 索引與約束
    __table_args__ = (
        Index("ix_snapshots_repo_date", "repo_id", "snapshot_date"),
        Index("ix_snapshots_date", "snapshot_date"),
        UniqueConstraint("repo_id", "snapshot_date", name="uq_snapshot_repo_date"),
    )

    def __repr__(self) -> str:
        return f"<RepoSnapshot repo_id={self.repo_id} date={self.snapshot_date} stars={self.stars}>"


class Signal(Base):
    """
    repo 的計算訊號。
    從快照計算而來，代表 velocity、acceleration 等指標。
    """
    __tablename__ = "signals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    repo_id: Mapped[int] = mapped_column(Integer, ForeignKey(FK_REPOS_ID, ondelete="CASCADE"), nullable=False)

    # 訊號資料
    signal_type: Mapped[str] = mapped_column(String(50), nullable=False)  # 例如 "stars_delta_7d"、"velocity"
    value: Mapped[float] = mapped_column(Float, nullable=False)

    # 時間戳記
    calculated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    # 關聯
    repo: Mapped["Repo"] = relationship("Repo", back_populates="signals")

    # 索引與約束
    __table_args__ = (
        Index("ix_signals_repo_type", "repo_id", "signal_type"),
        UniqueConstraint("repo_id", "signal_type", name="uq_signal_repo_type"),
    )

    def __repr__(self) -> str:
        return f"<Signal repo_id={self.repo_id} type={self.signal_type} value={self.value}>"


class AlertRule(Base):
    """
    使用者定義的警報規則。
    當條件滿足時觸發警報。
    """
    __tablename__ = "alert_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # 規則設定
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(String(1024), nullable=True)

    # 目標（選填 — 若為 null 則套用於所有 repo）
    repo_id: Mapped[int | None] = mapped_column(Integer, ForeignKey(FK_REPOS_ID, ondelete="CASCADE"), nullable=True)

    # 條件
    signal_type: Mapped[str] = mapped_column(String(50), nullable=False)  # 例如 "stars_delta_7d"、"velocity"
    operator: Mapped[str] = mapped_column(String(10), nullable=False)  # ">"、"<"、">="、"<="、"=="
    threshold: Mapped[float] = mapped_column(Float, nullable=False)

    # 狀態
    enabled: Mapped[bool] = mapped_column(Integer, default=True)  # SQLite 無 bool 型別，使用 int

    # 時間戳記
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)

    # 關聯
    repo: Mapped["Repo | None"] = relationship("Repo")
    triggered_alerts: Mapped[list["TriggeredAlert"]] = relationship("TriggeredAlert", back_populates="rule", cascade=CASCADE_DELETE_ORPHAN)

    # 索引
    __table_args__ = (
        Index("ix_alert_rules_repo_id", "repo_id"),
    )

    def __repr__(self) -> str:
        target = self.repo.full_name if self.repo else "all repos"
        return f"<AlertRule {self.name}: {self.signal_type} {self.operator} {self.threshold} for {target}>"


class TriggeredAlert(Base):
    """警報規則被觸發的紀錄。"""
    __tablename__ = "triggered_alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rule_id: Mapped[int] = mapped_column(Integer, ForeignKey(FK_ALERT_RULES_ID, ondelete="CASCADE"), nullable=False)
    repo_id: Mapped[int] = mapped_column(Integer, ForeignKey(FK_REPOS_ID, ondelete="CASCADE"), nullable=False)

    # 觸發詳情
    signal_value: Mapped[float] = mapped_column(Float, nullable=False)  # 觸發警報的數值
    triggered_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    # 使用者是否已檢視/確認此警報
    acknowledged: Mapped[bool] = mapped_column(Integer, default=False)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # 關聯
    rule: Mapped["AlertRule"] = relationship("AlertRule", back_populates="triggered_alerts")
    repo: Mapped["Repo"] = relationship("Repo")

    # 索引
    __table_args__ = (
        Index("ix_triggered_alerts_rule", "rule_id"),
        Index("ix_triggered_alerts_repo", "repo_id"),
        Index("ix_triggered_alerts_time", "triggered_at"),
        Index("ix_triggered_alerts_ack_time", "acknowledged", "triggered_at"),
    )

    def __repr__(self) -> str:
        return f"<TriggeredAlert rule_id={self.rule_id} repo_id={self.repo_id} value={self.signal_value}>"


class ContextSignal(Base):
    """
    repo 的外部情境訊號。
    追蹤 Hacker News 上的提及與 GitHub 新版本發布。
    """
    __tablename__ = "context_signals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    repo_id: Mapped[int] = mapped_column(Integer, ForeignKey(FK_REPOS_ID, ondelete="CASCADE"), nullable=False)

    # 訊號識別
    signal_type: Mapped[str] = mapped_column(String(50), nullable=False)  # hacker_news | release
    external_id: Mapped[str] = mapped_column(String(255), nullable=False)  # HN 文章 ID 或 release ID

    # 內容
    title: Mapped[str] = mapped_column(String(1024), nullable=False)
    url: Mapped[str] = mapped_column(String(2048), nullable=False)

    # 選填中繼資料
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)  # HN 分數
    comment_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    author: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # release 專用：從 release notes 掃出的標記（逗號分隔，如 "breaking,security"）。
    # HN 訊號留空。不存 notes 全文——我們只需要「值不值得先看」這個判斷，
    # 而全文會讓這張表在 90 天保留期內長得很快。
    tags: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # 時間戳記
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # 外部發布時間
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    # 關聯
    repo: Mapped["Repo"] = relationship("Repo", back_populates="context_signals")

    # 索引與約束
    __table_args__ = (
        Index("ix_context_signals_repo_type", "repo_id", "signal_type"),
        Index("ix_context_signals_published", "published_at"),
        Index("ix_context_signals_repo_published", "repo_id", "published_at"),  # 用於按 published_at 排序的查詢
        UniqueConstraint("repo_id", "signal_type", "external_id", name="uq_context_signal_unique"),
    )

    def __repr__(self) -> str:
        return f"<ContextSignal repo_id={self.repo_id} type={self.signal_type} title={self.title[:30] if self.title else ''}>"


class SimilarRepo(Base):
    """
    儲存追蹤清單中 repo 之間的相似關係。
    用於推薦相似專案。
    """
    __tablename__ = "similar_repos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    repo_id: Mapped[int] = mapped_column(Integer, ForeignKey(FK_REPOS_ID, ondelete="CASCADE"), nullable=False)
    similar_repo_id: Mapped[int] = mapped_column(Integer, ForeignKey(FK_REPOS_ID, ondelete="CASCADE"), nullable=False)

    # 相似度指標
    similarity_score: Mapped[float] = mapped_column(Float, nullable=False)  # 0.0-1.0
    shared_topics: Mapped[str | None] = mapped_column(String(2048), nullable=True)  # 共同 topics 的 JSON 陣列
    same_language: Mapped[bool] = mapped_column(Integer, nullable=False, default=False)  # SQLite 布林值

    # 時間戳記
    calculated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    # 關聯
    repo: Mapped["Repo"] = relationship("Repo", foreign_keys=[repo_id])
    similar: Mapped["Repo"] = relationship("Repo", foreign_keys=[similar_repo_id])

    # 索引與約束
    __table_args__ = (
        UniqueConstraint("repo_id", "similar_repo_id", name="uq_similar_repo_pair"),
        Index("ix_similar_repos_repo", "repo_id"),
        Index("ix_similar_repos_score", "similarity_score"),
    )

    def __repr__(self) -> str:
        return f"<SimilarRepo repo_id={self.repo_id} similar_id={self.similar_repo_id} score={self.similarity_score}>"


class Category(Base):
    """
    使用者定義的分類，用於組織 repo。
    透過 parent_id 支援階層結構。
    """
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    icon: Mapped[str | None] = mapped_column(String(10), nullable=True)  # 表情符號
    color: Mapped[str | None] = mapped_column(String(7), nullable=True)  # Hex 色碼
    parent_id: Mapped[int | None] = mapped_column(Integer, ForeignKey(FK_CATEGORIES_ID, ondelete="SET NULL"), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    # 關聯
    parent: Mapped["Category | None"] = relationship("Category", remote_side="Category.id", backref="children")
    repo_categories: Mapped[list["RepoCategory"]] = relationship("RepoCategory", back_populates="category", cascade=CASCADE_DELETE_ORPHAN)

    # 索引
    __table_args__ = (
        Index("ix_categories_parent", "parent_id"),
        Index("ix_categories_sort", "sort_order"),
    )

    def __repr__(self) -> str:
        return f"<Category id={self.id} name={self.name}>"


class RepoCategory(Base):
    """repo 與分類之間的多對多關聯。"""
    __tablename__ = "repo_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    repo_id: Mapped[int] = mapped_column(Integer, ForeignKey(FK_REPOS_ID, ondelete="CASCADE"), nullable=False)
    category_id: Mapped[int] = mapped_column(Integer, ForeignKey(FK_CATEGORIES_ID, ondelete="CASCADE"), nullable=False)
    added_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    # 關聯
    repo: Mapped["Repo"] = relationship("Repo")
    category: Mapped["Category"] = relationship("Category", back_populates="repo_categories")

    # 索引與約束
    __table_args__ = (
        UniqueConstraint("repo_id", "category_id", name="uq_repo_category"),
        Index("ix_repo_categories_repo", "repo_id"),
        Index("ix_repo_categories_category", "category_id"),
    )

    def __repr__(self) -> str:
        return f"<RepoCategory repo_id={self.repo_id} category_id={self.category_id}>"


class EarlySignal(Base):
    """
    偵測到的 repo 早期訊號/異常。
    協助辨識新興專案與異常活動。
    """
    __tablename__ = "early_signals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    repo_id: Mapped[int] = mapped_column(Integer, ForeignKey(FK_REPOS_ID, ondelete="CASCADE"), nullable=False)

    # 訊號詳情
    signal_type: Mapped[str] = mapped_column(String(50), nullable=False)
    severity: Mapped[str] = mapped_column(String(20), nullable=False)  # 嚴重度：low、medium、high
    description: Mapped[str] = mapped_column(String(500), nullable=False)

    # 偵測時的指標。velocity_value 的意義依 signal_type 而異：rising_star / sudden_spike /
    # breakout 是 stars/day；viral_hn 沒有 velocity 概念，這裡存的是 HN 分數
    # （前端 signalCopy.ts 依此渲染）
    velocity_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    star_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    percentile_rank: Mapped[float | None] = mapped_column(Float, nullable=True)  # 0-100
    # 描述模板的結構化參數（顯示文案由前端依語系渲染，description 是 fallback）：
    # baseline_value＝比較基準（sudden_spike 的平均日增、breakout 的前週 velocity）
    # context_title＝viral_hn 的 HN 標題（內容非文案，不翻譯）
    baseline_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    context_title: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # 時間戳記
    detected_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # 使用者互動
    acknowledged: Mapped[bool] = mapped_column(Integer, default=False)  # SQLite 布林值
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # 關聯
    repo: Mapped["Repo"] = relationship("Repo", back_populates="early_signals")

    # 索引
    __table_args__ = (
        Index("ix_early_signals_repo", "repo_id"),
        Index("ix_early_signals_type", "signal_type"),
        Index("ix_early_signals_detected", "detected_at"),
        Index("ix_early_signals_severity", "severity"),
        Index("ix_early_signals_filter", "repo_id", "signal_type", "acknowledged"),  # 用於篩選查詢
        Index("ix_early_signals_active", "acknowledged", "expires_at"),  # 用於活躍訊號批次查詢
    )

    def __repr__(self) -> str:
        return f"<EarlySignal repo_id={self.repo_id} type={self.signal_type} severity={self.severity}>"


# ==================== 應用程式設定模型 ====================

class AppSettingKey(StrEnum):
    """應用程式設定鍵常數（StrEnum 與其他常數群組一致）。"""
    GITHUB_TOKEN = "github_token"
    GITHUB_USERNAME = "github_username"
    # 排程設定
    FETCH_INTERVAL_MINUTES = "fetch_interval_minutes"
    # 快照保留
    SNAPSHOT_RETENTION_DAYS = "snapshot_retention_days"
    # Early Signal 偵測門檻
    SIGNAL_RISING_STAR_MIN_VELOCITY = "signal_rising_star_min_velocity"
    SIGNAL_SUDDEN_SPIKE_MULTIPLIER = "signal_sudden_spike_multiplier"
    SIGNAL_BREAKOUT_VELOCITY_THRESHOLD = "signal_breakout_velocity_threshold"
    SIGNAL_VIRAL_HN_MIN_SCORE = "signal_viral_hn_min_score"
    # 熱門主題建議（手動更新，見 services/trending_topics.py）
    LAST_STAR_SYNC_AT = "last_star_sync_at"
    LAST_RELEASE_FETCH_AT = "last_release_fetch_at"
    # 最後一次開啟這個資料庫的 app 版本。純診斷用：使用者回報問題時，
    # 「這個 DB 上次是哪一版開的」是唯一能還原升級路徑的線索，而外部
    # 使用者沒有任何遙測。由啟動流程覆寫，不需要人工維護
    LAST_OPENED_APP_VERSION = "last_opened_app_version"
    STAR_SYNC_RUNNING = "star_sync_running"
    TRENDING_TOPICS_CACHE = "trending_topics_cache"
    TRENDING_GLOBAL_COUNTS = "trending_global_counts"
    TRENDING_PROGRESS = "trending_progress"


class AppSetting(Base):
    """
    儲存於資料庫的應用程式設定。
    用於存放使用者偏好與憑證（如 GitHub OAuth token）。
    """
    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    value: Mapped[str] = mapped_column(String(4096), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)

    __table_args__ = (
        Index("ix_app_settings_key", "key"),
    )

    def __repr__(self) -> str:
        return f"<AppSetting key={self.key}>"


# --- For You Feed ---

class InterestKind(StrEnum):
    """興趣項目的匹配種類。"""
    TOPIC = "topic"
    LANGUAGE = "language"
    KEYWORD = "keyword"


class FeedFeedback(StrEnum):
    """Feed 項目的使用者回饋。"""
    STARRED = "starred"
    DISMISSED = "dismissed"


class Interest(Base):
    """使用者興趣清單，驅動 feed 候選搜尋與評分。"""
    __tablename__ = "interests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    term: Mapped[str] = mapped_column(String(100), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default=InterestKind.TOPIC)
    weight: Mapped[int] = mapped_column(Integer, nullable=False, default=2)  # 1–3
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    __table_args__ = (UniqueConstraint("term", "kind", name="uq_interests_term_kind"),)


class ExcludeTerm(Base):
    """Feed 黑名單關鍵字，命中者不進 feed。"""
    __tablename__ = "exclude_terms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    term: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)


class FeedCandidate(Base):
    """搜尋到的候選 repo（metadata 暫存池，與 watchlist 的 repos 表無關）。"""
    __tablename__ = "feed_candidates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    github_id: Mapped[int] = mapped_column(Integer, nullable=False, unique=True)
    full_name: Mapped[str] = mapped_column(String(512), nullable=False)
    owner: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    language: Mapped[str | None] = mapped_column(String(100), nullable=True)
    topics: Mapped[str | None] = mapped_column(String(2048), nullable=True)  # JSON 陣列
    stars: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    forks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    url: Mapped[str] = mapped_column(String(1024), nullable=False)
    owner_avatar_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    repo_created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    repo_pushed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    feed_items: Mapped[list["FeedItem"]] = relationship(
        "FeedItem", back_populates="candidate", cascade=CASCADE_DELETE_ORPHAN)


class FeedItem(Base):
    """每日 feed 產出項目，含評分與可回溯的推薦理由。"""
    __tablename__ = "feed_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    candidate_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("feed_candidates.id", ondelete="CASCADE"), nullable=False)
    feed_date: Mapped[date] = mapped_column(Date, nullable=False)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    reason_json: Mapped[str] = mapped_column(String(2048), nullable=False)
    feedback: Mapped[str | None] = mapped_column(String(20), nullable=True)  # FeedFeedback
    # 第一次點開連結的時間。刻意獨立於 feedback 而不是多加一個列舉值：
    # 「點開」與「加入/略過」不互斥（先看一眼再決定是常態），共用一欄會讓後者
    # 覆蓋掉前者。存時間而非布林同樣成本，卻能分辨「當天就點」與「三天後才回頭點」。
    opened_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    candidate: Mapped["FeedCandidate"] = relationship(
        "FeedCandidate", back_populates="feed_items")

    __table_args__ = (
        UniqueConstraint("candidate_id", "feed_date", name="uq_feed_items_candidate_date"),
        Index("ix_feed_items_feed_date", "feed_date"),
    )


class SeenRepo(Base):
    """已在 feed 出現過的 repo；推過不再推，dismissed 者永不回鍋。"""
    __tablename__ = "seen_repos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    github_id: Mapped[int] = mapped_column(Integer, nullable=False, unique=True)
    full_name: Mapped[str] = mapped_column(String(512), nullable=False)
    last_shown_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    dismissed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
