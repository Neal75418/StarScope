"""
StarScope 的 SQLAlchemy ORM 模型。

Tables:
- repos: 被追蹤的 GitHub repo
- repo_snapshots: repo 統計數據的歷史快照
- signals: 計算後的訊號（velocity、delta 等）
"""

from datetime import datetime, date
from typing import Optional, List
from sqlalchemy import Integer, String, Float, DateTime, Date, ForeignKey, Index, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, relationship, Mapped, mapped_column

# IDE 可能顯示警告 — 路徑在 main.py 中透過 sys.path 於執行時解析
from utils.time import utc_now  # noqa: F401
from constants import (  # noqa: F401
    SignalType, AlertOperator, ContextSignalType,
    EarlySignalType, EarlySignalSeverity,
)

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
    description: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)

    # GitHub 中繼資料
    github_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    default_branch: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    language: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    topics: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)  # GitHub topics 的 JSON 陣列

    # 時間戳記
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)  # GitHub 建立日期
    added_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)  # 加入追蹤清單的時間
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)

    # 關聯
    snapshots: Mapped[List["RepoSnapshot"]] = relationship("RepoSnapshot", back_populates="repo", cascade=CASCADE_DELETE_ORPHAN)
    signals: Mapped[List["Signal"]] = relationship("Signal", back_populates="repo", cascade=CASCADE_DELETE_ORPHAN)
    context_signals: Mapped[List["ContextSignal"]] = relationship("ContextSignal", back_populates="repo", cascade=CASCADE_DELETE_ORPHAN)
    commit_activities: Mapped[List["CommitActivity"]] = relationship("CommitActivity", back_populates="repo", cascade=CASCADE_DELETE_ORPHAN)
    languages: Mapped[List["RepoLanguage"]] = relationship("RepoLanguage", back_populates="repo", cascade=CASCADE_DELETE_ORPHAN)
    early_signals: Mapped[List["EarlySignal"]] = relationship("EarlySignal", back_populates="repo", cascade=CASCADE_DELETE_ORPHAN)

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
    description: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)

    # 目標（選填 — 若為 null 則套用於所有 repo）
    repo_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey(FK_REPOS_ID, ondelete="CASCADE"), nullable=True)

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
    repo: Mapped[Optional["Repo"]] = relationship("Repo")
    triggered_alerts: Mapped[List["TriggeredAlert"]] = relationship("TriggeredAlert", back_populates="rule", cascade=CASCADE_DELETE_ORPHAN)

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
    acknowledged_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # 關聯
    rule: Mapped["AlertRule"] = relationship("AlertRule", back_populates="triggered_alerts")
    repo: Mapped["Repo"] = relationship("Repo")

    # 索引
    __table_args__ = (
        Index("ix_triggered_alerts_rule", "rule_id"),
        Index("ix_triggered_alerts_repo", "repo_id"),
        Index("ix_triggered_alerts_time", "triggered_at"),
    )

    def __repr__(self) -> str:
        return f"<TriggeredAlert rule_id={self.rule_id} repo_id={self.repo_id} value={self.signal_value}>"



class ContextSignal(Base):
    """
    repo 的外部情境訊號。
    追蹤 Hacker News 上的提及。
    """
    __tablename__ = "context_signals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    repo_id: Mapped[int] = mapped_column(Integer, ForeignKey(FK_REPOS_ID, ondelete="CASCADE"), nullable=False)

    # 訊號識別
    signal_type: Mapped[str] = mapped_column(String(50), nullable=False)  # 僅 hacker_news
    external_id: Mapped[str] = mapped_column(String(255), nullable=False)  # HN story ID

    # 內容
    title: Mapped[str] = mapped_column(String(1024), nullable=False)
    url: Mapped[str] = mapped_column(String(2048), nullable=False)

    # 選填中繼資料
    score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # HN 分數
    comment_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    author: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # 時間戳記
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)  # 外部發布時間
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
    shared_topics: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)  # 共同 topics 的 JSON 陣列
    same_language: Mapped[bool] = mapped_column(Integer, nullable=False, default=False)  # SQLite bool

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
    description: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    icon: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)  # Emoji
    color: Mapped[Optional[str]] = mapped_column(String(7), nullable=True)  # Hex 色碼
    parent_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey(FK_CATEGORIES_ID, ondelete="SET NULL"), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    # 關聯
    parent: Mapped[Optional["Category"]] = relationship("Category", remote_side="Category.id", backref="children")
    repo_categories: Mapped[List["RepoCategory"]] = relationship("RepoCategory", back_populates="category", cascade=CASCADE_DELETE_ORPHAN)

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
    severity: Mapped[str] = mapped_column(String(20), nullable=False)  # low、medium、high
    description: Mapped[str] = mapped_column(String(500), nullable=False)

    # 偵測時的指標
    velocity_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    star_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    percentile_rank: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # 0-100

    # 時間戳記
    detected_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # 使用者互動
    acknowledged: Mapped[bool] = mapped_column(Integer, default=False)  # SQLite bool
    acknowledged_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # 關聯
    repo: Mapped["Repo"] = relationship("Repo", back_populates="early_signals")

    # 索引
    __table_args__ = (
        Index("ix_early_signals_repo", "repo_id"),
        Index("ix_early_signals_type", "signal_type"),
        Index("ix_early_signals_detected", "detected_at"),
        Index("ix_early_signals_severity", "severity"),
        Index("ix_early_signals_filter", "repo_id", "signal_type", "acknowledged"),  # 用於篩選查詢
    )

    def __repr__(self) -> str:
        return f"<EarlySignal repo_id={self.repo_id} type={self.signal_type} severity={self.severity}>"


# ==================== 應用程式設定模型 ====================

class AppSettingKey:
    """應用程式設定鍵常數。"""
    GITHUB_TOKEN = "github_token"
    GITHUB_USERNAME = "github_username"


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


# ==================== Commit Activity 模型 ====================

class CommitActivity(Base):
    """
    repo 的每週 commit 活動資料。
    從 GitHub Stats API 取得：/repos/{owner}/{repo}/stats/commit_activity
    """
    __tablename__ = "commit_activities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    repo_id: Mapped[int] = mapped_column(Integer, ForeignKey(FK_REPOS_ID, ondelete="CASCADE"), nullable=False)

    # 週資料
    week_start: Mapped[date] = mapped_column(Date, nullable=False)  # ISO 週起始日（週日）
    commit_count: Mapped[int] = mapped_column(Integer, default=0)

    # 時間戳記
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    # 關聯
    repo: Mapped["Repo"] = relationship("Repo", back_populates="commit_activities")

    # 索引與約束
    __table_args__ = (
        UniqueConstraint("repo_id", "week_start", name="uq_commit_activity"),
        Index("ix_commit_activity_repo", "repo_id"),
        Index("ix_commit_activity_week", "week_start"),
    )

    def __repr__(self) -> str:
        return f"<CommitActivity repo_id={self.repo_id} week={self.week_start} commits={self.commit_count}>"


# ==================== Repo 程式語言模型 ====================

class RepoLanguage(Base):
    """
    repo 的程式語言分佈。
    從 GitHub API 取得：/repos/{owner}/{repo}/languages
    """
    __tablename__ = "repo_languages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    repo_id: Mapped[int] = mapped_column(Integer, ForeignKey(FK_REPOS_ID, ondelete="CASCADE"), nullable=False)

    # 語言資料
    language: Mapped[str] = mapped_column(String(100), nullable=False)
    bytes: Mapped[int] = mapped_column(Integer, default=0)  # 程式碼位元組數
    percentage: Mapped[float] = mapped_column(Float, default=0.0)  # 計算後的百分比

    # 時間戳記
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    # 關聯
    repo: Mapped["Repo"] = relationship("Repo", back_populates="languages")

    # 索引與約束
    __table_args__ = (
        UniqueConstraint("repo_id", "language", name="uq_repo_language"),
        Index("ix_repo_languages_repo", "repo_id"),
    )

    def __repr__(self) -> str:
        return f"<RepoLanguage repo_id={self.repo_id} lang={self.language} {self.percentage:.1f}%>"
