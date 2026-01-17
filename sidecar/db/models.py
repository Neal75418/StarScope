"""
SQLAlchemy ORM models for StarScope.

Tables:
- repos: GitHub repositories being watched
- repo_snapshots: Historical snapshots of repo stats
- signals: Calculated signals (velocity, delta, etc.)
"""

from datetime import datetime, date
from typing import Optional, List
from sqlalchemy import Column, Integer, String, Float, DateTime, Date, ForeignKey, Index
from sqlalchemy.orm import DeclarativeBase, relationship, Mapped, mapped_column


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

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)  # GitHub creation date
    added_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)  # Added to watchlist
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    snapshots: Mapped[List["RepoSnapshot"]] = relationship("RepoSnapshot", back_populates="repo", cascade="all, delete-orphan")
    signals: Mapped[List["Signal"]] = relationship("Signal", back_populates="repo", cascade="all, delete-orphan")

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
    repo_id: Mapped[int] = mapped_column(Integer, ForeignKey("repos.id", ondelete="CASCADE"), nullable=False)

    # Stats at this point in time
    stars: Mapped[int] = mapped_column(Integer, nullable=False)
    forks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    watchers: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    open_issues: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Timestamps
    snapshot_date: Mapped[date] = mapped_column(Date, nullable=False)  # Date of snapshot (one per day)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationship
    repo: Mapped["Repo"] = relationship("Repo", back_populates="snapshots")

    # Indexes
    __table_args__ = (
        Index("ix_snapshots_repo_date", "repo_id", "snapshot_date"),
        Index("ix_snapshots_date", "snapshot_date"),
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
    repo_id: Mapped[int] = mapped_column(Integer, ForeignKey("repos.id", ondelete="CASCADE"), nullable=False)

    # Signal data
    signal_type: Mapped[str] = mapped_column(String(50), nullable=False)  # e.g., "stars_delta_7d", "velocity"
    value: Mapped[float] = mapped_column(Float, nullable=False)

    # Timestamps
    calculated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationship
    repo: Mapped["Repo"] = relationship("Repo", back_populates="signals")

    # Indexes
    __table_args__ = (
        Index("ix_signals_repo_type", "repo_id", "signal_type"),
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
    repo_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("repos.id", ondelete="CASCADE"), nullable=True)

    # Condition
    signal_type: Mapped[str] = mapped_column(String(50), nullable=False)  # e.g., "stars_delta_7d", "velocity"
    operator: Mapped[str] = mapped_column(String(10), nullable=False)  # ">", "<", ">=", "<=", "=="
    threshold: Mapped[float] = mapped_column(Float, nullable=False)

    # Status
    enabled: Mapped[bool] = mapped_column(Integer, default=True)  # SQLite doesn't have bool, use int

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    repo: Mapped[Optional["Repo"]] = relationship("Repo")
    triggered_alerts: Mapped[List["TriggeredAlert"]] = relationship("TriggeredAlert", back_populates="rule", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        target = self.repo.full_name if self.repo else "all repos"
        return f"<AlertRule {self.name}: {self.signal_type} {self.operator} {self.threshold} for {target}>"


class TriggeredAlert(Base):
    """
    A record of when an alert rule was triggered.
    """
    __tablename__ = "triggered_alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rule_id: Mapped[int] = mapped_column(Integer, ForeignKey("alert_rules.id", ondelete="CASCADE"), nullable=False)
    repo_id: Mapped[int] = mapped_column(Integer, ForeignKey("repos.id", ondelete="CASCADE"), nullable=False)

    # Trigger details
    signal_value: Mapped[float] = mapped_column(Float, nullable=False)  # The value that triggered the alert
    triggered_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

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
