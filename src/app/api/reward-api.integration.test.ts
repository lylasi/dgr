import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as adminPost } from "@/app/api/admin/route";
import { GET as rewardImageGet } from "@/app/api/reward-image/[imageId]/route";
import { POST as workerPost } from "@/app/api/worker/route";
import type { AdminState, WorkerState } from "@/components/types";
import { resetConfigForTests } from "@/lib/config";
import { closeDbForTests } from "@/lib/db";
import { getWorkerAuth } from "@/lib/service";
import {
  createEmptySession,
  currentAdminFingerprint,
  encodeSession,
  SESSION_COOKIE,
} from "@/lib/session";

const databasePath = path.join("/private/tmp", `pen-worker-reward-api-${process.pid}.db`);

type Envelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

function sessionCookie(value: string) {
  return `${SESSION_COOKIE}=${value}`;
}

function request(url: string, cookie: string | null, body: Record<string, unknown>, forwarded = "api-test") {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": forwarded,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function bodyOf<T>(response: Response) {
  return await response.json() as Envelope<T>;
}

describe.sequential("reward API permissions and concurrency", () => {
  let adminCookie = "";
  let firstWorkerCookie = "";
  let secondWorkerCookie = "";
  let firstWorkerId = "";
  let secondWorkerId = "";
  let fixedDefinitionId = "";
  let physicalDefinitionId = "";

  beforeAll(() => {
    process.env.ADMIN_PASSWORD = "reward-api-admin";
    process.env.SESSION_SECRET = "reward-api-session-secret-with-more-than-thirty-two-characters";
    process.env.DATABASE_PATH = databasePath;
    process.env.APP_TIMEZONE = "Asia/Shanghai";
    resetConfigForTests();
    closeDbForTests();
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${databasePath}${suffix}`, { force: true });

    const adminSession = createEmptySession();
    adminSession.adminFingerprint = currentAdminFingerprint();
    adminSession.active = { type: "admin" };
    adminCookie = sessionCookie(encodeSession(adminSession));
  });

  afterAll(() => {
    closeDbForTests();
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${databasePath}${suffix}`, { force: true });
    resetConfigForTests();
  });

  it("rejects reward administration without an administrator session", async () => {
    const response = await adminPost(request(
      "http://localhost/api/admin",
      null,
      { action: "set_reward_system_enabled", enabled: false, requestId: "api-no-admin" },
    ));
    expect(response.status).toBe(401);
    expect(await bodyOf(response)).toMatchObject({ ok: false, error: { code: "ADMIN_LOGIN_REQUIRED" } });
  });

  it("creates workers and the three API-facing reward resources", async () => {
    for (const [name, password, requestId] of [
      ["接口一号", "1357", "api-create-worker-one"],
      ["接口二号", "2468", "api-create-worker-two"],
    ]) {
      const response = await adminPost(request("http://localhost/api/admin", adminCookie, {
        action: "create_worker",
        name,
        password,
        avatar: "star",
        theme: "purple",
        dailyRewardSeconds: 0,
        requestId,
      }));
      expect(response.status).toBe(200);
    }
    const createRandom = await adminPost(request("http://localhost/api/admin", adminCookie, {
      action: "create_reward_definition",
      name: "接口随机券",
      description: "接口测试",
      icon: "sparkles",
      theme: "purple",
      kind: "random_time",
      randomMinSeconds: 60,
      randomMaxSeconds: 180,
      requestId: "api-create-random-definition",
    }));
    expect(createRandom.status).toBe(200);
    const fixedResponse = await adminPost(request("http://localhost/api/admin", adminCookie, {
      action: "create_reward_definition",
      name: "接口固定券",
      description: "并发使用测试",
      icon: "clock",
      theme: "blue",
      kind: "fixed_time",
      fixedSeconds: 600,
      requestId: "api-create-fixed-definition",
    }));
    const fixedBody = await bodyOf<AdminState>(fixedResponse);
    expect(fixedBody.ok).toBe(true);
    if (!fixedBody.ok) throw new Error("failed to create fixed definition");
    firstWorkerId = fixedBody.data.workers.find((worker) => worker.name === "接口一号")!.id;
    secondWorkerId = fixedBody.data.workers.find((worker) => worker.name === "接口二号")!.id;
    fixedDefinitionId = fixedBody.data.rewardDefinitions.find((definition) => definition.name === "接口固定券")!.id;

    const physicalResponse = await adminPost(request("http://localhost/api/admin", adminCookie, {
      action: "create_reward_definition",
      name: "接口图书券",
      description: "实物确认测试",
      icon: "book",
      theme: "green",
      kind: "physical",
      physicalDescription: "一本测试图书",
      fulfillmentInstructions: "实际交付后确认",
      requestId: "api-create-physical-definition",
    }));
    const physicalBody = await bodyOf<AdminState>(physicalResponse);
    if (!physicalBody.ok) throw new Error("failed to create physical definition");
    physicalDefinitionId = physicalBody.data.rewardDefinitions.find((definition) => definition.name === "接口图书券")!.id;

    const firstSession = createEmptySession();
    firstSession.workers[firstWorkerId] = getWorkerAuth(firstWorkerId).authVersion;
    firstSession.active = { type: "worker", workerId: firstWorkerId };
    firstWorkerCookie = sessionCookie(encodeSession(firstSession));
    const secondSession = createEmptySession();
    secondSession.workers[secondWorkerId] = getWorkerAuth(secondWorkerId).authVersion;
    secondSession.active = { type: "worker", workerId: secondWorkerId };
    secondWorkerCookie = sessionCookie(encodeSession(secondSession));
  });

  it("keeps a direct grant idempotent through the administrator API", async () => {
    const payload = {
      action: "grant_reward_items",
      workerId: firstWorkerId,
      definitionId: fixedDefinitionId,
      quantity: 1,
      reason: "接口直发测试",
      requestId: "api-grant-fixed-once",
    };
    const first = await adminPost(request("http://localhost/api/admin", adminCookie, payload));
    const second = await adminPost(request("http://localhost/api/admin", adminCookie, payload));
    const firstBody = await bodyOf<AdminState>(first);
    const secondBody = await bodyOf<AdminState>(second);
    expect(firstBody.ok && firstBody.data.rewardItems.filter((item) => item.definitionId === fixedDefinitionId)).toHaveLength(1);
    expect(secondBody.ok && secondBody.data.rewardItems.filter((item) => item.definitionId === fixedDefinitionId)).toHaveLength(1);
  });

  it("allows only one of two devices to use the same coupon", async () => {
    const adminStateResponse = await adminPost(request("http://localhost/api/admin", adminCookie, {
      action: "set_reward_system_enabled",
      enabled: true,
      requestId: "api-ensure-reward-enabled",
    }));
    const adminState = await bodyOf<AdminState>(adminStateResponse);
    if (!adminState.ok) throw new Error("failed to load admin reward state");
    const item = adminState.data.rewardItems.find((reward) => reward.definitionId === fixedDefinitionId)!;

    const [left, right] = await Promise.all([
      workerPost(request("http://localhost/api/worker", firstWorkerCookie, {
        action: "redeem_reward_item",
        rewardItemId: item.id,
        requestId: "api-concurrent-use-left",
      })),
      workerPost(request("http://localhost/api/worker", firstWorkerCookie, {
        action: "redeem_reward_item",
        rewardItemId: item.id,
        requestId: "api-concurrent-use-right",
      })),
    ]);
    expect([left.status, right.status].sort()).toEqual([200, 409]);
    const success = left.status === 200 ? left : right;
    const successBody = await bodyOf<WorkerState>(success);
    expect(successBody.ok && successBody.data.worker.balanceSeconds).toBe(600);
    expect(successBody.ok && successBody.data.transactions.filter((transaction) => transaction.rewardItemId === item.id)).toHaveLength(1);
  });

  it("prevents one worker from using another worker's coupon", async () => {
    const grant = await adminPost(request("http://localhost/api/admin", adminCookie, {
      action: "grant_reward_items",
      workerId: firstWorkerId,
      definitionId: fixedDefinitionId,
      quantity: 1,
      reason: "归属权限测试",
      requestId: "api-grant-owner-test",
    }));
    const grantBody = await bodyOf<AdminState>(grant);
    if (!grantBody.ok) throw new Error("failed to grant owner test item");
    const item = grantBody.data.rewardItems.find((reward) => reward.grantReason === "归属权限测试")!;
    const response = await workerPost(request("http://localhost/api/worker", secondWorkerCookie, {
      action: "redeem_reward_item",
      rewardItemId: item.id,
      requestId: "api-use-other-worker-item",
    }));
    expect(response.status).toBe(403);
    expect(await bodyOf(response)).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("requires the current worker password for physical confirmation", async () => {
    const grant = await adminPost(request("http://localhost/api/admin", adminCookie, {
      action: "grant_reward_items",
      workerId: firstWorkerId,
      definitionId: physicalDefinitionId,
      quantity: 1,
      reason: "接口实物测试",
      requestId: "api-grant-physical",
    }));
    const grantBody = await bodyOf<AdminState>(grant);
    if (!grantBody.ok) throw new Error("failed to grant physical item");
    const item = grantBody.data.rewardItems.find((reward) => reward.definitionId === physicalDefinitionId)!;
    const wrong = await workerPost(request("http://localhost/api/worker", firstWorkerCookie, {
      action: "confirm_physical_reward",
      rewardItemId: item.id,
      password: "wrong",
      requestId: "api-physical-wrong-password",
    }, "physical-password-test"));
    expect(wrong.status).toBe(401);
    const confirmed = await workerPost(request("http://localhost/api/worker", firstWorkerCookie, {
      action: "confirm_physical_reward",
      rewardItemId: item.id,
      password: "1357",
      requestId: "api-physical-correct-password",
    }, "physical-password-test"));
    const confirmedBody = await bodyOf<WorkerState>(confirmed);
    expect(confirmedBody.ok && confirmedBody.data.rewardItems.find((reward) => reward.id === item.id)?.status).toBe("fulfilled");
    expect(confirmedBody.ok && confirmedBody.data.transactions.some((transaction) => transaction.rewardItemId === item.id)).toBe(false);
  });

  it("publishes, snapshots, and atomically settles a configurable excellent task reward", async () => {
    const createTaskResponse = await adminPost(request("http://localhost/api/admin", adminCookie, {
      action: "create_task",
      title: "接口优秀任务",
      description: "验证可配置倍率和任务奖励券",
      rewardSeconds: 5 * 60,
      targetWorkerId: firstWorkerId,
      timingMode: "none",
      minimumDurationSeconds: null,
      bonusEnabled: true,
      excellentMultiplier: 3,
      bonusCriteria: "认真完成并说明收获",
      rewardBindings: [
        {
          definitionId: fixedDefinitionId,
          grantTier: "normal",
          quantity: 2,
          probabilityPercent: 100,
        },
        {
          definitionId: physicalDefinitionId,
          grantTier: "excellent_bonus",
          quantity: 1,
          probabilityPercent: 100,
        },
      ],
      assignNow: false,
      requestId: "api-create-reward-task",
    }));
    const createTaskBody = await bodyOf<AdminState>(createTaskResponse);
    expect(createTaskResponse.status).toBe(200);
    if (!createTaskBody.ok) throw new Error("failed to create task reward task");
    const task = createTaskBody.data.tasks.find((item) => item.title === "接口优秀任务")!;
    expect(task).toMatchObject({ excellentMultiplier: 3 });
    expect(task.rewardBindings).toHaveLength(2);
    expect(task.rewardBindings.find((item) => item.definitionId === fixedDefinitionId)).toMatchObject({
      grantTier: "normal",
      quantity: 2,
      probabilityPercent: 100,
    });

    const claimResponse = await workerPost(request("http://localhost/api/worker", firstWorkerCookie, {
      action: "claim_task",
      taskId: task.id,
      requestId: "api-claim-reward-task",
    }));
    const claimBody = await bodyOf<WorkerState>(claimResponse);
    if (!claimBody.ok) throw new Error("failed to claim task reward task");
    const assignment = claimBody.data.assignments.find((item) => item.taskId === task.id)!;
    expect(assignment).toMatchObject({ excellentMultiplier: 3, reviewTier: null });
    expect(assignment.rewardItems).toHaveLength(2);
    expect(assignment.rewardItems.find((item) => item.definitionId === physicalDefinitionId)).toMatchObject({
      grantTier: "excellent_bonus",
      physicalDescription: "一本测试图书",
      fulfillmentInstructions: "实际交付后确认",
    });
    const balanceBefore = claimBody.data.worker.balanceSeconds;

    const submitResponse = await workerPost(request("http://localhost/api/worker", firstWorkerCookie, {
      action: "submit_task",
      assignmentId: assignment.id,
      note: "已经完成并说明收获",
      requestId: "api-submit-reward-task",
    }));
    expect(submitResponse.status).toBe(200);

    const reviewResponse = await adminPost(request("http://localhost/api/admin", adminCookie, {
      action: "review",
      assignmentId: assignment.id,
      decision: "excellent",
      note: "达到优秀标准",
      requestId: "api-review-reward-task",
    }));
    const reviewBody = await bodyOf<AdminState>(reviewResponse);
    expect(reviewResponse.status).toBe(200);
    if (!reviewBody.ok) throw new Error("failed to review task reward task");
    const reviewedWorker = reviewBody.data.workers.find((worker) => worker.id === firstWorkerId)!;
    const reviewedAssignment = reviewedWorker.assignments.find((item) => item.id === assignment.id)!;
    expect(reviewedWorker.balanceSeconds - balanceBefore).toBe(15 * 60);
    expect(reviewedAssignment).toMatchObject({
      status: "approved",
      reviewTier: "excellent",
      reviewMultiplier: 3,
    });
    expect(reviewedAssignment.rewardItems.find((item) => item.definitionId === fixedDefinitionId)?.awardedQuantity).toBe(2);
    expect(reviewedAssignment.rewardItems.find((item) => item.definitionId === physicalDefinitionId)?.awardedQuantity).toBe(1);
    expect(reviewBody.data.rewardItems.filter((item) => item.sourceType === "task" && item.sourceId === assignment.id)).toHaveLength(3);
  });

  it("allows only one of two concurrent administrator reviews to settle a task", async () => {
    const createTaskResponse = await adminPost(request("http://localhost/api/admin", adminCookie, {
      action: "create_task",
      title: "接口并发审核任务",
      description: "两台设备同时审核只能结算一次",
      rewardSeconds: 4 * 60,
      targetWorkerId: secondWorkerId,
      timingMode: "none",
      bonusEnabled: true,
      excellentMultiplier: 2,
      bonusCriteria: "完成即优秀",
      rewardBindings: [{
        definitionId: fixedDefinitionId,
        grantTier: "normal",
        quantity: 1,
        probabilityPercent: 100,
      }],
      requestId: "api-create-concurrent-review-task",
    }));
    const createTaskBody = await bodyOf<AdminState>(createTaskResponse);
    if (!createTaskBody.ok) throw new Error("failed to create concurrent review task");
    const task = createTaskBody.data.tasks.find((item) => item.title === "接口并发审核任务")!;

    const claimResponse = await workerPost(request("http://localhost/api/worker", secondWorkerCookie, {
      action: "claim_task",
      taskId: task.id,
      requestId: "api-claim-concurrent-review-task",
    }));
    const claimBody = await bodyOf<WorkerState>(claimResponse);
    if (!claimBody.ok) throw new Error("failed to claim concurrent review task");
    const assignment = claimBody.data.assignments.find((item) => item.taskId === task.id)!;
    const balanceBefore = claimBody.data.worker.balanceSeconds;
    await workerPost(request("http://localhost/api/worker", secondWorkerCookie, {
      action: "submit_task",
      assignmentId: assignment.id,
      note: "并发审核测试已完成",
      requestId: "api-submit-concurrent-review-task",
    }));

    const [left, right] = await Promise.all([
      adminPost(request("http://localhost/api/admin", adminCookie, {
        action: "review",
        assignmentId: assignment.id,
        decision: "excellent",
        note: "左侧设备审核",
        requestId: "api-concurrent-review-left",
      })),
      adminPost(request("http://localhost/api/admin", adminCookie, {
        action: "review",
        assignmentId: assignment.id,
        decision: "excellent",
        note: "右侧设备审核",
        requestId: "api-concurrent-review-right",
      })),
    ]);
    expect([left.status, right.status].sort()).toEqual([200, 409]);
    const successBody = await bodyOf<AdminState>(left.status === 200 ? left : right);
    if (!successBody.ok) throw new Error("concurrent review did not produce a successful state");
    const worker = successBody.data.workers.find((item) => item.id === secondWorkerId)!;
    expect(worker.balanceSeconds - balanceBefore).toBe(8 * 60);
    expect(successBody.data.transactions.filter((item) => item.title === "接口并发审核任务")).toHaveLength(1);
    expect(successBody.data.rewardItems.filter((item) => item.sourceId === assignment.id)).toHaveLength(1);
  });

  it("serves versioned reward images through the read-only endpoint", async () => {
    const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nO0AAAAASUVORK5CYII=";
    const upload = await adminPost(request("http://localhost/api/admin", adminCookie, {
      action: "upload_reward_definition_image",
      definitionId: physicalDefinitionId,
      imageDataUrl: tinyPng,
      requestId: "api-upload-reward-image",
    }));
    const uploadBody = await bodyOf<AdminState>(upload);
    if (!uploadBody.ok) throw new Error("failed to upload reward image");
    const imageUrl = uploadBody.data.rewardDefinitions.find((definition) => definition.id === physicalDefinitionId)!.imageUrl!;
    const imageId = imageUrl.split("/").at(-1)!;
    const first = await rewardImageGet(
      new NextRequest(`http://localhost${imageUrl}`),
      { params: Promise.resolve({ imageId }) },
    );
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("image/png");
    const etag = first.headers.get("etag")!;
    const cached = await rewardImageGet(
      new NextRequest(`http://localhost${imageUrl}`, { headers: { "if-none-match": etag } }),
      { params: Promise.resolve({ imageId }) },
    );
    expect(cached.status).toBe(304);
  });
});
