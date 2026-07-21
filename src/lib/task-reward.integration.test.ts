import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetConfigForTests } from "@/lib/config";
import { closeDbForTests, getDb } from "@/lib/db";
import {
  cancelAssignment,
  createTask,
  createWorker,
  getAdminState,
  getWorkerState,
  reviewAssignment,
  submitAssignment,
} from "@/lib/service";
import {
  createRewardDefinition,
  setRewardSystemEnabled,
  updateRewardDefinition,
} from "@/lib/reward-service";
import { MINUTE } from "@/lib/time";

const databasePath = path.join("/private/tmp", `pen-worker-task-reward-${process.pid}.db`);

describe.sequential("task reward combinations", () => {
  let workerId = "";
  let normalDefinitionId = "";
  let excellentDefinitionId = "";
  let neverDefinitionId = "";
  let sequence = 0;

  function nextId(label: string) {
    sequence += 1;
    return `task-reward-${label}-${sequence}`;
  }

  function assignmentFor(taskId: string) {
    const assignment = getWorkerState(workerId).assignments.find((item) => item.taskId === taskId);
    if (!assignment) throw new Error(`missing assignment for ${taskId}`);
    return assignment;
  }

  function submitTask(taskId: string) {
    const assignment = assignmentFor(taskId);
    submitAssignment({
      workerId,
      assignmentId: assignment.id,
      note: "已经认真完成",
      actor: `worker:${workerId}`,
      requestId: nextId("submit"),
    });
    return assignment.id;
  }

  beforeAll(async () => {
    process.env.ADMIN_PASSWORD = "task-reward-admin";
    process.env.SESSION_SECRET = "task-reward-session-secret-with-at-least-thirty-two-characters";
    process.env.DATABASE_PATH = databasePath;
    process.env.APP_TIMEZONE = "Asia/Shanghai";
    resetConfigForTests();
    closeDbForTests();
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${databasePath}${suffix}`, { force: true });

    workerId = await createWorker({
      name: "任务奖励测试员",
      password: "1357",
      avatar: "star",
      theme: "purple",
      dailyRewardSeconds: 0,
      requestId: nextId("worker"),
    });
    normalDefinitionId = createRewardDefinition({
      name: "普通十分钟券",
      description: "普通奖励",
      icon: "clock",
      theme: "blue",
      kind: "fixed_time",
      fixedSeconds: 10 * MINUTE,
      requestId: nextId("normal-definition"),
    });
    excellentDefinitionId = createRewardDefinition({
      name: "优秀图书券",
      description: "优秀额外奖励",
      icon: "book",
      theme: "green",
      kind: "physical",
      physicalDescription: "一本测试图书",
      fulfillmentInstructions: "周末一起挑选",
      requestId: nextId("excellent-definition"),
    });
    neverDefinitionId = createRewardDefinition({
      name: "零概率券",
      description: "用于验证 0%",
      icon: "sparkles",
      theme: "purple",
      kind: "random_time",
      randomMinSeconds: MINUTE,
      randomMaxSeconds: 2 * MINUTE,
      requestId: nextId("never-definition"),
    });
  });

  afterAll(() => {
    closeDbForTests();
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${databasePath}${suffix}`, { force: true });
    resetConfigForTests();
  });

  it("settles normal completion as base x1 plus only the normal 100% coupon", () => {
    const taskId = createTask({
      title: "正常完成组合",
      description: "普通和优秀券都已配置",
      rewardSeconds: 10 * MINUTE,
      targetWorkerId: workerId,
      timingMode: "none",
      bonusEnabled: true,
      excellentMultiplier: 3,
      bonusCriteria: "达到优秀标准",
      rewardBindings: [
        { definitionId: normalDefinitionId, grantTier: "normal", quantity: 1, probabilityPercent: 100 },
        { definitionId: excellentDefinitionId, grantTier: "excellent_bonus", quantity: 1, probabilityPercent: 100 },
      ],
      assignNow: true,
      requestId: nextId("normal-task"),
    });
    const publicTask = getAdminState().tasks.find((task) => task.id === taskId)!;
    expect(publicTask).toMatchObject({ excellentMultiplier: 3 });
    expect(publicTask.rewardBindings).toHaveLength(2);
    const before = getWorkerState(workerId).worker.balanceSeconds;
    const assignmentId = submitTask(taskId);
    const result = reviewAssignment({
      assignmentId,
      decision: "approve",
      note: "正常完成",
      requestId: nextId("normal-review"),
    });
    expect(result).toMatchObject({
      amountSeconds: 10 * MINUTE,
      configuredRewardCount: 1,
      awardedRewardCount: 1,
    });
    const state = getWorkerState(workerId);
    const assignment = state.assignments.find((item) => item.id === assignmentId)!;
    expect(state.worker.balanceSeconds - before).toBe(10 * MINUTE);
    expect(assignment).toMatchObject({ reviewTier: "normal", reviewMultiplier: 1 });
    expect(assignment.rewardItems.find((item) => item.grantTier === "normal")?.awardedQuantity).toBe(1);
    expect(assignment.rewardItems.find((item) => item.grantTier === "excellent_bonus")?.awardedQuantity).toBeNull();
    const taskItems = state.rewardItems.filter((item) => item.sourceType === "task" && item.sourceId === assignmentId);
    expect(taskItems).toHaveLength(1);
    expect(taskItems[0].definitionId).toBe(normalDefinitionId);
  });

  it("settles excellent x3 with the original normal coupons and excellent extras", () => {
    const taskId = createTask({
      title: "优秀三倍组合",
      description: "验证优秀组合",
      rewardSeconds: 10 * MINUTE,
      targetWorkerId: workerId,
      timingMode: "none",
      bonusEnabled: true,
      excellentMultiplier: 3,
      bonusCriteria: "表现优秀",
      rewardBindings: [
        { definitionId: normalDefinitionId, grantTier: "normal", quantity: 1, probabilityPercent: 100 },
        { definitionId: excellentDefinitionId, grantTier: "excellent_bonus", quantity: 1, probabilityPercent: 100 },
      ],
      assignNow: true,
      requestId: nextId("excellent-three-task"),
    });
    const before = getWorkerState(workerId).worker.balanceSeconds;
    const assignmentId = submitTask(taskId);
    const result = reviewAssignment({
      assignmentId,
      decision: "excellent",
      note: "达到优秀标准",
      requestId: nextId("excellent-three-review"),
    });
    expect(result).toMatchObject({
      amountSeconds: 30 * MINUTE,
      configuredRewardCount: 2,
      awardedRewardCount: 2,
    });
    const state = getWorkerState(workerId);
    const assignment = state.assignments.find((item) => item.id === assignmentId)!;
    expect(state.worker.balanceSeconds - before).toBe(30 * MINUTE);
    expect(assignment).toMatchObject({ reviewTier: "excellent", reviewMultiplier: 3 });
    expect(assignment.rewardItems.map((item) => item.awardedQuantity)).toEqual([1, 1]);
    expect(state.rewardItems.filter((item) => item.sourceType === "task" && item.sourceId === assignmentId)).toHaveLength(2);
  });

  it("distinguishes excellent x1 and still grants excellent-only coupons", () => {
    const taskId = createTask({
      title: "优秀一倍组合",
      description: "优秀不增加基础时数",
      rewardSeconds: 5 * MINUTE,
      targetWorkerId: workerId,
      timingMode: "none",
      bonusEnabled: true,
      excellentMultiplier: 1,
      bonusCriteria: "优秀但基础倍率为一",
      rewardBindings: [
        { definitionId: excellentDefinitionId, grantTier: "excellent_bonus", quantity: 1, probabilityPercent: 100 },
      ],
      assignNow: true,
      requestId: nextId("excellent-one-task"),
    });
    const before = getWorkerState(workerId).worker.balanceSeconds;
    const assignmentId = submitTask(taskId);
    reviewAssignment({
      assignmentId,
      decision: "excellent",
      note: "优秀完成但倍率是一",
      requestId: nextId("excellent-one-review"),
    });
    const state = getWorkerState(workerId);
    const assignment = state.assignments.find((item) => item.id === assignmentId)!;
    expect(state.worker.balanceSeconds - before).toBe(5 * MINUTE);
    expect(assignment).toMatchObject({ reviewTier: "excellent", reviewMultiplier: 1, excellentMultiplier: 1 });
    expect(assignment.rewardItems[0].awardedQuantity).toBe(1);
    expect(state.rewardItems.filter((item) => item.sourceId === assignmentId)).toHaveLength(1);
  });

  it("records one independent outcome per candidate and honors 100% and 0% exactly", () => {
    const taskId = createTask({
      title: "概率与多张测试",
      description: "每张分别判定",
      rewardSeconds: MINUTE,
      targetWorkerId: workerId,
      timingMode: "none",
      bonusEnabled: false,
      rewardBindings: [
        { definitionId: normalDefinitionId, grantTier: "normal", quantity: 2, probabilityPercent: 100 },
        { definitionId: neverDefinitionId, grantTier: "normal", quantity: 3, probabilityPercent: 0 },
      ],
      assignNow: true,
      requestId: nextId("probability-task"),
    });
    const assignmentId = submitTask(taskId);
    const result = reviewAssignment({
      assignmentId,
      decision: "approve",
      note: "概率结算",
      requestId: nextId("probability-review"),
    });
    expect(result).toMatchObject({ configuredRewardCount: 5, awardedRewardCount: 2 });
    const outcomes = getDb().prepare(`
      SELECT o.roll_percent, o.awarded
      FROM assignment_reward_outcomes o
      JOIN assignment_reward_items i ON i.id = o.assignment_reward_item_id
      WHERE i.assignment_id = ?
      ORDER BY i.sort_order, o.sequence_number
    `).all(assignmentId) as Array<{ roll_percent: number; awarded: number }>;
    expect(outcomes).toHaveLength(5);
    expect(outcomes.every((outcome) => outcome.roll_percent >= 1 && outcome.roll_percent <= 100)).toBe(true);
    expect(outcomes.map((outcome) => outcome.awarded)).toEqual([1, 1, 0, 0, 0]);
    const publicItems = assignmentFor(taskId).rewardItems;
    expect(publicItems.find((item) => item.definitionId === normalDefinitionId)?.awardedQuantity).toBe(2);
    expect(publicItems.find((item) => item.definitionId === neverDefinitionId)?.awardedQuantity).toBe(0);
  });

  it("uses the assignment snapshot after a template is changed", () => {
    const snapshotDefinitionId = createRewardDefinition({
      name: "领取时十五分钟券",
      description: "旧版本",
      icon: "clock",
      theme: "orange",
      kind: "fixed_time",
      fixedSeconds: 15 * MINUTE,
      requestId: nextId("snapshot-definition"),
    });
    const taskId = createTask({
      title: "快照测试",
      description: "领取后修改模板",
      rewardSeconds: MINUTE,
      targetWorkerId: workerId,
      timingMode: "none",
      bonusEnabled: false,
      rewardBindings: [
        { definitionId: snapshotDefinitionId, grantTier: "normal", quantity: 1, probabilityPercent: 100 },
      ],
      assignNow: true,
      requestId: nextId("snapshot-task"),
    });
    expect(assignmentFor(taskId).rewardItems[0]).toMatchObject({
      name: "领取时十五分钟券",
      fixedSeconds: 15 * MINUTE,
      definitionVersion: 1,
    });
    updateRewardDefinition({
      definitionId: snapshotDefinitionId,
      name: "修改后四十五分钟券",
      description: "新版本",
      icon: "clock",
      theme: "orange",
      kind: "fixed_time",
      fixedSeconds: 45 * MINUTE,
      requestId: nextId("snapshot-update"),
    });
    expect(assignmentFor(taskId).rewardItems[0]).toMatchObject({
      name: "领取时十五分钟券",
      fixedSeconds: 15 * MINUTE,
      definitionVersion: 1,
    });
    const assignmentId = submitTask(taskId);
    reviewAssignment({
      assignmentId,
      decision: "approve",
      note: "按快照发放",
      requestId: nextId("snapshot-review"),
    });
    const issued = getWorkerState(workerId).rewardItems.find((item) => item.sourceId === assignmentId)!;
    expect(issued).toMatchObject({
      name: "领取时十五分钟券",
      fixedSeconds: 15 * MINUTE,
      definitionVersion: 1,
    });
  });

  it("does not grant coupons for revision, rejection, or cancellation", () => {
    const taskId = createTask({
      title: "不发券流程测试",
      description: "先退回再拒绝",
      rewardSeconds: MINUTE,
      targetWorkerId: workerId,
      timingMode: "none",
      bonusEnabled: false,
      rewardBindings: [
        { definitionId: normalDefinitionId, grantTier: "normal", quantity: 1, probabilityPercent: 100 },
      ],
      assignNow: true,
      requestId: nextId("non-grant-task"),
    });
    const assignmentId = submitTask(taskId);
    const beforeItems = getWorkerState(workerId).rewardItems.length;
    reviewAssignment({
      assignmentId,
      decision: "revision",
      note: "请补充",
      requestId: nextId("revision-review"),
    });
    expect(getWorkerState(workerId).rewardItems).toHaveLength(beforeItems);
    submitAssignment({
      workerId,
      assignmentId,
      note: "已经补充",
      actor: `worker:${workerId}`,
      requestId: nextId("revision-resubmit"),
    });
    reviewAssignment({
      assignmentId,
      decision: "reject",
      note: "本次未通过",
      requestId: nextId("reject-review"),
    });
    expect(getWorkerState(workerId).rewardItems).toHaveLength(beforeItems);
    expect(getDb().prepare(`
      SELECT COUNT(*) AS count FROM assignment_reward_outcomes o
      JOIN assignment_reward_items i ON i.id = o.assignment_reward_item_id
      WHERE i.assignment_id = ?
    `).get(assignmentId)).toEqual({ count: 0 });

    const cancelTaskId = createTask({
      title: "取消不发券",
      description: "提交后撤销",
      rewardSeconds: MINUTE,
      targetWorkerId: workerId,
      timingMode: "none",
      bonusEnabled: false,
      rewardBindings: [
        { definitionId: normalDefinitionId, grantTier: "normal", quantity: 1, probabilityPercent: 100 },
      ],
      assignNow: true,
      requestId: nextId("cancel-task"),
    });
    const cancelAssignmentId = submitTask(cancelTaskId);
    cancelAssignment({
      assignmentId: cancelAssignmentId,
      actor: "admin",
      reason: "撤销测试",
      requestId: nextId("cancel-assignment"),
    });
    expect(getWorkerState(workerId).rewardItems).toHaveLength(beforeItems);
  });

  it("rolls back the whole review while rewards are paused and keeps retries idempotent", () => {
    const taskId = createTask({
      title: "暂停原子性测试",
      description: "不能只结算基础时数",
      rewardSeconds: 4 * MINUTE,
      targetWorkerId: workerId,
      timingMode: "none",
      bonusEnabled: false,
      rewardBindings: [
        { definitionId: normalDefinitionId, grantTier: "normal", quantity: 1, probabilityPercent: 100 },
      ],
      assignNow: true,
      requestId: nextId("paused-task"),
    });
    const assignmentId = submitTask(taskId);
    const before = getWorkerState(workerId);
    const beforeTaskTransactions = before.transactions.filter((item) => item.type === "task_reward").length;
    const beforeItems = before.rewardItems.length;
    setRewardSystemEnabled(false, nextId("system-off"));
    expect(() => reviewAssignment({
      assignmentId,
      decision: "approve",
      note: "暂停期间尝试",
      requestId: nextId("paused-review-failed"),
    })).toThrow(/暂停/);
    let state = getWorkerState(workerId);
    expect(state.worker.balanceSeconds).toBe(before.worker.balanceSeconds);
    expect(state.assignments.find((item) => item.id === assignmentId)?.status).toBe("submitted");
    expect(state.transactions.filter((item) => item.type === "task_reward")).toHaveLength(beforeTaskTransactions);
    expect(state.rewardItems).toHaveLength(beforeItems);

    setRewardSystemEnabled(true, nextId("system-on"));
    const requestId = nextId("paused-review-success");
    expect(reviewAssignment({ assignmentId, decision: "approve", note: "恢复后审核", requestId }))
      .toMatchObject({ duplicated: false, awardedRewardCount: 1 });
    expect(reviewAssignment({ assignmentId, decision: "approve", note: "网络重试", requestId }))
      .toMatchObject({ duplicated: true });
    state = getWorkerState(workerId);
    expect(state.worker.balanceSeconds - before.worker.balanceSeconds).toBe(4 * MINUTE);
    expect(state.transactions.filter((item) => item.type === "task_reward")).toHaveLength(beforeTaskTransactions + 1);
    expect(state.rewardItems).toHaveLength(beforeItems + 1);
    expect(getDb().prepare(`
      SELECT COUNT(*) AS count FROM assignment_reward_outcomes o
      JOIN assignment_reward_items i ON i.id = o.assignment_reward_item_id
      WHERE i.assignment_id = ?
    `).get(assignmentId)).toEqual({ count: 1 });
  });

  it("keeps legacy no-coupon tasks on the default x2 behavior even while coupon grants are paused", () => {
    setRewardSystemEnabled(false, nextId("legacy-system-off"));
    const taskId = createTask({
      title: "旧式无券任务",
      description: "没有奖励券绑定",
      rewardSeconds: 3 * MINUTE,
      targetWorkerId: workerId,
      timingMode: "none",
      bonusEnabled: true,
      bonusCriteria: "沿用原双倍规则",
      assignNow: true,
      requestId: nextId("legacy-task"),
    });
    const before = getWorkerState(workerId).worker.balanceSeconds;
    const assignmentId = submitTask(taskId);
    const result = reviewAssignment({
      assignmentId,
      decision: "double",
      note: "兼容旧客户端",
      requestId: nextId("legacy-review"),
    });
    expect(result).toMatchObject({ amountSeconds: 6 * MINUTE, configuredRewardCount: 0, awardedRewardCount: 0 });
    const state = getWorkerState(workerId);
    expect(state.worker.balanceSeconds - before).toBe(6 * MINUTE);
    expect(state.assignments.find((item) => item.id === assignmentId)).toMatchObject({
      excellentMultiplier: 2,
      reviewMultiplier: 2,
      reviewTier: "excellent",
      rewardItems: [],
    });
    setRewardSystemEnabled(true, nextId("legacy-system-on"));
  });
});
