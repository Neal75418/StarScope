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

export const SIDECAR = "http://127.0.0.1:8008";

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
