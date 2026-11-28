/**
 * 封存清單：已取消 star、但快照與訊號仍保留的 repo。
 *
 * 兩個動作的可逆性天差地遠——重新追蹤只是清掉標記，永久刪除會連快照、訊號與
 * 警示規則一起 cascade 掉。所以只有後者要二次確認，而且文案必須點名警示規則：
 * 快照與訊號使用者猜得到會一起消失，自己設定的警示規則猜不到。
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "../../i18n";
import { deleteArchivedRepo, getArchivedRepos, restarRepo } from "../../api/client";
import { DATA_RESET_EVENT } from "../../constants/events";
import {
  invalidateTrackedRepos,
  keepRefetchingAfterTimeout,
  loadStatus,
  queryKeys,
  resetUnlessRunning,
} from "../../lib/react-query";
import { useInstanceMutationKey } from "../../hooks/useInstanceMutationKey";
import { ConfirmDialog } from "../ConfirmDialog";
import { LoadError } from "../LoadError";
import { Skeleton } from "../Skeleton";
import { interpolate } from "../../i18n";
import { ApiError } from "../../api/types";
import { describeWriteFailure, isRequestTimeout } from "../../utils/writeFailure";

const RESTAR_KEY = ["archivedRepos", "restar"] as const;
const PURGE_KEY = ["archivedRepos", "purge"] as const;

/** 本機已經沒有這一列（不帶 GITHUB_NOT_FOUND 的 404）：在別處被永久刪除了，刪除的話結果就是使用者要的 */
function goneLocally(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404 && err.code !== "GITHUB_NOT_FOUND";
}

export function ArchivedRepos() {
  const { t } = useI18n();
  const copy = t.settings.archived;
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<{ id: number; name: string } | null>(null);
  const restarKey = useInstanceMutationKey(RESTAR_KEY);
  const purgeKey = useInstanceMutationKey(PURGE_KEY);

  const query = useQuery({
    queryKey: queryKeys.repos.archived(),
    queryFn: ({ signal }) => getArchivedRepos(signal),
  });

  const invalidate = () => {
    // 復原會讓 repo 回到追蹤清單，刪除會讓它從封存清單消失——兩者都要重取
    invalidateTrackedRepos(queryClient);
  };

  // 明確包一層：TanStack v5 的 mutationFn 會收到 (variables, context)，裸名傳遞
  // 會把 context 物件當第二個參數餵給 API 函式——現在無害，但那些函式的第二個
  // 參數位置遲早會被用掉（getArchivedRepos 的 signal 就是這種形狀）
  // 失敗也重讀：有些失敗代表清單其實已經變了（在別處刪掉、逾時後伺服器做完了）；逾時的話接下來一陣子定期重讀
  const rereadAfterFailure = (err: unknown) => {
    invalidate();
    if (isRequestTimeout(err)) keepRefetchingAfterTimeout(invalidate);
  };
  const restar = useMutation({
    mutationKey: restarKey,
    mutationFn: (repoId: number) => restarRepo(repoId),
    onSuccess: invalidate,
    onError: rereadAfterFailure,
  });
  const purge = useMutation({
    mutationKey: purgeKey,
    mutationFn: (repoId: number) => deleteArchivedRepo(repoId),
    onSuccess: () => {
      setPendingDelete(null);
      invalidate();
    },
    // 失敗也關掉確認框：錯誤寫在區塊裡，對話框留著會蓋住它
    onError: (err) => {
      setPendingDelete(null);
      rereadAfterFailure(err);
    },
  });
  // 寫入在 sidecar 連不上時會立刻失敗（lib/react-query.ts 的 mutations.networkMode）：
  // 一定要說出來，否則使用者只看到按鈕轉一下又恢復。只顯示最近一次操作的錯誤；
  // 後端的原始訊息是英文內部用語，不直接給使用者看
  const actionMessage =
    restar.error != null
      ? describeRestarFailure(restar.error)
      : purge.error != null && !goneLocally(purge.error)
        ? describeDeleteFailure(purge.error)
        : null;
  function describeDeleteFailure(err: unknown): string {
    // 刪除只在那一列又回到追蹤清單時回 400（在 GitHub 上重新 star、背景同步把它復原了）：重試永遠不會好
    if (err instanceof ApiError && err.status === 400) return copy.deleteFailed.backOnWatchlist;
    return describeWriteFailure(err, t, copy.deleteFailed);
  }
  function describeRestarFailure(err: unknown): string {
    // 在別處被永久刪除了：重試永遠不會好
    if (goneLocally(err)) return copy.restarFailed.gone;
    return describeWriteFailure(err, t, copy.restarFailed);
  }
  // 重設資料之後清單重讀成空，上一次操作的錯誤講的是已經刪掉的 repo：一併清掉。錯誤存在 mutation 裡，
  // 重設時清快取碰不到；還在跑的不動（見 resetUnlessRunning）
  const resetRestar = restar.reset;
  const resetPurge = purge.reset;
  useEffect(() => {
    const handler = () => {
      resetUnlessRunning(queryClient, restarKey, resetRestar);
      resetUnlessRunning(queryClient, purgeKey, resetPurge);
    };
    window.addEventListener(DATA_RESET_EVENT, handler);
    return () => window.removeEventListener(DATA_RESET_EVENT, handler);
  }, [queryClient, restarKey, purgeKey, resetRestar, resetPurge]);

  const repos = query.data?.repos ?? [];
  const load = loadStatus(query);

  return (
    <div className="settings-section" data-testid="archived-repos">
      <div className="settings-section-header">
        <div>
          <h2>{copy.title}</h2>
          <p className="settings-description">{copy.description}</p>
        </div>
      </div>

      {actionMessage != null && (
        <p className="settings-error" role="alert">
          {actionMessage}
        </p>
      )}

      {/* 重讀失敗時清單還留在畫面上（上一次讀到的），所以錯誤另外說，不取代清單 */}
      {load.failed && (
        <LoadError
          testId="archived-load-error"
          message={copy.loadError}
          isRetrying={load.inProgress}
          onRetry={load.retry}
        />
      )}

      {/* 「沒有封存」只在讀到了、而且是空的時候才說。還沒讀到（載入中，或 sidecar 斷線時查詢暫停）
          與讀不到都是「還不知道」，使用者分辨不出畫面上那句是哪一種 */}
      {!load.ready ? (
        !load.failed && <Skeleton width="40%" height={14} />
      ) : repos.length === 0 ? (
        !load.failed && (
          <p className="settings-hint" data-testid="archived-empty">
            {copy.empty}
          </p>
        )
      ) : (
        <div className="archived-list">
          {repos.map((repo) => (
            <div key={repo.id} className="archived-item">
              <span className="archived-item-name">{repo.full_name}</span>
              <div className="archived-item-actions">
                <button
                  className="btn btn-sm"
                  data-testid={`archived-restar-${repo.id}`}
                  disabled={restar.isPending}
                  onClick={() => {
                    // 開始另一個操作時清掉對方的舊錯誤；對方還在跑就不動
                    resetUnlessRunning(queryClient, purgeKey, purge.reset);
                    void restar.mutateAsync(repo.id).catch(() => undefined);
                  }}
                >
                  {copy.restar}
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  data-testid={`archived-delete-${repo.id}`}
                  onClick={() => setPendingDelete({ id: repo.id, name: repo.full_name })}
                >
                  {copy.delete}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        title={copy.confirmTitle}
        message={interpolate(copy.confirmMessage, { name: pendingDelete?.name ?? "" })}
        confirmText={copy.delete}
        variant="danger"
        isProcessing={purge.isPending}
        onConfirm={() => {
          if (!pendingDelete) return;
          // 開始另一個操作時清掉對方的舊錯誤；對方還在跑就不動
          resetUnlessRunning(queryClient, restarKey, restar.reset);
          void purge.mutateAsync(pendingDelete.id).catch(() => undefined);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
