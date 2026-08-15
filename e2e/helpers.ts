/**
 * e2e 資料清理 helpers。
 *
 * e2e 可能重用開發者本機正在跑的 sidecar（playwright.config 的 reuseExistingServer），
 * 這時寫入的是**真實資料庫**。任何會新增資料的測試都必須遵守三條紀律：
 *
 * 1. 用專屬的 sentinel 名稱（絕不可能與真實資料撞名，例如 e2e-probe-*）
 * 2. 開跑前先清一次殘留（上次中斷的殘留會讓「新增」變成重複而失敗）
 * 3. 清理放在 finally（斷言失敗也不能把資料留在使用者的資料庫裡）
 *
 * 教訓來源：add-repo 測試曾把 vitejs/vite 留在開發者的 watchlist、
 * interests 測試曾反覆把使用者刻意刪掉的 tauri 加回興趣清單並污染當日 feed。
 */

import type { APIRequestContext } from "@playwright/test";

/**
 * e2e 專屬的 sidecar（見 playwright.config 的 webServer）。
 * 刻意不是開發用的 8008：測試永遠跑在自己的 port + 自己的資料目錄上，
 * 不會接管開發者正在跑的 sidecar、也就碰不到真實資料庫。
 */
export const SIDECAR = "http://127.0.0.1:8009";

/**
 * 測試用 repo 一律取自 GitHub 官方 fixture 帳號 octocat——真實存在（新增流程
 * 需要真的 GitHub repo，純 sentinel 假名會 404）、永遠在、沒有人會真的追蹤，
 * 所以 pre-clean 刪掉殘留不會誤刪使用者的真資料（教訓：vitejs/vite）。
 * fullyParallel 之下各 spec 平行跑，fixture 不得跨 spec 共用，撞名會互刪。
 */
export const FIXTURES = {
  watchlistFlow: "octocat/Hello-World",
  compare: ["octocat/Spoon-Knife", "octocat/octocat.github.io"],
} as const;

export async function isRepoTracked(request: APIRequestContext, fullName: string) {
  const res = await request.get(`${SIDECAR}/api/repos`);
  if (!res.ok()) return false;
  const body = await res.json();
  return Boolean(
    body?.data?.repos?.some((r: { full_name: string }) => r.full_name === fullName)
  );
}

/**
 * 透過 API 新增 repo（會觸發 sidecar 向 GitHub 抓 metadata）。冪等：
 * 「已存在」也算成功——平行 worker 同時播種同一 fixture 時後到者拿 400。
 */
export async function addRepoViaApi(request: APIRequestContext, fullName: string) {
  const [owner, name] = fullName.split("/");
  const res = await request.post(`${SIDECAR}/api/repos`, { data: { owner, name } });
  if (res.ok()) return true;
  return isRepoTracked(request, fullName);
}

export async function removeRepoByFullName(request: APIRequestContext, fullName: string) {
  const res = await request.get(`${SIDECAR}/api/repos`);
  if (!res.ok()) return;
  const body = await res.json();
  const hit = body?.data?.repos?.find(
    (r: { id: number; full_name: string }) => r.full_name === fullName
  );
  if (hit) await request.delete(`${SIDECAR}/api/repos/${hit.id}`);
}

export async function removeInterestByTerm(request: APIRequestContext, term: string) {
  const res = await request.get(`${SIDECAR}/api/interests`);
  if (!res.ok()) return;
  const body = await res.json();
  const hit = body?.data?.interests?.find((i: { id: number; term: string }) => i.term === term);
  if (hit) await request.delete(`${SIDECAR}/api/interests/${hit.id}`);
}

export async function removeCategoryByName(request: APIRequestContext, name: string) {
  const res = await request.get(`${SIDECAR}/api/categories/tree`);
  if (!res.ok()) return;
  const body = await res.json();
  if (!body?.success || !Array.isArray(body?.data?.tree)) return;
  for (const cat of body.data.tree) {
    if (cat.name === name) await request.delete(`${SIDECAR}/api/categories/${cat.id}`);
  }
}
