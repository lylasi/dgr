/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewPanel } from "@/components/admin-app";
import type { AdminState, Assignment, RewardItem, Transaction } from "@/components/types";

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
    assignmentId: "assignment",
    startedAt: null,
    endedAt: null,
    createdAt: now + 1,
    isReversed: false,
    reversalOfTransactionId: null,
  };
}

function assignment(): Assignment {
  return {
    id: "assignment",
    taskId: "task",
    workerId: "worker",
    title: "阅读奖励",
    description: "完成本周阅读计划",
    rewardSeconds: 1_800,
    timingMode: "optional",
    minimumDurationSeconds: null,
    bonusEnabled: true,
    excellentMultiplier: 2,
    bonusCriteria: "讲清楚书里的主要内容",
    dueAt: null,
    status: "approved",
    submissionNote: "读完并做了笔记",
    reviewMultiplier: 1,
    reviewTier: "normal",
    reviewNote: "家长确认完成",
    reviewedAt: now + 1,
    claimedAt: now - 60_000,
    submittedAt: now,
    durationSeconds: 1_200,
    rewardItems: [{
      id: "assignment-reward",
      definitionId: "definition",
      definitionVersion: 1,
      grantTier: "normal",
      quantity: 2,
      probabilityPercent: 100,
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
      outcomeCount: 2,
      awardedQuantity: 2,
    }],
  };
}

function adminState(): AdminState {
  return {
    workers: [{
      id: "worker",
      familyId: "family",
      name: "小林",
      avatar: "star",
      theme: "purple",
      avatarUrl: null,
      authVersion: 1,
      balanceSeconds: 3_600,
      dailyRewardSeconds: 0,
      timezone: "Asia/Shanghai",
      isActive: true,
      activeTimer: null,
      assignments: [assignment()],
      pendingReviewCount: 0,
      dailyCouponSetting: {
        workerId: "worker",
        isEnabled: false,
        dailyQuantity: 1,
        randomMinSeconds: 300,
        randomMaxSeconds: 1_800,
        updatedAt: now,
      },
      todayDailyCouponGrant: null,
      availableRewardCount: 1,
    }],
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
    expect(transactionRow?.querySelector('[aria-label="获得奖励券 2 张"]')).toBeTruthy();
    expect(transactionRow?.textContent).toContain("券×2");
    act(() => transactionRow!.click());
    const transactionDetail = container.querySelector('[aria-labelledby="admin-transaction-detail-title"]');
    expect(transactionDetail?.textContent).toContain("变化后余额");
    expect(transactionDetail?.textContent).toContain("家长确认完成");
    expect(transactionDetail?.textContent).toContain("本次任务奖励计提");
    expect(transactionDetail?.textContent).toContain("奖励券 2 张");
    expect(transactionDetail?.textContent).toContain("测试奖励券");
    expect(transactionDetail?.textContent).toContain("10 分钟固定时间");
    expect(transactionDetail?.textContent).toContain("普通奖励");
    expect(transactionDetail?.textContent).toContain("可以兑换十分钟时间");
    expect(transactionDetail?.textContent).toContain("本次实际获得 2 张");
  });
});
