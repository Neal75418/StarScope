"""Add app_settings table for storing application configuration.

Revision ID: 20260118_add_app_settings
Revises: 20260117_000000
Create Date: 2026-01-18

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260118_add_app_settings"
down_revision: Union[str, None] = "initial_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create app_settings table."""
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
    op.create_index("ix_app_settings_key", "app_settings", ["key"], unique=False)


def downgrade() -> None:
    """Drop app_settings table."""
    op.drop_index("ix_app_settings_key", table_name="app_settings")
    op.drop_table("app_settings")
