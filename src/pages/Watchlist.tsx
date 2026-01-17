/**
 * Watchlist page - main view showing all tracked repositories.
 */

import { useState, useEffect, useCallback } from "react";
import {
  RepoWithSignals,
  getRepos,
  addRepo,
  removeRepo,
  fetchRepo,
  fetchAllRepos,
  checkHealth,
  getCategoryRepos,
  ApiError,
} from "../api/client";
import { RepoCard } from "../components/RepoCard";
import { AddRepoDialog } from "../components/AddRepoDialog";
import { CategorySidebar } from "../components/CategorySidebar";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ToastContainer, useToast } from "../components/Toast";

export function Watchlist() {
  const [repos, setRepos] = useState<RepoWithSignals[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadingRepoId, setLoadingRepoId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [isAddingRepo, setIsAddingRepo] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [filteredRepoIds, setFilteredRepoIds] = useState<Set<number> | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState<{ isOpen: boolean; repoId: number | null; repoName: string }>({
    isOpen: false,
    repoId: null,
    repoName: "",
  });
  const toast = useToast();

  // Check connection to sidecar
  const checkConnection = useCallback(async () => {
    try {
      await checkHealth();
      setIsConnected(true);
      return true;
    } catch {
      setIsConnected(false);
      setError("Cannot connect to StarScope engine. Make sure Python sidecar is running.");
      return false;
    }
  }, []);

  // Load repos
  const loadRepos = useCallback(async () => {
    try {
      const response = await getRepos();
      setRepos(response.repos);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.detail);
      } else {
        setError("Failed to load repositories");
      }
    }
  }, []);

  // Initial load
  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      const connected = await checkConnection();
      if (connected) {
        await loadRepos();
      }
      setIsLoading(false);
    };
    init();
  }, [checkConnection, loadRepos]);

  // Load category filter
  useEffect(() => {
    if (selectedCategoryId === null) {
      setFilteredRepoIds(null);
      return;
    }

    getCategoryRepos(selectedCategoryId)
      .then((response) => {
        setFilteredRepoIds(new Set(response.repos.map((r) => r.id)));
      })
      .catch((err) => {
        console.error("Failed to load category repos:", err);
        setFilteredRepoIds(null);
      });
  }, [selectedCategoryId]);

  // Filter repos based on selected category
  const displayedRepos = filteredRepoIds
    ? repos.filter((r) => filteredRepoIds.has(r.id))
    : repos;

  // Add repo handler
  const handleAddRepo = async (input: string) => {
    setIsAddingRepo(true);
    setDialogError(null);

    try {
      // Parse input - could be "owner/repo" or a URL
      let repoInput: { owner?: string; name?: string; url?: string };

      if (input.includes("github.com")) {
        repoInput = { url: input };
      } else if (input.includes("/")) {
        const [owner, name] = input.split("/");
        repoInput = { owner, name };
      } else {
        setDialogError("Invalid format. Use owner/repo or GitHub URL.");
        setIsAddingRepo(false);
        return;
      }

      const newRepo = await addRepo(repoInput);
      setRepos((prev) => [newRepo, ...prev]);
      setIsDialogOpen(false);
    } catch (err) {
      if (err instanceof ApiError) {
        setDialogError(err.detail);
      } else {
        setDialogError("Failed to add repository");
      }
    } finally {
      setIsAddingRepo(false);
    }
  };

  // Remove repo handler
  const handleRemoveRepo = (repoId: number) => {
    const repo = repos.find((r) => r.id === repoId);
    setRemoveConfirm({
      isOpen: true,
      repoId,
      repoName: repo?.full_name || "",
    });
  };

  const confirmRemoveRepo = async () => {
    if (!removeConfirm.repoId) return;

    setLoadingRepoId(removeConfirm.repoId);
    try {
      await removeRepo(removeConfirm.repoId);
      setRepos((prev) => prev.filter((r) => r.id !== removeConfirm.repoId));
      toast.success("Repository removed from watchlist");
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.detail);
      } else {
        toast.error("Failed to remove repository");
      }
    } finally {
      setLoadingRepoId(null);
      setRemoveConfirm({ isOpen: false, repoId: null, repoName: "" });
    }
  };

  // Fetch single repo handler
  const handleFetchRepo = async (repoId: number) => {
    setLoadingRepoId(repoId);
    try {
      const updated = await fetchRepo(repoId);
      setRepos((prev) =>
        prev.map((r) => (r.id === repoId ? updated : r))
      );
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.detail);
      } else {
        setError("Failed to fetch repository data");
      }
    } finally {
      setLoadingRepoId(null);
    }
  };

  // Refresh all repos
  const handleRefreshAll = async () => {
    setIsRefreshing(true);
    try {
      const response = await fetchAllRepos();
      setRepos(response.repos);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.detail);
      } else {
        setError("Failed to refresh repositories");
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  // Retry connection
  const handleRetry = async () => {
    setIsLoading(true);
    setError(null);
    const connected = await checkConnection();
    if (connected) {
      await loadRepos();
    }
    setIsLoading(false);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="page">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  // Connection error
  if (!isConnected) {
    return (
      <div className="page">
        <div className="error-container">
          <h2>Connection Error</h2>
          <p>{error}</p>
          <p className="hint">
            Start the Python sidecar with:
            <code>cd sidecar && python main.py</code>
          </p>
          <button onClick={handleRetry} className="btn btn-primary">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>StarScope</h1>
        <p className="subtitle">GitHub Project Intelligence</p>
      </header>

      <div className="watchlist-with-sidebar">
        <CategorySidebar
          selectedCategoryId={selectedCategoryId}
          onSelectCategory={setSelectedCategoryId}
        />

        <div className="watchlist-main">
          <div className="toolbar">
            <button
              onClick={() => setIsDialogOpen(true)}
              className="btn btn-primary"
            >
              + Add Repository
            </button>
            <button
              onClick={handleRefreshAll}
              disabled={isRefreshing}
              className="btn"
            >
              {isRefreshing ? "Refreshing..." : "Refresh All"}
            </button>
            {selectedCategoryId && (
              <span className="filter-indicator">
                Showing {displayedRepos.length} of {repos.length} repos
              </span>
            )}
          </div>

          {error && (
            <div className="error-banner">
              {error}
              <button onClick={() => setError(null)}>x</button>
            </div>
          )}

          <div className="repo-list">
            {displayedRepos.length === 0 ? (
              <div className="empty-state">
                {selectedCategoryId ? (
                  <p>No repositories in this category.</p>
                ) : repos.length === 0 ? (
                  <>
                    <p>No repositories in your watchlist yet.</p>
                    <p>Click "Add Repository" to start tracking GitHub projects.</p>
                  </>
                ) : (
                  <p>No repositories match the current filter.</p>
                )}
              </div>
            ) : (
              displayedRepos.map((repo) => (
                <RepoCard
                  key={repo.id}
                  repo={repo}
                  onFetch={handleFetchRepo}
                  onRemove={handleRemoveRepo}
                  isLoading={loadingRepoId === repo.id}
                />
              ))
            )}
          </div>
        </div>
      </div>

      <AddRepoDialog
        isOpen={isDialogOpen}
        onClose={() => {
          setIsDialogOpen(false);
          setDialogError(null);
        }}
        onAdd={handleAddRepo}
        isLoading={isAddingRepo}
        error={dialogError}
      />

      <ConfirmDialog
        isOpen={removeConfirm.isOpen}
        title="Remove Repository"
        message={`Are you sure you want to remove "${removeConfirm.repoName}" from your watchlist?`}
        confirmText="Remove"
        variant="danger"
        onConfirm={confirmRemoveRepo}
        onCancel={() => setRemoveConfirm({ isOpen: false, repoId: null, repoName: "" })}
      />

      <ToastContainer toasts={toast.toasts} onDismiss={toast.dismissToast} />
    </div>
  );
}
