/**
 * 相對變化：star 增量除以期初的星數。
 *
 * 這份追蹤清單的規模從 1K 到 400K 星都有，絕對增量彼此不可比——
 * +125 對一個 62K 星的專案是雜訊，對一個 1K 星的專案是翻倍前兆。
 * 儀表板的「在動」面板早就是用相對變化排序的，這裡是同一份算法，
 * 兩邊各留一份的話改了一邊另一邊會無聲地跟著歪掉。
 */

/**
 * @param stars 目前星數
 * @param delta 期間增量
 * @returns 相對變化的比值（0.6 = +60%）；期初為零或無增量資料時回 null
 */
export function relativeDelta(
  stars: number | null | undefined,
  delta: number | null | undefined
): number | null {
  if (delta == null) return null;
  // 期初為 0 時「從 0 漲到 5」是無限大成長，排序會被它永遠霸佔
  const base = (stars ?? 0) - delta;
  if (base <= 0) return null;
  return delta / base;
}
