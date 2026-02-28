"""路由套件，匯出所有 API 路由模組。"""

from . import health
from . import repos
from . import alerts
from . import trends
from . import context
from . import charts
from . import recommendations
from . import categories
from . import early_signals
from . import export
from . import github_auth
from . import discovery
from . import commit_activity
from . import languages
from . import star_history

__all__ = [
    "health",
    "repos",
    "alerts",
    "trends",
    "context",
    "charts",
    "recommendations",
    "categories",
    "early_signals",
    "export",
    "github_auth",
    "discovery",
    "commit_activity",
    "languages",
    "star_history",
]
