/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickTimerDialog, WorkersPanel } from "@/components/admin-app";
import type { AdminState, AdminWorker } from "@/components/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const now = 1_750_000_000_000;

function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function worker(index: number): AdminWorker {
  return {
    id: `worker-${index}`,
    familyId: "family",
    name: `角色 ${index}`,
    avatar: "star",
    theme: index % 2 === 0 ? "blue" : "purple",
    avatarUrl: null,
    authVersion: 1,
    balanceSeconds: index * 1_800,
    dailyRewardSeconds: 2 * 3_600,
    timezone: "Asia/Shanghai",
    isActive: index !== 6,
    activeTimer: null,
    assignments: [],
    pendingReviewCount: index === 1 ? 2 : 0,
    dailyCouponSetting: {
      workerId: `worker-${index}`,
      isEnabled: index === 1,
      dailyQuantity: index === 1 ? 2 : 0,
      randomMinSeconds: 300,
      randomMaxSeconds: 900,
      updatedAt: now,
    },
    todayDailyCouponGrant: null,
    availableRewardCount: index,
  };
}

function state(): AdminState {
  return {
    workers: Array.from({ length: 6 }, (_, index) => worker(index + 1)),
    tasks: [],
    reviews: [],
    rewardRequests: [],
    activities: [{ id: "game", name: "玩游戏", icon: "game", sortOrder: 1, isActive: true }],
    transactions: [],
    rewardSystemEnabled: true,
    rewardDefinitions: [],
    rewardItems: [],
    dailyCouponSettings: [],
    dailyCouponGrants: [],
    todayDailyCouponGrants: {},
  };
}

describe("角色管理", () => {
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

  it("多角色使用紧凑列表，并通过弹窗改名和创建角色", async () => {
    const mutate = vi.fn(async () => true);
    const onOpenLedger = vi.fn();
    act(() => {
      root.render(createElement(WorkersPanel, {
        state: state(),
        busy: false,
        mutate,
        onQuickReward: vi.fn(),
        onDirectReward: vi.fn(),
        onEnterWorker: vi.fn(),
        onOpenLedger,
      }));
    });

    expect(container.querySelectorAll('[aria-label^="打开 "][aria-label$=" 的角色设置"]')).toHaveLength(6);
    expect(container.querySelectorAll('[aria-label^="查看 "][aria-label$=" 的明细"]')).toHaveLength(6);
    expect(container.querySelector('[aria-label="搜索角色"]')).toBeTruthy();
    expect(container.textContent).toContain("共 6 个角色 · 启用 5 · 停用 1");
    expect(container.textContent).not.toContain("上传照片头像");

    const firstRow = container.querySelector<HTMLButtonElement>('[aria-label="打开 角色 1 的角色设置"]');
    act(() => firstRow!.click());

    const settings = container.querySelector('[aria-labelledby="worker-settings-title"]');
    expect(settings).toBeTruthy();
    expect(settings?.textContent).toContain("角色 1");
    expect(settings?.textContent).toContain("每日固定奖励");
    expect(settings?.textContent).toContain("每日免费派券");
    expect(settings?.querySelector('input[placeholder="设置新 PIN"]')).toBeTruthy();
    expect(settings?.textContent).toContain("发奖励券");
    expect(settings?.textContent).toContain("进入页面");
    expect(settings?.textContent).toContain("查看明细");

    const nameInput = settings?.querySelector<HTMLInputElement>('[aria-label="角色名称"]');
    act(() => setInputValue(nameInput!, "新的角色名"));
    const saveName = [...settings!.querySelectorAll("button")].find((button) => button.textContent?.includes("保存名称"));
    await act(async () => saveName!.click());
    expect(mutate).toHaveBeenCalledWith(
      { action: "update_worker", workerId: "worker-1", name: "新的角色名" },
      "角色名称已更新",
    );

    const openLedger = [...settings!.querySelectorAll("button")].find((button) => button.textContent?.includes("查看明细"));
    act(() => openLedger!.click());
    expect(onOpenLedger).toHaveBeenCalledWith("worker-1");

    expect(container.querySelector('[aria-labelledby="worker-settings-title"]')).toBeNull();

    const createButton = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("新角色"));
    act(() => createButton!.click());
    expect(container.querySelector('[aria-labelledby="create-worker-title"]')?.textContent).toContain("每个角色都有自己的 PIN");
  });

  it("角色列表的快捷消耗可以直接填写已消耗分钟", async () => {
    const mutate = vi.fn(async () => true);
    const onClose = vi.fn();
    act(() => {
      root.render(createElement(QuickTimerDialog, {
        worker: worker(1),
        activities: state().activities,
        mutate,
        busy: false,
        onClose,
      }));
    });

    const dialog = container.querySelector('[aria-labelledby="quick-timer-title"]');
    expect(dialog?.textContent).toContain("直接填写已消耗时长");
    expect(dialog?.textContent).toContain("无需开启计时");
    expect(dialog?.querySelector<HTMLSelectElement>('[aria-label="直接填写消耗项目"]')?.value).toBe("game");

    const minutes = dialog?.querySelector<HTMLInputElement>('[aria-label="已消耗分钟数"]');
    const confirm = [...dialog!.querySelectorAll("button")].find((button) => button.textContent?.includes("确认记录并扣除")) as HTMLButtonElement;
    act(() => setInputValue(minutes!, "31"));
    expect(confirm.disabled).toBe(true);
    expect(dialog?.textContent).toContain("填写时长超过当前余额");

    act(() => setInputValue(minutes!, "20"));
    expect(confirm.disabled).toBe(false);
    expect(dialog?.textContent).toContain("将立即扣除 20分钟，剩余 10分钟");
    await act(async () => confirm.click());

    expect(mutate).toHaveBeenCalledWith(
      { action: "manual_consumption", workerId: "worker-1", activityId: "game", durationSeconds: 1_200 },
      "已帮 角色 1 记录玩游戏 20分钟",
    );
    expect(onClose).toHaveBeenCalledOnce();
  });
});
