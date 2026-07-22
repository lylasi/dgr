import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RewardSettingsPanel } from "@/components/admin-rewards";
import type { AdminRewardDefinition, AdminState } from "@/components/types";

function rewardDefinition(overrides: Partial<AdminRewardDefinition>): AdminRewardDefinition {
  return {
    id: "definition",
    name: "模板名称",
    description: "模板详细说明",
    icon: "gift",
    theme: "purple",
    kind: "fixed_time",
    version: 1,
    isActive: true,
    randomMinSeconds: null,
    randomMaxSeconds: null,
    fixedSeconds: 600,
    physicalDescription: null,
    fulfillmentInstructions: null,
    imageUrl: null,
    validityMode: "permanent",
    createdAt: 1,
    updatedAt: 1,
    canDelete: true,
    usage: { taskBindingCount: 0, assignmentSnapshotCount: 0, issuedRewardCount: 0 },
    ...overrides,
  };
}

describe("RewardSettingsPanel", () => {
  it("默认只显示模板统计入口，不铺开每个模板详情", () => {
    const state: AdminState = {
      workers: [],
      tasks: [],
      reviews: [],
      rewardRequests: [],
      activities: [],
      transactions: [],
      rewardSystemEnabled: true,
      rewardDefinitions: [
        rewardDefinition({ id: "fixed", name: "不应默认展开的固定券" }),
        rewardDefinition({
          id: "random",
          name: "不应默认展开的随机券",
          kind: "random_time",
          fixedSeconds: null,
          randomMinSeconds: 300,
          randomMaxSeconds: 900,
          isActive: false,
        }),
      ],
      rewardItems: [],
      dailyCouponSettings: [],
      dailyCouponGrants: [],
      todayDailyCouponGrants: {},
    };

    const markup = renderToStaticMarkup(createElement(RewardSettingsPanel, {
      state,
      busy: false,
      mutate: async () => true,
    }));

    expect(markup).toContain("2 个模板");
    expect(markup).toContain("启用 1");
    expect(markup).toContain("随机 1 · 固定 1 · 实物 0");
    expect(markup).toContain("查看全部");
    expect(markup).not.toContain("奖励历史");
    expect(markup).not.toContain("不应默认展开的固定券");
    expect(markup).not.toContain("不应默认展开的随机券");
  });
});
