import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAsyncOperation } from "../useAsyncOperation";

describe("useAsyncOperation", () => {
  it("starts with isSubmitting false", () => {
    const { result } = renderHook(() => useAsyncOperation());
    expect(result.current.isSubmitting).toBe(false);
  });

  it("is submitting while the operation runs and gives back its result", async () => {
    let resolveFn: (value: string) => void = () => {};
    const operation = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveFn = resolve;
        })
    );
    const { result } = renderHook(() => useAsyncOperation());

    let executePromise: Promise<string> = Promise.resolve("");
    act(() => {
      executePromise = result.current.execute(operation);
    });
    expect(result.current.isSubmitting).toBe(true);

    let value: string | undefined;
    await act(async () => {
      resolveFn("done");
      value = await executePromise;
    });

    expect(value).toBe("done");
    expect(result.current.isSubmitting).toBe(false);
  });

  it("lets the error through to the caller and stops submitting", async () => {
    // 失敗怎麼說由呼叫端決定（寫入失敗見 describeWriteFailure）：這裡接住的話，只能給一句不分操作的通用說法
    const error = new Error("Something broke");
    const { result } = renderHook(() => useAsyncOperation());

    let caught: unknown;
    await act(async () => {
      await result.current
        .execute(() => Promise.reject(error))
        .catch((err: unknown) => {
          caught = err;
        });
    });

    expect(caught).toBe(error);
    expect(result.current.isSubmitting).toBe(false);
  });
});
