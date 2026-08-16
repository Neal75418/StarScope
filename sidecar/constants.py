"""
應用程式常數。
集中管理 magic numbers 與設定值。
"""

from enum import StrEnum

# 應用程式版本
APP_VERSION = "1.0.0"

# 排程器設定
DEFAULT_FETCH_INTERVAL_MINUTES = 30

# 警報設定
ALERT_COOLDOWN_SECONDS = 3600  # 重複警報間隔 1 小時

# API 限制
MAX_REPOS_PER_PAGE = 100

# 推薦引擎批量寫入大小
RECOMMENDER_FLUSH_SIZE = 500

# 快照保留天數（DB 設定缺失時的預設值）
DEFAULT_SNAPSHOT_RETENTION_DAYS = 90

# 排程器停止等待秒數
SCHEDULER_SHUTDOWN_TIMEOUT_SECONDS = 10

# GitHub 連線狀態檢查逾時（比一般 API 短，因為只是 health check）
GITHUB_STATUS_CHECK_TIMEOUT_SECONDS = 10.0

# 情境訊號清理
CONTEXT_SIGNAL_MAX_AGE_DAYS = 90  # 超過此天數的訊號將被移除
CONTEXT_SIGNAL_MAX_PER_REPO = 100  # 每個 repo 最多保留的訊號數

# 警報查詢上限
MAX_ALERTS_PER_QUERY = 500

# GitHub 設定
GITHUB_API_TIMEOUT_SECONDS = 30.0
GITHUB_TOKEN_ENV_VAR = "GITHUB_TOKEN"  # GitHub token 的環境變數名稱

# 驗證
GITHUB_USERNAME_PATTERN = r"^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$"
GITHUB_REPO_NAME_PATTERN = r"^[a-zA-Z0-9._-]+$"
MAX_REPO_NAME_LENGTH = 100
MAX_OWNER_LENGTH = 39

# Context Signal 設定（僅 HN）
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

class SignalType(StrEnum):
    """Signal 類型常數。"""
    STARS_DELTA_1D = "stars_delta_1d"  # 單日 star 變化量，七日資料出現前的替代窗口
    STARS_DELTA_7D = "stars_delta_7d"
    STARS_DELTA_30D = "stars_delta_30d"
    VELOCITY = "velocity"  # 每日 star 數
    ACCELERATION = "acceleration"  # velocity 的變化率
    TREND = "trend"  # -1, 0, 1（下降、穩定、上升）
    FORKS_DELTA_7D = "forks_delta_7d"  # 7 天 fork 變化量
    FORKS_DELTA_30D = "forks_delta_30d"  # 30 天 fork 變化量
    ISSUES_DELTA_7D = "issues_delta_7d"  # 7 天 issue 變化量
    ISSUES_DELTA_30D = "issues_delta_30d"  # 30 天 issue 變化量


class AlertOperator(StrEnum):
    """警報運算子常數。"""
    GT = ">"
    LT = "<"
    GTE = ">="
    LTE = "<="
    EQ = "=="


class ContextSignalType(StrEnum):
    """Context Signal 類型常數。"""
    HACKER_NEWS = "hacker_news"
    RELEASE = "release"


# release notes 裡出現這些字時標記出來，讓「這禮拜有 14 個新版本」變成
# 「這兩個你今天該點進去」。字串刻意保守：寧可漏標也不要每一則都標，
# 全部都亮起來的標記等於沒有標記。
RELEASE_NOTE_TAGS: dict[str, tuple[str, ...]] = {
    # 「breaking」單獨出現太浮濫（"breaking down"、"record breaking"），要求它接著變更語意
    "breaking": ("breaking change", "breaking:", "backwards incompatible",
                 "backward incompatible", "incompatible change"),
    # 「security」同理：security fix/advisory/release 才算，單一個字不算
    "security": ("security fix", "security advisory", "security release",
                 "security update", "security patch", "cve-"),
    "deprecation": ("deprecated", "deprecation"),
}

# 抓取新版本的間隔。發版不像 star 數那樣持續變動，30 分鐘一次只是白燒配額；
# 三小時一次即使剛好錯過也只延遲半天不到，而使用者本來就不是即時在等這個。
RELEASE_FETCH_INTERVAL_MINUTES = 180


class EarlySignalType(StrEnum):
    """Early Signal 類型常數。"""
    RISING_STAR = "rising_star"      # 高 velocity + 低 star 數
    SUDDEN_SPIKE = "sudden_spike"    # 單日異常成長
    BREAKOUT = "breakout"            # 加速度轉正
    VIRAL_HN = "viral_hn"            # Hacker News 熱門


class EarlySignalSeverity(StrEnum):
    """Early Signal 嚴重等級。"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class TimeRange(StrEnum):
    """圖表的時間範圍選項（charts 與 comparison 共用）。"""
    WEEK = "7d"
    MONTH = "30d"
    QUARTER = "90d"
    ALL = "all"
