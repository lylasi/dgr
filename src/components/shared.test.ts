import { describe, expect, it } from "vitest";
import type { AssignmentRewardItem } from "@/components/types";
import { awardedTaskRewardItems } from "@/components/shared";

function rewardItem(id: string, awardedQuantity: number | null): AssignmentRewardItem {
  return {
    id,
    definitionId: id,
    definitionVersion: 1,
    grantTier: "normal",
    quantity: 1,
    probabilityPercent: 100,
    name: id,
    description: "",
    icon: "gift",
    theme: "purple",
    kind: "physical",
    randomMinSeconds: null,
    randomMaxSeconds: null,
    fixedSeconds: null,
    physicalDescription: "礼物",
    fulfillmentInstructions: null,
    imageUrl: null,
    outcomeCount: 1,
    awardedQuantity,
  };
}

describe("awardedTaskRewardItems", () => {
  it("只保留本次实际获得的奖励券", () => {
    const items = [rewardItem("awarded", 2), rewardItem("missed", 0), rewardItem("pending", null)];

    expect(awardedTaskRewardItems(items).map((item) => item.id)).toEqual(["awarded"]);
  });

  it("没有获得奖励券时返回空列表", () => {
    expect(awardedTaskRewardItems([rewardItem("missed", 0)])).toEqual([]);
  });
});
