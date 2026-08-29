

class TestManualFetchHonesty:
    def test_hn_failure_returns_502_not_zero(self, client, mock_repo):
        from unittest.mock import AsyncMock, patch

        with patch('routers.context.fetch_context_signals_for_repo',
                   new_callable=AsyncMock) as m:
            from services.context_fetcher import ContextFetchError
            m.side_effect = ContextFetchError("HN 查詢失敗")

            r = client.post(f"/api/context/{mock_repo.id}/fetch")

        assert r.status_code == 502
