/**
 * 打包版的 sidecar 冷啟動要 8–14 秒。這段時間發出的查詢不能就此放棄：sidecar 一答得出 health，
 * 畫面要自己出現資料，不必等使用者點別頁或等 60 秒後的下一次 health。
 *
 * 用正式版的 queryClient（重試設定與 app 相同）和真的 AppStatusProvider，只替換 fetch。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup, fireEvent } from "@testing-library/react";
import { StrictMode } from "react";
import { QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "../../lib/react-query";
import { AppStatusProvider, useAppStatus } from "../AppStatusContext";
import {
  FAST_PROBE_MS,
  PROBE_TIMEOUT_MS,
  SLOW_PROBE_MS,
  STARTUP_GRACE_MS,
} from "../../api/sidecarConnection";
import { logger } from "../../utils/logger";
import { getRepos } from "../../api/client";
import { API_ENDPOINT } from "../../config";

vi.mock("../../api/sessionSecret", () => ({ getSessionSecret: async () => null }));

let sidecarUp = false;
let reposTotal = 7;

function jsonResponse(data: unknown) {
  return { ok: true, status: 200, json: async () => data } as Response;
}

let failHealthNext = 0;
/** health 請求掛著不回，直到被 abort（sidecar 活著但 event loop 被卡住） */
let hangHealth = false;

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  // 還沒綁上 port：WebView 的 fetch 直接被拒絕
  if (!sidecarUp) throw new TypeError("Load failed");
  const url = String(input);
  if (url === `${API_ENDPOINT}/health` && hangHealth) {
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError"))
      );
    });
  }
  if (url === `${API_ENDPOINT}/health` && failHealthNext > 0) {
    failHealthNext -= 1;
    throw new TypeError("Load failed");
  }
  if (url === `${API_ENDPOINT}/health`) {
    return jsonResponse({
      success: true,
      data: { status: "ok", service: "starscope-engine", timestamp: "2026-09-26T00:00:00+00:00" },
      message: "Service is healthy",
      error: null,
    });
  }
  if (url === `${API_ENDPOINT}/repos`) return jsonResponse({ repos: [], total: reposTotal });
  throw new Error(`unexpected request ${url}`);
});

/** 渲染過的每一個 level：狀態短暫閃成 down 再恢復，只看最後一刻會漏掉 */
const levelsSeen: string[] = [];

function Probe() {
  const repos = useQuery({
    queryKey: ["cold-start", "repos"],
    queryFn: ({ signal }) => getRepos(signal),
  });
  const { level } = useAppStatus();
  if (levelsSeen[levelsSeen.length - 1] !== level) levelsSeen.push(level);
  return (
    <div>
      <span data-testid="level">{level}</span>
      {repos.data ? <span>repos loaded: {repos.data.total}</span> : null}
    </div>
  );
}

/** 使用者按下的寫入操作 */
function SaveButton() {
  const save = useMutation({ mutationFn: () => getRepos() });
  return (
    <div>
      <button onClick={() => save.mutate()}>save</button>
      <span data-testid="save-status">{save.isPaused ? "paused" : save.status}</span>
    </div>
  );
}

function renderApp({ strict = false }: { strict?: boolean } = {}) {
  const tree = (
    <QueryClientProvider client={queryClient}>
      <AppStatusProvider>
        <Probe />
        <SaveButton />
      </AppStatusProvider>
    </QueryClientProvider>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe("sidecar cold start", () => {
  beforeEach(() => {
    sidecarUp = false;
    reposTotal = 7;
    failHealthNext = 0;
    hangHealth = false;
    levelsSeen.length = 0;
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
  });

  afterEach(async () => {
    cleanup();
    // 還掛著的探測要在 fake timers 還在時收掉：負責 abort 的是 fake timer，換回真的 timer
    // 之後它永遠不會觸發，模組層的 probing 會一直是 true，後面的測試探測全都不跑
    hangHealth = false;
    await vi.runOnlyPendingTimersAsync();
    queryClient.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("control: with the sidecar already up, the data appears right away", async () => {
    // 這條現在就要綠：證明 fake timers 與 React Query 的組合本身沒問題，另外兩條紅的是 app 的行為
    sidecarUp = true;
    renderApp();
    await advance(1_000);

    expect(screen.getByText("repos loaded: 7")).toBeInTheDocument();
    expect(screen.getByTestId("level")).toHaveTextContent("online");
  });

  it("loads the queries it started while the sidecar was still starting, once it answers", async () => {
    renderApp();
    await advance(10_000);
    expect(screen.queryByText(/repos loaded/)).toBeNull(); // 還沒起來，當然沒有資料
    // 查詢是暫停，不是失敗後一直重試：冷啟動期間連一個 /repos 都不該發出去
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === `${API_ENDPOINT}/repos`)
    ).toHaveLength(0);

    sidecarUp = true;
    await advance(2_000);

    expect(screen.getByText("repos loaded: 7")).toBeInTheDocument();
    expect(screen.getByTestId("level")).toHaveTextContent("online");
  });

  it("says the engine is down once the startup window passes without an answer", async () => {
    renderApp();
    await advance(STARTUP_GRACE_MS + 1_000);

    expect(screen.getByTestId("level")).toHaveTextContent("sidecar-down");
  });

  it("notices a sidecar that dies mid-session and reloads once it is back", async () => {
    sidecarUp = true;
    renderApp();
    await advance(1_000);
    expect(screen.getByText("repos loaded: 7")).toBeInTheDocument();

    sidecarUp = false;
    // 一個查詢撞上連不上：不等 60 秒的例行探測，馬上知道它掛了
    await act(async () => {
      void queryClient.invalidateQueries({ queryKey: ["cold-start", "repos"] });
    });
    // 查詢撞上連不上 → 立刻探一次（落空）→ FAST_PROBE_MS 後再探（落空）→ 判定掛了。
    // 在第三次探測之前檢查：兩次就要判定，不能拖更久
    await advance(FAST_PROBE_MS + 200);
    expect(screen.getByTestId("level")).toHaveTextContent("sidecar-down");

    sidecarUp = true;
    reposTotal = 8;
    await advance(2_000);

    expect(screen.getByTestId("level")).toHaveTextContent("online");
    expect(screen.getByText("repos loaded: 8")).toBeInTheDocument();
  });

  it("keeps serving local data when the computer goes offline", async () => {
    // sidecar 在本機：瀏覽器斷網不該讓查詢暫停
    sidecarUp = true;
    renderApp();
    await advance(1_000);

    fireEvent(window, new Event("offline"));
    reposTotal = 9;
    await act(async () => {
      void queryClient.invalidateQueries({ queryKey: ["cold-start", "repos"] });
    });
    await advance(1_000);

    expect(screen.getByText("repos loaded: 9")).toBeInTheDocument();
  });

  it("does not call the engine down over a single missed probe", async () => {
    // sidecar 的 event loop 偶爾被同步工作卡住超過一次探測的逾時：不能因此叫使用者重啟
    sidecarUp = true;
    renderApp();
    await advance(1_000);

    failHealthNext = 1;
    // 第一次探測在 t=0 成功，下一次例行探測在 t=SLOW_PROBE_MS 落空；
    // 在 FAST_PROBE_MS 後的重探之前（t=SLOW_PROBE_MS+200）檢查
    await advance(SLOW_PROBE_MS - 1_000 + 200);
    expect(screen.getByTestId("level")).toHaveTextContent("online");

    // 重探成功後計數要歸零：隔了一輪之後再落空一次，也還只是「一次」
    await advance(300); // FAST_PROBE_MS 後的重探成功（t=SLOW_PROBE_MS+500）
    failHealthNext = 1;
    await advance(SLOW_PROBE_MS); // 下一輪例行探測在 t=2*SLOW_PROBE_MS+500 落空

    expect(screen.getByTestId("level")).toHaveTextContent("online");
    expect(levelsSeen).not.toContain("sidecar-down");
  });

  it("stays online after the query client is unmounted and mounted again", async () => {
    // onlineManager 在沒有訂閱者時會拆掉 listener，重新訂閱時再跑一次 setup：
    // setup 不能無條件把查詢設回離線，否則已經連上的 app 會永遠暫停
    sidecarUp = true;
    renderApp();
    await advance(1_000);

    queryClient.unmount();
    queryClient.mount();
    reposTotal = 10;
    await act(async () => {
      void queryClient.invalidateQueries({ queryKey: ["cold-start", "repos"] });
    });
    await advance(1_000);

    expect(screen.getByText("repos loaded: 10")).toBeInTheDocument();
  });

  it("fails a user's save right away while the sidecar is unreachable instead of queueing it", async () => {
    // 排隊的話：確認對話框關不掉、儲存鈕一直轉，刪除會在使用者忘記之後才突然執行
    renderApp();
    await advance(1_000);

    fireEvent.click(screen.getByText("save"));
    await advance(3_000); // apiCall 自己的重試（0.5 s + 1 s）

    expect(screen.getByTestId("save-status")).toHaveTextContent("error");
  });

  it("puts the engine's state ahead of the computer being offline", async () => {
    // sidecar 在本機：它沒在跑才是 app 用不了的原因，斷網提示不能蓋掉它
    renderApp();
    await advance(1_000);
    fireEvent(window, new Event("offline"));
    await advance(100);

    expect(screen.getByTestId("level")).toHaveTextContent("sidecar-starting");
  });

  it("counts a health request that hangs past the probe timeout as a miss", async () => {
    // sidecar 活著但被同步工作卡住：探測不能永遠等下去，逾時就算落空，連兩次才判定掛了
    sidecarUp = true;
    renderApp();
    await advance(1_000);

    hangHealth = true;
    // t=SLOW 探測掛住 → t=SLOW+逾時 落空 → FAST 後重探又掛住 → 再逾時 → 判定掛了
    await advance(SLOW_PROBE_MS - 1_000 + 2 * PROBE_TIMEOUT_MS + FAST_PROBE_MS + 200);

    expect(screen.getByTestId("level")).toHaveTextContent("sidecar-down");
  });

  it("works under StrictMode's mount, unmount, mount", async () => {
    // main.tsx 以 StrictMode 渲染：開發時 effect 會跑兩次（start → stop → start）
    renderApp({ strict: true });
    await advance(5_000);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === `${API_ENDPOINT}/repos`)
    ).toHaveLength(0);

    sidecarUp = true;
    await advance(1_000);

    expect(screen.getByText("repos loaded: 7")).toBeInTheDocument();
    expect(screen.getByTestId("level")).toHaveTextContent("online");
  });

  it("logs a probe failure once per distinct error, not on every retry", async () => {
    // 冷啟動期間每 500ms 落空一次；同一個錯誤只記一次，換了錯誤（例如程式錯誤）才再記
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      renderApp();
      await advance(5_000);

      const probeLogs = warn.mock.calls.filter(([message]) =>
        String(message).includes("[sidecarConnection]")
      );
      expect(probeLogs).toHaveLength(1);
      expect(String(probeLogs[0][1])).toMatch(/Load failed/);
    } finally {
      warn.mockRestore();
    }
  });

  it("logs the same failure again once it comes back after a recovery", async () => {
    // 冷啟動 Load failed → 連上 → 中途掛掉又是 Load failed：第二次一定要留下紀錄
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      renderApp();
      await advance(1_000);
      sidecarUp = true;
      await advance(1_000);

      sidecarUp = false;
      await act(async () => {
        void queryClient.invalidateQueries({ queryKey: ["cold-start", "repos"] });
      });
      await advance(FAST_PROBE_MS + 200);

      const probeLogs = warn.mock.calls.filter(([message]) =>
        String(message).includes("[sidecarConnection]")
      );
      expect(probeLogs).toHaveLength(2);
    } finally {
      warn.mockRestore();
    }
  });

  it("logs the first failure of a fresh start even if the last run ended on the same one", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      renderApp();
      await advance(1_000);
      cleanup(); // 以同樣的失敗收尾
      renderApp();
      await advance(1_000);

      const probeLogs = warn.mock.calls.filter(([message]) =>
        String(message).includes("[sidecarConnection]")
      );
      expect(probeLogs).toHaveLength(2);
    } finally {
      warn.mockRestore();
    }
  });

  it("says the engine is starting, not that it is down, during a normal cold start", async () => {
    renderApp();
    await advance(10_000);

    expect(screen.getByTestId("level")).toHaveTextContent("sidecar-starting");
  });
});
