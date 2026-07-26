import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as adminGet } from "@/app/api/admin/route";
import { POST as authPost } from "@/app/api/auth/route";
import { GET as avatarGet } from "@/app/api/avatar/[workerId]/route";
import { GET as bootstrapGet } from "@/app/api/bootstrap/route";
import { GET as bossGet, POST as bossPost } from "@/app/api/boss/route";
import { GET as systemGet, POST as systemPost } from "@/app/api/system/route";
import { resetConfigForTests } from "@/lib/config";
import { closeDbForTests, DEFAULT_FAMILY_ID, getDb } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/session";

const databasePath = path.join("/private/tmp", `pen-worker-account-api-${process.pid}.db`);

type Envelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

type SystemState = {
  families: Array<{ id: string; name: string; status: "active" | "inactive"; entryCode: string }>;
  bosses: Array<{
    id: string;
    username: string;
    displayName: string;
    authVersion: number;
    isActive: boolean;
    families: Array<{ familyId: string }>;
  }>;
  auditLogs: Array<{ action: string; targetId: string | null }>;
};

type BossLoginState = {
  activeIdentity: { type: "boss"; bossId: string; familyId: string } | null;
  boss: { id: string; username: string; displayName: string };
  families: Array<{ familyId: string; familyName: string }>;
  familySelectionRequired: boolean;
};

function request(
  method: "GET" | "POST",
  pathname: string,
  cookie: string | null = null,
  body?: Record<string, unknown>,
  forwarded = "account-api-test",
) {
  return new NextRequest(`http://localhost${pathname}`, {
    method,
    headers: {
      "x-forwarded-for": forwarded,
      ...(cookie ? { cookie } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function bodyOf<T>(response: Response) {
  return await response.json() as Envelope<T>;
}

function cookieFrom(response: Response) {
  const value = response.headers.get("set-cookie")
    ?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  if (!value) throw new Error("response did not set a session cookie");
  return `${SESSION_COOKIE}=${value}`;
}

describe.sequential("system administrator and boss APIs", () => {
  let systemCookie = "";
  let firstFamilyId = "";
  let secondFamilyId = "";
  let firstEntryCode = "";
  let secondEntryCode = "";
  let bossId = "";
  let firstWorkerId = "";
  let bossSelectionCookie = "";
  let firstFamilyBossCookie = "";

  beforeAll(() => {
    process.env.SYSTEM_ADMIN_PASSWORD = "api-system-admin-password";
    process.env.ADMIN_PASSWORD = "ignored-legacy-password";
    process.env.SESSION_SECRET = "account-api-session-secret-with-more-than-thirty-two-characters";
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
    delete process.env.SYSTEM_ADMIN_PASSWORD;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SESSION_SECRET;
    delete process.env.DATABASE_PATH;
    delete process.env.APP_TIMEZONE;
  });

  it("requires the system administrator and gives the new variable priority", async () => {
    const anonymous = await systemGet(request("GET", "/api/system"));
    expect(anonymous.status).toBe(401);
    expect(await bodyOf(anonymous)).toMatchObject({
      ok: false,
      error: { code: "SYSTEM_ADMIN_LOGIN_REQUIRED" },
    });

    const legacyPassword = await authPost(request("POST", "/api/auth", null, {
      action: "system_admin_login",
      password: "ignored-legacy-password",
    }, "account-api-system-wrong"));
    expect(legacyPassword.status).toBe(401);

    const login = await authPost(request("POST", "/api/auth", null, {
      action: "system_admin_login",
      password: "api-system-admin-password",
    }, "account-api-system-right"));
    expect(login.status).toBe(200);
    expect(await bodyOf(login)).toMatchObject({
      ok: true,
      data: { activeIdentity: { type: "system_admin" } },
    });
    systemCookie = cookieFrom(login);

    const legacyBusiness = await adminGet(request("GET", "/api/admin", systemCookie));
    expect(legacyBusiness.status).toBe(403);
    expect(await bodyOf(legacyBusiness)).toMatchObject({
      ok: false,
      error: { code: "SYSTEM_ADMIN_BUSINESS_FORBIDDEN" },
    });

    const legacyAction = await authPost(request("POST", "/api/auth", null, {
      action: "admin_login",
      password: "api-system-admin-password",
    }, "account-api-legacy-action"));
    expect(await bodyOf(legacyAction)).toMatchObject({
      ok: true,
      data: { activeIdentity: { type: "system_admin" } },
    });
  });

  it("lets the system administrator create families, a boss, and memberships", async () => {
    let response = await systemPost(request("POST", "/api/system", systemCookie, {
      action: "create_family",
      name: "接口家庭一",
      timezone: "UTC",
      requestId: "account-api-create-family-one",
    }));
    let body = await bodyOf<SystemState>(response);
    if (!body.ok) throw new Error("failed to create first family");
    const firstFamily = body.data.families.find((family) => family.name === "接口家庭一")!;
    firstFamilyId = firstFamily.id;
    firstEntryCode = firstFamily.entryCode;

    response = await systemPost(request("POST", "/api/system", systemCookie, {
      action: "create_family",
      name: "接口家庭二",
      requestId: "account-api-create-family-two",
    }));
    body = await bodyOf<SystemState>(response);
    if (!body.ok) throw new Error("failed to create second family");
    const secondFamily = body.data.families.find((family) => family.name === "接口家庭二")!;
    secondFamilyId = secondFamily.id;
    secondEntryCode = secondFamily.entryCode;
    expect(getDb().prepare("SELECT timezone FROM families WHERE id = ?").get(firstFamilyId))
      .toEqual({ timezone: "Asia/Shanghai" });
    expect(getDb().prepare("SELECT timezone FROM families WHERE id = ?").get(secondFamilyId))
      .toEqual({ timezone: "Asia/Shanghai" });

    response = await systemPost(request("POST", "/api/system", systemCookie, {
      action: "create_boss",
      username: "api.parent",
      displayName: "接口家长",
      password: "boss-api-password",
      requestId: "account-api-create-boss",
    }));
    body = await bodyOf<SystemState>(response);
    if (!body.ok) throw new Error("failed to create boss");
    bossId = body.data.bosses.find((boss) => boss.username === "api.parent")!.id;

    for (const [familyId, requestId] of [
      [firstFamilyId, "account-api-attach-family-one"],
      [secondFamilyId, "account-api-attach-family-two"],
    ]) {
      response = await systemPost(request("POST", "/api/system", systemCookie, {
        action: "set_boss_family",
        bossId,
        familyId,
        attached: true,
        requestId,
      }));
      expect(response.status).toBe(200);
    }
    const state = await systemGet(request("GET", "/api/system", systemCookie));
    const stateBody = await bodyOf<SystemState>(state);
    expect(stateBody.ok && stateBody.data.bosses.find((boss) => boss.id === bossId)?.families)
      .toHaveLength(2);
  });

  it("requires a family choice for a multi-family boss and rejects an unbound family", async () => {
    const login = await authPost(request("POST", "/api/auth", null, {
      action: "boss_login",
      username: "API.PARENT",
      password: "boss-api-password",
    }, "account-api-boss-login"));
    const loginBody = await bodyOf<BossLoginState>(login);
    expect(login.status).toBe(200);
    expect(loginBody).toMatchObject({
      ok: true,
      data: {
        activeIdentity: null,
        familySelectionRequired: true,
        boss: { id: bossId },
      },
    });
    expect(loginBody.ok && loginBody.data.families).toHaveLength(2);
    bossSelectionCookie = cookieFrom(login);

    const forbidden = await authPost(request("POST", "/api/auth", bossSelectionCookie, {
      action: "switch",
      identity: { type: "boss", bossId, familyId: DEFAULT_FAMILY_ID },
    }));
    expect(forbidden.status).toBe(403);
    expect(await bodyOf(forbidden)).toMatchObject({
      ok: false,
      error: { code: "BOSS_FAMILY_FORBIDDEN" },
    });
  });

  it("opens family-scoped boss business and blocks system or legacy business APIs", async () => {
    const switched = await authPost(request("POST", "/api/auth", bossSelectionCookie, {
      action: "switch",
      identity: { type: "boss", bossId, familyId: firstFamilyId },
    }));
    expect(switched.status).toBe(200);
    firstFamilyBossCookie = cookieFrom(switched);

    const portal = await bossGet(request("GET", "/api/boss", firstFamilyBossCookie));
    expect(portal.status).toBe(200);
    const portalBody = await bodyOf<{
      boss: { id: string; displayName: string };
      family: { id: string; name: string };
      families: Array<{ familyId: string }>;
      businessAccess: string;
    }>(portal);
    expect(portalBody).toMatchObject({
      ok: true,
      data: {
        boss: { id: bossId, displayName: "接口家长" },
        family: { id: firstFamilyId, name: "接口家庭一" },
        businessAccess: "family_business",
      },
    });
    expect(portalBody.ok && portalBody.data.families.map((family) => family.familyId).sort())
      .toEqual([firstFamilyId, secondFamilyId].sort());

    const createdWorker = await bossPost(request("POST", "/api/boss", firstFamilyBossCookie, {
      action: "create_worker",
      name: "接口家庭一小朋友",
      password: "1357",
      avatar: "star",
      theme: "purple",
      dailyRewardSeconds: 0,
      requestId: "account-api-create-worker-one",
    }));
    const createdWorkerBody = await bodyOf<{ workers: Array<{ id: string; name: string }> }>(createdWorker);
    if (!createdWorkerBody.ok) throw new Error("failed to create first family worker");
    firstWorkerId = createdWorkerBody.data.workers.find((worker) => worker.name === "接口家庭一小朋友")!.id;

    const proxy = await authPost(request("POST", "/api/auth", firstFamilyBossCookie, {
      action: "switch",
      identity: {
        type: "boss_as_worker",
        bossId,
        workerId: firstWorkerId,
        familyId: firstFamilyId,
      },
    }));
    expect(proxy.status).toBe(200);
    expect(await bodyOf(proxy)).toMatchObject({
      ok: true,
      data: { activeIdentity: { type: "boss_as_worker", bossId, workerId: firstWorkerId, familyId: firstFamilyId } },
    });
    const proxyCookie = cookieFrom(proxy);
    const proxyPasswordChange = await authPost(request("POST", "/api/auth", proxyCookie, {
      action: "boss_change_password",
      currentPassword: "boss-api-password",
      newPassword: "proxy-must-not-change-password",
      requestId: "account-api-proxy-password-change",
    }));
    expect(proxyPasswordChange.status).toBe(401);
    expect(await bodyOf(proxyPasswordChange)).toMatchObject({
      ok: false,
      error: { code: "BOSS_LOGIN_REQUIRED" },
    });
    const returned = await authPost(request("POST", "/api/auth", proxyCookie, {
      action: "switch",
      identity: { type: "boss", bossId, familyId: firstFamilyId },
    }));
    expect(returned.status).toBe(200);

    const workerLogin = await authPost(request("POST", "/api/auth", null, {
      action: "worker_login",
      workerId: firstWorkerId,
      password: "1357",
    }, "account-api-worker-login"));
    const forbiddenProxy = await authPost(request("POST", "/api/auth", cookieFrom(workerLogin), {
      action: "switch",
      identity: {
        type: "boss_as_worker",
        bossId,
        workerId: firstWorkerId,
        familyId: firstFamilyId,
      },
    }));
    expect(forbiddenProxy.status).toBe(403);
    expect(await bodyOf(forbiddenProxy)).toMatchObject({
      ok: false,
      error: { code: "BOSS_PROXY_SWITCH_FORBIDDEN" },
    });

    const system = await systemGet(request("GET", "/api/system", firstFamilyBossCookie));
    expect(system.status).toBe(401);
    const legacyBusiness = await adminGet(request("GET", "/api/admin", firstFamilyBossCookie));
    expect(legacyBusiness.status).toBe(401);
  });

  it("scopes family links and anonymous avatars, and invalidates rotated or inactive entries", async () => {
    const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nO0AAAAASUVORK5CYII=";
    const uploaded = await bossPost(request("POST", "/api/boss", firstFamilyBossCookie, {
      action: "upload_worker_avatar",
      workerId: firstWorkerId,
      imageDataUrl: tinyPng,
      requestId: "account-api-upload-worker-avatar",
    }));
    expect(uploaded.status).toBe(200);

    const firstEntry = await bootstrapGet(request("GET", `/api/bootstrap?entryCode=${firstEntryCode}`));
    expect(firstEntry.status).toBe(200);
    expect(await bodyOf(firstEntry)).toMatchObject({
      ok: true,
      data: {
        family: { id: firstFamilyId, name: "接口家庭一" },
        workers: [{ id: firstWorkerId, familyId: firstFamilyId }],
        activeIdentity: null,
      },
    });
    const secondEntry = await bootstrapGet(request("GET", `/api/bootstrap?entryCode=${secondEntryCode}`));
    expect(await bodyOf(secondEntry)).toMatchObject({
      ok: true,
      data: { family: { id: secondFamilyId }, workers: [] },
    });
    const conflictingEntry = await bootstrapGet(request(
      "GET",
      `/api/bootstrap?entryCode=${secondEntryCode}`,
      firstFamilyBossCookie,
    ));
    expect(await bodyOf(conflictingEntry)).toMatchObject({
      ok: true,
      data: { family: { id: secondFamilyId }, activeIdentity: null },
    });

    const anonymousDenied = await avatarGet(
      request("GET", `/api/avatar/${firstWorkerId}`),
      { params: Promise.resolve({ workerId: firstWorkerId }) },
    );
    const correctEntryAvatar = await avatarGet(
      request("GET", `/api/avatar/${firstWorkerId}?entryCode=${firstEntryCode}`),
      { params: Promise.resolve({ workerId: firstWorkerId }) },
    );
    const wrongEntryAvatar = await avatarGet(
      request("GET", `/api/avatar/${firstWorkerId}?entryCode=${secondEntryCode}`),
      { params: Promise.resolve({ workerId: firstWorkerId }) },
    );
    expect(anonymousDenied.status).toBe(404);
    expect(correctEntryAvatar.status).toBe(200);
    expect(wrongEntryAvatar.status).toBe(404);

    const renamed = await bossPost(request("POST", "/api/boss", firstFamilyBossCookie, {
      action: "update_family_name",
      name: "接口家庭一新名称",
      requestId: "account-api-boss-rename-family",
    }));
    expect(renamed.status).toBe(200);
    expect(await bodyOf(renamed)).toMatchObject({
      ok: true,
      data: {
        family: { id: firstFamilyId, name: "接口家庭一新名称", entryCode: firstEntryCode },
        boss: { id: bossId },
      },
    });
    expect(await bodyOf(await bootstrapGet(request("GET", `/api/bootstrap?entryCode=${firstEntryCode}`))))
      .toMatchObject({ ok: true, data: { family: { name: "接口家庭一新名称" } } });

    const disabled = await systemPost(request("POST", "/api/system", systemCookie, {
      action: "update_family",
      familyId: secondFamilyId,
      status: "inactive",
      requestId: "account-api-disable-second-entry",
    }));
    expect(disabled.status).toBe(200);
    expect((await bootstrapGet(request("GET", `/api/bootstrap?entryCode=${secondEntryCode}`))).status).toBe(404);
    await systemPost(request("POST", "/api/system", systemCookie, {
      action: "update_family",
      familyId: secondFamilyId,
      status: "active",
      requestId: "account-api-enable-second-entry",
    }));

    const rotationPayload = {
      action: "rotate_family_entry_code",
      requestId: "account-api-rotate-first-entry",
    };
    const rotated = await bossPost(request("POST", "/api/boss", firstFamilyBossCookie, rotationPayload));
    const rotatedBody = await bodyOf<{ family: { id: string; entryCode: string } }>(rotated);
    if (!rotatedBody.ok) throw new Error("failed to rotate first family entry");
    const nextEntryCode = rotatedBody.data.family.entryCode;
    expect(nextEntryCode).not.toBe(firstEntryCode);
    const duplicateRotation = await bossPost(request("POST", "/api/boss", firstFamilyBossCookie, rotationPayload));
    expect(await bodyOf(duplicateRotation)).toMatchObject({
      ok: true,
      data: { family: { entryCode: nextEntryCode } },
    });
    expect((await bootstrapGet(request("GET", `/api/bootstrap?entryCode=${firstEntryCode}`))).status).toBe(404);
    expect((await bootstrapGet(request("GET", `/api/bootstrap?entryCode=${nextEntryCode}`))).status).toBe(200);
    expect(getDb().prepare(`
      SELECT action, actor_type, actor_id, actor_name_snapshot, target_id
      FROM audit_logs
      WHERE request_id IN (?, ?)
      ORDER BY action
    `).all("account-api-boss-rename-family", "account-api-rotate-first-entry")).toEqual([
      {
        action: "family_entry_code_rotated",
        actor_type: "boss",
        actor_id: bossId,
        actor_name_snapshot: "接口家长",
        target_id: firstFamilyId,
      },
      {
        action: "family_name_updated",
        actor_type: "boss",
        actor_id: bossId,
        actor_name_snapshot: "接口家长",
        target_id: firstFamilyId,
      },
    ]);

    const renamedBoss = await bossPost(request("POST", "/api/boss", firstFamilyBossCookie, {
      action: "update_boss_display_name",
      displayName: "接口爸爸",
      requestId: "account-api-boss-update-display-name",
    }));
    expect(renamedBoss.status).toBe(200);
    expect(await bodyOf(renamedBoss)).toMatchObject({
      ok: true,
      data: { boss: { id: bossId, username: "api.parent", displayName: "接口爸爸" } },
    });
    expect(getDb().prepare(`
      SELECT action, actor_type, actor_id, actor_name_snapshot, target_type, target_id
      FROM audit_logs WHERE request_id = ?
    `).get("account-api-boss-update-display-name")).toEqual({
      action: "boss_display_name_updated",
      actor_type: "boss",
      actor_id: bossId,
      actor_name_snapshot: "接口家长",
      target_type: "boss",
      target_id: bossId,
    });

    const familyDisplayName = await bossPost(request("POST", "/api/boss", firstFamilyBossCookie, {
      action: "update_boss_family_display_name",
      displayName: "一号家庭爸爸",
      requestId: "account-api-boss-family-display-name",
    }));
    expect(familyDisplayName.status).toBe(200);
    expect(await bodyOf(familyDisplayName)).toMatchObject({
      ok: true,
      data: {
        boss: {
          id: bossId,
          displayName: "一号家庭爸爸",
          defaultDisplayName: "接口爸爸",
          familyDisplayNameOverride: "一号家庭爸爸",
        },
      },
    });
    expect(getDb().prepare(`
      SELECT action, actor_name_snapshot FROM audit_logs WHERE request_id = ?
    `).get("account-api-boss-family-display-name")).toEqual({
      action: "boss_family_display_name_updated",
      actor_name_snapshot: "接口爸爸",
    });

    const secondFamilySwitch = await authPost(request("POST", "/api/auth", firstFamilyBossCookie, {
      action: "switch",
      identity: { type: "boss", bossId, familyId: secondFamilyId },
    }));
    expect(secondFamilySwitch.status).toBe(200);
    expect(await bodyOf(await bossGet(request("GET", "/api/boss", cookieFrom(secondFamilySwitch)))))
      .toMatchObject({
        ok: true,
        data: {
          boss: {
            displayName: "接口爸爸",
            defaultDisplayName: "接口爸爸",
            familyDisplayNameOverride: null,
          },
        },
      });
    expect(await bodyOf(await bootstrapGet(request("GET", "/api/bootstrap", firstFamilyBossCookie))))
      .toMatchObject({
        ok: true,
        data: {
          bosses: [{
            id: bossId,
            displayName: "接口爸爸",
            families: expect.arrayContaining([
              expect.objectContaining({
                familyId: firstFamilyId,
                displayName: "一号家庭爸爸",
                displayNameOverride: "一号家庭爸爸",
              }),
              expect.objectContaining({
                familyId: secondFamilyId,
                displayName: "接口爸爸",
                displayNameOverride: null,
              }),
            ]),
          }],
        },
      });
    firstEntryCode = nextEntryCode;
  });

  it("invalidates a boss family context immediately after detachment", async () => {
    const detached = await systemPost(request("POST", "/api/system", systemCookie, {
      action: "set_boss_family",
      bossId,
      familyId: firstFamilyId,
      attached: false,
      requestId: "account-api-detach-family-one",
    }));
    expect(detached.status).toBe(200);

    const oldPortal = await bossGet(request("GET", "/api/boss", firstFamilyBossCookie));
    expect(oldPortal.status).toBe(401);
    expect(await bodyOf(oldPortal)).toMatchObject({
      ok: false,
      error: { code: "BOSS_LOGIN_REQUIRED" },
    });

    const singleFamilyLogin = await authPost(request("POST", "/api/auth", null, {
      action: "boss_login",
      username: "api.parent",
      password: "boss-api-password",
    }, "account-api-boss-single-family"));
    expect(await bodyOf(singleFamilyLogin)).toMatchObject({
      ok: true,
      data: {
        familySelectionRequired: false,
        activeIdentity: { type: "boss", bossId, familyId: secondFamilyId },
      },
    });
    const singleFamilyCookie = cookieFrom(singleFamilyLogin);

    const secondDeviceLogin = await authPost(request("POST", "/api/auth", null, {
      action: "boss_login",
      username: "api.parent",
      password: "boss-api-password",
    }, "account-api-boss-second-device"));
    const secondDeviceCookie = cookieFrom(secondDeviceLogin);

    const wrongCurrentPassword = await authPost(request("POST", "/api/auth", singleFamilyCookie, {
      action: "boss_change_password",
      currentPassword: "wrong-current-password",
      newPassword: "boss-self-service-password",
      requestId: "account-api-boss-self-password-wrong",
    }, "account-api-boss-password-change"));
    expect(wrongCurrentPassword.status).toBe(401);
    expect(await bodyOf(wrongCurrentPassword)).toMatchObject({
      ok: false,
      error: { code: "INVALID_BOSS_CURRENT_PASSWORD" },
    });

    const changedPassword = await authPost(request("POST", "/api/auth", singleFamilyCookie, {
      action: "boss_change_password",
      currentPassword: "boss-api-password",
      newPassword: "boss-self-service-password",
      requestId: "account-api-boss-self-password-change",
    }, "account-api-boss-password-change"));
    expect(changedPassword.status).toBe(200);
    expect(await bodyOf(changedPassword)).toMatchObject({
      ok: true,
      data: {
        passwordChanged: true,
        activeIdentity: { type: "boss", bossId, familyId: secondFamilyId },
      },
    });
    const changedPasswordCookie = cookieFrom(changedPassword);
    expect((await bossGet(request("GET", "/api/boss", changedPasswordCookie))).status).toBe(200);
    expect((await bossGet(request("GET", "/api/boss", secondDeviceCookie))).status).toBe(401);
    expect((await authPost(request("POST", "/api/auth", null, {
      action: "boss_login",
      username: "api.parent",
      password: "boss-api-password",
    }, "account-api-boss-old-password"))).status).toBe(401);
    expect((await authPost(request("POST", "/api/auth", null, {
      action: "boss_login",
      username: "api.parent",
      password: "boss-self-service-password",
    }, "account-api-boss-new-password"))).status).toBe(200);
    expect(getDb().prepare(`
      SELECT action, actor_name_snapshot, detail FROM audit_logs WHERE request_id = ?
    `).get("account-api-boss-self-password-change")).toEqual({
      action: "boss_password_changed",
      actor_name_snapshot: "接口爸爸",
      detail: "老板修改自己的登录密码",
    });

    const reset = await systemPost(request("POST", "/api/system", systemCookie, {
      action: "update_boss",
      bossId,
      password: "new-boss-api-password",
      requestId: "account-api-reset-boss-password",
    }));
    expect(reset.status).toBe(200);
    expect((await bossGet(request("GET", "/api/boss", changedPasswordCookie))).status).toBe(401);

    const bootstrap = await bootstrapGet(request("GET", "/api/bootstrap", changedPasswordCookie));
    expect(await bodyOf(bootstrap)).toMatchObject({
      ok: true,
      data: { activeIdentity: null },
    });
  });
});
