import { describe, expect, it } from "vitest";
import { groupAvailableRewards, taskCouponHint } from "@/components/worker-app";
import type { RewardItem, TaskRewardBinding } from "@/components/types";

function rewardItem(id: string, version: number, status: RewardItem["status"] = "available") {
  return {
    id,
    definitionId: "same-definition",
    definitionVersion: version,
    status,
  } as RewardItem;
}

describe("groupAvailableRewards", () => {
  it("合并同版本的可用券，并忽略已经使用的券", () => {
    const groups = groupAvailableRewards([
      rewardItem("one", 1),
      rewardItem("two", 1),
      rewardItem("used", 1, "redeemed"),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((item) => item.id)).toEqual(["one", "two"]);
  });

  it("不合并规则快照版本不同的券", () => {
    expect(groupAvailableRewards([
      rewardItem("old", 1),
      rewardItem("new", 2),
    ])).toHaveLength(2);
  });

  it("无模板来源时只合并内容完全相同的券", () => {
    const base = {
      ...rewardItem("legacy-one", 1),
      definitionId: null,
      kind: "physical" as const,
      name: "礼物券",
      description: "领取一份礼物",
      icon: "gift",
      theme: "purple",
      physicalDescription: "小礼物",
      fulfillmentInstructions: "和管理员领取",
      imageUrl: null,
    };

    expect(groupAvailableRewards([
      base,
      { ...base, id: "legacy-two" },
      { ...base, id: "different", fulfillmentInstructions: "邮寄领取" },
    ])).toHaveLength(2);
  });
});

function taskReward(overrides: Partial<TaskRewardBinding> = {}) {
  return {
    bindingId: "binding",
    name: "惊喜券",
    kind: "fixed_time",
    fixedSeconds: 15 * 60,
    quantity: 2,
    probabilityPercent: 100,
    grantTier: "normal",
    ...overrides,
  } as TaskRewardBinding;
}

describe("taskCouponHint", () => {
  it("用一句话说明券的条件、概率、数量和内容", () => {
    expect(taskCouponHint(taskReward())).toBe("完成必得“惊喜券”×2：15 分钟固定时间。");
    expect(taskCouponHint(taskReward({ grantTier: "excellent_bonus", probabilityPercent: 30 })))
      .toBe("优秀完成额外30% 概率获得“惊喜券”×2：15 分钟固定时间。");
  });

  it("神秘券只说明揭晓方式，不泄露内容", () => {
    expect(taskCouponHint(taskReward({ isMystery: true, name: "不能提前显示" })))
      .toBe("完成可能获得神秘奖励券，审核后揭晓。");
  });
});
