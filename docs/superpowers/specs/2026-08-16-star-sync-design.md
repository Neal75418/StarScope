# Star 同步設計

追蹤清單與 GitHub star 之間目前沒有任何連動：GitHub 上的 star 有九十幾個
（查法：`GET /user/starred?per_page=1` 的 `Link` 標頭最後一頁頁碼），app 裡有 1 個
repo。設定頁那個一次性匯入七個月來只被用過一次，所以追蹤／趨勢／比較三頁實際上
是空的。

這份設計讓追蹤清單成為 GitHub star 的鏡像。

## 決定

| 項目 | 決定 |
|---|---|
| 兩者關係 | 鏡像——app 裡有的 = GitHub 上 star 的 |
| 移除語意 | 封存，快照與訊號全部保留 |
| 同步時機 | 開 app 時自動對一次 |
| 推送 | 與拉取同時上線，不分兩期 |
| 比對鍵 | `github_id` |

推送不能延後。只做拉取的鏡像會在使用者於 app 內加入 repo 之後，讓下一次自動同步
把它判為「已取消 star」而封存——加進去的東西自己消失，比完全沒有同步更糟。

## 資料模型

`repos` 增加兩個可為空的欄位，不動任何外鍵：

| 欄位 | 用途 |
|---|---|
| `unstarred_at` | 封存標記。`NULL` 表示在清單中 |
| `starred_at` | GitHub 上 star 的時間 |

`starred_at` 不是額外功能。使用者判斷價值的依據是「star 很久的 repo 肯定有價值」，
而現有的 `added_at` 在批次同步後全部是同一天，表達不了收藏時長。這個值只在請求帶
`Accept: application/vnd.github.star+json` 時回傳（`services/github.py` 的
`get_stargazers_with_dates` 已有相同用法），錯過同步當下就無法補回。

以推送建立的 repo（app 內加入）拿不到 GitHub 的 `starred_at`，先以本機時間寫入，
下次同步時以 GitHub 的值覆蓋。復原（重新 star）同樣以 GitHub 回傳的新值覆蓋。

### 讓「排除封存」成為預設

repo 的查詢點有 29 處，而且需要相反的行為——列表與計數必須排除封存的，
依 `full_name` 或 `id` 做的查找則必須找得到它們。在 29 個地方各做一次判斷，
漏一個就是滲漏。

改用 SQLAlchemy 的 `do_orm_execute` 事件，對 `Repo` 注入
`with_loader_criteria(Repo, Repo.unstarred_at.is_(None))`，並提供顯式的
`include_archived` execution option 作為 opt-out。

已實測（SQLAlchemy 2.0.46）：預設 `.all()` 與 `.count()` 只回未封存的，依
`full_name` 找封存的回 `None`；帶上 opt-out 後兩者都看得到。

**必須 opt-out 的位置**（漏掉的症狀已逐一確認）：

| 位置 | 漏掉會怎樣 |
|---|---|
| `routers/repos.py` 的 `full_name` 存在性檢查（兩處）| `full_name` 是 `unique=True`，所以不會產生重複列，而是 INSERT 撞唯一鍵回 500。失敗是響亮的，不是安靜的 |
| `services/feed_generator.py` 的已追蹤排除集 | 封存的 repo 重新成為 feed 候選——刻意取消 star 的東西下週又被推薦。`SeenRepo` 擋不住從 star 匯入、未經 feed 的那些 |
| `routers/dependencies.py` 的 `get_repo_or_404` | 檢視與復原封存 repo 的端點一律 404 |
| `routers/comparison.py` 的 `id.in_()` 查詢 | 該處把找不到的 id 收集成 `missing` 後整個請求回 404。比較組合中只要有一個被取消 star，整頁就壞掉而不是少一項。應改為略過並在回應中標示 |

**關聯載入會回 `None` 而不是滲漏。** 已實測：`SimilarRepo.similar` 指向封存的 repo
時取得 `None`。滲漏被擋住了，但 `services/recommender.py` 直接把它當 `Repo` 使用，
會拋 `AttributeError` 變成 500。讀取相似專案時必須濾掉 `similar is None` 的列。

**這個事件只攔截 SELECT。** 已實測：`query(Repo).delete()` 仍會刪掉全部，包含封存的。
這對「清空所有資料」（`routers/app_settings.py`）是正確行為，但日後若新增 bulk
update 需自行處理。

### Schema 如何進到既有資料庫

`Base.metadata.create_all()` 只建新表，不會改既有表。沿用 `db/database.py` 既有的
`_ADDITIVE_COLUMNS` / `ensure_columns()`：把兩個欄位登記進去即可，啟動時冪等執行。

不要改用 alembic。這個專案沒有版本表，接上去得先 stamp 一個版本，stamp 錯會讓之後
所有 migration 對不上；補可為空的欄位在 SQLite 是不重寫資料的操作。

## 同步流程

```
1. 拉 GET /user/starred（帶 star+json header，per_page=100）
2. 安全閘：請求失敗或回傳 0 筆 → 記錄錯誤，不執行任何移除
3. 以 github_id 比對：
   新增  GitHub 有、app 沒有         → 建立，寫入 starred_at
   復原  GitHub 有、app 有但已封存   → 清除 unstarred_at，更新 starred_at
   改名  github_id 相同但 full_name 不同 → 更新 full_name、owner、name
   封存  app 有（未封存）、GitHub 沒有 → 寫入 unstarred_at
4. 回傳 {added, restored, renamed, archived}
```

比對鍵是 `github_id` 而非 `full_name`。repo 在 GitHub 上改名時 `full_name` 會變、
`github_id` 不變；用 `full_name` 比對會把改名判成「舊的消失 + 新的出現」，於是封存
舊列並建立新列，歷史快照從此斷成兩截。`_create_repo_from_github` 一律寫入
`github_id`，所以每一列都有值。

未設定 token 時同步不執行，也不發出請求——不依賴「回傳 0 筆」那道閘兜底。

自動同步與手動同步必須互斥。兩者若並行，會從同一份狀態算出相同的「新增」集合而
重複 insert，撞上 `full_name` 唯一鍵回 500。

0 筆等於清空整個追蹤清單，是這個功能最昂貴的誤動作，不應依賴「應該不會發生」。

刻意不加「封存比例過高就停下來確認」那道閘：全部 star 在一次請求內取完，不存在
取到一半的失敗模式，那道閘會是憑空的複雜度。

### 不要為每個新增的 repo 再打一次 GitHub

`/user/starred` 的回應本身就帶完整的 repo 物件，直接用來建列。首次同步會新增
九十幾個 repo，若每個再各呼叫一次 `get_repo`，那是九十幾次額外請求，而且會和
`main.py` 啟動時已經觸發的 `trigger_fetch_now()` 撞在一起。

同步應在啟動抓取之前完成，否則抓取拿到的是同步前的清單。

## 推送

建立 repo 的路徑有三條，全部都必須 star——否則任何一條都會產生「下次同步就消失」
的列：

| 路徑 | GitHub 呼叫 |
|---|---|
| `POST /repos`（手動新增對話框）| `PUT /user/starred/{owner}/{repo}` |
| `POST /repos/batch`（檔案／文字批次匯入）| 同上，逐筆 |
| feed 的「追蹤」按鈕 | 走 `POST /repos`，自動涵蓋 |

star 放在建立 repo 的端點層，而不是分散在各呼叫端。這樣沒有任何路徑能建立出未
star 的 repo，是性質上的排除，而不是逐條堵。

移除方向：

| 動作 | GitHub 呼叫 | 二次確認 |
|---|---|---|
| 取消追蹤 | `DELETE /user/starred/{owner}/{repo}` | 是 |

**先寫 GitHub，成功後才改本機。** 反向的順序會在 GitHub 寫入失敗時留下本機已改、
遠端未改的狀態，鏡像當場破裂且沒有任何跡象。正向順序另有一個好處：GitHub 成功而
本機寫入失敗時，下次同步會把它補回來——這個方向是自癒的。

權限已驗證：token 的 `X-OAuth-Scopes` 為 `read:user, repo`，`repo` 涵蓋 star 寫入，
不需要重新授權。

### 推送的節流

首次同步的「推上去」可能一次 star 數十個。GitHub 對會改變資料的請求另有次級速率
限制，**本設計未量測其門檻**——實作推送批次前先量，再依實測值決定間隔，不要沿用
搜尋那條 2.2 秒（那是為每分鐘 30 次的搜尋配額訂的，與寫入無關）。

### 永久刪除

`DELETE /repos/{id}` 現行為硬刪並 cascade。改為：

- 追蹤清單的「取消追蹤」→ 取消 star + 封存，不刪任何資料
- 封存清單保留一個明確的「永久刪除」動作，維持現行的硬刪行為

兩者分開，讓不可逆的操作只存在於一個需要刻意前往的位置。

永久刪除會 cascade 掉 `repo_id` 為外鍵的五張表：快照、訊號、context signals、
early signals，以及**警示規則**。最後一項使用者不會預期，確認訊息必須寫明。

## 第一次同步

以 `last_sync_at` 設定是否為 `NULL` 判斷是否為首次。

首次同步不自動封存。將「本機有、GitHub 沒有」的項目列出，由使用者選擇推上去
（star）或封存。之後的同步才自動封存。

第一次的差異是歷史遺留，之後的差異才代表使用者取消了 star；用同一套邏輯處理會把
歷史遺留當成使用者的決定。

（目前 app 內唯一的 repo 已在 star 清單中，實際上不會觸發，但規則仍需存在。）

## 介面

- 移除設定頁的 starred 匯入區塊，以及隨之失去用途的 `GET /repos/starred` 端點與
  `useStarredImport` hook——被同步取代，並存會有兩套語意打架
- 設定頁改為顯示上次同步時間、手動同步按鈕、上次結果（新增 N／封存 M）
- 追蹤清單的「移除」改為「取消追蹤」，加二次確認
- 封存清單需可檢視、可復原（復原即重新 star）、可永久刪除
- 首次同步的差異選擇畫面

## 測試

- 四個集合（新增／復原／改名／封存）的計算各一條
- 改名不得產生新列，且既有快照必須仍掛在同一列上
- 0 筆守則，以 mutation 驗證：拿掉它，測試必須轉紅
- 滲漏測試：掃過所有會列出 repo 的端點，斷言封存的不出現
- 反向滲漏測試：封存的 repo 不得重新出現在 feed 候選中
- 三條建立路徑都會 star
- 推送失敗時本機不得改變
- 首次同步不自動封存
- 封存後的相似專案端點不得 500（`similar is None` 的列要被濾掉）
- 封存後的比較頁不得整批 404
- 自動同步與手動同步並行時不得重複建立
- 未設定 token 時同步不發出請求

移除匯入區塊會動到 e2e：`e2e/` 下有七處引用，需一併調整。

## 風險

**誤觸取消的代價是弄丟 star 日期。** 資料因封存而完整保留，GitHub 上重新 star 也
回得來，唯一回不來的是原本的 star 時間——它會變成重新 star 的當天，`starred_at`
表達的「收藏多久」因此失準。二次確認是唯一的防線。

**推送的正確性只能在真實帳號上驗證。** 沒有測試環境，測試中的 GitHub 寫入全是
mock。權限已用 scope 標頭確認，但「程式碼是否正確呼叫」要到第一次真實操作才知道。
第一次的加入與取消應由使用者手動觸發並確認回應，而非交給自動同步。
