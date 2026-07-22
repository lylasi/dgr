import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AssignmentRewardItem } from "@/components/types";
import { awardedTaskRewardItems, TaskRewardSummary } from "@/components/shared";

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

describe("TaskRewardSummary", () => {
  it("没有配置奖励券时不显示任何券相关说明", () => {
    const markup = renderToStaticMarkup(
      createElement(TaskRewardSummary, { baseRewardSeconds: 1800, excellentMultiplier: 2, bonusEnabled: true, items: [] }),
    );

    expect(markup).not.toContain("普通奖励券");
    expect(markup).not.toContain("优秀额外奖励券");
    expect(markup).not.toContain("正常、优秀都会参与");
    expect(markup).toContain("正常完成");
    expect(markup).toContain("优秀完成");
  });

  it("只显示实际配置过的奖励券类别", () => {
    const markup = renderToStaticMarkup(
      createElement(TaskRewardSummary, {
        baseRewardSeconds: 1800,
        excellentMultiplier: 2,
        bonusEnabled: true,
        items: [rewardItem("普通礼物券", null)],
      }),
    );

    expect(markup).toContain("普通奖励券");
    expect(markup).toContain("普通礼物券");
    expect(markup).not.toContain("优秀额外奖励券");
  });

  it("打工人预览对概率券只显示神秘符号", () => {
    const possible = { ...rewardItem("隐藏的真实券名", null), probabilityPercent: 30 };
    const markup = renderToStaticMarkup(
      createElement(TaskRewardSummary, {
        baseRewardSeconds: 1800,
        excellentMultiplier: 2,
        bonusEnabled: false,
        items: [possible],
        workerPreview: true,
      }),
    );

    expect(markup).toContain("可能获得神秘奖励券");
    expect(markup).toContain("完成并审核后揭晓");
    expect(markup).not.toContain("隐藏的真实券名");
    expect(markup).not.toContain("30%");
  });
});
