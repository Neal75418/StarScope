"""路由套件，匯出所有 API 路由模組。"""

from . import health
from . import repos
from . import scheduler
from . import alerts
from . import trends
from . import commit_activity
from . import languages
from . import star_history

__all__ = ["health", "repos", "scheduler", "alerts", "trends", "commit_activity", "languages", "star_history"]
