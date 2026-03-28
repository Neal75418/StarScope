"""Initial schema — all production tables.

Revision ID: initial_schema
Revises:
Create Date: 2026-01-17

"""
from typing import Sequence, Union

from alembic import op  # noqa: F401
from alembic.operations import Operations
import sqlalchemy as sa

op: Operations

FK_REPOS_ID = "repos.id"
FK_CATEGORIES_ID = "categories.id"
FK_ALERT_RULES_ID = "alert_rules.id"

revision: str = "initial_schema"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # repos
    op.create_table(
        "repos",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("owner", sa.String(255), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("full_name", sa.String(512), nullable=False),
        sa.Column("url", sa.String(1024), nullable=False),
        sa.Column("description", sa.String(2048), nullable=True),
        sa.Column("github_id", sa.Integer(), nullable=True),
        sa.Column("default_branch", sa.String(255), nullable=True),
        sa.Column("language", sa.String(100), nullable=True),
        sa.Column("topics", sa.String(2048), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("added_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("full_name"),
    )
    op.create_index("ix_repos_owner_name", "repos", ["owner", "name"])

    # repo_snapshots
    op.create_table(
        "repo_snapshots",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("repo_id", sa.Integer(), nullable=False),
        sa.Column("stars", sa.Integer(), nullable=False),
        sa.Column("forks", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("watchers", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("open_issues", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("snapshot_date", sa.Date(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["repo_id"], [FK_REPOS_ID], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("repo_id", "snapshot_date", name="uq_snapshot_repo_date"),
    )
    op.create_index("ix_snapshots_repo_date", "repo_snapshots", ["repo_id", "snapshot_date"])
    op.create_index("ix_snapshots_date", "repo_snapshots", ["snapshot_date"])

    # signals
    op.create_table(
        "signals",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("repo_id", sa.Integer(), nullable=False),
        sa.Column("signal_type", sa.String(50), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("calculated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["repo_id"], [FK_REPOS_ID], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_signals_repo_type", "signals", ["repo_id", "signal_type"])

    # alert_rules
    op.create_table(
        "alert_rules",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.String(1024), nullable=True),
        sa.Column("repo_id", sa.Integer(), nullable=True),
        sa.Column("signal_type", sa.String(50), nullable=False),
        sa.Column("operator", sa.String(10), nullable=False),
        sa.Column("threshold", sa.Float(), nullable=False),
        sa.Column("enabled", sa.Integer(), server_default="1"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["repo_id"], [FK_REPOS_ID], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    # triggered_alerts
    op.create_table(
        "triggered_alerts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("rule_id", sa.Integer(), nullable=False),
        sa.Column("repo_id", sa.Integer(), nullable=False),
        sa.Column("signal_value", sa.Float(), nullable=False),
        sa.Column("triggered_at", sa.DateTime(), nullable=True),
        sa.Column("acknowledged", sa.Integer(), server_default="0"),
        sa.Column("acknowledged_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["repo_id"], [FK_REPOS_ID], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["rule_id"], [FK_ALERT_RULES_ID], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_triggered_alerts_rule", "triggered_alerts", ["rule_id"])
    op.create_index("ix_triggered_alerts_repo", "triggered_alerts", ["repo_id"])
    op.create_index("ix_triggered_alerts_time", "triggered_alerts", ["triggered_at"])

    # context_signals
    op.create_table(
        "context_signals",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("repo_id", sa.Integer(), nullable=False),
        sa.Column("signal_type", sa.String(50), nullable=False),
        sa.Column("external_id", sa.String(255), nullable=False),
        sa.Column("title", sa.String(1024), nullable=False),
        sa.Column("url", sa.String(2048), nullable=False),
        sa.Column("score", sa.Integer(), nullable=True),
        sa.Column("comment_count", sa.Integer(), nullable=True),
        sa.Column("author", sa.String(255), nullable=True),
        sa.Column("published_at", sa.DateTime(), nullable=True),
        sa.Column("fetched_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["repo_id"], [FK_REPOS_ID], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("repo_id", "signal_type", "external_id", name="uq_context_signal_unique"),
    )
    op.create_index("ix_context_signals_repo_type", "context_signals", ["repo_id", "signal_type"])
    op.create_index("ix_context_signals_published", "context_signals", ["published_at"])

    # similar_repos
    op.create_table(
        "similar_repos",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("repo_id", sa.Integer(), nullable=False),
        sa.Column("similar_repo_id", sa.Integer(), nullable=False),
        sa.Column("similarity_score", sa.Float(), nullable=False),
        sa.Column("shared_topics", sa.String(2048), nullable=True),
        sa.Column("same_language", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("calculated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["repo_id"], [FK_REPOS_ID], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["similar_repo_id"], [FK_REPOS_ID], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("repo_id", "similar_repo_id", name="uq_similar_repo_pair"),
    )
    op.create_index("ix_similar_repos_repo", "similar_repos", ["repo_id"])
    op.create_index("ix_similar_repos_score", "similar_repos", ["similarity_score"])

    # categories
    op.create_table(
        "categories",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.String(500), nullable=True),
        sa.Column("icon", sa.String(10), nullable=True),
        sa.Column("color", sa.String(7), nullable=True),
        sa.Column("parent_id", sa.Integer(), nullable=True),
        sa.Column("sort_order", sa.Integer(), server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["parent_id"], [FK_CATEGORIES_ID], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_categories_parent", "categories", ["parent_id"])
    op.create_index("ix_categories_sort", "categories", ["sort_order"])

    # repo_categories
    op.create_table(
        "repo_categories",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("repo_id", sa.Integer(), nullable=False),
        sa.Column("category_id", sa.Integer(), nullable=False),
        sa.Column("added_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["category_id"], [FK_CATEGORIES_ID], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["repo_id"], [FK_REPOS_ID], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("repo_id", "category_id", name="uq_repo_category"),
    )
    op.create_index("ix_repo_categories_repo", "repo_categories", ["repo_id"])
    op.create_index("ix_repo_categories_category", "repo_categories", ["category_id"])

    # early_signals
    op.create_table(
        "early_signals",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("repo_id", sa.Integer(), nullable=False),
        sa.Column("signal_type", sa.String(50), nullable=False),
        sa.Column("severity", sa.String(20), nullable=False),
        sa.Column("description", sa.String(500), nullable=False),
        sa.Column("velocity_value", sa.Float(), nullable=True),
        sa.Column("star_count", sa.Integer(), nullable=True),
        sa.Column("percentile_rank", sa.Float(), nullable=True),
        sa.Column("detected_at", sa.DateTime(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("acknowledged", sa.Integer(), server_default="0"),
        sa.Column("acknowledged_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["repo_id"], [FK_REPOS_ID], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_early_signals_repo", "early_signals", ["repo_id"])
    op.create_index("ix_early_signals_type", "early_signals", ["signal_type"])
    op.create_index("ix_early_signals_detected", "early_signals", ["detected_at"])
    op.create_index("ix_early_signals_severity", "early_signals", ["severity"])

    # app_settings
    op.create_table(
        "app_settings",
        sa.Column("id", sa.Integer(), nullable=False, autoincrement=True),
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("value", sa.String(length=4096), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key"),
    )
    op.create_index("ix_app_settings_key", "app_settings", ["key"])


def downgrade() -> None:
    op.drop_table("app_settings")
    op.drop_table("early_signals")
    op.drop_table("repo_categories")
    op.drop_table("categories")
    op.drop_table("similar_repos")
    op.drop_table("context_signals")
    op.drop_table("triggered_alerts")
    op.drop_table("alert_rules")
    op.drop_table("signals")
    op.drop_table("repo_snapshots")
    op.drop_table("repos")
