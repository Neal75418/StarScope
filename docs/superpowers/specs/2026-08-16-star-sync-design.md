# Star 同步設計

追蹤清單與 GitHub star 之間目前沒有任何連動：GitHub 上有 94 個 star，app 裡有
1 個 repo。設定頁那個一次性匯入七個月來只被用過一次，所以追蹤／趨勢／比較三頁
實際上是空的。

這份設計讓追蹤清單成為 GitHub star 的鏡像。

## 決定

| 項目 | 決定 |
|---|---|
| 兩者關係 | 鏡像——app 裡有的 = GitHub 上 star 的 |
| 移除語意 | 封存，快照與訊號全部保留 |
| 同步時機 | 開 app 時自動對一次 |
| 推送 | 與拉取同時上線，不分兩期 |

推送不能延後。只做拉取的鏡像會在使用者於 app 內加入 repo 之後，讓下一次自動
同步把它判為「已取消 star」而封存——加進去的東西自己消失，比完全沒有同步更糟。

## 資料模型

`repos` 增加兩個可為空的欄位，不動任何外鍵：

| 欄位 | 用途 |
|---|---|
| `unstarred_at` | 封存標記。`NULL` 表示在清單中 |
| `starred_at` | GitHub 上 star 的時間 |

`starred_at` 不是額外功能。使用者判斷價值的依據是「star 很久的 repo 肯定有價值」，
而現有的 `added_at` 在批次同步後全部是同一天，表達不了收藏時長。這個值只在
請求帶 `Accept: application/vnd.github.star+json` 時回傳（`services/github.py` 的
`get_stargazers_with_dates` 已有相同用法），錯過同步當下就無法補回。

### 讓「排除封存」成為預設

repo 的查詢點有 29 處，而且需要相反的行為——列表與計數必須排除封存的，
依 `full_name` 做的存在性檢查則必須找得到它們，否則重新 star 時會建出重複的一筆。
在 29 個地方各做一次判斷，漏一個就是滲漏。

改用 SQLAlchemy 的 `do_orm_execute` 事件，對 `Repo` 注入
`with_loader_criteria(Repo, Repo.unstarred_at.is_(None))`，並提供顯式的
`include_archived` execution option 作為 opt-out。

已實測（SQLAlchemy 2.0.46）：預設 `.all()` 與 `.count()` 只回未封存的，依
`full_name` 找封存的回 `None`；帶上 opt-out 後兩者都看得到。

這把風險從「29 處都要記得加條件」翻轉為「約 2 處要記得 opt-out」，而後者漏掉的
症狀是重新 star 時建出重複列——會被測試抓到，且不破壞既有資料。

## 同步流程

```
1. 拉 GET /user/starred（帶 star+json header，per_page=100）
2. 安全閘：請求失敗或回傳 0 筆 → 記錄錯誤，不執行任何移除
3. 比對：
   新增  GitHub 有、app 沒有         → 建立，寫入 starred_at
   復原  GitHub 有、app 有但已封存   → 清除 unstarred_at
   封存  app 有（未封存）、GitHub 沒有 → 寫入 unstarred_at
4. 回傳 {added, restored, archived}
```

0 筆等於清空整個追蹤清單，是這個功能最昂貴的誤動作，不應依賴「應該不會發生」。

刻意不加「封存比例過高就停下來確認」那道閘：94 個 star 在一次請求內取完，
不存在取到一半的失敗模式，那道閘會是憑空的複雜度。

## 推送

| app 內動作 | GitHub 呼叫 | 二次確認 |
|---|---|---|
| 加入追蹤 | `PUT /user/starred/{owner}/{repo}` | 否 |
| feed 的「追蹤」按鈕 | 同上 | 否 |
| 移除 | `DELETE /user/starred/{owner}/{repo}` | 是 |

**先寫 GitHub，成功後才改本機。** 反向的順序會在 GitHub 寫入失敗時留下本機已改、
遠端未改的狀態，鏡像當場破裂且沒有任何跡象。

feed 的「追蹤」按鈕目前只寫本機，在鏡像模型下必須一併 star，否則每按一次就
製造一筆會被下次同步封存的漂移。

權限已驗證：token 的 `X-OAuth-Scopes` 為 `read:user, repo`，`repo` 涵蓋 star 寫入，
不需要重新授權。

## 第一次同步

首次同步不自動封存。將「本機有、GitHub 沒有」的項目列出，由使用者選擇推上去
（star）或封存。之後的同步才自動封存。

第一次的差異是歷史遺留，之後的差異才代表使用者取消了 star；用同一套邏輯處理會把
歷史遺留當成使用者的決定。

## 介面

- 移除設定頁的 starred 匯入區塊——被同步取代，並存會有兩套語意打架
- 設定頁改為顯示上次同步時間、手動同步按鈕、上次結果（新增 N／封存 M）
- 追蹤清單的「移除」改為「取消 star」，加二次確認
- 封存清單需可檢視與手動復原（復原即重新 star）

## 測試

- 三個集合（新增／復原／封存）的計算各一條
- 0 筆守則，以 mutation 驗證：拿掉它，測試必須轉紅
- 滲漏測試：掃過所有會列出 repo 的端點，斷言封存的不出現
- 推送失敗時本機不得改變
- 首次同步不自動封存

## 風險

**誤觸取消的代價是弄丟 star 日期。** 資料因封存而完整保留，GitHub 上重新 star
也回得來，唯一回不來的是原本的 star 時間——它會變成重新 star 的當天，
`starred_at` 表達的「收藏多久」因此失準。二次確認是唯一的防線。

**推送的正確性只能在真實帳號上驗證。** 沒有測試環境，測試中的 GitHub 寫入全是
mock。權限已用 scope 標頭確認，但「程式碼是否正確呼叫」要到第一次真實操作才知道。
第一次的加入與取消應由使用者手動觸發並確認回應，而非交給自動同步。
