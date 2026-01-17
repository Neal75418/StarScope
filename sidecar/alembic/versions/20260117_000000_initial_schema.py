"""Initial schema - captures existing database structure

Revision ID: initial_schema
Revises:
Create Date: 2026-01-17

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'initial_schema'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create repos table
    op.create_table(
        'repos',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('owner', sa.String(255), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('full_name', sa.String(512), nullable=False),
        sa.Column('url', sa.String(1024), nullable=False),
        sa.Column('description', sa.String(2048), nullable=True),
        sa.Column('github_id', sa.Integer(), nullable=True),
        sa.Column('default_branch', sa.String(255), nullable=True),
        sa.Column('language', sa.String(100), nullable=True),
        sa.Column('topics', sa.String(2048), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('added_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('full_name')
    )
    op.create_index('ix_repos_owner_name', 'repos', ['owner', 'name'])

    # Create repo_snapshots table
    op.create_table(
        'repo_snapshots',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('repo_id', sa.Integer(), nullable=False),
        sa.Column('stars', sa.Integer(), nullable=False),
        sa.Column('forks', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('watchers', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('open_issues', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('snapshot_date', sa.Date(), nullable=False),
        sa.Column('fetched_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['repo_id'], ['repos.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('repo_id', 'snapshot_date', name='uq_snapshot_repo_date')
    )
    op.create_index('ix_snapshots_repo_date', 'repo_snapshots', ['repo_id', 'snapshot_date'])
    op.create_index('ix_snapshots_date', 'repo_snapshots', ['snapshot_date'])

    # Create signals table
    op.create_table(
        'signals',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('repo_id', sa.Integer(), nullable=False),
        sa.Column('signal_type', sa.String(50), nullable=False),
        sa.Column('value', sa.Float(), nullable=False),
        sa.Column('calculated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['repo_id'], ['repos.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_signals_repo_type', 'signals', ['repo_id', 'signal_type'])

    # Create alert_rules table
    op.create_table(
        'alert_rules',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.String(1024), nullable=True),
        sa.Column('repo_id', sa.Integer(), nullable=True),
        sa.Column('signal_type', sa.String(50), nullable=False),
        sa.Column('operator', sa.String(10), nullable=False),
        sa.Column('threshold', sa.Float(), nullable=False),
        sa.Column('enabled', sa.Integer(), server_default='1'),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['repo_id'], ['repos.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )

    # Create triggered_alerts table
    op.create_table(
        'triggered_alerts',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('rule_id', sa.Integer(), nullable=False),
        sa.Column('repo_id', sa.Integer(), nullable=False),
        sa.Column('signal_value', sa.Float(), nullable=False),
        sa.Column('triggered_at', sa.DateTime(), nullable=True),
        sa.Column('acknowledged', sa.Integer(), server_default='0'),
        sa.Column('acknowledged_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['repo_id'], ['repos.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['rule_id'], ['alert_rules.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_triggered_alerts_rule', 'triggered_alerts', ['rule_id'])
    op.create_index('ix_triggered_alerts_repo', 'triggered_alerts', ['repo_id'])
    op.create_index('ix_triggered_alerts_time', 'triggered_alerts', ['triggered_at'])

    # Create context_signals table
    op.create_table(
        'context_signals',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('repo_id', sa.Integer(), nullable=False),
        sa.Column('signal_type', sa.String(50), nullable=False),
        sa.Column('external_id', sa.String(255), nullable=False),
        sa.Column('title', sa.String(1024), nullable=False),
        sa.Column('url', sa.String(2048), nullable=False),
        sa.Column('score', sa.Integer(), nullable=True),
        sa.Column('comment_count', sa.Integer(), nullable=True),
        sa.Column('author', sa.String(255), nullable=True),
        sa.Column('version_tag', sa.String(100), nullable=True),
        sa.Column('is_prerelease', sa.Integer(), nullable=True),
        sa.Column('published_at', sa.DateTime(), nullable=True),
        sa.Column('fetched_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['repo_id'], ['repos.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('repo_id', 'signal_type', 'external_id', name='uq_context_signal_unique')
    )
    op.create_index('ix_context_signals_repo_type', 'context_signals', ['repo_id', 'signal_type'])
    op.create_index('ix_context_signals_published', 'context_signals', ['published_at'])

    # Create health_scores table
    op.create_table(
        'health_scores',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('repo_id', sa.Integer(), nullable=False),
        sa.Column('overall_score', sa.Float(), nullable=False),
        sa.Column('grade', sa.String(2), nullable=False),
        sa.Column('issue_response_score', sa.Float(), nullable=True),
        sa.Column('pr_merge_score', sa.Float(), nullable=True),
        sa.Column('release_cadence_score', sa.Float(), nullable=True),
        sa.Column('bus_factor_score', sa.Float(), nullable=True),
        sa.Column('documentation_score', sa.Float(), nullable=True),
        sa.Column('dependency_score', sa.Float(), nullable=True),
        sa.Column('velocity_score', sa.Float(), nullable=True),
        sa.Column('avg_issue_response_hours', sa.Float(), nullable=True),
        sa.Column('pr_merge_rate', sa.Float(), nullable=True),
        sa.Column('days_since_last_release', sa.Integer(), nullable=True),
        sa.Column('contributor_count', sa.Integer(), nullable=True),
        sa.Column('has_readme', sa.Integer(), nullable=True),
        sa.Column('has_contributing', sa.Integer(), nullable=True),
        sa.Column('has_license', sa.Integer(), nullable=True),
        sa.Column('calculated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['repo_id'], ['repos.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('repo_id')
    )
    op.create_index('ix_health_scores_overall', 'health_scores', ['overall_score'])

    # Create tags table
    op.create_table(
        'tags',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('tag_type', sa.String(20), nullable=False),
        sa.Column('color', sa.String(7), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name')
    )
    op.create_index('ix_tags_type', 'tags', ['tag_type'])

    # Create repo_tags table
    op.create_table(
        'repo_tags',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('repo_id', sa.Integer(), nullable=False),
        sa.Column('tag_id', sa.Integer(), nullable=False),
        sa.Column('source', sa.String(20), nullable=False),
        sa.Column('confidence', sa.Float(), nullable=True),
        sa.Column('applied_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['repo_id'], ['repos.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['tag_id'], ['tags.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('repo_id', 'tag_id', name='uq_repo_tag')
    )
    op.create_index('ix_repo_tags_repo', 'repo_tags', ['repo_id'])
    op.create_index('ix_repo_tags_tag', 'repo_tags', ['tag_id'])

    # Create similar_repos table
    op.create_table(
        'similar_repos',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('repo_id', sa.Integer(), nullable=False),
        sa.Column('similar_repo_id', sa.Integer(), nullable=False),
        sa.Column('similarity_score', sa.Float(), nullable=False),
        sa.Column('shared_topics', sa.String(2048), nullable=True),
        sa.Column('same_language', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('calculated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['repo_id'], ['repos.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['similar_repo_id'], ['repos.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('repo_id', 'similar_repo_id', name='uq_similar_repo_pair')
    )
    op.create_index('ix_similar_repos_repo', 'similar_repos', ['repo_id'])
    op.create_index('ix_similar_repos_score', 'similar_repos', ['similarity_score'])

    # Create categories table
    op.create_table(
        'categories',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('description', sa.String(500), nullable=True),
        sa.Column('icon', sa.String(10), nullable=True),
        sa.Column('color', sa.String(7), nullable=True),
        sa.Column('parent_id', sa.Integer(), nullable=True),
        sa.Column('sort_order', sa.Integer(), server_default='0'),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['parent_id'], ['categories.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_categories_parent', 'categories', ['parent_id'])
    op.create_index('ix_categories_sort', 'categories', ['sort_order'])

    # Create repo_categories table
    op.create_table(
        'repo_categories',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('repo_id', sa.Integer(), nullable=False),
        sa.Column('category_id', sa.Integer(), nullable=False),
        sa.Column('added_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['category_id'], ['categories.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['repo_id'], ['repos.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('repo_id', 'category_id', name='uq_repo_category')
    )
    op.create_index('ix_repo_categories_repo', 'repo_categories', ['repo_id'])
    op.create_index('ix_repo_categories_category', 'repo_categories', ['category_id'])

    # Create comparison_groups table
    op.create_table(
        'comparison_groups',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('description', sa.String(1000), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )

    # Create comparison_members table
    op.create_table(
        'comparison_members',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('group_id', sa.Integer(), nullable=False),
        sa.Column('repo_id', sa.Integer(), nullable=False),
        sa.Column('sort_order', sa.Integer(), server_default='0'),
        sa.Column('added_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['group_id'], ['comparison_groups.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['repo_id'], ['repos.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('group_id', 'repo_id', name='uq_comparison_member')
    )
    op.create_index('ix_comparison_members_group', 'comparison_members', ['group_id'])

    # Create early_signals table
    op.create_table(
        'early_signals',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('repo_id', sa.Integer(), nullable=False),
        sa.Column('signal_type', sa.String(50), nullable=False),
        sa.Column('severity', sa.String(20), nullable=False),
        sa.Column('description', sa.String(500), nullable=False),
        sa.Column('velocity_value', sa.Float(), nullable=True),
        sa.Column('star_count', sa.Integer(), nullable=True),
        sa.Column('percentile_rank', sa.Float(), nullable=True),
        sa.Column('detected_at', sa.DateTime(), nullable=True),
        sa.Column('expires_at', sa.DateTime(), nullable=True),
        sa.Column('acknowledged', sa.Integer(), server_default='0'),
        sa.Column('acknowledged_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['repo_id'], ['repos.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_early_signals_repo', 'early_signals', ['repo_id'])
    op.create_index('ix_early_signals_type', 'early_signals', ['signal_type'])
    op.create_index('ix_early_signals_detected', 'early_signals', ['detected_at'])
    op.create_index('ix_early_signals_severity', 'early_signals', ['severity'])

    # Create webhooks table
    op.create_table(
        'webhooks',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('webhook_type', sa.String(20), nullable=False),
        sa.Column('url', sa.String(1024), nullable=False),
        sa.Column('triggers', sa.String(500), nullable=False),
        sa.Column('min_severity', sa.String(20), nullable=True),
        sa.Column('enabled', sa.Integer(), server_default='1'),
        sa.Column('last_triggered', sa.DateTime(), nullable=True),
        sa.Column('last_error', sa.String(500), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_webhooks_type', 'webhooks', ['webhook_type'])
    op.create_index('ix_webhooks_enabled', 'webhooks', ['enabled'])

    # Create webhook_logs table
    op.create_table(
        'webhook_logs',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('webhook_id', sa.Integer(), nullable=False),
        sa.Column('trigger_type', sa.String(50), nullable=False),
        sa.Column('payload_summary', sa.String(500), nullable=True),
        sa.Column('success', sa.Integer(), server_default='0'),
        sa.Column('status_code', sa.Integer(), nullable=True),
        sa.Column('error_message', sa.String(500), nullable=True),
        sa.Column('sent_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['webhook_id'], ['webhooks.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_webhook_logs_webhook', 'webhook_logs', ['webhook_id'])
    op.create_index('ix_webhook_logs_sent', 'webhook_logs', ['sent_at'])


def downgrade() -> None:
    # Drop tables in reverse order (respecting foreign key constraints)
    op.drop_table('webhook_logs')
    op.drop_table('webhooks')
    op.drop_table('early_signals')
    op.drop_table('comparison_members')
    op.drop_table('comparison_groups')
    op.drop_table('repo_categories')
    op.drop_table('categories')
    op.drop_table('similar_repos')
    op.drop_table('repo_tags')
    op.drop_table('tags')
    op.drop_table('health_scores')
    op.drop_table('context_signals')
    op.drop_table('triggered_alerts')
    op.drop_table('alert_rules')
    op.drop_table('signals')
    op.drop_table('repo_snapshots')
    op.drop_table('repos')
