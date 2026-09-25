"""
Pytest fixtures for StarScope tests.
"""

import os
import sys
from typing import Generator
from unittest.mock import AsyncMock, patch

import pytest
from constants import SignalType
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import StaticPool

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db.models import Base
from db.database import get_db
from db.soft_delete import install_archive_filter

# 正式環境在 init_db() 註冊，但測試不走 init_db——不在這裡裝的話，測試看到的是
# 沒有封存過濾的行為，等於整組滲漏測試都在測一個不存在的預設
install_archive_filter()


@pytest.fixture(scope="session", autouse=True)
def isolate_github_credentials() -> Generator[None, None, None]:
    """讓測試碰不到開發者的 GitHub 憑證（Keychain 與 GITHUB_TOKEN 環境變數）。

    client 的 lifespan 會跑 star 同步，不隔離的話在開發機上會用真 token 打 GitHub；
    忘了 mock 的寫入路徑（儲存、刪除 token）則會直接改動開發者的 Keychain。
    null backend 對所有操作都回 None：寫入後的讀回驗證會失敗，而不是悄悄寫進真的 Keychain。

    GITHUB_TOKEN 設成空字串而不是刪掉：main.py 在 import 時呼叫 load_dotenv()，它不覆蓋
    已存在的 key，但會把不存在的 key 從 .env 補回來。它從 main.py 所在目錄往上找第一個
    .env（coverage／debugger 底下改從 cwd 找）——沒有 sidecar/.env 時就會找到 repo 根目錄
    那份放著真 token 的。
    """
    import keyring
    from keyring.backends.null import Keyring as NullKeyring
    from constants import GITHUB_TOKEN_ENV_VAR

    previous_backend = keyring.get_keyring()
    previous_token = os.environ.get(GITHUB_TOKEN_ENV_VAR)
    keyring.set_keyring(NullKeyring())
    os.environ[GITHUB_TOKEN_ENV_VAR] = ""
    try:
        yield
    finally:
        keyring.set_keyring(previous_backend)
        if previous_token is None:
            os.environ.pop(GITHUB_TOKEN_ENV_VAR, None)
        else:
            os.environ[GITHUB_TOKEN_ENV_VAR] = previous_token


@pytest.fixture(scope="session", autouse=True)
def block_real_network() -> Generator[None, None, None]:
    """httpx 的真 transport 一律拋錯，測試裡的 httpx 請求連不到外網。

    沒有它，只要某條路徑漏了 mock（例如 lifespan 的 star 同步被某個 fixture 放行），
    測試就會真的打到 api.github.com。擋下的錯誤一樣會被呼叫端吞掉、全套照樣綠，
    只在 captured log 留一行「測試不能連外網」——它擋的是流量，不負責讓漏 mock 浮上來。
    MockTransport 與 TestClient 用的是別的 transport，不受影響；httpx 以外的連線
    （例如 run_jobs.py 的 socket 探測）不歸它管。
    """
    import httpx

    def _refuse(request: httpx.Request) -> None:
        raise RuntimeError(f"測試不能連外網：{request.method} {request.url}")

    def _sync(self, request, *args, **kwargs):
        _refuse(request)

    async def _async(self, request, *args, **kwargs):
        _refuse(request)

    original_sync = httpx.HTTPTransport.handle_request
    original_async = httpx.AsyncHTTPTransport.handle_async_request
    httpx.HTTPTransport.handle_request = _sync  # type: ignore[method-assign]
    httpx.AsyncHTTPTransport.handle_async_request = _async  # type: ignore[method-assign]
    try:
        yield
    finally:
        httpx.HTTPTransport.handle_request = original_sync  # type: ignore[method-assign]
        httpx.AsyncHTTPTransport.handle_async_request = original_async  # type: ignore[method-assign]


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
         patch("services.scheduler.stop_scheduler", new_callable=AsyncMock), \
         patch("services.scheduler.trigger_fetch_now", return_value=None), \
         patch("main.init_db"), \
         patch("db.database.SessionLocal", test_session_local), \
         patch("services.settings.SessionLocal", test_session_local):
        mock_start.return_value = None

        # Import app after patching to ensure patches take effect
        from main import app

        def override_get_db():
            yield test_db

        app.dependency_overrides[get_db] = override_get_db
        # 預設的 Host "testserver" 會被 LocalRequestGuardMiddleware 擋掉
        with TestClient(app, base_url="http://127.0.0.1:8008") as test_client:
            yield test_client
        app.dependency_overrides.clear()


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

    # Create 31 days of snapshots with growing stars (including today)
    for i in range(30, -1, -1):
        snapshot = RepoSnapshot(
            repo_id=mock_repo.id,
            stars=1000 + (30 - i) * 50,  # Growing from 1000 to 2500
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
        signal_type=SignalType.VELOCITY,
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

    for i, (owner, name, lang) in enumerate(repo_data):
        repo = Repo(
            owner=owner,
            name=name,
            full_name=f"{owner}/{name}",
            url=f"https://github.com/{owner}/{name}",
            description=f"The {name} framework",
            github_id=100001 + i,
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


