/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LedgerPanel } from "@/components/worker-app";
import type { TransactionPage, WorkerState } from "@/components/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function page(pageNumber = 1): TransactionPage {
  return {
    items: [],
    page: pageNumber,
    pageSize: 30,
    total: 31,
    totalPages: 2,
    summary: { incomeSeconds: 3_600, spentSeconds: 600 },
  };
}

function workerState(): WorkerState {
  return {
    worker: { id: "worker", familyId: "family", name: "小林", avatar: "star", theme: "purple", avatarUrl: null, authVersion: 1, balanceSeconds: 3_000, dailyRewardSeconds: 0, timezone: "Asia/Shanghai", isActive: true },
    transactions: [],
    assignments: [],
  } as unknown as WorkerState;
}

function setControlValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("打工人明细分页搜索", () => {
  let container: HTMLDivElement;
  let root: Root;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const pageNumber = new URL(url, "http://localhost").searchParams.get("page") === "2" ? 2 : 1;
    return new Response(JSON.stringify({ ok: true, data: page(pageNumber) }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("每次最多查询 30 条，并传递日期、类型、方向和页码", async () => {
    await act(async () => {
      root.render(<LedgerPanel state={workerState()} onOpenTaskDetail={vi.fn()} />);
    });

    expect(String(fetchMock.mock.calls[0][0])).toContain("pageSize=30");
    expect(container.querySelector("#ledger-advanced-search")).toBeNull();
    expect([...container.querySelectorAll<HTMLButtonElement>("button")].filter((button) => ["全部", "收入", "消耗", "每日奖励"].includes(button.textContent || ""))).toHaveLength(4);

    const daily = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "每日奖励")!;
    await act(async () => { daily.click(); });
    expect(new URL(String(fetchMock.mock.calls.at(-1)![0]), "http://localhost").searchParams.get("type")).toBe("daily_reward");

    const more = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("更多搜索"))!;
    await act(async () => { more.click(); });
    expect(container.querySelector("#ledger-advanced-search")).toBeTruthy();

    const controls = container.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select");
    await act(async () => {
      setControlValue(controls[0], "阅读");
      setControlValue(controls[1], "2026-07-01");
      setControlValue(controls[2], "2026-07-27");
      setControlValue(controls[3], "task_reward");
      setControlValue(controls[4], "income");
      container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    const searchUrl = new URL(String(fetchMock.mock.calls.at(-1)![0]), "http://localhost");
    expect(Object.fromEntries(searchUrl.searchParams)).toMatchObject({
      page: "1",
      pageSize: "30",
      query: "阅读",
      startDate: "2026-07-01",
      endDate: "2026-07-27",
      type: "task_reward",
      direction: "income",
    });

    const next = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "下一页")!;
    await act(async () => { next.click(); });
    expect(new URL(String(fetchMock.mock.calls.at(-1)![0]), "http://localhost").searchParams.get("page")).toBe("2");
  });
});
