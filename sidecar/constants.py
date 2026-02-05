"""
Application constants.
Centralized location for magic numbers and configuration values.
"""

# Scheduler settings
DEFAULT_FETCH_INTERVAL_MINUTES = 30
ALERT_CHECK_DELAY_MINUTES = 1

# Alert settings
ALERT_COOLDOWN_SECONDS = 3600  # 1 hour between duplicate alerts

# API limits
MAX_REPOS_PER_PAGE = 100
DEFAULT_TRENDS_LIMIT = 50
MAX_TRENDS_LIMIT = 100

# GitHub settings
GITHUB_API_TIMEOUT_SECONDS = 30.0
GITHUB_TOKEN_ENV_VAR = "GITHUB_TOKEN"  # Environment variable name for GitHub token

# Validation
GITHUB_USERNAME_PATTERN = r"^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$"
GITHUB_REPO_NAME_PATTERN = r"^[a-zA-Z0-9._-]+$"
MAX_REPO_NAME_LENGTH = 100
MAX_OWNER_LENGTH = 39

# Context Signal settings (HN only after simplification)
HN_API_TIMEOUT_SECONDS = 15.0
CONTEXT_FETCH_INTERVAL_MINUTES = 30

# Badge display thresholds
MIN_HN_SCORE_FOR_BADGE = 50
RECENT_THRESHOLD_DAYS = 7

# Trend calculation thresholds
# Used in analyzer.py calculate_trend() to determine trend direction
TREND_VELOCITY_UPWARD_THRESHOLD = 0.5       # Minimum velocity for upward trend
TREND_VELOCITY_DOWNWARD_THRESHOLD = -0.5    # Velocity below this = downward trend
TREND_ACCELERATION_DECLINE_THRESHOLD = -0.1 # Acceleration threshold for upward trend
TREND_STRONG_DECLINE_THRESHOLD = -0.3       # Acceleration below this = strong decline
