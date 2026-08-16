/**
 * 段一是整頁唯一一個「你可以不看」的承諾，所以空狀態必須講出自己的覆蓋範圍。
 * 在沒有檢查過任何東西的情況下宣稱沒事，跟「velocity 是 null 卻算成停滯」
 * 是同一個錯誤，而這裡的代價更高。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AttentionBar } from "../AttentionBar";

const base = {
  items: [],
  totalRepos: 94,
  hasAlertRules: true,
  releasesChecked: true,
  updatedLabel: "3 分鐘前",
  onRefresh: () => {},
};

describe("AttentionBar", () => {
  it("沒事時是一行，並帶著追蹤數量與更新時間", () => {
    render(<AttentionBar {...base} />);

    const bar = screen.getByTestId("attention-bar");
    expect(bar).toHaveTextContent("94");
    expect(bar).toHaveTextContent("3 分鐘前");
    // 兩個來源都真的檢查過時，必須真的講出「沒事」，不能只交代追蹤數量跟時間就算數——
    // 那兩個欄位跟 status 文案是各自獨立算的，少了這條，status 整個算錯也測不出來。
    expect(bar).toHaveTextContent(/nothing needs attention this week/i);
    // 沒有理由在這裡出現「未設定警報規則」的但書——這條線是用來擋
    // 「不管旗標永遠附加但書」這種寫法的。
    expect(bar).not.toHaveTextContent(/no alert rules/i);
    expect(screen.queryByTestId("attention-item")).not.toBeInTheDocument();
  });

  it("沒設警報規則時要講出來", () => {
    // 一條規則都沒有，警報那個來源永遠不會觸發。此時宣稱「無需注意」
    // 等於在沒有檢查過任何東西的情況下說沒事。
    render(<AttentionBar {...base} hasAlertRules={false} />);

    const bar = screen.getByTestId("attention-bar");
    expect(bar).toHaveTextContent(/no alert rules/i);
    // 這是複合宣稱：版本那邊確實沒事，但警報那邊沒檢查。少了前半段，
    // 「no alert rules set」單獨出現時使用者看不出版本檢查其實是有跑、有過關的。
    expect(bar).toHaveTextContent(/nothing needs attention this week/i);
  });

  it("版本還沒抓過時說正在檢查，不說沒事", () => {
    render(<AttentionBar {...base} releasesChecked={false} />);

    const bar = screen.getByTestId("attention-bar");
    expect(bar).toHaveTextContent(/still checking/i);
    expect(bar).not.toHaveTextContent(/nothing needs/i);
  });

  it("版本沒抓、也沒設警報規則時，兩個原因都要講", () => {
    // 三元短路的舊寫法在兩個檢查同時缺席時只會講其中一個——使用者會以為
    // 版本一補上，這個段落就全覆蓋了，但警報那個來源其實從頭到尾沒被提到。
    render(<AttentionBar {...base} hasAlertRules={false} releasesChecked={false} />);

    const bar = screen.getByTestId("attention-bar");
    expect(bar).toHaveTextContent(/still checking/i);
    expect(bar).toHaveTextContent(/no alert rules/i);
    expect(bar).not.toHaveTextContent(/nothing needs/i);
  });

  it("保留手動重整——它原本掛在被取代的元件上", () => {
    const onRefresh = vi.fn();
    render(<AttentionBar {...base} onRefresh={onRefresh} />);

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("有項目時展開成清單", () => {
    render(
      <AttentionBar
        {...base}
        items={[
          {
            id: "release-1-v8.0.0",
            kind: "release",
            title: "redis/jedis v8.0.0",
            detail: "breaking",
            url: "https://x",
          },
          { id: "alert-1", kind: "alert", title: "Star spike", detail: "ollama/ollama" },
        ]}
      />
    );

    expect(screen.getAllByTestId("attention-item")).toHaveLength(2);
    expect(screen.getByRole("link", { name: /jedis/ })).toBeInTheDocument();
    // 沒有 url 的項目不該變成可點連結——不然「沒有 url」這個分支邏輯永遠測不出來。
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("同一個 title 出現兩次時，各自的 detail 仍對得上自己的 title", () => {
    // 一條全域警報規則對每個觸發的 repo 各寫一筆，rule_name（title）因此相同。
    // 用舊的 `${kind}-${title}` 當 key 時，這兩筆會撞成同一個 key，React 會在
    // render 當下就用 console.error 警告 key 不唯一——用 id 當 key 之後不該再看到它。
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <AttentionBar
        {...base}
        items={[
          { id: "alert-101", kind: "alert", title: "Star spike", detail: "facebook/react" },
          { id: "alert-102", kind: "alert", title: "Star spike", detail: "vuejs/vue" },
        ]}
      />
    );

    const rows = screen.getAllByTestId("attention-item");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("facebook/react");
    expect(rows[1]).toHaveTextContent("vuejs/vue");

    const duplicateKeyWarning = errorSpy.mock.calls.some((args) =>
      String(args[0]).includes("same key")
    );
    expect(duplicateKeyWarning).toBe(false);

    errorSpy.mockRestore();
  });
});
