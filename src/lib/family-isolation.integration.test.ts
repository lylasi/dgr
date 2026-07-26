import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as avatarGet } from "@/app/api/avatar/[workerId]/route";
import { GET as bossGet, POST as bossPost } from "@/app/api/boss/route";
import { GET as bootstrapGet } from "@/app/api/bootstrap/route";
import { GET as rewardImageGet } from "@/app/api/reward-image/[imageId]/route";
import { POST as workerPost } from "@/app/api/worker/route";
import {
  authenticateBoss,
  createBossAccount,
  createFamily,
  setBossFamilyMembership,
} from "@/lib/account-service";
import type { FamilyBusinessContext } from "@/lib/business-context";
import { resetConfigForTests } from "@/lib/config";
import { closeDbForTests, getDb } from "@/lib/db";
import {
  cancelRewardItem,
  confirmPhysicalReward,
  createRewardDefinition,
  getRewardDefinitionImage,
  grantRewardDefinition,
  isRewardSystemEnabled,
  redeemTimeReward,
  setRewardDefinitionActive,
  setRewardDefinitionImage,
  setRewardSystemEnabled,
  updateDailyCouponSetting,
} from "@/lib/reward-service";
import {
  adjustBalance,
  claimTask,
  createTask,
  createWorker,
  getAdminState,
  getWorkerAuth,
  getWorkerAvatarImage,
  getWorkerState,
  manualConsumption,
  reviewAssignment,
  reverseConsumptionTransaction,
  setWorkerAvatarImage,
  startTimer,
  updateWorker,
} from "@/lib/service";
import {
  createEmptySession,
  encodeSession,
  SESSION_COOKIE,
} from "@/lib/session";

const databasePath = path.join("/private/tmp", `pen-worker-family-isolation-${process.pid}.db`);
const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nO0AAAAASUVORK5CYII=";

type Envelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

function cookie(value: string) {
  return `${SESSION_COOKIE}=${value}`;
}

function apiRequest(
  pathname: string,
  sessionCookie: string | null,
  body?: Record<string, unknown>,
) {
  return new NextRequest(`http://localhost${pathname}`, {
    method: body ? "POST" : "GET",
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(sessionCookie ? { cookie: sessionCookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function bodyOf<T>(response: Response) {
  return await response.json() as Envelope<T>;
}

function expectErrorCode(operation: () => unknown, code: string) {
  let caught: unknown;
  try {
    operation();
  } catch (error) {
    caught = error;
  }
  expect(caught).toMatchObject({ code });
}

describe.sequential("explicit family business isolation", () => {
  let familyA = "";
  let familyB = "";
  let bossA = "";
  let bossB = "";
  let workerA = "";
  let workerB = "";
  let activityA = "";
  let activityB = "";
  let taskA = "";
  let taskB = "";
  let assignmentB = "";
  let transactionB = "";
  let definitionB = "";
  let rewardItemB = "";
  let physicalRewardItemA = "";
  let rewardImageB = "";
  let managerA: FamilyBusinessContext;
  let managerB: FamilyBusinessContext;
  let workerContextA: FamilyBusinessContext;
  let workerContextB: FamilyBusinessContext;
  let bossAsWorkerA: FamilyBusinessContext;
  let bossCookieA = "";
  let bossCookieB = "";
  let bossAsWorkerCookieA = "";
  let workerCookieA = "";

  beforeAll(async () => {
    process.env.SYSTEM_ADMIN_PASSWORD = "family-isolation-system-admin";
    process.env.SESSION_SECRET = "family-isolation-session-secret-with-more-than-thirty-two-characters";
    process.env.DATABASE_PATH = databasePath;
    process.env.APP_TIMEZONE = "Asia/Shanghai";
    resetConfigForTests();
    closeDbForTests();
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${databasePath}${suffix}`, { force: true });

    familyA = createFamily({
      name: "隔离家庭 A",
      requestId: "isolation-create-family-a",
    });
    familyB = createFamily({
      name: "隔离家庭 B",
      requestId: "isolation-create-family-b",
    });
    bossA = await createBossAccount({
      username: "isolation.boss.a",
      displayName: "A 家爸爸",
      password: "isolation-boss-a-password",
      requestId: "isolation-create-boss-a",
    });
    bossB = await createBossAccount({
      username: "isolation.boss.b",
      displayName: "B 家妈妈",
      password: "isolation-boss-b-password",
      requestId: "isolation-create-boss-b",
    });
    setBossFamilyMembership({
      bossId: bossA,
      familyId: familyA,
      attached: true,
      requestId: "isolation-bind-boss-a",
    });
    setBossFamilyMembership({
      bossId: bossB,
      familyId: familyB,
      attached: true,
      requestId: "isolation-bind-boss-b",
    });

    managerA = {
      familyId: familyA,
      actor: { type: "boss", bossId: bossA, displayName: "A 家爸爸" },
    };
    managerB = {
      familyId: familyB,
      actor: { type: "boss", bossId: bossB, displayName: "B 家妈妈" },
    };
    workerA = await createWorker(managerA, {
      name: "A 家小朋友",
      password: "1357",
      avatar: "star",
      theme: "purple",
      dailyRewardSeconds: 0,
      requestId: "isolation-create-worker-a",
    });
    workerB = await createWorker(managerB, {
      name: "B 家小朋友",
      password: "2468",
      avatar: "rocket",
      theme: "blue",
      dailyRewardSeconds: 0,
      requestId: "isolation-create-worker-b",
    });
    workerContextA = {
      familyId: familyA,
      actor: { type: "worker", workerId: workerA, displayName: "A 家小朋友" },
    };
    workerContextB = {
      familyId: familyB,
      actor: { type: "worker", workerId: workerB, displayName: "B 家小朋友" },
    };
    bossAsWorkerA = {
      familyId: familyA,
      actor: {
        type: "boss_as_worker",
        bossId: bossA,
        displayName: "A 家爸爸",
        workerId: workerA,
      },
    };

    activityA = getAdminState(managerA).activities[0].id;
    activityB = getAdminState(managerB).activities[0].id;
    taskA = createTask(managerA, {
      title: "A 家可代领任务",
      description: "验证老板代操作",
      rewardSeconds: 300,
      targetWorkerId: workerA,
      timingMode: "none",
      bonusEnabled: false,
      assignNow: false,
      requestId: "isolation-create-task-a",
    });
    taskB = createTask(managerB, {
      title: "B 家私有任务",
      description: "不能被 A 家操作",
      rewardSeconds: 600,
      targetWorkerId: workerB,
      timingMode: "optional",
      bonusEnabled: false,
      assignNow: true,
      requestId: "isolation-create-task-b",
    });
    assignmentB = getWorkerState(workerContextB, workerB).assignments
      .find((assignment) => assignment.taskId === taskB)!.id;

    adjustBalance(managerB, {
      workerId: workerB,
      amountSeconds: 1_800,
      reason: "准备 B 家隔离测试",
      requestId: "isolation-balance-worker-b",
    });
    manualConsumption(workerContextB, {
      workerId: workerB,
      activityId: activityB,
      durationSeconds: 60,
      requestId: "isolation-consume-worker-b",
    });
    transactionB = (getDb().prepare(
      "SELECT id FROM transactions WHERE family_id = ? AND request_id = ?",
    ).get(familyB, "isolation-consume-worker-b") as { id: string }).id;

    definitionB = createRewardDefinition(managerB, {
      name: "B 家固定券",
      description: "B 家私有奖励",
      icon: "clock",
      theme: "blue",
      kind: "fixed_time",
      fixedSeconds: 600,
      requestId: "isolation-definition-b",
    });
    const grantedB = grantRewardDefinition(managerB, {
      workerId: workerB,
      definitionId: definitionB,
      quantity: 1,
      reason: "B 家测试发券",
      requestId: "isolation-grant-b",
    });
    rewardItemB = grantedB.rewardItemIds[0];

    const physicalDefinitionA = createRewardDefinition(managerA, {
      name: "A 家实物券",
      description: "只能由小朋友本人确认",
      icon: "gift",
      theme: "orange",
      kind: "physical",
      physicalDescription: "一份小礼物",
      fulfillmentInstructions: "收到后本人确认",
      requestId: "isolation-physical-definition-a",
    });
    physicalRewardItemA = grantRewardDefinition(managerA, {
      workerId: workerA,
      definitionId: physicalDefinitionA,
      quantity: 1,
      reason: "验证本人确认边界",
      requestId: "isolation-physical-grant-a",
    }).rewardItemIds[0];

    const physicalDefinitionB = createRewardDefinition(managerB, {
      name: "B 家图片券",
      description: "验证图片隔离",
      icon: "gift",
      theme: "green",
      kind: "physical",
      physicalDescription: "B 家私有图片",
      fulfillmentInstructions: "仅 B 家可见",
      requestId: "isolation-image-definition-b",
    });
    const rewardImageUrlB = setRewardDefinitionImage(managerB, {
      definitionId: physicalDefinitionB,
      imageDataUrl: tinyPng,
      requestId: "isolation-image-upload-b",
    });
    if (!rewardImageUrlB) throw new Error("failed to create the family B reward image");
    rewardImageB = rewardImageUrlB.split("/").at(-1)!;
    setWorkerAvatarImage(managerB, {
      workerId: workerB,
      imageDataUrl: tinyPng,
      requestId: "isolation-avatar-upload-b",
    });

    const authA = await authenticateBoss("isolation.boss.a", "isolation-boss-a-password");
    const authB = await authenticateBoss("isolation.boss.b", "isolation-boss-b-password");
    const bossSessionA = createEmptySession();
    bossSessionA.bosses[bossA] = authA.authVersion;
    bossSessionA.active = { type: "boss", bossId: bossA, familyId: familyA };
    bossCookieA = cookie(encodeSession(bossSessionA));
    const bossAsWorkerSessionA = createEmptySession();
    bossAsWorkerSessionA.bosses[bossA] = authA.authVersion;
    bossAsWorkerSessionA.active = {
      type: "boss_as_worker",
      bossId: bossA,
      workerId: workerA,
      familyId: familyA,
    };
    bossAsWorkerCookieA = cookie(encodeSession(bossAsWorkerSessionA));
    const bossSessionB = createEmptySession();
    bossSessionB.bosses[bossB] = authB.authVersion;
    bossSessionB.active = { type: "boss", bossId: bossB, familyId: familyB };
    bossCookieB = cookie(encodeSession(bossSessionB));
    const workerAuthA = getWorkerAuth(workerA);
    const workerSessionA = createEmptySession();
    workerSessionA.workers[workerA] = workerAuthA.authVersion;
    workerSessionA.active = { type: "worker", workerId: workerA, familyId: familyA };
    workerCookieA = cookie(encodeSession(workerSessionA));
  });

  afterAll(() => {
    closeDbForTests();
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${databasePath}${suffix}`, { force: true });
    resetConfigForTests();
    delete process.env.SYSTEM_ADMIN_PASSWORD;
    delete process.env.SESSION_SECRET;
    delete process.env.DATABASE_PATH;
    delete process.env.APP_TIMEZONE;
  });

  it("returns only the current family's workers, tasks, ledger, and settings", () => {
    const stateA = getAdminState(managerA);
    const stateB = getAdminState(managerB);
    expect(stateA.workers.map((worker) => worker.id)).toEqual([workerA]);
    expect(stateB.workers.map((worker) => worker.id)).toEqual([workerB]);
    expect(stateA.tasks.some((task) => task.id === taskB)).toBe(false);
    expect(stateB.tasks.some((task) => task.id === taskA)).toBe(false);
    expect(stateA.transactions.some((transaction) => transaction.id === transactionB)).toBe(false);

    setRewardSystemEnabled(managerA, false, "isolation-disable-rewards-a");
    expect(isRewardSystemEnabled(managerA)).toBe(false);
    expect(isRewardSystemEnabled(managerB)).toBe(true);
    setRewardSystemEnabled(managerA, true, "isolation-enable-rewards-a");
  });

  it("treats known IDs from another family as unavailable across all business areas", async () => {
    await expect(updateWorker(managerA, {
      workerId: workerB,
      name: "不应被修改",
      requestId: "isolation-cross-update-worker",
    })).rejects.toMatchObject({ code: "WORKER_NOT_FOUND" });
    expectErrorCode(() => createTask(managerA, {
      title: "错误跨家庭任务",
      description: "",
      rewardSeconds: 60,
      targetWorkerId: workerB,
      timingMode: "none",
      bonusEnabled: false,
      requestId: "isolation-cross-create-task",
    }), "WORKER_NOT_FOUND");
    expectErrorCode(
      () => claimTask(workerContextA, workerA, taskB, "isolation-cross-claim-task"),
      "TASK_NOT_FOUND",
    );
    expectErrorCode(() => reviewAssignment(managerA, {
      assignmentId: assignmentB,
      decision: "approve",
      note: "不应成功",
      requestId: "isolation-cross-review-assignment",
    }), "ASSIGNMENT_NOT_FOUND");
    expectErrorCode(() => startTimer(workerContextA, {
      workerId: workerA,
      timerType: "consumption",
      targetId: activityB,
      requestId: "isolation-cross-start-activity",
    }), "ACTIVITY_NOT_FOUND");
    expectErrorCode(() => reverseConsumptionTransaction(managerA, {
      transactionId: transactionB,
      reason: "不应成功",
      requestId: "isolation-cross-reverse-transaction",
    }), "TRANSACTION_NOT_FOUND");
    expectErrorCode(
      () => setRewardDefinitionActive(managerA, definitionB, false, "isolation-cross-definition"),
      "REWARD_DEFINITION_NOT_FOUND",
    );
    expectErrorCode(() => grantRewardDefinition(managerA, {
      workerId: workerA,
      definitionId: definitionB,
      quantity: 1,
      reason: "不应成功",
      requestId: "isolation-cross-grant",
    }), "REWARD_DEFINITION_NOT_FOUND");
    expectErrorCode(() => cancelRewardItem(managerA, {
      rewardItemId: rewardItemB,
      reason: "不应成功",
      requestId: "isolation-cross-cancel-item",
    }), "REWARD_ITEM_NOT_FOUND");
    expectErrorCode(() => redeemTimeReward(workerContextA, {
      workerId: workerA,
      rewardItemId: rewardItemB,
      requestId: "isolation-cross-redeem-item",
    }), "REWARD_ITEM_NOT_FOUND");
    expectErrorCode(() => updateDailyCouponSetting(managerA, {
      workerId: workerB,
      isEnabled: true,
      dailyQuantity: 1,
      randomMinSeconds: 60,
      randomMaxSeconds: 120,
      requestId: "isolation-cross-daily-setting",
    }), "WORKER_NOT_FOUND");
    expect(getWorkerAvatarImage(managerA, workerB)).toBeNull();
    expect(getRewardDefinitionImage(managerA, rewardImageB)).toBeNull();
  });

  it("enforces the same boundary at boss, worker, bootstrap, and image APIs", async () => {
    const bootstrap = await bootstrapGet(apiRequest("/api/bootstrap", bossCookieA));
    const bootstrapBody = await bodyOf<{ workers: Array<{ id: string; familyId: string }> }>(bootstrap);
    expect(bootstrapBody.ok && bootstrapBody.data.workers).toEqual([
      expect.objectContaining({ id: workerA, familyId: familyA }),
    ]);

    const crossBossMutation = await bossPost(apiRequest("/api/boss", bossCookieA, {
      action: "update_worker",
      workerId: workerB,
      name: "A 家不能修改 B 家",
      requestId: "isolation-api-cross-worker",
    }));
    expect(crossBossMutation.status).toBe(404);
    expect(await bodyOf(crossBossMutation)).toMatchObject({
      ok: false,
      error: { code: "WORKER_NOT_FOUND" },
    });

    const ownLedger = await bossGet(apiRequest(`/api/boss?view=transactions&workerId=${workerA}&pageSize=30`, bossCookieA));
    expect(ownLedger.status).toBe(200);
    expect(await bodyOf(ownLedger)).toMatchObject({
      ok: true,
      data: { page: 1, pageSize: 30 },
    });
    const crossFamilyLedger = await bossGet(apiRequest(`/api/boss?view=transactions&workerId=${workerB}`, bossCookieA));
    expect(crossFamilyLedger.status).toBe(404);
    expect(await bodyOf(crossFamilyLedger)).toMatchObject({
      ok: false,
      error: { code: "WORKER_NOT_FOUND" },
    });

    const crossWorkerMutation = await workerPost(apiRequest("/api/worker", workerCookieA, {
      action: "claim_task",
      taskId: taskB,
      requestId: "isolation-api-cross-task",
    }));
    expect(crossWorkerMutation.status).toBe(404);
    expect(await bodyOf(crossWorkerMutation)).toMatchObject({
      ok: false,
      error: { code: "TASK_NOT_FOUND" },
    });

    const proxyMutation = await workerPost(apiRequest("/api/worker", bossAsWorkerCookieA, {
      action: "submit_reward_request",
      title: "老板陪同申报",
      description: "验证代操作会话",
      rewardSeconds: 60,
      requestId: "isolation-api-proxy-request",
    }));
    expect(proxyMutation.status).toBe(200);
    expect(getDb().prepare(`
      SELECT actor_type, actor_id, actor_name_snapshot, acting_for_worker_id
      FROM audit_logs WHERE request_id = ?
    `).get("isolation-api-proxy-request")).toEqual({
      actor_type: "boss_as_worker",
      actor_id: bossA,
      actor_name_snapshot: "A 家爸爸",
      acting_for_worker_id: workerA,
    });
    const proxyPhysicalConfirmation = await workerPost(apiRequest(
      "/api/worker",
      bossAsWorkerCookieA,
      {
        action: "confirm_physical_reward",
        rewardItemId: physicalRewardItemA,
        password: "1357",
        requestId: "isolation-api-proxy-confirm",
      },
    ));
    expect(proxyPhysicalConfirmation.status).toBe(403);
    expect(await bodyOf(proxyPhysicalConfirmation)).toMatchObject({
      ok: false,
      error: { code: "WORKER_CONFIRMATION_REQUIRED" },
    });

    const avatarDenied = await avatarGet(
      apiRequest(`/api/avatar/${workerB}`, bossCookieA),
      { params: Promise.resolve({ workerId: workerB }) },
    );
    const avatarAllowed = await avatarGet(
      apiRequest(`/api/avatar/${workerB}`, bossCookieB),
      { params: Promise.resolve({ workerId: workerB }) },
    );
    const anonymousAvatar = await avatarGet(
      apiRequest(`/api/avatar/${workerB}`, null),
      { params: Promise.resolve({ workerId: workerB }) },
    );
    expect(avatarDenied.status).toBe(404);
    expect(anonymousAvatar.status).toBe(404);
    expect(avatarAllowed.status).toBe(200);
    expect(avatarAllowed.headers.get("cache-control")).toContain("private");
    expect(avatarAllowed.headers.get("cache-control")).toContain("no-cache");

    const rewardImageDenied = await rewardImageGet(
      apiRequest(`/api/reward-image/${rewardImageB}`, bossCookieA),
      { params: Promise.resolve({ imageId: rewardImageB }) },
    );
    const rewardImageAllowed = await rewardImageGet(
      apiRequest(`/api/reward-image/${rewardImageB}`, bossCookieB),
      { params: Promise.resolve({ imageId: rewardImageB }) },
    );
    const anonymousRewardImage = await rewardImageGet(
      apiRequest(`/api/reward-image/${rewardImageB}`, null),
      { params: Promise.resolve({ imageId: rewardImageB }) },
    );
    expect(rewardImageDenied.status).toBe(404);
    expect(anonymousRewardImage.status).toBe(404);
    expect(rewardImageAllowed.status).toBe(200);
    expect(rewardImageAllowed.headers.get("cache-control")).toContain("private");
    expect(rewardImageAllowed.headers.get("cache-control")).toContain("no-cache");
  });

  it("records the real boss and target worker during boss-as-worker operations", async () => {
    claimTask(bossAsWorkerA, workerA, taskA, "isolation-proxy-claim-a");
    adjustBalance(managerA, {
      workerId: workerA,
      amountSeconds: 600,
      reason: "准备代操作消耗",
      requestId: "isolation-proxy-balance-a",
    });
    manualConsumption(bossAsWorkerA, {
      workerId: workerA,
      activityId: activityA,
      durationSeconds: 60,
      requestId: "isolation-proxy-consume-a",
    });

    expect(getDb().prepare(`
      SELECT family_id, actor, actor_type, actor_id, actor_name_snapshot, acting_for_worker_id
      FROM audit_logs WHERE request_id = ?
    `).get("isolation-proxy-claim-a")).toEqual({
      family_id: familyA,
      actor: `boss:${bossA}`,
      actor_type: "boss_as_worker",
      actor_id: bossA,
      actor_name_snapshot: "A 家爸爸",
      acting_for_worker_id: workerA,
    });
    expect(getDb().prepare(`
      SELECT family_id, actor_type, actor_id, actor_name_snapshot, acting_for_worker_id
      FROM transactions WHERE request_id = ?
    `).get("isolation-proxy-consume-a")).toEqual({
      family_id: familyA,
      actor_type: "boss_as_worker",
      actor_id: bossA,
      actor_name_snapshot: "A 家爸爸",
      acting_for_worker_id: workerA,
    });
    expect(getWorkerState(bossAsWorkerA, workerA).assignments
      .some((assignment) => assignment.taskId === taskA)).toBe(true);

    await expect(confirmPhysicalReward(bossAsWorkerA, {
      workerId: workerA,
      rewardItemId: physicalRewardItemA,
      password: "1357",
      requestId: "isolation-proxy-physical-confirm",
    })).rejects.toMatchObject({ code: "WORKER_CONFIRMATION_REQUIRED", status: 403 });
  });

  it("writes boss API mutations with the authenticated boss identity", async () => {
    const response = await bossPost(apiRequest("/api/boss", bossCookieA, {
      action: "adjust_balance",
      workerId: workerA,
      amountSeconds: 60,
      reason: "老板接口审计验证",
      requestId: "isolation-api-boss-audit",
    }));
    expect(response.status).toBe(200);
    expect(getDb().prepare(`
      SELECT family_id, actor_type, actor_id, actor_name_snapshot, acting_for_worker_id
      FROM audit_logs WHERE request_id = ?
    `).get("isolation-api-boss-audit")).toEqual({
      family_id: familyA,
      actor_type: "boss",
      actor_id: bossA,
      actor_name_snapshot: "A 家爸爸",
      acting_for_worker_id: null,
    });
  });
});
