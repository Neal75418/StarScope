"""
應用程式常數。
集中管理 magic numbers 與設定值。
"""

# 排程器設定
DEFAULT_FETCH_INTERVAL_MINUTES = 30
ALERT_CHECK_DELAY_MINUTES = 1

# 警報設定
ALERT_COOLDOWN_SECONDS = 3600  # 重複警報間隔 1 小時

# API 限制
MAX_REPOS_PER_PAGE = 100

# 排程器批量處理大小
SCHEDULER_BATCH_SIZE = 50
DEFAULT_TRENDS_LIMIT = 50
MAX_TRENDS_LIMIT = 100

# GitHub 設定
GITHUB_API_TIMEOUT_SECONDS = 30.0
GITHUB_TOKEN_ENV_VAR = "GITHUB_TOKEN"  # GitHub token 的環境變數名稱

# 驗證
GITHUB_USERNAME_PATTERN = r"^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$"
GITHUB_REPO_NAME_PATTERN = r"^[a-zA-Z0-9._-]+$"
MAX_REPO_NAME_LENGTH = 100
MAX_OWNER_LENGTH = 39

# Context Signal 設定（簡化後僅保留 HN）
HN_API_TIMEOUT_SECONDS = 15.0
CONTEXT_FETCH_INTERVAL_MINUTES = 30

# Badge 顯示門檻
MIN_HN_SCORE_FOR_BADGE = 50
RECENT_THRESHOLD_DAYS = 7

# 趨勢計算門檻
# 用於 analyzer.py calculate_trend() 判斷趨勢方向
TREND_VELOCITY_UPWARD_THRESHOLD = 0.5       # 上升趨勢的最低 velocity
TREND_VELOCITY_DOWNWARD_THRESHOLD = -0.5    # 低於此值視為下降趨勢
TREND_ACCELERATION_DECLINE_THRESHOLD = -0.1 # 上升趨勢的加速度門檻
TREND_STRONG_DECLINE_THRESHOLD = -0.3       # 低於此值視為強烈衰退


# ==================== 類型常量 ====================

class SignalType:
    """Signal 類型常數。"""
    STARS_DELTA_7D = "stars_delta_7d"
    STARS_DELTA_30D = "stars_delta_30d"
    VELOCITY = "velocity"  # 每日 star 數
    ACCELERATION = "acceleration"  # velocity 的變化率
    TREND = "trend"  # -1, 0, 1（下降、穩定、上升）


class AlertOperator:
    """警報運算子常數。"""
    GT = ">"
    LT = "<"
    GTE = ">="
    LTE = "<="
    EQ = "=="


class ContextSignalType:
    """Context Signal 類型常數。"""
    HACKER_NEWS = "hacker_news"


class EarlySignalType:
    """Early Signal 類型常數。"""
    RISING_STAR = "rising_star"      # 高 velocity + 低 star 數
    SUDDEN_SPIKE = "sudden_spike"    # 單日異常成長
    BREAKOUT = "breakout"            # 加速度轉正
    VIRAL_HN = "viral_hn"            # Hacker News 熱門


class EarlySignalSeverity:
    """Early Signal 嚴重等級。"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
