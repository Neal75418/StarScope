"""
Pytest fixtures for StarScope tests.
"""

import os
import sys
from typing import Generator
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import StaticPool

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db.models import Base
from db.database import get_db


# Create in-memory SQLite database for tests
SQLALCHEMY_TEST_DATABASE_URL = "sqlite:///:memory:"


@pytest.fixture(scope="function")
def test_engine():
    """Create a test database engine."""
    engine = create_engine(
        SQLALCHEMY_TEST_DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="function")
def test_db(test_engine) -> Generator[Session, None, None]:
    """Create a test database session."""
    testing_session_local = sessionmaker(
        autocommit=False, autoflush=False, expire_on_commit=False, bind=test_engine
    )
    db = testing_session_local()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="function")
def test_session_local(test_engine):
    """Create a session factory bound to the test engine."""
    return sessionmaker(autocommit=False, autoflush=False, expire_on_commit=False, bind=test_engine)


@pytest.fixture(scope="function")
def client(test_db, test_session_local) -> Generator[TestClient, None, None]:
    """
    Create a test client with database override.
    Mocks the scheduler to prevent background tasks during tests.
    Also patches SessionLocal to use the test database for services that bypass DI.
    """
    # Mock scheduler, init_db, and trigger_fetch_now to prevent lifespan
    # from interfering with the test session's SQLite connection.
    # Also patch SessionLocal so services like settings.py use test DB.
    with patch("services.scheduler.start_scheduler") as mock_start, \
         patch("services.scheduler.stop_scheduler") as mock_stop, \
         patch("services.scheduler.trigger_fetch_now", return_value=None), \
         patch("main.init_db"), \
         patch("db.database.SessionLocal", test_session_local), \
         patch("services.settings.SessionLocal", test_session_local):
        mock_start.return_value = None
        mock_stop.return_value = None

        # Import app after patching to ensure patches take effect
        from main import app

        def override_get_db():
            yield test_db

        app.dependency_overrides[get_db] = override_get_db
        with TestClient(app) as test_client:
            yield test_client
        app.dependency_overrides.clear()


@pytest.fixture
def sample_repo_data():
    """Sample repository data for testing."""
    return {
        "owner": "facebook",
        "name": "react"
    }


@pytest.fixture
def sample_repo_url_data():
    """Sample repository data with URL for testing."""
    return {
        "url": "https://github.com/facebook/react"
    }


@pytest.fixture
def mock_repo(test_db):
    """Create a mock repository in the database."""
    from db.models import Repo
    from utils.time import utc_now

    repo = Repo(
        owner="testowner",
        name="testrepo",
        full_name="testowner/testrepo",
        url="https://github.com/testowner/testrepo",
        description="A test repository",
        github_id=12345,
        default_branch="main",
        language="Python",
        topics='["testing", "python"]',
        created_at=utc_now(),
        added_at=utc_now(),
        updated_at=utc_now(),
    )
    test_db.add(repo)
    test_db.commit()
    return repo


@pytest.fixture
def mock_repo_with_snapshots(test_db, mock_repo):
    """Create a mock repository with historical snapshots."""
    from datetime import timedelta
    from db.models import RepoSnapshot
    from utils.time import utc_now

    today = utc_now().date()
    snapshots = []

    # Create 30 days of snapshots with growing stars
    for i in range(30, 0, -1):
        snapshot = RepoSnapshot(
            repo_id=mock_repo.id,
            stars=1000 + (30 - i) * 50,  # Growing from 1000 to 2450
            forks=100 + (30 - i) * 5,
            watchers=50,
            open_issues=10,
            snapshot_date=today - timedelta(days=i),
            fetched_at=utc_now() - timedelta(days=i),
        )
        test_db.add(snapshot)
        snapshots.append(snapshot)

    test_db.commit()
    return mock_repo, snapshots


@pytest.fixture
def mock_repo_with_signals(test_db, mock_repo):
    """Create a mock repository with calculated signals."""
    from db.models import Signal
    from utils.time import utc_now

    signal = Signal(
        repo_id=mock_repo.id,
        signal_type="star_velocity",
        value=50.0,
        calculated_at=utc_now(),
    )
    test_db.add(signal)
    test_db.commit()
    return mock_repo, signal


@pytest.fixture
def mock_multiple_repos(test_db):
    """Create multiple mock repositories for comparison tests."""
    from db.models import Repo
    from utils.time import utc_now

    repos = []
    repo_data = [
        ("facebook", "react", "JavaScript"),
        ("vuejs", "vue", "TypeScript"),
        ("angular", "angular", "TypeScript"),
    ]

    for owner, name, lang in repo_data:
        repo = Repo(
            owner=owner,
            name=name,
            full_name=f"{owner}/{name}",
            url=f"https://github.com/{owner}/{name}",
            description=f"The {name} framework",
            github_id=hash(f"{owner}/{name}") % 1000000,
            default_branch="main",
            language=lang,
            created_at=utc_now(),
            added_at=utc_now(),
            updated_at=utc_now(),
        )
        test_db.add(repo)
        repos.append(repo)

    test_db.commit()
    return repos


@pytest.fixture
def mock_category(test_db):
    """Create a mock category."""
    from db.models import Category
    from utils.time import utc_now

    category = Category(
        name="Frontend Frameworks",
        description="JavaScript/TypeScript UI frameworks",
        created_at=utc_now(),
    )
    test_db.add(category)
    test_db.commit()
    return category


@pytest.fixture
def mock_early_signal(test_db, mock_repo):
    """Create a mock early signal."""
    from db.models import EarlySignal
    from utils.time import utc_now

    signal = EarlySignal(
        repo_id=mock_repo.id,
        signal_type="rising_star",
        severity="high",
        description="Repository showing strong velocity growth",
        velocity_value=50.0,
        star_count=1000,
        percentile_rank=85.0,
        detected_at=utc_now(),
    )
    test_db.add(signal)
    test_db.commit()
    return mock_repo, signal


