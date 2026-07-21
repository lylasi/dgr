import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetConfigForTests } from "@/lib/config";
import { closeDbForTests, getDb } from "@/lib/db";
import {
  adjustBalance,
  cancelAssignment,
  cancelConsumptionTimer,
  claimTask,
  createTask,
  createWorker,
  getAdminState,
  getWorkerState,
  getWorkerAvatarImage,
  grantQuickReward,
  manualConsumption,
  removeWorkerAvatarImage,
  resubmitRewardRequest,
  reviewAssignment,
  reviewRewardRequest,
  reverseConsumptionTransaction,
  setAssignmentDuration,
  setWorkerAvatarImage,
  startTimer,
  stopTimer,
  submitAssignment,
  submitRewardRequest,
  syncWorker,
  updateWorker,
} from "@/lib/service";
import {
  cancelRewardItem,
  confirmPhysicalReward,
  copyRewardDefinition,
  createRewardDefinition,
  getAdminRewardState,
  getRewardDefinitionImage,
  grantRewardDefinition,
  redeemTimeReward,
  removeRewardDefinitionImage,
  setRewardDefinitionActive,
  setRewardDefinitionImage,
  setRewardSystemEnabled,
  updateDailyCouponSetting,
  updateRewardDefinition,
} from "@/lib/reward-service";
import { HOUR, MINUTE } from "@/lib/time";

const databasePath = path.join("/private/tmp", `pen-worker-test-${process.pid}.db`);

describe.sequential("SQLite business flow", () => {
  let workerId = "";
  let assignmentId = "";
  let featureWorkerId = "";
  let featureTaskId = "";
  let featureAssignmentId = "";

  beforeAll(() => {
    process.env.ADMIN_PASSWORD = "test-admin";
    process.env.SESSION_SECRET = "test-session-secret-with-at-least-thirty-two-characters";
    process.env.DATABASE_PATH = databasePath;
    process.env.APP_TIMEZONE = "Asia/Shanghai";
    resetConfigForTests();
    closeDbForTests();
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${databasePath}${suffix}`, { force: true });
  });

  afterAll(() => {
    closeDbForTests();
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${databasePath}${suffix}`, { force: true });
    resetConfigForTests();
  });

  it("creates a worker and grants the configured daily reward only once", async () => {
    workerId = await createWorker({
      name: "小测试员",
      password: "1234",
      avatar: "star",
      theme: "purple",
      dailyRewardSeconds: 2 * HOUR,
      requestId: "test-create-worker",
    });
    const first = getWorkerState(workerId);
    const second = getWorkerState(workerId);
    expect(first.worker.balanceSeconds).toBe(2 * HOUR);
    expect(second.worker.balanceSeconds).toBe(2 * HOUR);
    expect(second.transactions.filter((item) => item.type === "daily_reward")).toHaveLength(1);
  });

  it("stores and replaces a compressed custom avatar", () => {
    const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nO0AAAAASUVORK5CYII=";
    const avatarUrl = setWorkerAvatarImage({
      workerId,
      imageDataUrl: tinyPng,
      requestId: "test-avatar-upload",
    });
    expect(avatarUrl).toContain(`/api/avatar/${workerId}?v=`);
    expect(getWorkerAvatarImage(workerId)?.mime_type).toBe("image/png");
    expect(getWorkerState(workerId).worker.avatarUrl).toBe(avatarUrl);
    removeWorkerAvatarImage(workerId, "test-avatar-remove");
    expect(getWorkerAvatarImage(workerId)).toBeNull();
    expect(getWorkerState(workerId).worker.avatarUrl).toBeNull();
  });

  it("keeps rewards pending until an administrator approves them", () => {
    createTask({
      title: "读书",
      description: "认真读一章",
      rewardSeconds: 30 * 60,
      targetWorkerId: workerId,
      timingMode: "none",
      bonusEnabled: true,
      bonusCriteria: "说出三个收获",
      assignNow: true,
      requestId: "test-create-task",
    });
    const assigned = getWorkerState(workerId).assignments[0];
    assignmentId = assigned.id;
    submitAssignment({
      workerId,
      assignmentId,
      note: "已经读完并记录三个收获",
      actor: `worker:${workerId}`,
      requestId: "test-submit-task",
    });
    const pending = getWorkerState(workerId);
    expect(pending.worker.balanceSeconds).toBe(2 * HOUR);
    expect(pending.summary.pendingRewardSeconds).toBe(30 * 60);

    reviewAssignment({
      assignmentId,
      decision: "double",
      note: "完成得很好",
      requestId: "test-review-task",
    });
    const approved = getWorkerState(workerId);
    expect(approved.worker.balanceSeconds).toBe(3 * HOUR);
    expect(approved.assignments[0].reviewMultiplier).toBe(2);
  });

  it("does not reward an already reviewed assignment twice", () => {
    expect(() => reviewAssignment({
      assignmentId,
      decision: "double",
      note: "重复请求",
      requestId: "test-review-task-again",
    })).toThrow();
    expect(getWorkerState(workerId).worker.balanceSeconds).toBe(3 * HOUR);
  });

  it("lets a worker submit an ad-hoc reward for admin review", async () => {
    const requestWorkerId = await createWorker({
      name: "自主申报测试员",
      password: "2468",
      avatar: "book",
      theme: "green",
      dailyRewardSeconds: 0,
      requestId: "test-request-worker",
    });
    const rewardRequestId = submitRewardRequest({
      workerId: requestWorkerId,
      title: "整理书架",
      description: "把所有书按类别摆整齐",
      rewardSeconds: 25 * 60,
      requestId: "test-reward-request",
    });
    let workerState = getWorkerState(requestWorkerId);
    expect(workerState.worker.balanceSeconds).toBe(0);
    expect(workerState.rewardRequests[0]).toMatchObject({
      id: rewardRequestId,
      status: "pending",
      rewardSeconds: 25 * 60,
    });
    expect(workerState.summary.pendingRewardSeconds).toBe(25 * 60);
    expect(getAdminState().rewardRequests[0].id).toBe(rewardRequestId);

    reviewRewardRequest({
      rewardRequestId,
      decision: "revision",
      note: "请补充整理前后的情况",
      requestId: "test-request-revision",
    });
    workerState = getWorkerState(requestWorkerId);
    expect(workerState.rewardRequests[0].status).toBe("revision_requested");
    expect(workerState.worker.balanceSeconds).toBe(0);

    resubmitRewardRequest({
      workerId: requestWorkerId,
      rewardRequestId,
      title: "整理书架和学习桌",
      description: "书架分类完成，学习桌也擦干净了",
      rewardSeconds: 35 * 60,
      requestId: "test-request-resubmit",
    });
    reviewRewardRequest({
      rewardRequestId,
      decision: "approve",
      note: "整理得很好",
      requestId: "test-request-approve",
    });
    workerState = getWorkerState(requestWorkerId);
    expect(workerState.worker.balanceSeconds).toBe(35 * 60);
    expect(workerState.rewardRequests[0].status).toBe("approved");
    expect(workerState.transactions[0]).toMatchObject({
      type: "task_reward",
      title: "整理书架和学习桌",
      amountSeconds: 35 * 60,
    });

    expect(reviewRewardRequest({
      rewardRequestId,
      decision: "approve",
      note: "重复请求",
      requestId: "test-request-approve",
    })).toMatchObject({ duplicated: true });
    expect(getWorkerState(requestWorkerId).worker.balanceSeconds).toBe(35 * 60);
  });

  it("deducts exact consumption seconds and records the result", () => {
    startTimer({
      workerId,
      timerType: "consumption",
      targetId: "consume-game",
      actor: `worker:${workerId}`,
      requestId: "test-consumption-start",
    });
    getDb().prepare("UPDATE active_timers SET started_at = ? WHERE worker_id = ?")
      .run(Date.now() - 5_500, workerId);
    stopTimer(workerId, `worker:${workerId}`, "test-consumption-stop");
    const state = getWorkerState(workerId);
    expect(state.worker.balanceSeconds).toBe(3 * HOUR - 5);
    expect(state.transactions[0].type).toBe("consumption");
    expect(state.transactions[0].amountSeconds).toBe(-5);
  });

  it("uses the administrator's new daily reward on the next day", async () => {
    await updateWorker({
      workerId,
      dailyRewardSeconds: HOUR,
      requestId: "test-update-daily",
    });
    const before = getWorkerState(workerId).worker.balanceSeconds;
    syncWorker(workerId, Date.now() + 26 * HOUR * 1000);
    const after = getWorkerState(workerId).worker.balanceSeconds;
    expect(after - before).toBe(HOUR);
  });

  it("automatically ends consumption when the balance is exhausted", () => {
    const current = getWorkerState(workerId).worker.balanceSeconds;
    adjustBalance({
      workerId,
      amountSeconds: 2 - current,
      reason: "准备余额耗尽测试",
      requestId: "test-prepare-auto-stop",
    });
    startTimer({
      workerId,
      timerType: "consumption",
      targetId: "consume-video",
      actor: `worker:${workerId}`,
      requestId: "test-auto-stop-start",
    });
    getDb().prepare("UPDATE active_timers SET started_at = ? WHERE worker_id = ?")
      .run(Date.now() - 3_500, workerId);
    const state = getWorkerState(workerId);
    expect(state.worker.balanceSeconds).toBe(0);
    expect(state.activeTimer).toBeNull();
    expect(state.transactions.find((item) => item.type === "consumption" && item.amountSeconds === -2)).toBeTruthy();
  });

  it("keeps approved tasks immutable", () => {
    expect(() => cancelAssignment({
      assignmentId,
      actor: "admin",
      requestId: "test-cancel-approved",
    })).toThrow(/已经入账/);
  });

  it("lets workers and administrators correct cumulative task time", async () => {
    featureWorkerId = await createWorker({
      name: "功能测试员",
      password: "5678",
      avatar: "rocket",
      theme: "blue",
      dailyRewardSeconds: 0,
      requestId: "test-feature-worker",
    });
    adjustBalance({
      workerId: featureWorkerId,
      amountSeconds: 2 * HOUR,
      reason: "准备功能测试余额",
      requestId: "test-feature-balance",
    });
    featureTaskId = createTask({
      title: "运动计时",
      description: "测试手动修正时长",
      rewardSeconds: 20 * 60,
      targetWorkerId: featureWorkerId,
      timingMode: "optional",
      bonusEnabled: false,
      assignNow: true,
      requestId: "test-feature-task",
    });
    featureAssignmentId = getWorkerState(featureWorkerId).assignments[0].id;

    setAssignmentDuration({
      assignmentId: featureAssignmentId,
      durationSeconds: 10 * 60,
      actor: `worker:${featureWorkerId}`,
      requestId: "test-duration-worker",
    });
    expect(getWorkerState(featureWorkerId).assignments[0].durationSeconds).toBe(10 * 60);

    setAssignmentDuration({
      assignmentId: featureAssignmentId,
      durationSeconds: 2 * 60,
      actor: "admin",
      reason: "修正误填时长",
      requestId: "test-duration-admin",
    });
    expect(getWorkerState(featureWorkerId).assignments[0].durationSeconds).toBe(2 * 60);
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM timer_adjustments WHERE assignment_id = ?")
      .get(featureAssignmentId)).toEqual({ count: 2 });

    startTimer({
      workerId: featureWorkerId,
      timerType: "reward_task",
      targetId: featureAssignmentId,
      actor: `worker:${featureWorkerId}`,
      requestId: "test-duration-active-start",
    });
    expect(() => setAssignmentDuration({
      assignmentId: featureAssignmentId,
      durationSeconds: 3 * 60,
      actor: "admin",
      requestId: "test-duration-while-active",
    })).toThrow(/先暂停/);
  });

  it("cancels unposted tasks safely and allows a clean re-claim", () => {
    getDb().prepare("UPDATE active_timers SET started_at = ? WHERE worker_id = ?")
      .run(Date.now() - 5_500, featureWorkerId);
    cancelAssignment({
      assignmentId: featureAssignmentId,
      actor: "admin",
      reason: "测试撤销误操作",
      requestId: "test-cancel-running",
    });
    let state = getWorkerState(featureWorkerId);
    expect(state.activeTimer).toBeNull();
    expect(state.assignments[0].status).toBe("cancelled");
    expect(state.availableTasks.some((task) => task.id === featureTaskId)).toBe(true);

    expect(claimTask(featureWorkerId, featureTaskId, "test-reclaim-task")).toBe(featureAssignmentId);
    state = getWorkerState(featureWorkerId);
    expect(state.assignments[0].status).toBe("claimed");
    expect(state.assignments[0].durationSeconds).toBe(0);

    submitAssignment({
      workerId: featureWorkerId,
      assignmentId: featureAssignmentId,
      note: "误提交测试",
      actor: `worker:${featureWorkerId}`,
      requestId: "test-submit-before-admin-cancel",
    });
    cancelAssignment({
      assignmentId: featureAssignmentId,
      actor: "admin",
      requestId: "test-cancel-submitted",
    });
    expect(getWorkerState(featureWorkerId).assignments[0].status).toBe("cancelled");

    claimTask(featureWorkerId, featureTaskId, "test-reclaim-for-worker-cancel");
    cancelAssignment({
      assignmentId: featureAssignmentId,
      actor: `worker:${featureWorkerId}`,
      requestId: "test-worker-cancel",
    });
    expect(getWorkerState(featureWorkerId).assignments[0].status).toBe("cancelled");
  });

  it("records manual consumption exactly and rejects overspending", () => {
    const firstRequest = {
      workerId: featureWorkerId,
      activityId: "consume-game",
      durationSeconds: 20 * 60,
      actor: `worker:${featureWorkerId}` as const,
      requestId: "test-manual-consumption-worker",
    };
    manualConsumption(firstRequest);
    expect(getWorkerState(featureWorkerId).worker.balanceSeconds).toBe(100 * 60);
    manualConsumption(firstRequest);
    expect(getWorkerState(featureWorkerId).worker.balanceSeconds).toBe(100 * 60);

    manualConsumption({
      workerId: featureWorkerId,
      activityId: "consume-video",
      durationSeconds: 10 * 60,
      actor: "admin",
      requestId: "test-manual-consumption-admin",
    });
    const state = getWorkerState(featureWorkerId);
    expect(state.worker.balanceSeconds).toBe(90 * 60);
    expect(state.transactions[0].title).toBe("看视频（手动填写）");
    expect(state.transactions[0].amountSeconds).toBe(-10 * 60);
    expect(() => manualConsumption({
      workerId: featureWorkerId,
      activityId: "consume-video",
      durationSeconds: 91 * 60,
      actor: "admin",
      requestId: "test-manual-consumption-too-large",
    })).toThrow(/超过当前余额/);
    expect(getWorkerState(featureWorkerId).worker.balanceSeconds).toBe(90 * 60);
  });

  it("cancels an accidentally started consumption timer without charging", () => {
    const before = getWorkerState(featureWorkerId);
    const consumptionCount = before.transactions.filter((item) => item.type === "consumption").length;
    startTimer({
      workerId: featureWorkerId,
      timerType: "consumption",
      targetId: "consume-game",
      actor: `worker:${featureWorkerId}`,
      requestId: "test-accidental-consumption-start",
    });
    cancelConsumptionTimer({
      workerId: featureWorkerId,
      actor: `worker:${featureWorkerId}`,
      requestId: "test-accidental-consumption-cancel",
    });
    let state = getWorkerState(featureWorkerId);
    expect(state.activeTimer).toBeNull();
    expect(state.worker.balanceSeconds).toBe(90 * 60);
    expect(state.transactions.filter((item) => item.type === "consumption")).toHaveLength(consumptionCount);

    startTimer({
      workerId: featureWorkerId,
      timerType: "consumption",
      targetId: "consume-video",
      actor: `worker:${featureWorkerId}`,
      requestId: "test-expired-undo-start",
    });
    getDb().prepare("UPDATE active_timers SET started_at = ? WHERE worker_id = ?")
      .run(Date.now() - 31_500, featureWorkerId);
    expect(() => cancelConsumptionTimer({
      workerId: featureWorkerId,
      actor: `worker:${featureWorkerId}`,
      requestId: "test-expired-worker-undo",
    })).toThrow(/30 秒/);
    cancelConsumptionTimer({
      workerId: featureWorkerId,
      actor: "admin",
      requestId: "test-admin-cancel-active-consumption",
    });
    state = getWorkerState(featureWorkerId);
    expect(state.activeTimer).toBeNull();
    expect(state.worker.balanceSeconds).toBe(90 * 60);
  });

  it("reverses a posted consumption exactly once with an audit trail", () => {
    const before = getWorkerState(featureWorkerId);
    const original = before.transactions.find((item) => item.title === "看视频（手动填写）");
    expect(original).toBeTruthy();
    reverseConsumptionTransaction({
      transactionId: original!.id,
      reason: "确认是误触",
      requestId: "test-reverse-consumption",
    });
    const state = getWorkerState(featureWorkerId);
    expect(state.worker.balanceSeconds).toBe(100 * 60);
    expect(state.transactions.find((item) => item.id === original!.id)?.isReversed).toBe(true);
    const refund = state.transactions.find((item) => item.reversalOfTransactionId === original!.id);
    expect(refund?.amountSeconds).toBe(10 * 60);
    expect(refund?.title).toContain("撤销消耗");
    expect(() => reverseConsumptionTransaction({
      transactionId: original!.id,
      requestId: "test-reverse-consumption-again",
    })).toThrow(/已经撤销过/);
    expect(getWorkerState(featureWorkerId).worker.balanceSeconds).toBe(100 * 60);
  });

  it("lets an administrator quickly backfill a missed task reward exactly once", () => {
    const result = grantQuickReward({
      workerId: featureWorkerId,
      title: "主动整理客厅",
      rewardSeconds: 15 * 60,
      note: "昨天完成，管理员补录",
      requestId: "test-quick-reward",
    });
    expect(result).toMatchObject({ duplicated: false, amountSeconds: 15 * 60 });

    let state = getWorkerState(featureWorkerId);
    expect(state.worker.balanceSeconds).toBe(115 * 60);
    expect(state.transactions[0]).toMatchObject({
      type: "task_reward",
      title: "主动整理客厅",
      amountSeconds: 15 * 60,
      reason: "昨天完成，管理员补录",
    });

    expect(grantQuickReward({
      workerId: featureWorkerId,
      title: "主动整理客厅",
      rewardSeconds: 15 * 60,
      note: "昨天完成，管理员补录",
      requestId: "test-quick-reward",
    })).toMatchObject({ duplicated: true });
    state = getWorkerState(featureWorkerId);
    expect(state.worker.balanceSeconds).toBe(115 * 60);
  });

  it("supports the complete first-stage reward coupon lifecycle", async () => {
    const randomDefinitionId = createRewardDefinition({
      name: "周末惊喜券",
      description: "使用时随机获得时间币",
      icon: "sparkles",
      theme: "purple",
      kind: "random_time",
      randomMinSeconds: 5 * MINUTE,
      randomMaxSeconds: 7 * MINUTE,
      requestId: "reward-create-random",
    });
    expect(createRewardDefinition({
      name: "不会重复创建",
      icon: "sparkles",
      theme: "purple",
      kind: "random_time",
      randomMinSeconds: MINUTE,
      randomMaxSeconds: MINUTE,
      requestId: "reward-create-random",
    })).toBe(randomDefinitionId);

    const fixedDefinitionId = createRewardDefinition({
      name: "30 分钟时间券",
      description: "想用的时候再用",
      icon: "clock",
      theme: "blue",
      kind: "fixed_time",
      fixedSeconds: 30 * MINUTE,
      requestId: "reward-create-fixed",
    });
    const physicalDefinitionId = createRewardDefinition({
      name: "新图书券",
      description: "一起挑一本喜欢的书",
      icon: "book",
      theme: "green",
      kind: "physical",
      physicalDescription: "一本 30 元以内的新图书",
      fulfillmentInstructions: "周末一起去书店购买",
      requestId: "reward-create-physical",
    });
    const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nO0AAAAASUVORK5CYII=";
    const physicalImageUrl = setRewardDefinitionImage({
      definitionId: physicalDefinitionId,
      imageDataUrl: tinyPng,
      requestId: "reward-physical-image",
    });
    const physicalImageId = physicalImageUrl!.split("/").at(-1)!;
    expect(getRewardDefinitionImage(physicalImageId)?.mime_type).toBe("image/png");

    const fixedGrant = grantRewardDefinition({
      workerId: featureWorkerId,
      definitionId: fixedDefinitionId,
      quantity: 2,
      reason: "认真完成整理",
      requestId: "reward-grant-fixed",
    });
    expect(fixedGrant.rewardItemIds).toHaveLength(2);
    expect(grantRewardDefinition({
      workerId: featureWorkerId,
      definitionId: fixedDefinitionId,
      quantity: 2,
      reason: "网络重试",
      requestId: "reward-grant-fixed",
    })).toMatchObject({ duplicated: true, batchId: fixedGrant.batchId });

    updateRewardDefinition({
      definitionId: fixedDefinitionId,
      name: "45 分钟时间券",
      description: "模板已经修改",
      icon: "clock",
      theme: "blue",
      kind: "fixed_time",
      fixedSeconds: 45 * MINUTE,
      requestId: "reward-update-fixed",
    });
    let state = getWorkerState(featureWorkerId);
    const issuedFixed = state.rewardItems.filter((item) => fixedGrant.rewardItemIds.includes(item.id));
    expect(issuedFixed).toHaveLength(2);
    expect(issuedFixed.every((item) => item.fixedSeconds === 30 * MINUTE && item.name === "30 分钟时间券")).toBe(true);

    const balanceBeforeFixed = state.worker.balanceSeconds;
    const fixedUse = redeemTimeReward({
      workerId: featureWorkerId,
      rewardItemId: fixedGrant.rewardItemIds[0],
      requestId: "reward-use-fixed",
    });
    expect(fixedUse.resultSeconds).toBe(30 * MINUTE);
    expect(redeemTimeReward({
      workerId: featureWorkerId,
      rewardItemId: fixedGrant.rewardItemIds[0],
      requestId: "reward-use-fixed",
    })).toMatchObject({ duplicated: true, resultSeconds: 30 * MINUTE });
    expect(() => redeemTimeReward({
      workerId: featureWorkerId,
      rewardItemId: fixedGrant.rewardItemIds[0],
      requestId: "reward-use-fixed-again",
    })).toThrow(/已经处理过/);
    state = getWorkerState(featureWorkerId);
    expect(state.worker.balanceSeconds).toBe(balanceBeforeFixed + 30 * MINUTE);
    expect(state.transactions.find((transaction) => transaction.id === fixedUse.transactionId)?.type).toBe("coupon_reward");

    const randomGrant = grantRewardDefinition({
      workerId: featureWorkerId,
      definitionId: randomDefinitionId,
      quantity: 1,
      reason: "周末惊喜",
      requestId: "reward-grant-random",
    });
    const randomUse = redeemTimeReward({
      workerId: featureWorkerId,
      rewardItemId: randomGrant.rewardItemIds[0],
      requestId: "reward-use-random",
    });
    expect(randomUse.resultSeconds).toBeGreaterThanOrEqual(5 * MINUTE);
    expect(randomUse.resultSeconds).toBeLessThanOrEqual(7 * MINUTE);
    expect(randomUse.resultSeconds % MINUTE).toBe(0);

    const physicalGrant = grantRewardDefinition({
      workerId: featureWorkerId,
      definitionId: physicalDefinitionId,
      quantity: 1,
      reason: "读书表现优秀",
      requestId: "reward-grant-physical",
    });
    removeRewardDefinitionImage(physicalDefinitionId, "reward-remove-physical-image");
    state = getWorkerState(featureWorkerId);
    expect(state.rewardItems.find((item) => item.id === physicalGrant.rewardItemIds[0])?.imageUrl).toBe(physicalImageUrl);
    await expect(confirmPhysicalReward({
      workerId: featureWorkerId,
      rewardItemId: physicalGrant.rewardItemIds[0],
      password: "错误密码",
      requestId: "reward-confirm-physical-wrong",
    })).rejects.toThrow(/密码不正确/);
    expect(getWorkerState(featureWorkerId).rewardItems.find((item) => item.id === physicalGrant.rewardItemIds[0])?.status).toBe("available");
    const physicalUse = await confirmPhysicalReward({
      workerId: featureWorkerId,
      rewardItemId: physicalGrant.rewardItemIds[0],
      password: "5678",
      requestId: "reward-confirm-physical",
    });
    expect(physicalUse.duplicated).toBe(false);
    expect(await confirmPhysicalReward({
      workerId: featureWorkerId,
      rewardItemId: physicalGrant.rewardItemIds[0],
      password: "5678",
      requestId: "reward-confirm-physical",
    })).toMatchObject({ duplicated: true });
    expect(getWorkerState(featureWorkerId).rewardItems.find((item) => item.id === physicalGrant.rewardItemIds[0])?.status).toBe("fulfilled");

    updateDailyCouponSetting({
      workerId: featureWorkerId,
      isEnabled: true,
      dailyQuantity: 2,
      randomMinSeconds: 2 * MINUTE,
      randomMaxSeconds: 4 * MINUTE,
      requestId: "reward-enable-daily",
    });
    const dailyBefore = getWorkerState(featureWorkerId).rewardItems.filter((item) => item.sourceType === "daily").length;
    const tomorrow = Date.now() + 26 * HOUR * 1000;
    syncWorker(featureWorkerId, tomorrow);
    syncWorker(featureWorkerId, tomorrow);
    const dailyItems = getWorkerState(featureWorkerId).rewardItems.filter((item) => item.sourceType === "daily");
    expect(dailyItems).toHaveLength(dailyBefore + 2);
    expect(dailyItems.slice(0, 2).every((item) => item.randomMinSeconds === 2 * MINUTE && item.randomMaxSeconds === 4 * MINUTE)).toBe(true);

    setRewardSystemEnabled(false, "reward-system-off");
    expect(() => grantRewardDefinition({
      workerId: featureWorkerId,
      definitionId: fixedDefinitionId,
      quantity: 1,
      reason: "系统暂停测试",
      requestId: "reward-grant-while-off",
    })).toThrow(/暂停/);
    expect(() => redeemTimeReward({
      workerId: featureWorkerId,
      rewardItemId: fixedGrant.rewardItemIds[1],
      requestId: "reward-use-while-off",
    })).toThrow(/暂停/);
    expect(getWorkerState(featureWorkerId).rewardItems.find((item) => item.id === fixedGrant.rewardItemIds[1])?.status).toBe("available");
    setRewardSystemEnabled(true, "reward-system-on");

    cancelRewardItem({
      rewardItemId: fixedGrant.rewardItemIds[1],
      reason: "管理员确认误发",
      requestId: "reward-cancel-fixed",
    });
    expect(cancelRewardItem({
      rewardItemId: fixedGrant.rewardItemIds[1],
      reason: "网络重试",
      requestId: "reward-cancel-fixed",
    })).toMatchObject({ duplicated: true });
    expect(() => cancelRewardItem({
      rewardItemId: fixedGrant.rewardItemIds[0],
      reason: "不能撤销已使用券",
      requestId: "reward-cancel-used-fixed",
    })).toThrow(/尚未使用/);

    const copiedDefinitionId = copyRewardDefinition(physicalDefinitionId, "reward-copy-physical");
    expect(getAdminRewardState().rewardDefinitions.find((item) => item.id === copiedDefinitionId)).toMatchObject({
      kind: "physical",
      isActive: true,
      imageUrl: null,
    });
    setRewardDefinitionActive(randomDefinitionId, false, "reward-disable-random");
    expect(() => grantRewardDefinition({
      workerId: featureWorkerId,
      definitionId: randomDefinitionId,
      quantity: 1,
      reason: "停用模板测试",
      requestId: "reward-grant-disabled",
    })).toThrow(/已经停用/);

    const rewardAdminState = getAdminRewardState();
    expect(rewardAdminState.rewardItems.some((item) => item.workerName === "功能测试员")).toBe(true);
    expect(rewardAdminState.rewardDefinitions).toHaveLength(4);
  });

  it("returns a complete administrator dashboard", () => {
    const dashboard = getAdminState();
    expect(dashboard.workers).toHaveLength(3);
    expect(dashboard.tasks).toHaveLength(2);
    expect(dashboard.reviews).toHaveLength(0);
  });
});
