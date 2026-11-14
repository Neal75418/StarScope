/**
 * loadStatus／combineLoadStatus 的單元測試：用真的 QueryClient，一個區塊同時靠兩個查詢。
 */

import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { combineLoadStatus, loadStatus } from "../react-query";

interface Pending {
  resolve: (value: string) => void;
  reject: (reason: Error) => void;
}

function setup() {
  const requests: Record<"rules" | "repos", Pending[]> = { rules: [], repos: [] };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const probe = (name: "rules" | "repos") => () =>
    new Promise<string>((resolve, reject) => {
      requests[name].push({ resolve, reject });
    });
  const view = renderHook(
    () => {
      const rules = loadStatus(useQuery({ queryKey: ["rules"], queryFn: probe("rules") }));
      const repos = loadStatus(useQuery({ queryKey: ["repos"], queryFn: probe("repos") }));
      return { rules, repos, both: combineLoadStatus([rules, repos]) };
    },
    { wrapper }
  );
  return { ...view, requests };
}

async function settle(action: () => void) {
  await act(async () => {
    action();
    await Promise.resolve();
  });
}

describe("loadStatus", () => {
  it("is not ready, not failed and in progress while the first load is running", async () => {
    const { result, requests } = setup();
    await waitFor(() => expect(requests.rules).toHaveLength(1));

    expect(result.current.rules).toMatchObject({ ready: false, failed: false, inProgress: true });
  });

  it("is ready once data arrived, and stays ready when a later reload fails", async () => {
    const { result, requests } = setup();
    await waitFor(() => expect(requests.rules).toHaveLength(1));
    await settle(() => requests.rules[0].resolve("ok"));
    await waitFor(() => expect(result.current.rules.ready).toBe(true));
    expect(result.current.rules).toMatchObject({ failed: false, inProgress: false });

    await settle(() => result.current.rules.retry());
    await waitFor(() => expect(requests.rules).toHaveLength(2));
    await settle(() => requests.rules[1].reject(new Error("boom")));

    await waitFor(() => expect(result.current.rules.failed).toBe(true));
    expect(result.current.rules.ready).toBe(true);
  });

  it("retry loads the query again", async () => {
    const { result, requests } = setup();
    await waitFor(() => expect(requests.rules).toHaveLength(1));
    await settle(() => requests.rules[0].reject(new Error("boom")));
    await waitFor(() => expect(result.current.rules.failed).toBe(true));

    await settle(() => result.current.rules.retry());

    await waitFor(() => expect(requests.rules).toHaveLength(2));
    expect(result.current.rules).toMatchObject({ failed: true, inProgress: true });
  });
});

describe("combineLoadStatus", () => {
  it("is ready only when every part is, and failed as soon as one part is", async () => {
    const { result, requests } = setup();
    await waitFor(() => expect(requests.repos).toHaveLength(1));
    await settle(() => requests.rules[0].resolve("ok"));
    await waitFor(() => expect(result.current.rules.ready).toBe(true));
    expect(result.current.both).toMatchObject({ ready: false, failed: false, inProgress: true });

    await settle(() => requests.repos[0].reject(new Error("boom")));

    await waitFor(() => expect(result.current.both.failed).toBe(true));
    expect(result.current.both).toMatchObject({ ready: false, inProgress: false });
  });

  it("retries only the parts that failed", async () => {
    const { result, requests } = setup();
    await waitFor(() => expect(requests.repos).toHaveLength(1));
    await settle(() => requests.rules[0].resolve("ok"));
    await settle(() => requests.repos[0].reject(new Error("boom")));
    await waitFor(() => expect(result.current.both.failed).toBe(true));

    await settle(() => result.current.both.retry());

    await waitFor(() => expect(requests.repos).toHaveLength(2));
    expect(requests.rules).toHaveLength(1);
    expect(result.current.both.inProgress).toBe(true);

    await settle(() => requests.repos[1].resolve("ok"));
    await waitFor(() => expect(result.current.both.ready).toBe(true));
    expect(result.current.both).toMatchObject({ failed: false, inProgress: false });
  });

  it("counts a retry as running only when a part that failed is being reloaded", async () => {
    // 規則讀不到、追蹤清單因為別的原因在重讀：按鈕顯示「重試中」並不吃點擊的話，其實沒有任何東西在重讀規則
    const { result, requests } = setup();
    await waitFor(() => expect(requests.repos).toHaveLength(1));
    await settle(() => requests.rules[0].reject(new Error("boom")));
    await settle(() => requests.repos[0].resolve("ok"));
    await waitFor(() => expect(result.current.both.failed).toBe(true));

    await settle(() => result.current.repos.retry());
    await waitFor(() => expect(result.current.repos.inProgress).toBe(true));
    expect(result.current.both.inProgress).toBe(false);

    await settle(() => result.current.both.retry());
    await waitFor(() => expect(requests.rules).toHaveLength(2));
    expect(result.current.both.inProgress).toBe(true);
  });

  it("keeps the retry available while one of several failed parts is not being reloaded", async () => {
    // 兩份都讀不到、其中一份因為別的原因在重讀：另一份沒有人在重讀，重試鈕要能按
    const { result, requests } = setup();
    await waitFor(() => expect(requests.repos).toHaveLength(1));
    await settle(() => requests.rules[0].reject(new Error("boom")));
    await settle(() => requests.repos[0].reject(new Error("boom")));
    await waitFor(() => expect(result.current.rules.failed).toBe(true));
    await waitFor(() => expect(result.current.repos.failed).toBe(true));

    await settle(() => result.current.repos.retry());
    await waitFor(() => expect(result.current.repos.inProgress).toBe(true));
    expect(result.current.both.inProgress).toBe(false);

    await settle(() => result.current.both.retry());
    await waitFor(() => expect(requests.rules).toHaveLength(2));
    expect(result.current.both.inProgress).toBe(true);
  });
});
