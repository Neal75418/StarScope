/**
 * 這個元件實例專用的 mutationKey（後面接 useId）。
 *
 * 給 resetUnlessRunning 判斷「我的請求還在不在跑」用：元件卸載（例如離開設定頁）時，請求還在 mutation cache 裡跑，
 * 只是接不回 hook；只看共用的 key 的話，重新掛上的新實例會把舊實例的請求也算進去，自己的舊結果就清不掉。
 */

import { useId, useMemo } from "react";
import type { InstanceMutationKey } from "../lib/react-query";

export function useInstanceMutationKey(base: readonly string[]): InstanceMutationKey {
  const instance = useId();
  return useMemo(() => [...base, instance] as unknown as InstanceMutationKey, [base, instance]);
}
