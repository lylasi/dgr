/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewPanel } from "@/components/admin-app";
import type { AdminState, RewardItem, Transaction } from "@/components/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const now = 1_750_000_000_000;

function rewardItem(): RewardItem {
  return {
    id: "reward-item",
    workerId: "worker",
    workerName: "小林",
    grantBatchId: "batch",
    definitionId: "definition",
    definitionVersion: 1,
    sourceType: "admin_direct",
    sourceId: null,
    grantedBy: "admin",
    grantReason: "认真完成阅读计划",
    name: "测试奖励券",
    description: "可以兑换十分钟时间",
    icon: "gift",
    theme: "purple",
    kind: "fixed_time",
    randomMinSeconds: null,
    randomMaxSeconds: null,
    fixedSeconds: 600,
    physicalDescription: null,
    fulfillmentInstructions: null,
    imageUrl: null,
    status: "available",
    expiresAt: null,
    grantedAt: now,
    redeemedAt: null,
    fulfilledAt: null,
    cancelledAt: null,
    cancellationReason: null,
    resultSeconds: null,
    transactionId: null,
    usedAt: null,
  };
}

function transaction(): Transaction {
  return {
    id: "transaction",
    workerId: "worker",
    workerName: "小林",
    type: "task_reward",
    title: "阅读奖励",
    amountSeconds: 1_800,
    balanceAfterSeconds: 3_600,
    actor: "admin",
    reason: "家长确认完成",
    rewardItemId: null,
    assignmentId: null,
    startedAt: null,
    endedAt: null,
    createdAt: now + 1,
    isReversed: false,
    reversalOfTransactionId: null,
  };
}

function adminState(): AdminState {
  return {
    workers: [],
    tasks: [],
    reviews: [],
    rewardRequests: [],
    activities: [],
    transactions: [transaction()],
    rewardSystemEnabled: true,
    rewardDefinitions: [],
    rewardItems: [rewardItem()],
    dailyCouponSettings: [],
    dailyCouponGrants: [],
    todayDailyCouponGrants: {},
  };
}

describe("管理员审核历史", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("在待审核列表下依次展示可点击的奖励历史和最近明细", () => {
    act(() => {
      root.render(createElement(ReviewPanel, {
        state: adminState(),
        busy: false,
        mutate: vi.fn(async () => true),
      }));
    });

    const text = container.textContent || "";
    expect(text.indexOf("待审核")).toBeLessThan(text.indexOf("奖励历史"));
    expect(text.indexOf("奖励历史")).toBeLessThan(text.indexOf("最近明细"));

    const rewardRow = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("测试奖励券"));
    expect(rewardRow).toBeTruthy();
    act(() => rewardRow!.click());
    expect(container.querySelector('[aria-labelledby="admin-reward-detail-title"]')?.textContent).toContain("认真完成阅读计划");

    const closeReward = container.querySelector<HTMLButtonElement>('[aria-label="关闭奖励历史详情"]');
    act(() => closeReward!.click());

    const transactionRow = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("阅读奖励"));
    expect(transactionRow).toBeTruthy();
    act(() => transactionRow!.click());
    const transactionDetail = container.querySelector('[aria-labelledby="admin-transaction-detail-title"]');
    expect(transactionDetail?.textContent).toContain("变化后余额");
    expect(transactionDetail?.textContent).toContain("家长确认完成");
  });
});
