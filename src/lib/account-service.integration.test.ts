import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authenticateBoss,
  bossAuthorizationVersionValid,
  changeBossPassword,
  createBossAccount,
  createFamily,
  getActiveFamilyByEntryCode,
  getAuthorizedBossContext,
  getPublicFamilyDirectoryState,
  getSystemManagementState,
  listBossMemberships,
  setBossFamilyMembership,
  setPublicFamilyDirectory,
  updateBossAccount,
  updateBossDisplayName,
  updateBossFamilyDisplayName,
  updateFamily,
} from "@/lib/account-service";
import { resetConfigForTests } from "@/lib/config";
import { closeDbForTests, getDb } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import {
  authenticateWorker,
  listPublicWorkers,
  workerAuthorizationValid,
} from "@/lib/service";

const databasePath = path.join("/private/tmp", `pen-worker-account-service-${process.pid}.db`);

describe.sequential("family and boss account service", () => {
  let firstFamilyId = "";
  let secondFamilyId = "";
  let bossId = "";
  let currentBossVersion = 0;

  beforeAll(() => {
    process.env.SYSTEM_ADMIN_PASSWORD = "account-service-system-admin";
    process.env.SESSION_SECRET = "account-service-session-secret-with-more-than-thirty-two-characters";
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
    delete process.env.SESSION_SECRET;
    delete process.env.DATABASE_PATH;
    delete process.env.APP_TIMEZONE;
  });

  it("creates initialized families and makes creation idempotent", () => {
    firstFamilyId = createFamily({
      name: "测试一号家庭",
      timezone: "Asia/Shanghai",
      requestId: "account-create-family-one",
    });
    expect(createFamily({
      name: "重试时不会再创建",
      timezone: "UTC",
      requestId: "account-create-family-one",
    })).toBe(firstFamilyId);
    secondFamilyId = createFamily({
      name: "测试二号家庭",
      timezone: "Asia/Chongqing",
      requestId: "account-create-family-two",
    });

    const db = getDb();
    expect(db.prepare(`
      SELECT key, value FROM app_settings WHERE family_id = ?
    `).all(firstFamilyId)).toEqual([{ key: "reward_system_enabled", value: "1" }]);
    expect(db.prepare(`
      SELECT name FROM consumption_activities WHERE family_id = ? ORDER BY sort_order
    `).all(firstFamilyId)).toEqual([{ name: "玩游戏" }, { name: "看视频" }]);
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM system_audit_logs WHERE request_id = ?
    `).get("account-create-family-one")).toEqual({ count: 1 });
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = 10").get())
      .toEqual({ version: 10 });
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = 13").get())
      .toEqual({ version: 13 });
  });

  it("publishes active families by default and hides only their discovery when disabled", () => {
    const db = getDb();
    const firstEntryCode = (db.prepare("SELECT entry_code FROM families WHERE id = ?")
      .get(firstFamilyId) as { entry_code: string }).entry_code;
    expect(getPublicFamilyDirectoryState()).toMatchObject({
      enabled: true,
      families: expect.arrayContaining([
        expect.objectContaining({ id: firstFamilyId, name: "测试一号家庭", entryCode: firstEntryCode }),
        expect.objectContaining({ id: secondFamilyId, name: "测试二号家庭" }),
      ]),
    });

    setPublicFamilyDirectory({
      enabled: false,
      requestId: "account-hide-public-family-directory",
    });
    expect(getPublicFamilyDirectoryState()).toEqual({ enabled: false, families: [] });
    expect(getActiveFamilyByEntryCode(firstEntryCode)).toMatchObject({
      id: firstFamilyId,
      name: "测试一号家庭",
    });
    expect(getSystemManagementState().settings.publicFamilyDirectoryEnabled).toBe(false);
    expect(db.prepare("SELECT action FROM system_audit_logs WHERE request_id = ?")
      .get("account-hide-public-family-directory"))
      .toEqual({ action: "public_family_directory_disabled" });

    setPublicFamilyDirectory({
      enabled: true,
      requestId: "account-show-public-family-directory",
    });
    expect(getPublicFamilyDirectoryState().enabled).toBe(true);
  });

  it("creates a case-insensitive unique boss and binds multiple families", async () => {
    bossId = await createBossAccount({
      username: "parent.one",
      displayName: "一号家长",
      password: "initial-password",
      requestId: "account-create-boss-one",
    });
    await expect(createBossAccount({
      username: "PARENT.ONE",
      displayName: "重复家长",
      password: "another-password",
      requestId: "account-create-boss-duplicate",
    })).rejects.toMatchObject({ code: "BOSS_USERNAME_EXISTS", status: 409 });

    setBossFamilyMembership({
      bossId,
      familyId: firstFamilyId,
      attached: true,
      requestId: "account-attach-family-one",
    });
    setBossFamilyMembership({
      bossId,
      familyId: firstFamilyId,
      attached: true,
      requestId: "account-attach-family-one",
    });
    setBossFamilyMembership({
      bossId,
      familyId: secondFamilyId,
      attached: true,
      requestId: "account-attach-family-two",
    });

    await expect(authenticateBoss("parent.one", "wrong-password"))
      .rejects.toMatchObject({ code: "INVALID_BOSS_CREDENTIALS", status: 401 });
    const authenticated = await authenticateBoss("PARENT.ONE", "initial-password");
    currentBossVersion = authenticated.authVersion;
    expect(authenticated.families.map((family) => family.familyId).sort())
      .toEqual([firstFamilyId, secondFamilyId].sort());
    expect(listBossMemberships(bossId, true)).toHaveLength(2);
    expect(getAuthorizedBossContext(bossId, currentBossVersion, firstFamilyId))
      .toMatchObject({ bossId, familyId: firstFamilyId, displayName: "一号家长" });
    expect(getDb().prepare(`
      SELECT COUNT(*) AS count FROM system_audit_logs WHERE request_id = ?
    `).get("account-attach-family-one")).toEqual({ count: 1 });
  });

  it("uses a family display name override while retaining an account default", async () => {
    const firstContext = {
      familyId: firstFamilyId,
      actor: { type: "boss" as const, bossId, displayName: "一号家长" },
    };
    updateBossFamilyDisplayName(firstContext, {
      displayName: "一号家庭爸爸",
      requestId: "account-family-display-name",
    });
    const aliasedContext = getAuthorizedBossContext(bossId, currentBossVersion, firstFamilyId)!;
    expect(aliasedContext).toMatchObject({
      displayName: "一号家庭爸爸",
      defaultDisplayName: "一号家长",
      familyDisplayNameOverride: "一号家庭爸爸",
    });

    updateBossDisplayName({
      familyId: firstFamilyId,
      actor: { type: "boss", bossId, displayName: aliasedContext.displayName },
    }, {
      displayName: "家长默认名称",
      requestId: "account-default-display-name",
    });
    expect(getAuthorizedBossContext(bossId, currentBossVersion, firstFamilyId)).toMatchObject({
      displayName: "一号家庭爸爸",
      defaultDisplayName: "家长默认名称",
    });
    expect(getAuthorizedBossContext(bossId, currentBossVersion, secondFamilyId)).toMatchObject({
      displayName: "家长默认名称",
      defaultDisplayName: "家长默认名称",
      familyDisplayNameOverride: null,
    });
    expect(listBossMemberships(bossId).map((family) => ({
      familyId: family.familyId,
      displayName: family.displayName,
      displayNameOverride: family.displayNameOverride,
    }))).toEqual([
      {
        familyId: firstFamilyId,
        displayName: "一号家庭爸爸",
        displayNameOverride: "一号家庭爸爸",
      },
      {
        familyId: secondFamilyId,
        displayName: "家长默认名称",
        displayNameOverride: null,
      },
    ]);
    expect(getDb().prepare(`
      SELECT action, actor_name_snapshot FROM audit_logs
      WHERE request_id IN ('account-family-display-name', 'account-default-display-name')
      ORDER BY created_at, rowid
    `).all()).toEqual([
      { action: "boss_family_display_name_updated", actor_name_snapshot: "一号家长" },
      { action: "boss_display_name_updated", actor_name_snapshot: "一号家庭爸爸" },
    ]);

    updateBossFamilyDisplayName({
      familyId: firstFamilyId,
      actor: { type: "boss", bossId, displayName: "一号家庭爸爸" },
    }, {
      displayName: null,
      requestId: "account-family-display-name-clear",
    });
    expect(getAuthorizedBossContext(bossId, currentBossVersion, firstFamilyId)).toMatchObject({
      displayName: "家长默认名称",
      familyDisplayNameOverride: null,
    });
    updateBossFamilyDisplayName({
      familyId: firstFamilyId,
      actor: { type: "boss", bossId, displayName: "家长默认名称" },
    }, {
      displayName: "一号家庭爸爸",
      requestId: "account-family-display-name-restore",
    });
  });

  it("lets a boss change their own password and invalidates the previous version", async () => {
    const originalVersion = currentBossVersion;
    const context = {
      familyId: firstFamilyId,
      actor: { type: "boss" as const, bossId, displayName: "一号家庭爸爸" },
    };
    await expect(changeBossPassword(context, {
      currentPassword: "wrong-password",
      newPassword: "self-service-password",
      requestId: "account-self-password-wrong",
    })).rejects.toMatchObject({ code: "INVALID_BOSS_CURRENT_PASSWORD", status: 401 });

    currentBossVersion = await changeBossPassword(context, {
      currentPassword: "initial-password",
      newPassword: "self-service-password",
      requestId: "account-self-password-change",
    });
    expect(currentBossVersion).toBe(originalVersion + 1);
    expect(bossAuthorizationVersionValid(bossId, originalVersion)).toBe(false);
    await expect(authenticateBoss("parent.one", "initial-password"))
      .rejects.toMatchObject({ code: "INVALID_BOSS_CREDENTIALS" });
    expect(await authenticateBoss("parent.one", "self-service-password"))
      .toMatchObject({ authVersion: currentBossVersion, displayName: "家长默认名称" });
    expect(getDb().prepare(`
      SELECT action, actor_name_snapshot, detail FROM audit_logs WHERE request_id = ?
    `).get("account-self-password-change")).toEqual({
      action: "boss_password_changed",
      actor_name_snapshot: "一号家庭爸爸",
      detail: "老板修改自己的登录密码",
    });
  });

  it("invalidates old boss authorization after password reset and account status changes", async () => {
    const originalVersion = currentBossVersion;
    await updateBossAccount({
      bossId,
      password: "replacement-password",
      requestId: "account-reset-boss-password",
    });
    expect(bossAuthorizationVersionValid(bossId, originalVersion)).toBe(false);
    await expect(authenticateBoss("parent.one", "self-service-password"))
      .rejects.toMatchObject({ code: "INVALID_BOSS_CREDENTIALS" });

    const afterReset = await authenticateBoss("parent.one", "replacement-password");
    expect(afterReset.authVersion).toBe(originalVersion + 1);
    await updateBossAccount({
      bossId,
      isActive: false,
      requestId: "account-disable-boss",
    });
    expect(bossAuthorizationVersionValid(bossId, afterReset.authVersion)).toBe(false);
    await expect(authenticateBoss("parent.one", "replacement-password"))
      .rejects.toMatchObject({ code: "BOSS_DISABLED", status: 403 });

    await updateBossAccount({
      bossId,
      isActive: true,
      requestId: "account-enable-boss",
    });
    expect(bossAuthorizationVersionValid(bossId, afterReset.authVersion)).toBe(false);
    const afterEnable = await authenticateBoss("parent.one", "replacement-password");
    currentBossVersion = afterEnable.authVersion;
    expect(currentBossVersion).toBe(afterReset.authVersion + 2);
  });

  it("revokes detached or inactive family access for bosses and workers", async () => {
    setBossFamilyMembership({
      bossId,
      familyId: firstFamilyId,
      attached: false,
      requestId: "account-detach-family-one",
    });
    expect(getAuthorizedBossContext(bossId, currentBossVersion, firstFamilyId)).toBeNull();
    expect(getAuthorizedBossContext(bossId, currentBossVersion, secondFamilyId)).not.toBeNull();

    const workerId = randomUUID();
    const passwordHash = await hashPassword("2468");
    const now = Date.now();
    getDb().prepare(`
      INSERT INTO workers(
        id, family_id, name, avatar, theme, password_hash, auth_version,
        balance_seconds, daily_reward_seconds, timezone, is_active, created_at, updated_at
      ) VALUES (?, ?, '二号家庭小朋友', 'star', 'purple', ?, 1, 0, 0, 'Asia/Shanghai', 1, ?, ?)
    `).run(workerId, secondFamilyId, passwordHash, now, now);
    expect(workerAuthorizationValid(workerId, 1, secondFamilyId)).toBe(true);

    updateFamily({
      familyId: secondFamilyId,
      status: "inactive",
      requestId: "account-disable-family-two",
    });
    expect(getAuthorizedBossContext(bossId, currentBossVersion, secondFamilyId)).toBeNull();
    expect(workerAuthorizationValid(workerId, 1, secondFamilyId)).toBe(false);
    expect(listPublicWorkers(secondFamilyId).some((worker) => worker.id === workerId)).toBe(false);
    expect(getPublicFamilyDirectoryState().families.some((family) => family.id === secondFamilyId)).toBe(false);
    await expect(authenticateWorker(workerId, "2468"))
      .rejects.toMatchObject({ code: "FAMILY_DISABLED", status: 403 });

    updateFamily({
      familyId: secondFamilyId,
      status: "active",
      requestId: "account-enable-family-two",
    });
    expect(getAuthorizedBossContext(bossId, currentBossVersion, secondFamilyId)).not.toBeNull();
    expect(workerAuthorizationValid(workerId, 1, secondFamilyId)).toBe(true);
    expect(getPublicFamilyDirectoryState().families.some((family) => family.id === secondFamilyId)).toBe(true);
  });

  it("refuses to disable a family while one of its timers is active", () => {
    const db = getDb();
    const worker = db.prepare(`
      SELECT id FROM workers WHERE family_id = ? LIMIT 1
    `).get(secondFamilyId) as { id: string };
    const activity = db.prepare(`
      SELECT id FROM consumption_activities WHERE family_id = ? ORDER BY sort_order LIMIT 1
    `).get(secondFamilyId) as { id: string };
    db.prepare(`
      INSERT INTO active_timers(
        worker_id, timer_type, assignment_id, consumption_activity_id,
        started_at, started_by, request_id
      ) VALUES (?, 'consumption', NULL, ?, ?, 'system_admin', ?)
    `).run(worker.id, activity.id, Date.now(), randomUUID());

    expect(() => updateFamily({
      familyId: secondFamilyId,
      status: "inactive",
      requestId: "account-disable-with-timer",
    })).toThrowError(/正在运行的计时/);
    expect(getSystemManagementState().families.find((family) => family.id === secondFamilyId))
      .toMatchObject({ status: "active", bossCount: 1, workerCount: 1 });
  });
});
