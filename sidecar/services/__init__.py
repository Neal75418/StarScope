# Services package
from .github import GitHubService
from .analyzer import calculate_signals

__all__ = ["GitHubService", "calculate_signals"]
