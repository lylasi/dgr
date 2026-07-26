import { randomBytes, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { actorAuditFields, type FamilyBusinessContext } from "@/lib/business-context";
import { getConfig } from "@/lib/config";
import {
  getDb,
  type BossAccountRow,
  type FamilyRow,
} from "@/lib/db";
import { AppError } from "@/lib/http";
import { hashPassword, verifyPassword } from "@/lib/password";

type Db = Database.Database;

type FamilySummaryRow = FamilyRow & {
  boss_count: number;
  worker_count: number;
};

type BossMembershipRow = {
  family_id: string;
  family_name: string;
  family_status: FamilyRow["status"];
  family_timezone: string;
  display_name_override: string | null;
  effective_display_name: string;
};

type SystemAuditRow = {
  id: string;
  actor: "system_admin";
  action: string;
  target_type: string;
  target_id: string | null;
  detail: string | null;
  request_id: string | null;
  created_at: number;
};

export type BossMembership = {
  familyId: string;
  familyName: string;
  familyStatus: FamilyRow["status"];
  familyTimezone: string;
  displayName: string;
  displayNameOverride: string | null;
};

export type BossContext = {
  bossId: string;
  username: string;
  displayName: string;
  defaultDisplayName: string;
  familyDisplayNameOverride: string | null;
  authVersion: number;
  familyId: string;
  familyName: string;
  familyTimezone: string;
  familyEntryCode: string;
};

export type BossSessionSummary = {
  id: string;
  username: string;
  displayName: string;
  authVersion: number;
  families: BossMembership[];
};

export type FamilyEntrySummary = {
  id: string;
  name: string;
  timezone: string;
};

export type PublicFamilyDirectoryEntry = {
  id: string;
  name: string;
  entryCode: string;
};

const PUBLIC_FAMILY_DIRECTORY_KEY = "public_family_directory_enabled";

const USERNAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u;

function requestId(value?: string) {
  return value?.trim() || randomUUID();
}

function getFamily(db: Db, familyId: string): FamilyRow {
  const family = db.prepare("SELECT * FROM families WHERE id = ?").get(familyId) as FamilyRow | undefined;
  if (!family) throw new AppError("没有找到这个家庭。", 404, "FAMILY_NOT_FOUND");
  return family;
}

function getBoss(db: Db, bossId: string): BossAccountRow {
  const boss = db.prepare("SELECT * FROM boss_accounts WHERE id = ?").get(bossId) as BossAccountRow | undefined;
  if (!boss) throw new AppError("没有找到这个老板账号。", 404, "BOSS_NOT_FOUND");
  return boss;
}

function normalizeTimezone(value?: string): string {
  const timezone = value?.trim() || getConfig().timezone;
  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone: timezone }).format(0);
  } catch {
    throw new AppError("家庭时区不是有效的 IANA 时区。", 400, "INVALID_TIMEZONE");
  }
  return timezone;
}

function normalizeUsername(value: string): string {
  const username = value.trim();
  if (username.length < 3 || username.length > 50 || !USERNAME_PATTERN.test(username)) {
    throw new AppError(
      "老板登录名需要填写 3～50 个字符，只能使用文字、数字、点、横线或下划线。",
      400,
      "INVALID_BOSS_USERNAME",
    );
  }
  return username;
}

function normalizeDisplayName(value: string): string {
  const displayName = value.trim();
  if (!displayName || displayName.length > 60) {
    throw new AppError("老板显示名称需要填写 1～60 个字符。", 400, "INVALID_BOSS_DISPLAY_NAME");
  }
  return displayName;
}

function validateBossPassword(value: string): void {
  if (value.length < 8 || value.length > 200) {
    throw new AppError("老板密码需要包含 8～200 个字符。", 400, "INVALID_BOSS_PASSWORD");
  }
}

function previousSystemAudit(db: Db, mutationId: string): SystemAuditRow | undefined {
  return db
    .prepare("SELECT * FROM system_audit_logs WHERE request_id = ?")
    .get(mutationId) as SystemAuditRow | undefined;
}

function systemAudit(
  db: Db,
  action: string,
  targetType: string,
  targetId: string | null,
  detail: string,
  mutationId: string,
  now = Date.now(),
): void {
  db.prepare(`
    INSERT INTO system_audit_logs(
      id, actor, action, target_type, target_id, detail, request_id, created_at
    ) VALUES (?, 'system_admin', ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), action, targetType, targetId, detail, mutationId, now);
}

function publicMembership(row: BossMembershipRow): BossMembership {
  return {
    familyId: row.family_id,
    familyName: row.family_name,
    familyStatus: row.family_status,
    familyTimezone: row.family_timezone,
    displayName: row.effective_display_name,
    displayNameOverride: row.display_name_override,
  };
}

export function listBossMemberships(bossId: string, activeOnly = false): BossMembership[] {
  const rows = getDb().prepare(`
    SELECT
      family.id AS family_id,
      family.name AS family_name,
      family.status AS family_status,
      family.timezone AS family_timezone,
      membership.display_name_override,
      COALESCE(membership.display_name_override, boss.display_name) AS effective_display_name
    FROM family_bosses membership
    JOIN boss_accounts boss ON boss.id = membership.boss_id
    JOIN families family ON family.id = membership.family_id
    WHERE membership.boss_id = ?
      ${activeOnly ? "AND family.status = 'active'" : ""}
    ORDER BY family.status = 'active' DESC, family.created_at, family.id
  `).all(bossId) as BossMembershipRow[];
  return rows.map(publicMembership);
}

export async function authenticateBoss(username: string, password: string) {
  const db = getDb();
  const normalizedUsername = username.trim();
  const boss = db
    .prepare("SELECT * FROM boss_accounts WHERE username = ? COLLATE NOCASE")
    .get(normalizedUsername) as BossAccountRow | undefined;
  if (!boss || !(await verifyPassword(password, boss.password_hash))) {
    throw new AppError("老板账号或密码不正确。", 401, "INVALID_BOSS_CREDENTIALS");
  }
  if (!boss.is_active) {
    throw new AppError("这个老板账号已经停用，请联系系统管理员。", 403, "BOSS_DISABLED");
  }
  const families = listBossMemberships(boss.id, true);
  if (families.length === 0) {
    throw new AppError("这个老板账号还没有可用家庭，请联系系统管理员。", 403, "BOSS_NO_ACTIVE_FAMILY");
  }
  return {
    bossId: boss.id,
    username: boss.username,
    displayName: boss.display_name,
    authVersion: boss.auth_version,
    families,
  };
}

export function bossAuthorizationVersionValid(bossId: string, authVersion: number): boolean {
  const row = getDb()
    .prepare("SELECT auth_version, is_active FROM boss_accounts WHERE id = ?")
    .get(bossId) as { auth_version: number; is_active: number } | undefined;
  return Boolean(row?.is_active && row.auth_version === authVersion);
}

export function getAuthorizedBossSummary(
  bossId: string,
  authVersion: number,
): BossSessionSummary | null {
  const boss = getDb().prepare(`
    SELECT * FROM boss_accounts
    WHERE id = ? AND auth_version = ? AND is_active = 1
  `).get(bossId, authVersion) as BossAccountRow | undefined;
  if (!boss) return null;
  const families = listBossMemberships(boss.id, true);
  if (families.length === 0) return null;
  return {
    id: boss.id,
    username: boss.username,
    displayName: boss.display_name,
    authVersion: boss.auth_version,
    families,
  };
}

export function getActiveFamilyByEntryCode(entryCode: string): FamilyEntrySummary | null {
  const code = entryCode.trim();
  if (code.length < 16 || code.length > 100) return null;
  const family = getDb().prepare(`
    SELECT id, name, timezone FROM families
    WHERE entry_code = ? AND status = 'active'
  `).get(code) as FamilyEntrySummary | undefined;
  return family || null;
}

export function getActiveFamilySummary(familyId: string): FamilyEntrySummary | null {
  const family = getDb().prepare(`
    SELECT id, name, timezone FROM families
    WHERE id = ? AND status = 'active'
  `).get(familyId) as FamilyEntrySummary | undefined;
  return family || null;
}

export function getPublicFamilyDirectoryState(): {
  enabled: boolean;
  families: PublicFamilyDirectoryEntry[];
} {
  const db = getDb();
  const setting = db.prepare("SELECT value FROM system_settings WHERE key = ?")
    .get(PUBLIC_FAMILY_DIRECTORY_KEY) as { value: string } | undefined;
  const enabled = setting?.value !== "0";
  if (!enabled) return { enabled, families: [] };
  const families = (db.prepare(`
    SELECT id, name, entry_code
    FROM families
    WHERE status = 'active'
    ORDER BY created_at, id
  `).all() as Array<{ id: string; name: string; entry_code: string }>).map((family) => ({
    id: family.id,
    name: family.name,
    entryCode: family.entry_code,
  }));
  return { enabled, families };
}

export function getAuthorizedBossContext(
  bossId: string,
  authVersion: number,
  familyId: string,
): BossContext | null {
  const row = getDb().prepare(`
    SELECT
      boss.id AS boss_id,
      boss.username,
      boss.display_name AS default_display_name,
      membership.display_name_override,
      COALESCE(membership.display_name_override, boss.display_name) AS effective_display_name,
      boss.auth_version,
      family.id AS family_id,
      family.name AS family_name,
      family.timezone AS family_timezone,
      family.entry_code AS family_entry_code
    FROM boss_accounts boss
    JOIN family_bosses membership ON membership.boss_id = boss.id
    JOIN families family ON family.id = membership.family_id
    WHERE boss.id = ? AND boss.auth_version = ? AND boss.is_active = 1
      AND family.id = ? AND family.status = 'active'
  `).get(bossId, authVersion, familyId) as {
    boss_id: string;
    username: string;
    default_display_name: string;
    display_name_override: string | null;
    effective_display_name: string;
    auth_version: number;
    family_id: string;
    family_name: string;
    family_timezone: string;
    family_entry_code: string;
  } | undefined;
  if (!row) return null;
  return {
    bossId: row.boss_id,
    username: row.username,
    displayName: row.effective_display_name,
    defaultDisplayName: row.default_display_name,
    familyDisplayNameOverride: row.display_name_override,
    authVersion: row.auth_version,
    familyId: row.family_id,
    familyName: row.family_name,
    familyTimezone: row.family_timezone,
    familyEntryCode: row.family_entry_code,
  };
}

function requireBossFamilyContext(context: FamilyBusinessContext) {
  if (context.actor.type !== "boss") {
    throw new AppError("只有当前家庭的老板可以修改家庭资料。", 403, "BOSS_REQUIRED");
  }
  return context.actor;
}

function familyAudit(
  db: Db,
  context: FamilyBusinessContext,
  action: string,
  detail: string,
  mutationId: string,
  now: number,
  targetType = "family",
  targetId = context.familyId,
) {
  const actor = actorAuditFields(context.actor);
  db.prepare(`
    INSERT INTO audit_logs(
      id, family_id, actor, actor_type, actor_id, actor_name_snapshot,
      acting_for_worker_id, action, target_type, target_id, detail,
      request_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    context.familyId,
    actor.key,
    actor.type,
    actor.id,
    actor.name,
    actor.actingForWorkerId,
    action,
    targetType,
    targetId,
    detail,
    mutationId,
    now,
  );
}

export function updateBossDisplayName(
  context: FamilyBusinessContext,
  input: { displayName: string; requestId?: string },
) {
  const actor = requireBossFamilyContext(context);
  const displayName = normalizeDisplayName(input.displayName);
  const mutationId = requestId(input.requestId);
  const db = getDb();
  db.transaction(() => {
    if (db.prepare("SELECT 1 FROM audit_logs WHERE request_id = ?").get(mutationId)) return;
    const boss = getBoss(db, actor.bossId);
    if (!boss.is_active) {
      throw new AppError("这个老板账号已经停用。", 403, "BOSS_DISABLED");
    }
    const now = Date.now();
    db.prepare("UPDATE boss_accounts SET display_name = ?, updated_at = ? WHERE id = ?")
      .run(displayName, now, boss.id);
    familyAudit(
      db,
      context,
      "boss_display_name_updated",
      `修改老板账号默认名称：${boss.display_name} → ${displayName}`,
      mutationId,
      now,
      "boss",
      boss.id,
    );
  }).immediate();
}

export function updateBossFamilyDisplayName(
  context: FamilyBusinessContext,
  input: { displayName: string | null; requestId?: string },
) {
  const actor = requireBossFamilyContext(context);
  const displayName = input.displayName === null ? null : normalizeDisplayName(input.displayName);
  const mutationId = requestId(input.requestId);
  const db = getDb();
  db.transaction(() => {
    if (db.prepare("SELECT 1 FROM audit_logs WHERE request_id = ?").get(mutationId)) return;
    const boss = getBoss(db, actor.bossId);
    if (!boss.is_active) {
      throw new AppError("这个老板账号已经停用。", 403, "BOSS_DISABLED");
    }
    const membership = db.prepare(`
      SELECT display_name_override
      FROM family_bosses
      WHERE family_id = ? AND boss_id = ?
    `).get(context.familyId, boss.id) as { display_name_override: string | null } | undefined;
    if (!membership) {
      throw new AppError("这个老板不属于当前家庭。", 403, "BOSS_FAMILY_FORBIDDEN");
    }
    const previousDisplayName = membership.display_name_override || boss.display_name;
    const nextDisplayName = displayName || boss.display_name;
    const now = Date.now();
    db.prepare(`
      UPDATE family_bosses SET display_name_override = ?
      WHERE family_id = ? AND boss_id = ?
    `).run(displayName, context.familyId, boss.id);
    familyAudit(
      db,
      context,
      "boss_family_display_name_updated",
      displayName
        ? `修改本家庭显示名称：${previousDisplayName} → ${nextDisplayName}`
        : `本家庭显示名称恢复账号默认：${previousDisplayName} → ${nextDisplayName}`,
      mutationId,
      now,
      "boss",
      boss.id,
    );
  }).immediate();
}

export async function changeBossPassword(
  context: FamilyBusinessContext,
  input: { currentPassword: string; newPassword: string; requestId?: string },
): Promise<number> {
  const actor = requireBossFamilyContext(context);
  validateBossPassword(input.newPassword);
  const mutationId = requestId(input.requestId);
  const db = getDb();
  const previous = db.prepare("SELECT action FROM audit_logs WHERE request_id = ?")
    .get(mutationId) as { action: string } | undefined;
  if (previous) {
    if (previous.action !== "boss_password_changed") {
      throw new AppError("这个请求编号已经用于其他操作。", 409, "REQUEST_ID_REUSED");
    }
    return getBoss(db, actor.bossId).auth_version;
  }

  const boss = getBoss(db, actor.bossId);
  if (!boss.is_active) {
    throw new AppError("这个老板账号已经停用。", 403, "BOSS_DISABLED");
  }
  if (!(await verifyPassword(input.currentPassword, boss.password_hash))) {
    throw new AppError("当前密码不正确。", 401, "INVALID_BOSS_CURRENT_PASSWORD");
  }
  if (await verifyPassword(input.newPassword, boss.password_hash)) {
    throw new AppError("新密码不能和当前密码相同。", 400, "BOSS_PASSWORD_UNCHANGED");
  }
  const passwordHash = await hashPassword(input.newPassword);

  return db.transaction(() => {
    const duplicate = db.prepare("SELECT action FROM audit_logs WHERE request_id = ?")
      .get(mutationId) as { action: string } | undefined;
    if (duplicate) {
      if (duplicate.action !== "boss_password_changed") {
        throw new AppError("这个请求编号已经用于其他操作。", 409, "REQUEST_ID_REUSED");
      }
      return getBoss(db, actor.bossId).auth_version;
    }
    const current = getBoss(db, actor.bossId);
    if (
      !current.is_active
      || current.auth_version !== boss.auth_version
      || current.password_hash !== boss.password_hash
    ) {
      throw new AppError("账号状态已经变化，请重新登录后再修改密码。", 409, "BOSS_ACCOUNT_CHANGED");
    }
    const now = Date.now();
    const authVersion = current.auth_version + 1;
    db.prepare(`
      UPDATE boss_accounts
      SET password_hash = ?, auth_version = ?, updated_at = ?
      WHERE id = ?
    `).run(passwordHash, authVersion, now, current.id);
    familyAudit(
      db,
      context,
      "boss_password_changed",
      "老板修改自己的登录密码",
      mutationId,
      now,
      "boss",
      current.id,
    );
    return authVersion;
  }).immediate();
}

export function updateBossFamilyName(
  context: FamilyBusinessContext,
  input: { name: string; requestId?: string },
) {
  requireBossFamilyContext(context);
  const name = input.name.trim();
  if (!name || name.length > 60) {
    throw new AppError("家庭名称需要填写 1～60 个字符。", 400, "INVALID_FAMILY_NAME");
  }
  const mutationId = requestId(input.requestId);
  const db = getDb();
  db.transaction(() => {
    if (db.prepare("SELECT 1 FROM audit_logs WHERE request_id = ?").get(mutationId)) return;
    const family = getFamily(db, context.familyId);
    if (family.status !== "active") {
      throw new AppError("这个家庭已经停用。", 403, "FAMILY_DISABLED");
    }
    const now = Date.now();
    db.prepare("UPDATE families SET name = ?, updated_at = ? WHERE id = ?")
      .run(name, now, family.id);
    familyAudit(db, context, "family_name_updated", `修改家庭名称：${family.name} → ${name}`, mutationId, now);
  }).immediate();
}

export function rotateBossFamilyEntryCode(
  context: FamilyBusinessContext,
  input: { requestId?: string },
) {
  requireBossFamilyContext(context);
  const mutationId = requestId(input.requestId);
  const db = getDb();
  db.transaction(() => {
    if (db.prepare("SELECT 1 FROM audit_logs WHERE request_id = ?").get(mutationId)) return;
    const family = getFamily(db, context.familyId);
    if (family.status !== "active") {
      throw new AppError("这个家庭已经停用。", 403, "FAMILY_DISABLED");
    }
    const now = Date.now();
    db.prepare("UPDATE families SET entry_code = ?, updated_at = ? WHERE id = ?")
      .run(randomBytes(18).toString("base64url"), now, family.id);
    familyAudit(db, context, "family_entry_code_rotated", `老板轮换家庭入口：${family.name}`, mutationId, now);
  }).immediate();
}

export function getSystemManagementState() {
  const db = getDb();
  const directory = getPublicFamilyDirectoryState();
  const families = (db.prepare(`
    SELECT family.*,
      COUNT(DISTINCT membership.boss_id) AS boss_count,
      COUNT(DISTINCT worker.id) AS worker_count
    FROM families family
    LEFT JOIN family_bosses membership ON membership.family_id = family.id
    LEFT JOIN workers worker ON worker.family_id = family.id
    GROUP BY family.id
    ORDER BY family.status = 'active' DESC, family.created_at, family.id
  `).all() as FamilySummaryRow[]).map((family) => ({
    id: family.id,
    name: family.name,
    timezone: family.timezone,
    status: family.status,
    entryCode: family.entry_code,
    bossCount: family.boss_count,
    workerCount: family.worker_count,
    createdAt: family.created_at,
    updatedAt: family.updated_at,
  }));
  const bosses = (db.prepare(`
    SELECT * FROM boss_accounts
    ORDER BY is_active DESC, created_at, id
  `).all() as BossAccountRow[]).map((boss) => ({
    id: boss.id,
    username: boss.username,
    displayName: boss.display_name,
    authVersion: boss.auth_version,
    isActive: Boolean(boss.is_active),
    families: listBossMemberships(boss.id),
    createdAt: boss.created_at,
    updatedAt: boss.updated_at,
  }));
  const auditLogs = (db.prepare(`
    SELECT * FROM system_audit_logs
    ORDER BY created_at DESC, id DESC
    LIMIT 100
  `).all() as SystemAuditRow[]).map((row) => ({
    id: row.id,
    actor: row.actor,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    detail: row.detail,
    createdAt: row.created_at,
  }));
  return {
    settings: { publicFamilyDirectoryEnabled: directory.enabled },
    families,
    bosses,
    auditLogs,
  };
}

export function setPublicFamilyDirectory(input: {
  enabled: boolean;
  requestId?: string;
}) {
  const mutationId = requestId(input.requestId);
  const db = getDb();
  db.transaction(() => {
    if (previousSystemAudit(db, mutationId)) return;
    const now = Date.now();
    db.prepare(`
      INSERT INTO system_settings(key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(PUBLIC_FAMILY_DIRECTORY_KEY, input.enabled ? "1" : "0", now);
    systemAudit(
      db,
      input.enabled ? "public_family_directory_enabled" : "public_family_directory_disabled",
      "system_setting",
      PUBLIC_FAMILY_DIRECTORY_KEY,
      input.enabled ? "开启首页家庭选择" : "关闭首页家庭选择",
      mutationId,
      now,
    );
  }).immediate();
}

export function createFamily(input: {
  name: string;
  timezone?: string;
  requestId?: string;
}) {
  const name = input.name.trim();
  if (!name || name.length > 60) {
    throw new AppError("家庭名称需要填写 1～60 个字符。", 400, "INVALID_FAMILY_NAME");
  }
  const timezone = normalizeTimezone(input.timezone);
  const mutationId = requestId(input.requestId);
  const db = getDb();
  return db.transaction(() => {
    const previous = previousSystemAudit(db, mutationId);
    if (previous?.target_id) return previous.target_id;
    const id = randomUUID();
    const now = Date.now();
    db.prepare(`
      INSERT INTO families(id, name, timezone, status, entry_code, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?)
    `).run(id, name, timezone, randomBytes(18).toString("base64url"), now, now);
    db.prepare(`
      INSERT INTO app_settings(family_id, key, value, updated_at)
      VALUES (?, 'reward_system_enabled', '1', ?)
    `).run(id, now);
    const activity = db.prepare(`
      INSERT INTO consumption_activities(
        id, family_id, name, icon, sort_order, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `);
    activity.run(randomUUID(), id, "玩游戏", "gamepad", 10, now, now);
    activity.run(randomUUID(), id, "看视频", "video", 20, now, now);
    systemAudit(db, "family_created", "family", id, `创建家庭：${name}`, mutationId, now);
    return id;
  }).immediate();
}

export function updateFamily(input: {
  familyId: string;
  name?: string;
  timezone?: string;
  status?: FamilyRow["status"];
  requestId?: string;
}) {
  const mutationId = requestId(input.requestId);
  const db = getDb();
  return db.transaction(() => {
    if (previousSystemAudit(db, mutationId)) return;
    const family = getFamily(db, input.familyId);
    const name = input.name === undefined ? family.name : input.name.trim();
    if (!name || name.length > 60) {
      throw new AppError("家庭名称需要填写 1～60 个字符。", 400, "INVALID_FAMILY_NAME");
    }
    const timezone = input.timezone === undefined ? family.timezone : normalizeTimezone(input.timezone);
    const status = input.status ?? family.status;
    if (status === "inactive" && family.status !== "inactive") {
      const activeTimer = db.prepare(`
        SELECT 1
        FROM active_timers timer
        JOIN workers worker ON worker.id = timer.worker_id
        WHERE worker.family_id = ?
        LIMIT 1
      `).get(family.id);
      if (activeTimer) {
        throw new AppError("请先结束这个家庭正在运行的计时，再停用家庭。", 409, "FAMILY_TIMER_ACTIVE");
      }
    }
    const now = Date.now();
    db.prepare(`
      UPDATE families SET name = ?, timezone = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(name, timezone, status, now, family.id);
    systemAudit(
      db,
      status === "inactive" ? "family_disabled" : family.status === "inactive" ? "family_enabled" : "family_updated",
      "family",
      family.id,
      `更新家庭：${name}`,
      mutationId,
      now,
    );
  }).immediate();
}

export function rotateFamilyEntryCode(input: {
  familyId: string;
  requestId?: string;
}) {
  const mutationId = requestId(input.requestId);
  const db = getDb();
  return db.transaction(() => {
    const previous = previousSystemAudit(db, mutationId);
    if (previous?.target_id) {
      return getFamily(db, previous.target_id).entry_code;
    }
    const family = getFamily(db, input.familyId);
    const entryCode = randomBytes(18).toString("base64url");
    const now = Date.now();
    db.prepare("UPDATE families SET entry_code = ?, updated_at = ? WHERE id = ?")
      .run(entryCode, now, family.id);
    systemAudit(
      db,
      "family_entry_code_rotated",
      "family",
      family.id,
      `轮换家庭入口：${family.name}`,
      mutationId,
      now,
    );
    return entryCode;
  }).immediate();
}

export async function createBossAccount(input: {
  username: string;
  displayName: string;
  password: string;
  requestId?: string;
}) {
  const username = normalizeUsername(input.username);
  const displayName = normalizeDisplayName(input.displayName);
  validateBossPassword(input.password);
  const mutationId = requestId(input.requestId);
  const db = getDb();
  const previous = previousSystemAudit(db, mutationId);
  if (previous?.target_id) return previous.target_id;
  const passwordHash = await hashPassword(input.password);
  return db.transaction(() => {
    const duplicate = previousSystemAudit(db, mutationId);
    if (duplicate?.target_id) return duplicate.target_id;
    const id = randomUUID();
    const now = Date.now();
    try {
      db.prepare(`
        INSERT INTO boss_accounts(
          id, username, display_name, password_hash, auth_version,
          is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 1, 1, ?, ?)
      `).run(id, username, displayName, passwordHash, now, now);
    } catch (error) {
      if (String(error).includes("boss_accounts.username")) {
        throw new AppError("这个老板登录名已经被使用。", 409, "BOSS_USERNAME_EXISTS");
      }
      throw error;
    }
    systemAudit(db, "boss_created", "boss", id, `创建老板：${displayName}（${username}）`, mutationId, now);
    return id;
  }).immediate();
}

export async function updateBossAccount(input: {
  bossId: string;
  username?: string;
  displayName?: string;
  password?: string;
  isActive?: boolean;
  requestId?: string;
}) {
  const mutationId = requestId(input.requestId);
  const db = getDb();
  if (previousSystemAudit(db, mutationId)) return;
  const current = getBoss(db, input.bossId);
  const username = input.username === undefined ? current.username : normalizeUsername(input.username);
  const displayName = input.displayName === undefined
    ? current.display_name
    : normalizeDisplayName(input.displayName);
  if (input.password !== undefined) validateBossPassword(input.password);
  const passwordHash = input.password === undefined ? null : await hashPassword(input.password);
  db.transaction(() => {
    if (previousSystemAudit(db, mutationId)) return;
    const boss = getBoss(db, input.bossId);
    const nextActive = input.isActive === undefined ? boss.is_active : input.isActive ? 1 : 0;
    const invalidateSessions = Boolean(passwordHash) || nextActive !== boss.is_active;
    const now = Date.now();
    try {
      db.prepare(`
        UPDATE boss_accounts SET
          username = ?, display_name = ?, password_hash = ?, auth_version = ?,
          is_active = ?, updated_at = ?
        WHERE id = ?
      `).run(
        username,
        displayName,
        passwordHash || boss.password_hash,
        invalidateSessions ? boss.auth_version + 1 : boss.auth_version,
        nextActive,
        now,
        boss.id,
      );
    } catch (error) {
      if (String(error).includes("boss_accounts.username")) {
        throw new AppError("这个老板登录名已经被使用。", 409, "BOSS_USERNAME_EXISTS");
      }
      throw error;
    }
    systemAudit(
      db,
      nextActive ? "boss_updated" : "boss_disabled",
      "boss",
      boss.id,
      `更新老板：${displayName}（${username}）`,
      mutationId,
      now,
    );
  }).immediate();
}

export function setBossFamilyMembership(input: {
  bossId: string;
  familyId: string;
  attached: boolean;
  requestId?: string;
}) {
  const mutationId = requestId(input.requestId);
  const db = getDb();
  db.transaction(() => {
    if (previousSystemAudit(db, mutationId)) return;
    const boss = getBoss(db, input.bossId);
    const family = getFamily(db, input.familyId);
    const now = Date.now();
    if (input.attached) {
      db.prepare(`
        INSERT OR IGNORE INTO family_bosses(family_id, boss_id, created_at)
        VALUES (?, ?, ?)
      `).run(family.id, boss.id, now);
    } else {
      db.prepare("DELETE FROM family_bosses WHERE family_id = ? AND boss_id = ?")
        .run(family.id, boss.id);
    }
    systemAudit(
      db,
      input.attached ? "boss_family_attached" : "boss_family_detached",
      "boss",
      boss.id,
      `${input.attached ? "绑定" : "解除"}家庭：${family.name}`,
      mutationId,
      now,
    );
  }).immediate();
}

export function getBossPortalState(context: BossContext) {
  return {
    boss: {
      id: context.bossId,
      username: context.username,
      displayName: context.displayName,
      defaultDisplayName: context.defaultDisplayName,
      familyDisplayNameOverride: context.familyDisplayNameOverride,
    },
    family: {
      id: context.familyId,
      name: context.familyName,
      timezone: context.familyTimezone,
      entryCode: context.familyEntryCode,
    },
    families: listBossMemberships(context.bossId, true),
    businessAccess: "family_business" as const,
  };
}
