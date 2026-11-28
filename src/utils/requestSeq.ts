/**
 * 請求送出的先後。同一份資料有兩個來源、先送出的可能晚回來時（追蹤清單的批次與卡片自己抓），
 * 比這個編號決定留哪一份。
 *
 * 不用時間比：系統時間往回調之後，新的請求會比舊的早，畫面會卡在舊資料直到時間追上；
 * React Query 的 dataUpdatedAt 是回應到達的時間，也不是送出的先後。
 */

let lastSeq = 0;

/** 送出請求的當下取號：越晚送出號碼越大。 */
export function nextRequestSeq(): number {
  lastSeq += 1;
  return lastSeq;
}
