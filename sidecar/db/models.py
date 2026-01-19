"""
SQLAlchemy ORM models for StarScope.

Tables:
- repos: GitHub repositories being watched
- repo_snapshots: Historical snapshots of repo stats
- signals: Calculated signals (velocity, delta, etc.)
"""

from datetime import datetime, date
from typing import Optional, List
from sqlalchemy import Integer, String, Float, DateTime, Date, ForeignKey, Index, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, relationship, Mapped, mapped_column

# IDE may show warning - path is resolved at runtime via sys.path in main.py
from utils.time import utc_now  # noqa: F401

# Constants to avoid code duplication warnings
CASCADE_DELETE_ORPHAN = "all, delete-orphan"
FK_REPOS_ID = "repos.id"
FK_TAGS_ID = "tags.id"
FK_CATEGORIES_ID = "categories.id"
FK_ALERT_RULES_ID = "alert_rules.id"
FK_COMPARISON_GROUPS_ID = "comparison_groups.id"
FK_WEBHOOKS_ID = "webhooks.id"


class Base(DeclarativeBase):
    """Base class for all models."""
    pass


class Repo(Base):
    """
    A GitHub repository being watched.
    """
    __tablename__ = "repos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    url: Mapped[str] = mapped_column(String(1024), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)

    # GitHub metadata
    github_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    default_branch: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    language: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    topics: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)  # JSON array of GitHub topics

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)  # GitHub creation date
    added_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)  # Added to watchlist
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)

    # Relationships
    snapshots: Mapped[List["RepoSnapshot"]] = relationship("RepoSnapshot", back_populates="repo", cascade=CASCADE_DELETE_ORPHAN)
    signals: Mapped[List["Signal"]] = relationship("Signal", back_populates="repo", cascade=CASCADE_DELETE_ORPHAN)
    context_signals: Mapped[List["ContextSignal"]] = relationship("ContextSignal", back_populates="repo", cascade=CASCADE_DELETE_ORPHAN)
    repo_tags: Mapped[List["RepoTag"]] = relationship("RepoTag", back_populates="repo", cascade=CASCADE_DELETE_ORPHAN)

    # Indexes
    __table_args__ = (
        Index("ix_repos_owner_name", "owner", "name"),
    )

    def __repr__(self) -> str:
        return f"<Repo {self.full_name}>"


class RepoSnapshot(Base):
    """
    A point-in-time snapshot of a repository's stats.
    Used to calculate deltas and velocity.
    """
    __tablename__ = "repo_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    repo_id: Mapped[int] = mapped_column(Integer, ForeignKey(FK_REPOS_ID, ondelete="CASCADE"), nullable=False)

    # Stats at this point in time
    stars: Mapped[int] = mapped_column(Integer, nullable=False)
    forks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    watchers: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    open_issues: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Timestamps
    snapshot_date: Mapped[date] = mapped_column(Date, nullable=False)  # Date of snapshot (one per day)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    # Relationship
    repo: Mapped["Repo"] = relationship("Repo", back_populates="snapshots")

    # Indexes and constraints
    __table_args__ = (
        Index("ix_snapshots_repo_date", "repo_id", "snapshot_date"),
        Index("ix_snapshots_date", "snapshot_date"),
        UniqueConstraint("repo_id", "snapshot_date", name="uq_snapshot_repo_date"),
    )

    def __repr__(self) -> str:
        return f"<RepoSnapshot repo_id={self.repo_id} date={self.snapshot_date} stars={self.stars}>"


class Signal(Base):
    """
    A calculated signal for a repository.
    Signals are computed from snapshots and represent metrics like velocity, acceleration, etc.
    """
    __tablename__ = "signals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    repo_id: Mapped[int] = mapped_column(Integer, ForeignKey(FK_REPOS_ID, ondelete="CASCADE"), nullable=False)

    # Signal data
    signal_type: Mapped[str] = mapped_column(String(50), nullable=False)  # e.g., "stars_delta_7d", "velocity"
    value: Mapped[float] = mapped_column(Float, nullable=False)

    # Timestamps
    calculated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    # Relationship
    repo: Mapped["Repo"] = relationship("Repo", back_populates="signals")

    # Indexes and constraints
    __table_args__ = (
        Index("ix_signals_repo_type", "repo_id", "signal_type"),
        UniqueConstraint("repo_id", "signal_type", name="uq_signal_repo_type"),
    )

    def __repr__(self) -> str:
        return f"<Signal repo_id={self.repo_id} type={self.signal_type} value={self.value}>"


class AlertRule(Base):
    """
    A user-defined alert rule.
    When conditions are met, an alert is triggered.
    """
    __tablename__ = "alert_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Rule configuration
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)

    # Target (optional - if null, applies to all repos)
    repo_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey(FK_REPOS_ID, ondelete="CASCADE"), nullable=True)

    # Condition
    signal_type: Mapped[str] = mapped_column(String(50), nullable=False)  # e.g., "stars_delta_7d", "velocity"
    operator: Mapped[str] = mapped_column(String(10), nullable=False)  # ">", "<", ">=", "<=", "=="
    threshold: Mapped[float] = mapped_column(Float, nullable=False)

    # Status
    enabled: Mapped[bool] = mapped_column(Integer, default=True)  # SQLite doesn't have bool, use int

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)

    # Relationships
    repo: Mapped[Optional["Repo"]] = relationship("Repo")
    triggered_alerts: Mapped[List["TriggeredAlert"]] = relationship("TriggeredAlert", back_populates="rule", cascade=CASCADE_DELETE_ORPHAN)

    def __repr__(self) -> str:
        target = self.repo.full_name if self.repo else "all repos"
        return f"<AlertRule {self.name}: {self.signal_type} {self.operator} {self.threshold} for {target}>"


class TriggeredAlert(Base):
    """
    A record of when an alert rule was triggered.
    """
    __tablename__ = "triggered_alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rule_id: Mapped[int] = mapped_column(Integer, ForeignKey(FK_ALERT_RULES_ID, ondelete="CASCADE"), nullable=False)
    repo_id: Mapped[int] = mapped_column(Integer, ForeignKey(FK_REPOS_ID, ondelete="CASCADE"), nullable=False)

    # Trigger details
    signal_value: Mapped[float] = mapped_column(Float, nullable=False)  # The value that triggered the alert
    triggered_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    # Whether the user has seen/acknowledged this alert
    acknowledged: Mapped[bool] = mapped_column(Integer, default=False)
    acknowledged_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # Relationships
    rule: Mapped["AlertRule"] = relationship("AlertRule", back_populates="triggered_alerts")
    repo: Mapped["Repo"] = relationship("Repo")

    # Indexes
    __table_args__ = (
        Index("ix_triggered_alerts_rule", "rule_id"),
        Index("ix_triggered_alerts_repo", "repo_id"),
        Index("ix_triggered_alerts_time", "triggered_at"),
    )

    def __repr__(self) -> str:
        return f"<TriggeredAlert rule_id={self.rule_id} repo_id={self.repo_id} value={self.signal_value}>"


# Signal type constants
class SignalType:
    """Constants for signal types."""
    STARS_DELTA_7D = "stars_delta_7d"
    STARS_DELTA_30D = "stars_delta_30d"
    VELOCITY = "velocity"  # stars per day
    ACCELERATION = "acceleration"  # rate of change of velocity
    TREND = "trend"  # -1, 0, 1 (down, stable, up)


# Alert operator constants
class AlertOperator:
    """Constants for alert operators."""
    GT = ">"
    LT = "<"
    GTE = ">="
    LTE = "<="
    EQ = "=="


# Context Signal type constants
class ContextSignalType:
    """Constants for context signal types."""
    HACKER_NEWS = "hacker_news"
    REDDIT = "reddit"
    GITHUB_RELEASE = "github_release"


class ContextSignal(Base):
    """
    External context signals about a repository.
    Tracks mentions on Hacker News, Reddit, and GitHub releases.
    """
    __tablename__ = "context_signals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    repo_id: Mapped[int] = mapped_column(Integer, ForeignKey(FK_REPOS_ID, ondelete="CASCADE"), nullable=False)

    # Signal identification
    signal_type: Mapped[str] = mapped_column(String(50), nullable=False)  # hacker_news, reddit, github_release
    external_id: Mapped[str] = mapped_column(String(255), nullable=False)  # HN story ID, Reddit post ID, release tag

    # Content
    title: Mapped[str] = mapped_column(String(1024), nullable=False)
    url: Mapped[str] = mapped_column(String(2048), nullable=False)

    # Optional metadata
    score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # HN points, Reddit upvotes
    comment_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    author: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # For GitHub releases
    version_tag: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    is_prerelease: Mapped[Optional[bool]] = mapped_column(Integer, nullable=True)  # SQLite bool as int

    # Timestamps
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)  # When it was published externally
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    # Relationship
    repo: Mapped["Repo"] = relationship("Repo", back_populates="context_signals")

    # Indexes and constraints
    __table_args__ = (
        Index("ix_context_signals_repo_type", "repo_id", "signal_type"),
        Index("ix_context_signals_published", "published_at"),
        UniqueConstraint("repo_id", "signal_type", "external_id", name="uq_context_signal_unique"),
    )

    def __repr__(self) -> str:
        return f"<ContextSignal repo_id={self.repo_id} type={self.signal_type} title={self.title[:30] if self.title else ''}>"


class HealthScore(Base):
    """
    Project health score for a repository.
    Calculated from various GitHub metrics.
    """
    __tablename__ = "health_scores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    repo_id: Mapped[int] = mapped_column(Integer, ForeignKey(FK_REPOS_ID, ondelete="CASCADE"), nullable=False, unique=True)

    # Overall score (0-100)
    overall_score: Mapped[float] = mapped_column(Float, nullable=False)
    grade: Mapped[str] = mapped_column(String(2), nullable=False)  # A+, A, B+, B, C+, C, D, F

    # Individual metrics (0-100 each)
    issue_response_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    pr_merge_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    release_cadence_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    bus_factor_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    documentation_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    dependency_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    velocity_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Raw data for transparency
    avg_issue_response_hours: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    pr_merge_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # Percentage
    days_since_last_release: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    contributor_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    has_readme: Mapped[Optional[bool]] = mapped_column(Integer, nullable=True)  # SQLite bool
    has_contributing: Mapped[Optional[bool]] = mapped_column(Integer, nullable=True)
    has_license: Mapped[Optional[bool]] = mapped_column(Integer, nullable=True)

    # Timestamps
    calculated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    # Relationship
    repo: Mapped["Repo"] = relationship("Repo")

    # Indexes
    __table_args__ = (
        Index("ix_health_scores_overall", "overall_score"),
    )

    def __repr__(self) -> str:
        return f"<HealthScore repo_id={self.repo_id} score={self.overall_score} grade={self.grade}>"


# Tag type constants
class TagType:
    """Constants for tag types."""
    LANGUAGE = "language"    # Programming language tag
    TOPIC = "topic"          # GitHub topics
    INFERRED = "inferred"    # Inferred from description
    CUSTOM = "custom"        # User-defined custom tag


class Tag(Base):
    """
    A tag that can be applied to repositories.
    Tags can be system-generated (auto) or user-created (custom).
    """
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    tag_type: Mapped[str] = mapped_column(String(20), nullable=False)  # language, topic, inferred, custom
    color: Mapped[Optional[str]] = mapped_column(String(7), nullable=True)  # Hex color for UI (e.g., "#3b82f6")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    # Relationships
    repo_tags: Mapped[List["RepoTag"]] = relationship("RepoTag", back_populates="tag", cascade=CASCADE_DELETE_ORPHAN)

    # Indexes
    __table_args__ = (
        Index("ix_tags_type", "tag_type"),
    )

    def __repr__(self) -> str:
        return f"<Tag name={self.name} type={self.tag_type}>"


class RepoTag(Base):
    """
    Many-to-many relationship between repos and tags.
    Stores metadata about how/when the tag was applied.
    """
    __tablename__ = "repo_tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    repo_id: Mapped[int] = mapped_column(Integer, ForeignKey(FK_REPOS_ID, ondelete="CASCADE"), nullable=False)
    tag_id: Mapped[int] = mapped_column(Integer, ForeignKey(FK_TAGS_ID, ondelete="CASCADE"), nullable=False)

    source: Mapped[str] = mapped_column(String(20), nullable=False)  # "auto" or "user"
    confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # 0.0-1.0 for inferred tags
    applied_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    # Relationships
    repo: Mapped["Repo"] = relationship("Repo", back_populates="repo_tags")
    tag: Mapped["Tag"] = relationship("Tag", back_populates="repo_tags")

    # Indexes and constraints
    __table_args__ = (
        UniqueConstraint("repo_id", "tag_id", name="uq_repo_tag"),
        Index("ix_repo_tags_repo", "repo_id"),
        Index("ix_repo_tags_tag", "tag_id"),
    )

    def __repr__(self) -> str:
        return f"<RepoTag repo_id={self.repo_id} tag_id={self.tag_id} source={self.source}>"


class SimilarRepo(Base):
    """
    Stores similarity relationships between repositories in the watchlist.
    Used for recommending similar projects.
    """
    __tablename__ = "similar_repos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    repo_id: Mapped[int] = mapped_column(Integer, ForeignKey(FK_REPOS_ID, ondelete="CASCADE"), nullable=False)
    similar_repo_id: Mapped[int] = mapped_column(Integer, ForeignKey(FK_REPOS_ID, ondelete="CASCADE"), nullable=False)

    # Similarity metrics
    similarity_score: Mapped[float] = mapped_column(Float, nullable=False)  # 0.0-1.0
    shared_topics: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)  # JSON array of shared topics
    same_language: Mapped[bool] = mapped_column(Integer, nullable=False, default=False)  # SQLite bool

    # Timestamps
    calculated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    # Relationships
    repo: Mapped["Repo"] = relationship("Repo", foreign_keys=[repo_id])
    similar: Mapped["Repo"] = relationship("Repo", foreign_keys=[similar_repo_id])

    # Indexes and constraints
    __table_args__ = (
        UniqueConstraint("repo_id", "similar_repo_id", name="uq_similar_repo_pair"),
        Index("ix_similar_repos_repo", "repo_id"),
        Index("ix_similar_repos_score", "similarity_score"),
    )

    def __repr__(self) -> str:
        return f"<SimilarRepo repo_id={self.repo_id} similar_id={self.similar_repo_id} score={self.similarity_score}>"


class Category(Base):
    """
    User-defined category for organizing repositories.
    Supports hierarchical structure via parent_id.
    """
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    icon: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)  # Emoji
    color: Mapped[Optional[str]] = mapped_column(String(7), nullable=True)  # Hex color
    parent_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey(FK_CATEGORIES_ID, ondelete="SET NULL"), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    # Relationships
    parent: Mapped[Optional["Category"]] = relationship("Category", remote_side="Category.id", backref="children")
    repo_categories: Mapped[List["RepoCategory"]] = relationship("RepoCategory", back_populates="category", cascade=CASCADE_DELETE_ORPHAN)

    # Indexes
    __table_args__ = (
        Index("ix_categories_parent", "parent_id"),
        Index("ix_categories_sort", "sort_order"),
    )

    def __repr__(self) -> str:
        return f"<Category id={self.id} name={self.name}>"


class RepoCategory(Base):
    """
    Many-to-many relationship between repos and categories.
    """
    __tablename__ = "repo_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    repo_id: Mapped[int] = mapped_column(Integer, ForeignKey(FK_REPOS_ID, ondelete="CASCADE"), nullable=False)
    category_id: Mapped[int] = mapped_column(Integer, ForeignKey(FK_CATEGORIES_ID, ondelete="CASCADE"), nullable=False)
    added_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    # Relationships
    repo: Mapped["Repo"] = relationship("Repo")
    category: Mapped["Category"] = relationship("Category", back_populates="repo_categories")

    # Indexes and constraints
    __table_args__ = (
        UniqueConstraint("repo_id", "category_id", name="uq_repo_category"),
        Index("ix_repo_categories_repo", "repo_id"),
        Index("ix_repo_categories_category", "category_id"),
    )

    def __repr__(self) -> str:
        return f"<RepoCategory repo_id={self.repo_id} category_id={self.category_id}>"


class ComparisonGroup(Base):
    """
    A group of repositories for comparison.
    E.g., "JS Runtimes" with Bun, Deno, Node.
    """
    __tablename__ = "comparison_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)

    # Relationships
    members: Mapped[List["ComparisonMember"]] = relationship("ComparisonMember", back_populates="group", cascade=CASCADE_DELETE_ORPHAN)

    def __repr__(self) -> str:
        return f"<ComparisonGroup id={self.id} name={self.name}>"


class ComparisonMember(Base):
    """
    A repository member of a comparison group.
    """
    __tablename__ = "comparison_members"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    group_id: Mapped[int] = mapped_column(Integer, ForeignKey(FK_COMPARISON_GROUPS_ID, ondelete="CASCADE"), nullable=False)
    repo_id: Mapped[int] = mapped_column(Integer, ForeignKey(FK_REPOS_ID, ondelete="CASCADE"), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    added_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    # Relationships
    group: Mapped["ComparisonGroup"] = relationship("ComparisonGroup", back_populates="members")
    repo: Mapped["Repo"] = relationship("Repo")

    # Indexes and constraints
    __table_args__ = (
        UniqueConstraint("group_id", "repo_id", name="uq_comparison_member"),
        Index("ix_comparison_members_group", "group_id"),
    )

    def __repr__(self) -> str:
        return f"<ComparisonMember group_id={self.group_id} repo_id={self.repo_id}>"


# Early Signal type constants
class EarlySignalType:
    """Constants for early signal types."""
    RISING_STAR = "rising_star"      # High velocity + low star count
    SUDDEN_SPIKE = "sudden_spike"    # Single-day anomalous growth
    BREAKOUT = "breakout"            # Acceleration turning positive
    VIRAL_HN = "viral_hn"            # Hot on Hacker News
    RELEASE_SURGE = "release_surge"  # Surge after release


class EarlySignalSeverity:
    """Severity levels for early signals."""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class EarlySignal(Base):
    """
    Detected early signals/anomalies for repositories.
    Helps identify rising projects and unusual activity.
    """
    __tablename__ = "early_signals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    repo_id: Mapped[int] = mapped_column(Integer, ForeignKey(FK_REPOS_ID, ondelete="CASCADE"), nullable=False)

    # Signal details
    signal_type: Mapped[str] = mapped_column(String(50), nullable=False)
    severity: Mapped[str] = mapped_column(String(20), nullable=False)  # low, medium, high
    description: Mapped[str] = mapped_column(String(500), nullable=False)

    # Metrics at detection time
    velocity_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    star_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    percentile_rank: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # 0-100

    # Timestamps
    detected_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # User interaction
    acknowledged: Mapped[bool] = mapped_column(Integer, default=False)  # SQLite bool
    acknowledged_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # Relationship
    repo: Mapped["Repo"] = relationship("Repo")

    # Indexes
    __table_args__ = (
        Index("ix_early_signals_repo", "repo_id"),
        Index("ix_early_signals_type", "signal_type"),
        Index("ix_early_signals_detected", "detected_at"),
        Index("ix_early_signals_severity", "severity"),
    )

    def __repr__(self) -> str:
        return f"<EarlySignal repo_id={self.repo_id} type={self.signal_type} severity={self.severity}>"


# ==================== Webhook Models ====================

class WebhookType:
    """Constants for webhook types."""
    SLACK = "slack"
    DISCORD = "discord"
    GENERIC = "generic"  # Generic HTTP POST


class WebhookTrigger:
    """Constants for webhook trigger events."""
    SIGNAL_DETECTED = "signal_detected"    # New early signal
    DAILY_DIGEST = "daily_digest"          # Daily summary
    WEEKLY_DIGEST = "weekly_digest"        # Weekly summary
    THRESHOLD_ALERT = "threshold_alert"    # Custom threshold exceeded


class Webhook(Base):
    """
    Configured webhooks for notifications.
    Supports Slack, Discord, and generic HTTP POST.
    """
    __tablename__ = "webhooks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    webhook_type: Mapped[str] = mapped_column(String(20), nullable=False)  # slack, discord, generic
    url: Mapped[str] = mapped_column(String(1024), nullable=False)

    # Trigger configuration
    triggers: Mapped[str] = mapped_column(String(500), nullable=False)  # JSON array of trigger types
    min_severity: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # low, medium, high

    # Status
    enabled: Mapped[bool] = mapped_column(Integer, default=True)  # SQLite bool
    last_triggered: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_error: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)

    # Relationship
    logs: Mapped[List["WebhookLog"]] = relationship("WebhookLog", back_populates="webhook", cascade=CASCADE_DELETE_ORPHAN)

    __table_args__ = (
        Index("ix_webhooks_type", "webhook_type"),
        Index("ix_webhooks_enabled", "enabled"),
    )

    def __repr__(self) -> str:
        return f"<Webhook name={self.name} type={self.webhook_type}>"


class WebhookLog(Base):
    """
    Log of webhook invocations.
    Tracks success/failure for debugging.
    """
    __tablename__ = "webhook_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    webhook_id: Mapped[int] = mapped_column(Integer, ForeignKey(FK_WEBHOOKS_ID, ondelete="CASCADE"), nullable=False)

    # Request details
    trigger_type: Mapped[str] = mapped_column(String(50), nullable=False)
    payload_summary: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # Response
    success: Mapped[bool] = mapped_column(Integer, default=False)  # SQLite bool
    status_code: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # Timestamp
    sent_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)

    # Relationship
    webhook: Mapped["Webhook"] = relationship("Webhook", back_populates="logs")

    __table_args__ = (
        Index("ix_webhook_logs_webhook", "webhook_id"),
        Index("ix_webhook_logs_sent", "sent_at"),
    )

    def __repr__(self) -> str:
        return f"<WebhookLog webhook_id={self.webhook_id} success={self.success}>"


# ==================== App Settings Models ====================

class AppSettingKey:
    """Constants for app setting keys."""
    GITHUB_TOKEN = "github_token"
    GITHUB_USERNAME = "github_username"


class AppSetting(Base):
    """
    Application settings stored in database.
    Used for storing user preferences and credentials like GitHub OAuth tokens.
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
