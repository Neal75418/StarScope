/**
 * 封存清單：已取消 star、但快照與訊號仍保留的 repo。
 *
 * 兩個動作的可逆性天差地遠——重新追蹤只是清掉標記，永久刪除會連快照、訊號與
 * 警示規則一起 cascade 掉。所以只有後者要二次確認，而且文案必須點名警示規則：
 * 快照與訊號使用者猜得到會一起消失，自己設定的警示規則猜不到。
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "../../i18n";
import { deleteArchivedRepo, getArchivedRepos, restarRepo } from "../../api/client";
import { queryKeys } from "../../lib/react-query";
import { ConfirmDialog } from "../ConfirmDialog";
import { Skeleton } from "../Skeleton";
import { interpolate } from "../../i18n";
import { getErrorMessage } from "../../utils/error";

export function ArchivedRepos() {
  const { t } = useI18n();
  const copy = t.settings.archived;
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<{ id: number; name: string } | null>(null);

  const query = useQuery({
    queryKey: queryKeys.repos.archived(),
    queryFn: ({ signal }) => getArchivedRepos(signal),
  });

  const invalidate = () => {
    // 復原會讓 repo 回到追蹤清單，刪除會讓它從封存清單消失——兩者都要重取
    void queryClient.invalidateQueries({ queryKey: queryKeys.repos.all });
  };

  // 明確包一層：TanStack v5 的 mutationFn 會收到 (variables, context)，裸名傳遞
  // 會把 context 物件當第二個參數餵給 API 函式——現在無害，但那些函式的第二個
  // 參數位置遲早會被用掉（getArchivedRepos 的 signal 就是這種形狀）
  const restar = useMutation({
    mutationFn: (repoId: number) => restarRepo(repoId),
    onSuccess: invalidate,
  });
  const purge = useMutation({
    mutationFn: (repoId: number) => deleteArchivedRepo(repoId),
    onSuccess: () => {
      setPendingDelete(null);
      invalidate();
    },
    // 失敗也關掉確認框：錯誤寫在區塊裡，對話框留著會蓋住它
    onError: () => setPendingDelete(null),
  });
  // 寫入在 sidecar 連不上時會立刻失敗（lib/react-query.ts 的 mutations.networkMode）：
  // 一定要說出來，否則使用者只看到按鈕轉一下又恢復。只顯示最近一次操作的錯誤
  const actionError = restar.error ?? purge.error;
  // 開始另一個操作時清掉對方的舊錯誤；對方的請求還在跑就不動它——reset() 會把 hook 從那次
  // 請求上拆下來，按鈕馬上又能按、之後失敗也不會顯示
  const clearStale = (other: { isPending: boolean; reset: () => void }) => {
    if (!other.isPending) other.reset();
  };

  const repos = query.data?.repos ?? [];

  return (
    <div className="settings-section" data-testid="archived-repos">
      <div className="settings-section-header">
        <div>
          <h2>{copy.title}</h2>
          <p className="settings-description">{copy.description}</p>
        </div>
      </div>

      {actionError != null && (
        <p className="settings-error" role="alert">
          {getErrorMessage(actionError, copy.error)}
        </p>
      )}

      {/* 載入中不能顯示「沒有封存」——那與「還不知道」是兩件事，
          而使用者分辨不出畫面上那句是哪一種 */}
      {query.isLoading ? (
        <Skeleton width="40%" height={14} />
      ) : repos.length === 0 ? (
        <p className="settings-hint" data-testid="archived-empty">
          {copy.empty}
        </p>
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
                    clearStale(purge);
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
          clearStale(restar);
          void purge.mutateAsync(pendingDelete.id).catch(() => undefined);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
