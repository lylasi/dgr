import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getConfig } from "@/lib/config";
import {
  getDb,
  type ActiveTimerRow,
  type AssignmentRow,
  type RewardRequestRow,
  type TaskRow,
  type WorkerAvatarImageRow,
  type WorkerRow,
} from "@/lib/db";
import { AppError } from "@/lib/http";
import { hashPassword, verifyPassword } from "@/lib/password";
import {
  getPublicAssignmentRewardItems,
  getPublicTaskRewardBindings,
  getAdminRewardState,
  getWorkerRewardState,
  grantAssignmentRewardsWithin,
  grantDailyCouponsWithin,
  replaceTaskRewardBindingsWithin,
  snapshotAssignmentRewardsWithin,
  type TaskRewardBindingInput,
} from "@/lib/reward-service";
import { dateKey, elapsedSeconds } from "@/lib/time";

type Db = Database.Database;
type Actor = "admin" | `worker:${string}` | "system";

type ConsumptionRow = {
  id: string;
  name: string;
  icon: string;
  sort_order: number;
  is_active: number;
  created_at: number;
  updated_at: number;
};

type TransactionRow = {
  id: string;
  worker_id: string;
  type: "daily_reward" | "task_reward" | "consumption" | "admin_adjustment" | "coupon_reward";
  title: string;
  amount_seconds: number;
  balance_after_seconds: number;
  assignment_id: string | null;
  consumption_activity_id: string | null;
  reward_item_id: string | null;
  actor: Actor;
  reason: string | null;
  request_id: string | null;
  started_at: number | null;
  ended_at: number | null;
  created_at: number;
  is_reversed?: number;
  reversal_of_transaction_id?: string | null;
};

function uniqueId() {
  return randomUUID();
}

function requestId(value?: string) {
  return value?.trim() || uniqueId();
}

function actorForWorker(workerId: string): Actor {
  return `worker:${workerId}`;
}

function assertActorCanManageWorker(actor: Actor, workerId: string) {
  if (actor !== "admin" && actor !== actorForWorker(workerId)) {
    throw new AppError("不能操作别人的记录。", 403, "FORBIDDEN");
  }
}

function getWorkerRow(db: Db, workerId: string, includeInactive = false): WorkerRow {
  const worker = db.prepare("SELECT * FROM workers WHERE id = ?").get(workerId) as WorkerRow | undefined;
  if (!worker || (!includeInactive && !worker.is_active)) {
    throw new AppError("没有找到这个打工人。", 404, "WORKER_NOT_FOUND");
  }
  return worker;
}

function getAssignmentRow(db: Db, assignmentId: string): AssignmentRow {
  const assignment = db
    .prepare("SELECT * FROM task_assignments WHERE id = ?")
    .get(assignmentId) as AssignmentRow | undefined;
  if (!assignment) throw new AppError("没有找到这个任务记录。", 404, "ASSIGNMENT_NOT_FOUND");
  return assignment;
}

function getTaskRow(db: Db, taskId: string): TaskRow {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as TaskRow | undefined;
  if (!task) throw new AppError("没有找到这个任务。", 404, "TASK_NOT_FOUND");
  return task;
}

function getRewardRequestRow(db: Db, rewardRequestId: string): RewardRequestRow {
  const rewardRequest = db
    .prepare("SELECT * FROM reward_requests WHERE id = ?")
    .get(rewardRequestId) as RewardRequestRow | undefined;
  if (!rewardRequest) {
    throw new AppError("没有找到这条奖励申报。", 404, "REWARD_REQUEST_NOT_FOUND");
  }
  return rewardRequest;
}

function audit(
  db: Db,
  actor: Actor,
  action: string,
  targetType: string,
  targetId: string | null,
  detail: string | null,
  mutationId?: string,
) {
  db.prepare(`
    INSERT INTO audit_logs(id, actor, action, target_type, target_id, detail, request_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uniqueId(), actor, action, targetType, targetId, detail, mutationId || null, Date.now());
}

function insertTransaction(
  db: Db,
  values: {
    id?: string;
    workerId: string;
    type: TransactionRow["type"];
    title: string;
    amountSeconds: number;
    balanceAfter: number;
    assignmentId?: string | null;
    consumptionActivityId?: string | null;
    actor: Actor;
    reason?: string | null;
    requestId?: string | null;
    startedAt?: number | null;
    endedAt?: number | null;
    createdAt?: number;
  },
) {
  const id = values.id || uniqueId();
  db.prepare(`
    INSERT INTO transactions(
      id, worker_id, type, title, amount_seconds, balance_after_seconds,
      assignment_id, consumption_activity_id, actor, reason, request_id,
      started_at, ended_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    values.workerId,
    values.type,
    values.title,
    values.amountSeconds,
    values.balanceAfter,
    values.assignmentId || null,
    values.consumptionActivityId || null,
    values.actor,
    values.reason || null,
    values.requestId || null,
    values.startedAt || null,
    values.endedAt || null,
    values.createdAt || Date.now(),
  );
  return id;
}

function timerTitle(db: Db, timer: ActiveTimerRow): string {
  if (timer.timer_type === "reward_task") {
    const row = db
      .prepare("SELECT title_snapshot FROM task_assignments WHERE id = ?")
      .get(timer.assignment_id) as { title_snapshot: string } | undefined;
    return row?.title_snapshot || "奖励任务";
  }
  const row = db
    .prepare("SELECT name FROM consumption_activities WHERE id = ?")
    .get(timer.consumption_activity_id) as { name: string } | undefined;
  return row?.name || "消耗任务";
}

function stopTimerWithin(
  db: Db,
  timer: ActiveTimerRow,
  actor: Actor,
  endedAt: number,
  mutationId: string,
) {
  const worker = getWorkerRow(db, timer.worker_id, true);
  const elapsed = elapsedSeconds(timer.started_at, endedAt);
  let duration = elapsed;
  let actualEnd = endedAt;
  let transactionId: string | null = null;

  if (timer.timer_type === "consumption") {
    duration = Math.min(elapsed, worker.balance_seconds);
    if (worker.balance_seconds > 0 && elapsed >= worker.balance_seconds) {
      actualEnd = timer.started_at + worker.balance_seconds * 1000;
    }
  }

  db.prepare(`
    INSERT INTO timer_segments(
      id, worker_id, timer_type, assignment_id, consumption_activity_id,
      started_at, ended_at, duration_seconds, started_by, ended_by, request_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uniqueId(),
    timer.worker_id,
    timer.timer_type,
    timer.assignment_id,
    timer.consumption_activity_id,
    timer.started_at,
    actualEnd,
    duration,
    timer.started_by,
    actor,
    mutationId,
    endedAt,
  );

  db.prepare("DELETE FROM active_timers WHERE worker_id = ?").run(timer.worker_id);

  if (timer.timer_type === "reward_task") {
    db.prepare(`
      UPDATE task_assignments
      SET status = CASE WHEN status = 'in_progress' THEN 'claimed' ELSE status END,
          updated_at = ?, version = version + 1
      WHERE id = ?
    `).run(endedAt, timer.assignment_id);
  } else if (duration > 0) {
    const nextBalance = worker.balance_seconds - duration;
    db.prepare("UPDATE workers SET balance_seconds = ?, updated_at = ? WHERE id = ?")
      .run(nextBalance, endedAt, worker.id);
    transactionId = insertTransaction(db, {
      workerId: worker.id,
      type: "consumption",
      title: timerTitle(db, timer),
      amountSeconds: -duration,
      balanceAfter: nextBalance,
      consumptionActivityId: timer.consumption_activity_id,
      actor,
      requestId: mutationId,
      startedAt: timer.started_at,
      endedAt: actualEnd,
      createdAt: endedAt,
    });
  }

  return { durationSeconds: duration, endedAt: actualEnd, transactionId };
}

function reconcileExpiredConsumption(db: Db, workerId: string, now: number) {
  const timer = db
    .prepare("SELECT * FROM active_timers WHERE worker_id = ?")
    .get(workerId) as ActiveTimerRow | undefined;
  if (!timer || timer.timer_type !== "consumption") return false;
  const worker = getWorkerRow(db, workerId, true);
  if (elapsedSeconds(timer.started_at, now) < worker.balance_seconds && worker.balance_seconds > 0) {
    return false;
  }
  stopTimerWithin(db, timer, "system", now, `auto-end:${timer.request_id}`);
  audit(db, "system", "timer_auto_stopped", "worker", workerId, "余额已用完，自动结束消耗计时");
  return true;
}

function grantDailyReward(db: Db, workerId: string, now: number) {
  const worker = getWorkerRow(db, workerId);
  const rewardDate = dateKey(now, worker.timezone);
  const existing = db
    .prepare("SELECT id FROM daily_grants WHERE worker_id = ? AND reward_date = ?")
    .get(workerId, rewardDate);
  if (existing) return false;

  const grantId = uniqueId();
  let transactionId: string | null = null;
  if (worker.daily_reward_seconds > 0) {
    const nextBalance = worker.balance_seconds + worker.daily_reward_seconds;
    db.prepare("UPDATE workers SET balance_seconds = ?, updated_at = ? WHERE id = ?")
      .run(nextBalance, now, workerId);
    transactionId = insertTransaction(db, {
      workerId,
      type: "daily_reward",
      title: "每日固定奖励",
      amountSeconds: worker.daily_reward_seconds,
      balanceAfter: nextBalance,
      actor: "system",
      requestId: `daily:${workerId}:${rewardDate}`,
      createdAt: now,
    });
  }

  db.prepare(`
    INSERT INTO daily_grants(id, worker_id, reward_date, amount_seconds, transaction_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(grantId, workerId, rewardDate, worker.daily_reward_seconds, transactionId, now);
  return true;
}

function syncWorkerWithin(db: Db, workerId: string, now = Date.now()) {
  reconcileExpiredConsumption(db, workerId, now);
  grantDailyReward(db, workerId, now);
  grantDailyCouponsWithin(db, workerId, now);
}

export function syncWorker(workerId: string, now = Date.now()) {
  const db = getDb();
  return db.transaction(() => syncWorkerWithin(db, workerId, now)).immediate();
}

function workerAvatarUrl(db: Db, workerId: string): string | null {
  const row = db
    .prepare("SELECT updated_at FROM worker_avatar_images WHERE worker_id = ?")
    .get(workerId) as { updated_at: number } | undefined;
  return row ? `/api/avatar/${workerId}?v=${row.updated_at}` : null;
}

function publicWorker(db: Db, worker: WorkerRow) {
  return {
    id: worker.id,
    name: worker.name,
    avatar: worker.avatar,
    theme: worker.theme,
    avatarUrl: workerAvatarUrl(db, worker.id),
    authVersion: worker.auth_version,
    balanceSeconds: worker.balance_seconds,
    dailyRewardSeconds: worker.daily_reward_seconds,
    timezone: worker.timezone,
    isActive: Boolean(worker.is_active),
  };
}

function publicTask(db: Db, task: TaskRow) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    rewardSeconds: task.reward_seconds,
    targetWorkerId: task.target_worker_id,
    timingMode: task.timing_mode,
    minimumDurationSeconds: task.minimum_duration_seconds,
    bonusEnabled: Boolean(task.bonus_enabled),
    excellentMultiplier: task.excellent_multiplier_bps / 10_000,
    bonusCriteria: task.bonus_criteria,
    availableFrom: task.available_from,
    dueAt: task.due_at,
    status: task.status,
    createdAt: task.created_at,
    rewardBindings: getPublicTaskRewardBindings(db, task.id),
  };
}

function assignmentDuration(db: Db, assignmentId: string): number {
  const row = db
    .prepare(`
      SELECT MAX(
        0,
        COALESCE((SELECT SUM(duration_seconds) FROM timer_segments WHERE assignment_id = ?), 0)
        + COALESCE((SELECT SUM(delta_seconds) FROM timer_adjustments WHERE assignment_id = ?), 0)
      ) AS total
    `)
    .get(assignmentId, assignmentId) as { total: number };
  return row.total;
}

function publicAssignment(db: Db, assignment: AssignmentRow) {
  return {
    id: assignment.id,
    taskId: assignment.task_id,
    workerId: assignment.worker_id,
    title: assignment.title_snapshot,
    description: assignment.description_snapshot,
    rewardSeconds: assignment.reward_seconds,
    timingMode: assignment.timing_mode,
    minimumDurationSeconds: assignment.minimum_duration_seconds,
    bonusEnabled: Boolean(assignment.bonus_enabled),
    excellentMultiplier: assignment.excellent_multiplier_bps / 10_000,
    bonusCriteria: assignment.bonus_criteria,
    dueAt: assignment.due_at,
    status: assignment.status,
    submissionNote: assignment.submission_note,
    reviewMultiplier: assignment.review_multiplier,
    reviewTier: assignment.review_tier,
    reviewNote: assignment.review_note,
    reviewedAt: assignment.reviewed_at,
    claimedAt: assignment.claimed_at,
    submittedAt: assignment.submitted_at,
    durationSeconds: assignmentDuration(db, assignment.id),
    rewardItems: getPublicAssignmentRewardItems(db, assignment.id),
  };
}

function publicTimer(db: Db, timer: ActiveTimerRow | undefined) {
  if (!timer) return null;
  return {
    workerId: timer.worker_id,
    type: timer.timer_type,
    assignmentId: timer.assignment_id,
    consumptionActivityId: timer.consumption_activity_id,
    startedAt: timer.started_at,
    startedBy: timer.started_by,
    title: timerTitle(db, timer),
  };
}

function publicActivity(activity: ConsumptionRow) {
  return {
    id: activity.id,
    name: activity.name,
    icon: activity.icon,
    sortOrder: activity.sort_order,
    isActive: Boolean(activity.is_active),
  };
}

function publicRewardRequest(row: RewardRequestRow, workerName?: string) {
  return {
    id: row.id,
    workerId: row.worker_id,
    workerName,
    title: row.title,
    description: row.description,
    rewardSeconds: row.reward_seconds,
    status: row.status,
    reviewNote: row.review_note,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicTransaction(row: TransactionRow, workerName?: string) {
  return {
    id: row.id,
    workerId: row.worker_id,
    workerName,
    type: row.type,
    title: row.title,
    amountSeconds: row.amount_seconds,
    balanceAfterSeconds: row.balance_after_seconds,
    actor: row.actor,
    reason: row.reason,
    rewardItemId: row.reward_item_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    isReversed: Boolean(row.is_reversed),
    reversalOfTransactionId: row.reversal_of_transaction_id || null,
  };
}

export function listPublicWorkers() {
  const db = getDb();
  return (db
    .prepare("SELECT * FROM workers WHERE is_active = 1 ORDER BY created_at")
    .all() as WorkerRow[]).map((worker) => ({
    id: worker.id,
    name: worker.name,
    avatar: worker.avatar,
    theme: worker.theme,
    avatarUrl: workerAvatarUrl(db, worker.id),
    authVersion: worker.auth_version,
  }));
}

function avatarMime(data: Buffer): WorkerAvatarImageRow["mime_type"] | null {
  if (data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return "image/png";
  }
  if (data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255) {
    return "image/jpeg";
  }
  return null;
}

export function setWorkerAvatarImage(input: {
  workerId: string;
  imageDataUrl: string;
  requestId?: string;
}) {
  const db = getDb();
  const mutationId = requestId(input.requestId);
  const now = Date.now();
  const match = /^data:image\/(?:webp|png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(input.imageDataUrl);
  if (!match) throw new AppError("头像格式不正确，请选择 JPG、PNG 或 WebP 图片。", 400, "INVALID_AVATAR_IMAGE");
  const imageData = Buffer.from(match[1], "base64");
  const mimeType = avatarMime(imageData);
  if (!mimeType) throw new AppError("无法识别这张头像图片。", 400, "INVALID_AVATAR_IMAGE");
  if (imageData.length > 512 * 1024) {
    throw new AppError("压缩后的头像不能超过 512KB。", 400, "AVATAR_TOO_LARGE");
  }

  db.transaction(() => {
    getWorkerRow(db, input.workerId, true);
    db.prepare(`
      INSERT INTO worker_avatar_images(worker_id, mime_type, image_data, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(worker_id) DO UPDATE SET
        mime_type = excluded.mime_type,
        image_data = excluded.image_data,
        updated_at = excluded.updated_at
    `).run(input.workerId, mimeType, imageData, now);
    db.prepare("UPDATE workers SET updated_at = ? WHERE id = ?").run(now, input.workerId);
    audit(db, "admin", "worker_avatar_updated", "worker", input.workerId, `更新头像：${mimeType}，${imageData.length} 字节`, mutationId);
  })();
  return workerAvatarUrl(db, input.workerId);
}

export function removeWorkerAvatarImage(workerId: string, mutationId?: string) {
  const db = getDb();
  const id = requestId(mutationId);
  const now = Date.now();
  db.transaction(() => {
    getWorkerRow(db, workerId, true);
    db.prepare("DELETE FROM worker_avatar_images WHERE worker_id = ?").run(workerId);
    db.prepare("UPDATE workers SET updated_at = ? WHERE id = ?").run(now, workerId);
    audit(db, "admin", "worker_avatar_removed", "worker", workerId, "恢复为系统图标头像", id);
  })();
}

export function getWorkerAvatarImage(workerId: string): WorkerAvatarImageRow | null {
  const row = getDb()
    .prepare("SELECT * FROM worker_avatar_images WHERE worker_id = ?")
    .get(workerId) as WorkerAvatarImageRow | undefined;
  return row || null;
}

export function getWorkerAuth(workerId: string) {
  const worker = getWorkerRow(getDb(), workerId);
  return { id: worker.id, passwordHash: worker.password_hash, authVersion: worker.auth_version };
}

export async function authenticateWorker(workerId: string, password: string) {
  const auth = getWorkerAuth(workerId);
  const valid = await verifyPassword(password, auth.passwordHash);
  if (!valid) throw new AppError("密码不正确，请再试一次。", 401, "INVALID_PASSWORD");
  return auth;
}

export function workerAuthorizationValid(workerId: string, authVersion: number) {
  const row = getDb()
    .prepare("SELECT auth_version, is_active FROM workers WHERE id = ?")
    .get(workerId) as { auth_version: number; is_active: number } | undefined;
  return Boolean(row?.is_active && row.auth_version === authVersion);
}

export async function createWorker(input: {
  name: string;
  password: string;
  avatar: string;
  theme: string;
  dailyRewardSeconds: number;
  requestId?: string;
}) {
  const db = getDb();
  const id = uniqueId();
  const now = Date.now();
  const passwordHash = await hashPassword(input.password);
  const mutationId = requestId(input.requestId);

  db.transaction(() => {
    db.prepare(`
      INSERT INTO workers(
        id, name, avatar, theme, password_hash, balance_seconds,
        daily_reward_seconds, timezone, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
    `).run(
      id,
      input.name.trim(),
      input.avatar,
      input.theme,
      passwordHash,
      input.dailyRewardSeconds,
      getConfig().timezone,
      now,
      now,
    );
    db.prepare(`
      INSERT INTO worker_daily_coupon_settings(
        worker_id, is_enabled, daily_quantity, random_min_seconds, random_max_seconds, updated_at
      ) VALUES (?, 0, 0, 300, 900, ?)
    `).run(id, now);
    audit(db, "admin", "worker_created", "worker", id, `创建打工人：${input.name.trim()}`, mutationId);
  })();
  return id;
}

export async function updateWorker(input: {
  workerId: string;
  name?: string;
  avatar?: string;
  theme?: string;
  dailyRewardSeconds?: number;
  password?: string;
  isActive?: boolean;
  requestId?: string;
}) {
  const db = getDb();
  const worker = getWorkerRow(db, input.workerId, true);
  const passwordHash = input.password ? await hashPassword(input.password) : null;
  const mutationId = requestId(input.requestId);
  const activeTimer = db.prepare("SELECT worker_id FROM active_timers WHERE worker_id = ?").get(input.workerId);
  if (input.isActive === false && activeTimer) {
    throw new AppError("请先结束这个打工人的计时，再停用角色。", 409, "TIMER_ACTIVE");
  }

  db.transaction(() => {
    db.prepare(`
      UPDATE workers SET
        name = ?, avatar = ?, theme = ?, daily_reward_seconds = ?,
        password_hash = ?, auth_version = ?, is_active = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.name?.trim() || worker.name,
      input.avatar || worker.avatar,
      input.theme || worker.theme,
      input.dailyRewardSeconds ?? worker.daily_reward_seconds,
      passwordHash || worker.password_hash,
      passwordHash ? worker.auth_version + 1 : worker.auth_version,
      input.isActive === undefined ? worker.is_active : input.isActive ? 1 : 0,
      Date.now(),
      worker.id,
    );
    audit(db, "admin", "worker_updated", "worker", worker.id, "更新打工人资料", mutationId);
  })();
}

function createAssignmentWithin(db: Db, task: TaskRow, workerId: string, assignedBy: Actor) {
  getWorkerRow(db, workerId);
  const now = Date.now();
  if (task.status !== "published") throw new AppError("这个任务已经关闭。", 409, "TASK_CLOSED");
  if (task.target_worker_id && task.target_worker_id !== workerId) {
    throw new AppError("这个任务没有发布给该打工人。", 403, "TASK_NOT_AVAILABLE");
  }
  if (task.available_from && task.available_from > now) {
    throw new AppError("这个任务还没有开始领取。", 409, "TASK_NOT_STARTED");
  }
  if (task.due_at && task.due_at < now) {
    throw new AppError("这个任务已经过期。", 409, "TASK_EXPIRED");
  }

  const previous = db
    .prepare("SELECT * FROM task_assignments WHERE task_id = ? AND worker_id = ?")
    .get(task.id, workerId) as AssignmentRow | undefined;
  if (previous) {
    if (previous.status !== "cancelled") {
      throw new AppError("这个任务已经领取过了。", 409, "TASK_ALREADY_CLAIMED");
    }
    const previousDuration = assignmentDuration(db, previous.id);
    if (previousDuration > 0) {
      db.prepare(`
        INSERT INTO timer_adjustments(
          id, worker_id, assignment_id, delta_seconds, actor, reason, request_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        uniqueId(),
        workerId,
        previous.id,
        -previousDuration,
        assignedBy,
        "重新领取任务，累计时长从 0 开始",
        uniqueId(),
        now,
      );
    }
    db.prepare(`
      UPDATE task_assignments SET
        title_snapshot = ?, description_snapshot = ?, reward_seconds = ?,
        timing_mode = ?, minimum_duration_seconds = ?, bonus_enabled = ?,
        excellent_multiplier_bps = ?, bonus_criteria = ?, due_at = ?,
        status = 'claimed', submission_note = NULL,
        review_multiplier = NULL, review_tier = NULL, review_note = NULL, reviewed_at = NULL,
        approved_transaction_id = NULL, approved_reward_grant_id = NULL,
        assigned_by = ?, claimed_at = ?,
        submitted_at = NULL, updated_at = ?, version = version + 1
      WHERE id = ?
    `).run(
      task.title,
      task.description,
      task.reward_seconds,
      task.timing_mode,
      task.minimum_duration_seconds,
      task.bonus_enabled,
      task.excellent_multiplier_bps,
      task.bonus_criteria,
      task.due_at,
      assignedBy,
      now,
      now,
      previous.id,
    );
    snapshotAssignmentRewardsWithin(db, previous.id, task.id, now);
    return previous.id;
  }

  const id = uniqueId();
  try {
    db.prepare(`
      INSERT INTO task_assignments(
        id, task_id, worker_id, title_snapshot, description_snapshot,
        reward_seconds, timing_mode, minimum_duration_seconds, bonus_enabled,
        excellent_multiplier_bps, bonus_criteria, due_at, assigned_by,
        claimed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      task.id,
      workerId,
      task.title,
      task.description,
      task.reward_seconds,
      task.timing_mode,
      task.minimum_duration_seconds,
      task.bonus_enabled,
      task.excellent_multiplier_bps,
      task.bonus_criteria,
      task.due_at,
      assignedBy,
      now,
      now,
    );
  } catch (error) {
    if (String(error).includes("UNIQUE")) {
      throw new AppError("这个任务已经领取过了。", 409, "TASK_ALREADY_CLAIMED");
    }
    throw error;
  }
  snapshotAssignmentRewardsWithin(db, id, task.id, now);
  return id;
}

export function createTask(input: {
  title: string;
  description: string;
  rewardSeconds: number;
  targetWorkerId?: string | null;
  timingMode: TaskRow["timing_mode"];
  minimumDurationSeconds?: number | null;
  bonusEnabled: boolean;
  excellentMultiplier?: number;
  bonusCriteria?: string | null;
  rewardBindings?: TaskRewardBindingInput[];
  dueAt?: number | null;
  assignNow?: boolean;
  requestId?: string;
}) {
  const db = getDb();
  const id = uniqueId();
  const now = Date.now();
  const mutationId = requestId(input.requestId);
  const excellentMultiplierBps = Math.round((input.excellentMultiplier ?? 2) * 10_000);
  if (!Number.isSafeInteger(excellentMultiplierBps) || excellentMultiplierBps < 10_000) {
    throw new AppError("优秀完成倍率必须是大于或等于 1 的有效数字。", 400, "INVALID_EXCELLENT_MULTIPLIER");
  }
  return db.transaction(() => {
    const previous = db
      .prepare("SELECT target_id FROM audit_logs WHERE request_id = ?")
      .get(mutationId) as { target_id: string | null } | undefined;
    if (previous?.target_id) return previous.target_id;
    if (input.targetWorkerId) getWorkerRow(db, input.targetWorkerId);
    db.prepare(`
      INSERT INTO tasks(
        id, title, description, reward_seconds, target_worker_id,
        timing_mode, minimum_duration_seconds, bonus_enabled,
        excellent_multiplier_bps, bonus_criteria,
        due_at, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?)
    `).run(
      id,
      input.title.trim(),
      input.description.trim(),
      input.rewardSeconds,
      input.targetWorkerId || null,
      input.timingMode,
      input.minimumDurationSeconds || null,
      input.bonusEnabled ? 1 : 0,
      excellentMultiplierBps,
      input.bonusEnabled ? input.bonusCriteria?.trim() || null : null,
      input.dueAt || null,
      now,
      now,
    );
    replaceTaskRewardBindingsWithin(
      db,
      id,
      input.rewardBindings || [],
      input.bonusEnabled,
      now,
    );
    if (input.assignNow && input.targetWorkerId) {
      createAssignmentWithin(db, getTaskRow(db, id), input.targetWorkerId, "admin");
    }
    audit(db, "admin", "task_published", "task", id, `发布任务：${input.title.trim()}`, mutationId);
    return id;
  }).immediate();
}

export function submitRewardRequest(input: {
  workerId: string;
  title: string;
  description: string;
  rewardSeconds: number;
  requestId?: string;
}) {
  const db = getDb();
  const id = uniqueId();
  const now = Date.now();
  const mutationId = requestId(input.requestId);
  return db.transaction(() => {
    const previous = db
      .prepare("SELECT target_id FROM audit_logs WHERE request_id = ?")
      .get(mutationId) as { target_id: string | null } | undefined;
    if (previous?.target_id) return previous.target_id;
    getWorkerRow(db, input.workerId);
    db.prepare(`
      INSERT INTO reward_requests(
        id, worker_id, title, description, reward_seconds,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      id,
      input.workerId,
      input.title.trim(),
      input.description.trim(),
      input.rewardSeconds,
      now,
      now,
    );
    audit(
      db,
      actorForWorker(input.workerId),
      "reward_request_submitted",
      "reward_request",
      id,
      `自主申报：${input.title.trim()}`,
      mutationId,
    );
    return id;
  })();
}

export function resubmitRewardRequest(input: {
  workerId: string;
  rewardRequestId: string;
  title: string;
  description: string;
  rewardSeconds: number;
  requestId?: string;
}) {
  const db = getDb();
  const mutationId = requestId(input.requestId);
  const now = Date.now();
  db.transaction(() => {
    const rewardRequest = getRewardRequestRow(db, input.rewardRequestId);
    if (rewardRequest.worker_id !== input.workerId) {
      throw new AppError("不能修改别人的奖励申报。", 403, "FORBIDDEN");
    }
    if (rewardRequest.status !== "revision_requested") {
      throw new AppError("只有被退回的奖励申报可以重新提交。", 409, "INVALID_REWARD_REQUEST_STATUS");
    }
    db.prepare(`
      UPDATE reward_requests SET
        title = ?, description = ?, reward_seconds = ?, status = 'pending',
        review_note = NULL, reviewed_at = NULL, updated_at = ?, version = version + 1
      WHERE id = ?
    `).run(
      input.title.trim(),
      input.description.trim(),
      input.rewardSeconds,
      now,
      input.rewardRequestId,
    );
    audit(
      db,
      actorForWorker(input.workerId),
      "reward_request_resubmitted",
      "reward_request",
      input.rewardRequestId,
      `重新提交：${input.title.trim()}`,
      mutationId,
    );
  })();
}

export function cancelRewardRequest(input: {
  workerId: string;
  rewardRequestId: string;
  requestId?: string;
}) {
  const db = getDb();
  const mutationId = requestId(input.requestId);
  const now = Date.now();
  db.transaction(() => {
    const rewardRequest = getRewardRequestRow(db, input.rewardRequestId);
    if (rewardRequest.worker_id !== input.workerId) {
      throw new AppError("不能取消别人的奖励申报。", 403, "FORBIDDEN");
    }
    if (!["pending", "revision_requested"].includes(rewardRequest.status)) {
      throw new AppError("这条奖励申报现在不能取消。", 409, "INVALID_REWARD_REQUEST_STATUS");
    }
    db.prepare(`
      UPDATE reward_requests SET status = 'cancelled', updated_at = ?, version = version + 1
      WHERE id = ?
    `).run(now, input.rewardRequestId);
    audit(db, actorForWorker(input.workerId), "reward_request_cancelled", "reward_request", input.rewardRequestId, "取消自主申报", mutationId);
  })();
}

export function reviewRewardRequest(input: {
  rewardRequestId: string;
  decision: "approve" | "revision" | "reject";
  note: string;
  requestId?: string;
}) {
  const db = getDb();
  const mutationId = requestId(input.requestId);
  const now = Date.now();
  return db.transaction(() => {
    const existing = db.prepare("SELECT target_id FROM audit_logs WHERE request_id = ?").get(mutationId);
    if (existing) return { duplicated: true, amountSeconds: 0 };
    const rewardRequest = getRewardRequestRow(db, input.rewardRequestId);
    if (rewardRequest.status !== "pending") {
      throw new AppError("这条奖励申报已经被处理，或还没有提交。", 409, "ALREADY_REVIEWED");
    }
    if (input.decision !== "approve" && !input.note.trim()) {
      throw new AppError("请写一句审核说明。", 400, "REVIEW_NOTE_REQUIRED");
    }

    if (input.decision === "revision" || input.decision === "reject") {
      const nextStatus = input.decision === "revision" ? "revision_requested" : "rejected";
      db.prepare(`
        UPDATE reward_requests SET status = ?, review_note = ?, reviewed_at = ?, updated_at = ?, version = version + 1
        WHERE id = ?
      `).run(nextStatus, input.note.trim(), now, now, rewardRequest.id);
      audit(
        db,
        "admin",
        input.decision === "revision" ? "reward_request_revision" : "reward_request_rejected",
        "reward_request",
        rewardRequest.id,
        input.note.trim(),
        mutationId,
      );
      return { duplicated: false, amountSeconds: 0 };
    }

    syncWorkerWithin(db, rewardRequest.worker_id, now);
    const worker = getWorkerRow(db, rewardRequest.worker_id);
    const nextBalance = worker.balance_seconds + rewardRequest.reward_seconds;
    const transactionId = insertTransaction(db, {
      workerId: worker.id,
      type: "task_reward",
      title: rewardRequest.title,
      amountSeconds: rewardRequest.reward_seconds,
      balanceAfter: nextBalance,
      actor: "admin",
      reason: input.note.trim() || rewardRequest.description.trim() || "管理员审核自主申报",
      requestId: mutationId,
      createdAt: now,
    });
    db.prepare("UPDATE workers SET balance_seconds = ?, updated_at = ? WHERE id = ?")
      .run(nextBalance, now, worker.id);
    db.prepare(`
      UPDATE reward_requests SET status = 'approved', review_note = ?, reviewed_at = ?,
        approved_transaction_id = ?, updated_at = ?, version = version + 1
      WHERE id = ?
    `).run(input.note.trim() || "审核通过", now, transactionId, now, rewardRequest.id);
    audit(db, "admin", "reward_request_approved", "reward_request", rewardRequest.id, input.note.trim() || "发放自主申报奖励", mutationId);
    return { duplicated: false, amountSeconds: rewardRequest.reward_seconds };
  })();
}

export function closeTask(taskId: string, mutationId?: string) {
  const db = getDb();
  const id = requestId(mutationId);
  db.transaction(() => {
    getTaskRow(db, taskId);
    db.prepare("UPDATE tasks SET status = 'closed', updated_at = ? WHERE id = ?")
      .run(Date.now(), taskId);
    audit(db, "admin", "task_closed", "task", taskId, "关闭任务", id);
  })();
}

export function claimTask(workerId: string, taskId: string, mutationId?: string) {
  const db = getDb();
  const id = requestId(mutationId);
  return db.transaction(() => {
    syncWorkerWithin(db, workerId);
    const assignmentId = createAssignmentWithin(db, getTaskRow(db, taskId), workerId, actorForWorker(workerId));
    audit(db, actorForWorker(workerId), "task_claimed", "assignment", assignmentId, "领取任务", id);
    return assignmentId;
  })();
}

export function assignTask(taskId: string, workerId: string, mutationId?: string) {
  const db = getDb();
  const id = requestId(mutationId);
  return db.transaction(() => {
    const assignmentId = createAssignmentWithin(db, getTaskRow(db, taskId), workerId, "admin");
    audit(db, "admin", "task_assigned", "assignment", assignmentId, `分配给 ${workerId}`, id);
    return assignmentId;
  })();
}

export function startTimer(input: {
  workerId: string;
  timerType: "reward_task" | "consumption";
  targetId: string;
  actor: Actor;
  requestId?: string;
}) {
  const db = getDb();
  const mutationId = requestId(input.requestId);
  const now = Date.now();
  return db.transaction(() => {
    syncWorkerWithin(db, input.workerId, now);
    if (db.prepare("SELECT worker_id FROM active_timers WHERE worker_id = ?").get(input.workerId)) {
      throw new AppError("已经有一个任务在计时啦。", 409, "TIMER_ALREADY_ACTIVE");
    }
    const worker = getWorkerRow(db, input.workerId);
    let assignmentId: string | null = null;
    let activityId: string | null = null;

    if (input.timerType === "reward_task") {
      const assignment = getAssignmentRow(db, input.targetId);
      if (assignment.worker_id !== input.workerId) throw new AppError("不能操作别人的任务。", 403);
      if (!["claimed", "in_progress", "revision_requested"].includes(assignment.status)) {
        throw new AppError("这个任务现在不能开始计时。", 409, "INVALID_TASK_STATUS");
      }
      if (assignment.timing_mode === "none") {
        throw new AppError("这个任务不需要计时，可以完成后直接提交。", 409, "TIMER_NOT_ALLOWED");
      }
      assignmentId = assignment.id;
      db.prepare("UPDATE task_assignments SET status = 'in_progress', updated_at = ?, version = version + 1 WHERE id = ?")
        .run(now, assignment.id);
    } else {
      const activity = db
        .prepare("SELECT * FROM consumption_activities WHERE id = ? AND is_active = 1")
        .get(input.targetId) as ConsumptionRow | undefined;
      if (!activity) throw new AppError("这个消耗项目不可用。", 404, "ACTIVITY_NOT_FOUND");
      if (worker.balance_seconds <= 0) {
        throw new AppError("时数不够啦，先完成一个任务吧。", 409, "INSUFFICIENT_BALANCE");
      }
      activityId = activity.id;
    }

    db.prepare(`
      INSERT INTO active_timers(
        worker_id, timer_type, assignment_id, consumption_activity_id,
        started_at, started_by, request_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(input.workerId, input.timerType, assignmentId, activityId, now, input.actor, mutationId);
    audit(db, input.actor, "timer_started", input.timerType, input.targetId, "开始计时");
    return now;
  })();
}

export function stopTimer(workerId: string, actor: Actor, mutationId?: string) {
  const db = getDb();
  const id = requestId(mutationId);
  const now = Date.now();
  return db.transaction(() => {
    const timer = db
      .prepare("SELECT * FROM active_timers WHERE worker_id = ?")
      .get(workerId) as ActiveTimerRow | undefined;
    if (!timer) throw new AppError("现在没有正在计时的任务。", 409, "NO_ACTIVE_TIMER");
    const result = stopTimerWithin(db, timer, actor, now, id);
    audit(db, actor, "timer_stopped", timer.timer_type, timer.assignment_id || timer.consumption_activity_id, "结束计时");
    return result;
  })();
}

export function cancelConsumptionTimer(input: {
  workerId: string;
  actor: Actor;
  requestId?: string;
}) {
  const db = getDb();
  const mutationId = requestId(input.requestId);
  const now = Date.now();
  return db.transaction(() => {
    assertActorCanManageWorker(input.actor, input.workerId);
    const previousRequest = db
      .prepare("SELECT target_id FROM audit_logs WHERE request_id = ?")
      .get(mutationId);
    if (previousRequest) return { duplicated: true };

    const timer = db
      .prepare("SELECT * FROM active_timers WHERE worker_id = ?")
      .get(input.workerId) as ActiveTimerRow | undefined;
    if (!timer || timer.timer_type !== "consumption") {
      throw new AppError("现在没有可以撤销的消耗计时。", 409, "NO_CONSUMPTION_TIMER");
    }
    if (input.actor !== "admin" && elapsedSeconds(timer.started_at, now) > 30) {
      throw new AppError("误触取消只在开始后的 30 秒内可用，请联系管理员处理。", 409, "UNDO_WINDOW_EXPIRED");
    }

    db.prepare("DELETE FROM active_timers WHERE worker_id = ?").run(input.workerId);
    audit(
      db,
      input.actor,
      "consumption_timer_cancelled",
      "consumption_activity",
      timer.consumption_activity_id,
      "误触取消，本次未扣除时数",
      mutationId,
    );
    return { duplicated: false };
  })();
}

export function reverseConsumptionTransaction(input: {
  transactionId: string;
  reason?: string;
  requestId?: string;
}) {
  const db = getDb();
  const mutationId = requestId(input.requestId);
  const now = Date.now();
  return db.transaction(() => {
    const previousRequest = db
      .prepare("SELECT original_transaction_id FROM transaction_reversals WHERE request_id = ?")
      .get(mutationId);
    if (previousRequest) return { duplicated: true };

    const original = db
      .prepare("SELECT * FROM transactions WHERE id = ?")
      .get(input.transactionId) as TransactionRow | undefined;
    if (!original) throw new AppError("没有找到这条消耗明细。", 404, "TRANSACTION_NOT_FOUND");
    if (original.type !== "consumption" || original.amount_seconds >= 0) {
      throw new AppError("只有消耗明细可以撤销。", 409, "TRANSACTION_NOT_REVERSIBLE");
    }
    if (db.prepare("SELECT id FROM transaction_reversals WHERE original_transaction_id = ?").get(original.id)) {
      throw new AppError("这笔消耗已经撤销过了。", 409, "TRANSACTION_ALREADY_REVERSED");
    }

    const beforeSync = getWorkerRow(db, original.worker_id, true);
    if (beforeSync.is_active) syncWorkerWithin(db, original.worker_id, now);
    const worker = getWorkerRow(db, original.worker_id, true);
    const refundSeconds = Math.abs(original.amount_seconds);
    const nextBalance = worker.balance_seconds + refundSeconds;
    const reason = input.reason?.trim() || "误触消耗原额退回";
    db.prepare("UPDATE workers SET balance_seconds = ?, updated_at = ? WHERE id = ?")
      .run(nextBalance, now, worker.id);
    const reversalTransactionId = insertTransaction(db, {
      workerId: worker.id,
      type: "admin_adjustment",
      title: `撤销消耗：${original.title}`,
      amountSeconds: refundSeconds,
      balanceAfter: nextBalance,
      actor: "admin",
      reason,
      requestId: mutationId,
      createdAt: now,
    });
    db.prepare(`
      INSERT INTO transaction_reversals(
        id, original_transaction_id, reversal_transaction_id,
        actor, reason, request_id, created_at
      ) VALUES (?, ?, ?, 'admin', ?, ?, ?)
    `).run(uniqueId(), original.id, reversalTransactionId, reason, mutationId, now);
    audit(
      db,
      "admin",
      "consumption_transaction_reversed",
      "transaction",
      original.id,
      `${reason}：退回 ${refundSeconds} 秒`,
      mutationId,
    );
    return { duplicated: false, refundSeconds, balanceSeconds: nextBalance };
  })();
}

export function setAssignmentDuration(input: {
  assignmentId: string;
  durationSeconds: number;
  actor: Actor;
  reason?: string;
  requestId?: string;
}) {
  const db = getDb();
  const mutationId = requestId(input.requestId);
  const now = Date.now();
  return db.transaction(() => {
    const assignment = getAssignmentRow(db, input.assignmentId);
    assertActorCanManageWorker(input.actor, assignment.worker_id);
    if (!Number.isInteger(input.durationSeconds) || input.durationSeconds < 0 || input.durationSeconds > 86_400) {
      throw new AppError("累计时长必须是 0 到 24 小时之间的整数秒。", 400, "INVALID_DURATION");
    }

    const previousRequest = db
      .prepare("SELECT id FROM timer_adjustments WHERE request_id = ?")
      .get(mutationId);
    if (previousRequest) return assignmentDuration(db, assignment.id);

    const editableStatuses = input.actor === "admin"
      ? ["claimed", "in_progress", "submitted", "revision_requested"]
      : ["claimed", "in_progress", "revision_requested"];
    if (!editableStatuses.includes(assignment.status)) {
      throw new AppError(
        assignment.status === "approved"
          ? "任务奖励已经入账，不能再修改任务时长。"
          : "这个任务现在不能修改时长。",
        409,
        "DURATION_NOT_EDITABLE",
      );
    }
    if (db.prepare("SELECT worker_id FROM active_timers WHERE worker_id = ?").get(assignment.worker_id)) {
      throw new AppError("请先暂停当前计时，再手动修改时长。", 409, "TIMER_ACTIVE");
    }

    const currentDuration = assignmentDuration(db, assignment.id);
    const delta = input.durationSeconds - currentDuration;
    if (delta === 0) return currentDuration;
    const reason = input.reason?.trim()
      || (input.actor === "admin" ? "管理员手动修正累计时长" : "打工人手动修正累计时长");
    db.prepare(`
      INSERT INTO timer_adjustments(
        id, worker_id, assignment_id, delta_seconds, actor, reason, request_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uniqueId(),
      assignment.worker_id,
      assignment.id,
      delta,
      input.actor,
      reason,
      mutationId,
      now,
    );
    db.prepare("UPDATE task_assignments SET updated_at = ?, version = version + 1 WHERE id = ?")
      .run(now, assignment.id);
    audit(
      db,
      input.actor,
      "task_duration_set",
      "assignment",
      assignment.id,
      `${reason}：${currentDuration} 秒 → ${input.durationSeconds} 秒`,
      mutationId,
    );
    return input.durationSeconds;
  })();
}

export function cancelAssignment(input: {
  assignmentId: string;
  actor: Actor;
  reason?: string;
  requestId?: string;
}) {
  const db = getDb();
  const mutationId = requestId(input.requestId);
  const now = Date.now();
  return db.transaction(() => {
    const previousRequest = db
      .prepare("SELECT target_id FROM audit_logs WHERE request_id = ?")
      .get(mutationId);
    if (previousRequest) return { duplicated: true };

    const assignment = getAssignmentRow(db, input.assignmentId);
    assertActorCanManageWorker(input.actor, assignment.worker_id);
    const cancellableStatuses = input.actor === "admin"
      ? ["claimed", "in_progress", "submitted", "revision_requested"]
      : ["claimed", "in_progress", "revision_requested"];
    if (!cancellableStatuses.includes(assignment.status)) {
      throw new AppError(
        assignment.status === "approved"
          ? "这个任务的奖励已经入账，不能撤销；如需纠正，请使用余额调整。"
          : "这个任务现在不能撤销。",
        409,
        "ASSIGNMENT_NOT_CANCELLABLE",
      );
    }

    const activeTimer = db
      .prepare("SELECT * FROM active_timers WHERE worker_id = ? AND assignment_id = ?")
      .get(assignment.worker_id, assignment.id) as ActiveTimerRow | undefined;
    if (activeTimer) {
      stopTimerWithin(db, activeTimer, input.actor, now, `cancel-stop:${mutationId}`);
    }
    db.prepare(`
      UPDATE task_assignments
      SET status = 'cancelled', updated_at = ?, version = version + 1
      WHERE id = ?
    `).run(now, assignment.id);
    const reason = input.reason?.trim() || (input.actor === "admin" ? "管理员撤销误操作任务" : "打工人取消任务");
    audit(db, input.actor, "assignment_cancelled", "assignment", assignment.id, reason, mutationId);
    return { duplicated: false };
  })();
}

export function manualConsumption(input: {
  workerId: string;
  activityId: string;
  durationSeconds: number;
  actor: Actor;
  requestId?: string;
}) {
  const db = getDb();
  const mutationId = requestId(input.requestId);
  const now = Date.now();
  return db.transaction(() => {
    assertActorCanManageWorker(input.actor, input.workerId);
    if (!Number.isInteger(input.durationSeconds) || input.durationSeconds <= 0 || input.durationSeconds > 86_400) {
      throw new AppError("消耗时长必须是 1 秒到 24 小时之间的整数。", 400, "INVALID_DURATION");
    }
    const previous = db
      .prepare("SELECT id FROM transactions WHERE request_id = ?")
      .get(mutationId);
    if (previous) return { duplicated: true };

    syncWorkerWithin(db, input.workerId, now);
    const worker = getWorkerRow(db, input.workerId);
    if (db.prepare("SELECT worker_id FROM active_timers WHERE worker_id = ?").get(worker.id)) {
      throw new AppError("请先结束当前计时，再直接填写消耗。", 409, "TIMER_ACTIVE");
    }
    const activity = db
      .prepare("SELECT * FROM consumption_activities WHERE id = ? AND is_active = 1")
      .get(input.activityId) as ConsumptionRow | undefined;
    if (!activity) throw new AppError("这个消耗项目不可用。", 404, "ACTIVITY_NOT_FOUND");
    if (input.durationSeconds > worker.balance_seconds) {
      throw new AppError("填写的消耗时长超过当前余额。", 409, "INSUFFICIENT_BALANCE");
    }

    const nextBalance = worker.balance_seconds - input.durationSeconds;
    db.prepare("UPDATE workers SET balance_seconds = ?, updated_at = ? WHERE id = ?")
      .run(nextBalance, now, worker.id);
    insertTransaction(db, {
      workerId: worker.id,
      type: "consumption",
      title: `${activity.name}（手动填写）`,
      amountSeconds: -input.durationSeconds,
      balanceAfter: nextBalance,
      consumptionActivityId: activity.id,
      actor: input.actor,
      reason: input.actor === "admin" ? "管理员代为填写" : "本人直接填写",
      requestId: mutationId,
      startedAt: now - input.durationSeconds * 1000,
      endedAt: now,
      createdAt: now,
    });
    audit(
      db,
      input.actor,
      "manual_consumption_created",
      "worker",
      worker.id,
      `${activity.name}：${input.durationSeconds} 秒`,
      mutationId,
    );
    return { duplicated: false, balanceSeconds: nextBalance };
  })();
}

export function submitAssignment(input: {
  workerId: string;
  assignmentId: string;
  note: string;
  actor: Actor;
  requestId?: string;
  overrideMinimum?: boolean;
}) {
  const db = getDb();
  const mutationId = requestId(input.requestId);
  const now = Date.now();
  db.transaction(() => {
    syncWorkerWithin(db, input.workerId, now);
    let assignment = getAssignmentRow(db, input.assignmentId);
    if (assignment.worker_id !== input.workerId) throw new AppError("不能提交别人的任务。", 403);
    if (!["claimed", "in_progress", "revision_requested"].includes(assignment.status)) {
      throw new AppError("这个任务现在不能提交。", 409, "INVALID_TASK_STATUS");
    }
    const active = db
      .prepare("SELECT * FROM active_timers WHERE worker_id = ?")
      .get(input.workerId) as ActiveTimerRow | undefined;
    if (active) {
      if (active.assignment_id !== assignment.id) {
        throw new AppError("请先结束当前正在计时的任务。", 409, "OTHER_TIMER_ACTIVE");
      }
      stopTimerWithin(db, active, input.actor, now, `submit-stop:${mutationId}`);
      assignment = getAssignmentRow(db, input.assignmentId);
    }
    const duration = assignmentDuration(db, assignment.id);
    if (
      assignment.timing_mode === "required" &&
      duration < (assignment.minimum_duration_seconds || 1) &&
      !input.overrideMinimum
    ) {
      throw new AppError("还没有达到任务要求的计时时长。", 409, "MINIMUM_DURATION_NOT_MET");
    }
    db.prepare(`
      UPDATE task_assignments SET
        status = 'submitted', submission_note = ?, submitted_at = ?,
        updated_at = ?, version = version + 1
      WHERE id = ?
    `).run(input.note.trim(), now, now, assignment.id);
    audit(db, input.actor, "task_submitted", "assignment", assignment.id, input.note.trim(), mutationId);
  })();
}

export function reviewAssignment(input: {
  assignmentId: string;
  decision: "approve" | "excellent" | "double" | "revision" | "reject";
  note: string;
  requestId?: string;
}) {
  const db = getDb();
  const mutationId = requestId(input.requestId);
  const now = Date.now();
  return db.transaction(() => {
    const existing = db.prepare("SELECT target_id FROM audit_logs WHERE request_id = ?").get(mutationId);
    if (existing) return { duplicated: true };
    const assignment = getAssignmentRow(db, input.assignmentId);
    if (assignment.status !== "submitted") {
      throw new AppError("这个任务已经被处理，或还没有提交。", 409, "ALREADY_REVIEWED");
    }
    const excellent = input.decision === "excellent" || input.decision === "double";
    if (excellent && !assignment.bonus_enabled) {
      throw new AppError("这个任务没有开启优秀奖励。", 409, "BONUS_NOT_ALLOWED");
    }
    if (input.decision !== "approve" && !input.note.trim()) {
      throw new AppError("请写一句审核说明。", 400, "REVIEW_NOTE_REQUIRED");
    }

    if (input.decision === "revision") {
      db.prepare(`
        UPDATE task_assignments SET status = 'revision_requested', review_note = ?,
          reviewed_at = ?, updated_at = ?, version = version + 1 WHERE id = ?
      `).run(input.note.trim(), now, now, assignment.id);
      audit(db, "admin", "review_revision", "assignment", assignment.id, input.note.trim(), mutationId);
      return { duplicated: false, amountSeconds: 0 };
    }
    if (input.decision === "reject") {
      db.prepare(`
        UPDATE task_assignments SET status = 'rejected', review_note = ?,
          reviewed_at = ?, updated_at = ?, version = version + 1 WHERE id = ?
      `).run(input.note.trim(), now, now, assignment.id);
      audit(db, "admin", "review_rejected", "assignment", assignment.id, input.note.trim(), mutationId);
      return { duplicated: false, amountSeconds: 0 };
    }

    syncWorkerWithin(db, assignment.worker_id, now);
    const worker = getWorkerRow(db, assignment.worker_id);
    const multiplierBps = excellent ? assignment.excellent_multiplier_bps : 10_000;
    const multiplier = multiplierBps / 10_000;
    const amount = Math.round(assignment.reward_seconds * multiplierBps / 10_000);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new AppError("任务奖励时数超出可处理范围。", 400, "INVALID_REWARD_AMOUNT");
    }
    const nextBalance = worker.balance_seconds + amount;
    if (!Number.isSafeInteger(nextBalance)) {
      throw new AppError("打工人的时数余额超出可处理范围。", 409, "BALANCE_TOO_LARGE");
    }
    const transactionId = uniqueId();
    db.prepare("UPDATE workers SET balance_seconds = ?, updated_at = ? WHERE id = ?")
      .run(nextBalance, now, worker.id);
    insertTransaction(db, {
      id: transactionId,
      workerId: worker.id,
      type: "task_reward",
      title: assignment.title_snapshot,
      amountSeconds: amount,
      balanceAfter: nextBalance,
      assignmentId: assignment.id,
      actor: "admin",
      reason: input.note.trim() || (excellent ? `优秀完成，基础时数 ×${multiplier}` : "审核通过"),
      requestId: mutationId,
      createdAt: now,
    });
    const rewardGrant = grantAssignmentRewardsWithin(db, {
      assignmentId: assignment.id,
      workerId: worker.id,
      excellent,
      reviewNote: input.note.trim(),
      requestId: mutationId,
      now,
    });
    db.prepare(`
      UPDATE task_assignments SET
        status = 'approved', review_multiplier = ?, review_tier = ?, review_note = ?, reviewed_at = ?,
        approved_transaction_id = ?, approved_reward_grant_id = ?,
        updated_at = ?, version = version + 1
      WHERE id = ?
    `).run(
      multiplier,
      excellent ? "excellent" : "normal",
      input.note.trim() || "审核通过",
      now,
      transactionId,
      rewardGrant.batchId,
      now,
      assignment.id,
    );
    audit(
      db,
      "admin",
      excellent ? "review_excellent" : "review_approved",
      "assignment",
      assignment.id,
      input.note.trim(),
      mutationId,
    );
    return {
      duplicated: false,
      amountSeconds: amount,
      configuredRewardCount: rewardGrant.configuredQuantity,
      awardedRewardCount: rewardGrant.awardedQuantity,
    };
  }).immediate();
}

export function grantQuickReward(input: {
  workerId: string;
  title: string;
  rewardSeconds: number;
  note?: string;
  requestId?: string;
}) {
  const db = getDb();
  const mutationId = requestId(input.requestId);
  const now = Date.now();
  const title = input.title.trim();
  const note = input.note?.trim() || "";

  if (!title || title.length > 60) {
    throw new AppError("奖励名称需要填写 1～60 个字。", 400, "INVALID_REWARD_TITLE");
  }
  if (!Number.isInteger(input.rewardSeconds) || input.rewardSeconds <= 0 || input.rewardSeconds > 86_400) {
    throw new AppError("奖励时数必须是 1 秒到 24 小时之间的整数。", 400, "INVALID_REWARD_AMOUNT");
  }
  if (note.length > 500) {
    throw new AppError("补录说明不能超过 500 个字。", 400, "INVALID_REWARD_NOTE");
  }

  return db.transaction(() => {
    const previous = db
      .prepare("SELECT id FROM transactions WHERE request_id = ?")
      .get(mutationId) as { id: string } | undefined;
    if (previous) return { duplicated: true, transactionId: previous.id };

    syncWorkerWithin(db, input.workerId, now);
    const worker = getWorkerRow(db, input.workerId);
    const nextBalance = worker.balance_seconds + input.rewardSeconds;
    db.prepare("UPDATE workers SET balance_seconds = ?, updated_at = ? WHERE id = ?")
      .run(nextBalance, now, worker.id);
    const transactionId = insertTransaction(db, {
      workerId: worker.id,
      type: "task_reward",
      title,
      amountSeconds: input.rewardSeconds,
      balanceAfter: nextBalance,
      actor: "admin",
      reason: note || "管理员快速补录奖励",
      requestId: mutationId,
      createdAt: now,
    });
    audit(
      db,
      "admin",
      "quick_reward_granted",
      "transaction",
      transactionId,
      `${title}：${input.rewardSeconds} 秒${note ? `；${note}` : ""}`,
      mutationId,
    );
    return {
      duplicated: false,
      transactionId,
      amountSeconds: input.rewardSeconds,
      balanceSeconds: nextBalance,
    };
  })();
}

export function adjustBalance(input: {
  workerId: string;
  amountSeconds: number;
  reason: string;
  requestId?: string;
}) {
  const db = getDb();
  const mutationId = requestId(input.requestId);
  return db.transaction(() => {
    syncWorkerWithin(db, input.workerId);
    const worker = getWorkerRow(db, input.workerId);
    const nextBalance = worker.balance_seconds + input.amountSeconds;
    if (input.amountSeconds === 0) throw new AppError("调整时数不能为 0。", 400);
    if (nextBalance < 0) throw new AppError("扣除后余额不能小于 0。", 409, "NEGATIVE_BALANCE");
    db.prepare("UPDATE workers SET balance_seconds = ?, updated_at = ? WHERE id = ?")
      .run(nextBalance, Date.now(), worker.id);
    insertTransaction(db, {
      workerId: worker.id,
      type: "admin_adjustment",
      title: "管理员调整",
      amountSeconds: input.amountSeconds,
      balanceAfter: nextBalance,
      actor: "admin",
      reason: input.reason.trim(),
      requestId: mutationId,
    });
    audit(db, "admin", "balance_adjusted", "worker", worker.id, input.reason.trim());
    return nextBalance;
  })();
}

export function createConsumptionActivity(input: {
  name: string;
  icon?: string;
  requestId?: string;
}) {
  const db = getDb();
  const id = uniqueId();
  const mutationId = requestId(input.requestId);
  const now = Date.now();
  db.transaction(() => {
    const max = db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS value FROM consumption_activities").get() as { value: number };
    db.prepare(`
      INSERT INTO consumption_activities(id, name, icon, sort_order, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `).run(id, input.name.trim(), input.icon || "clock", max.value + 10, now, now);
    audit(db, "admin", "activity_created", "consumption_activity", id, input.name.trim(), mutationId);
  })();
  return id;
}

export function toggleConsumptionActivity(activityId: string, active: boolean, mutationId?: string) {
  const db = getDb();
  const id = requestId(mutationId);
  const row = db.prepare("SELECT id FROM consumption_activities WHERE id = ?").get(activityId);
  if (!row) throw new AppError("没有找到这个消耗项目。", 404);
  db.transaction(() => {
    db.prepare("UPDATE consumption_activities SET is_active = ?, updated_at = ? WHERE id = ?")
      .run(active ? 1 : 0, Date.now(), activityId);
    audit(db, "admin", active ? "activity_enabled" : "activity_disabled", "consumption_activity", activityId, null, id);
  })();
}

export function getWorkerState(workerId: string) {
  const db = getDb();
  syncWorker(workerId);
  const worker = getWorkerRow(db, workerId);
  const now = Date.now();
  const availableTasks = (db.prepare(`
    SELECT t.* FROM tasks t
    WHERE t.status = 'published'
      AND (t.target_worker_id IS NULL OR t.target_worker_id = ?)
      AND (t.available_from IS NULL OR t.available_from <= ?)
      AND (t.due_at IS NULL OR t.due_at >= ?)
      AND NOT EXISTS (
        SELECT 1 FROM task_assignments a
        WHERE a.task_id = t.id AND a.worker_id = ? AND a.status <> 'cancelled'
      )
    ORDER BY t.created_at DESC
  `).all(workerId, now, now, workerId) as TaskRow[]).map((row) => publicTask(db, row));
  const assignments = (db
    .prepare("SELECT * FROM task_assignments WHERE worker_id = ? ORDER BY updated_at DESC")
    .all(workerId) as AssignmentRow[]).map((row) => publicAssignment(db, row));
  const rewardRequests = (db
    .prepare("SELECT * FROM reward_requests WHERE worker_id = ? ORDER BY updated_at DESC LIMIT 50")
    .all(workerId) as RewardRequestRow[]).map((row) => publicRewardRequest(row));
  const activeTimer = db
    .prepare("SELECT * FROM active_timers WHERE worker_id = ?")
    .get(workerId) as ActiveTimerRow | undefined;
  const activities = (db
    .prepare("SELECT * FROM consumption_activities WHERE is_active = 1 ORDER BY sort_order, created_at")
    .all() as ConsumptionRow[]).map(publicActivity);
  const transactions = (db
    .prepare(`
      SELECT tr.*,
        EXISTS(SELECT 1 FROM transaction_reversals rv WHERE rv.original_transaction_id = tr.id) AS is_reversed,
        (SELECT rv.original_transaction_id FROM transaction_reversals rv WHERE rv.reversal_transaction_id = tr.id) AS reversal_of_transaction_id
      FROM transactions tr
      WHERE tr.worker_id = ?
      ORDER BY tr.created_at DESC LIMIT 100
    `)
    .all(workerId) as TransactionRow[]).map((row) => publicTransaction(row));
  const today = dateKey(now, worker.timezone);
  const todayTransactions = transactions.filter((row) => dateKey(row.createdAt, worker.timezone) === today);
  const pendingRewardSeconds = assignments
    .filter((assignment) => assignment.status === "submitted")
    .reduce((total, assignment) => total + assignment.rewardSeconds, 0)
    + rewardRequests
      .filter((rewardRequest) => rewardRequest.status === "pending")
      .reduce((total, rewardRequest) => total + rewardRequest.rewardSeconds, 0);
  const dailyGrant = db
    .prepare("SELECT amount_seconds FROM daily_grants WHERE worker_id = ? AND reward_date = ?")
    .get(workerId, today) as { amount_seconds: number } | undefined;
  const rewardState = getWorkerRewardState(workerId, now);

  return {
    worker: publicWorker(db, getWorkerRow(db, workerId)),
    availableTasks,
    assignments,
    rewardRequests,
    activeTimer: publicTimer(db, activeTimer),
    activities,
    transactions,
    ...rewardState,
    summary: {
      todayIncomeSeconds: todayTransactions
        .filter((row) => row.amountSeconds > 0)
        .reduce((sum, row) => sum + row.amountSeconds, 0),
      todaySpentSeconds: todayTransactions
        .filter((row) => row.amountSeconds < 0)
        .reduce((sum, row) => sum + Math.abs(row.amountSeconds), 0),
      pendingRewardSeconds,
      dailyGrantAmountSeconds: dailyGrant?.amount_seconds ?? null,
    },
  };
}

export function getAdminState() {
  const db = getDb();
  const workers = db
    .prepare("SELECT * FROM workers ORDER BY is_active DESC, created_at")
    .all() as WorkerRow[];
  for (const worker of workers) {
    if (worker.is_active) syncWorker(worker.id);
  }
  const refreshedWorkers = db
    .prepare("SELECT * FROM workers ORDER BY is_active DESC, created_at")
    .all() as WorkerRow[];
  const timers = db.prepare("SELECT * FROM active_timers").all() as ActiveTimerRow[];
  const assignmentRows = db
    .prepare("SELECT * FROM task_assignments ORDER BY updated_at DESC")
    .all() as AssignmentRow[];
  const assignments = assignmentRows.map((row) => publicAssignment(db, row));
  const rewardRequestRows = db.prepare(`
    SELECT rr.*, w.name AS worker_name
    FROM reward_requests rr JOIN workers w ON w.id = rr.worker_id
    WHERE rr.status = 'pending'
    ORDER BY rr.created_at ASC
  `).all() as Array<RewardRequestRow & { worker_name: string }>;
  const rewardRequests = rewardRequestRows.map((row) => publicRewardRequest(row, row.worker_name));
  const tasks = (db
    .prepare("SELECT * FROM tasks ORDER BY created_at DESC")
    .all() as TaskRow[]).map((row) => ({
    ...publicTask(db, row),
    assignmentCount: assignmentRows.filter((assignment) => assignment.task_id === row.id && assignment.status !== "cancelled").length,
    assignedWorkerIds: assignmentRows
      .filter((assignment) => assignment.task_id === row.id && assignment.status !== "cancelled")
      .map((assignment) => assignment.worker_id),
  }));
  const activities = (db
    .prepare("SELECT * FROM consumption_activities ORDER BY sort_order, created_at")
    .all() as ConsumptionRow[]).map(publicActivity);
  const transactionRows = db.prepare(`
    SELECT tr.*, w.name AS worker_name,
      EXISTS(SELECT 1 FROM transaction_reversals rv WHERE rv.original_transaction_id = tr.id) AS is_reversed,
      (SELECT rv.original_transaction_id FROM transaction_reversals rv WHERE rv.reversal_transaction_id = tr.id) AS reversal_of_transaction_id
    FROM transactions tr JOIN workers w ON w.id = tr.worker_id
    ORDER BY tr.created_at DESC LIMIT 80
  `).all() as Array<TransactionRow & { worker_name: string }>;
  const rewardState = getAdminRewardState();

  return {
    workers: refreshedWorkers.map((worker) => {
      const workerAssignments = assignments.filter((assignment) => assignment.workerId === worker.id);
      const timer = timers.find((item) => item.worker_id === worker.id);
      return {
        ...publicWorker(db, worker),
        activeTimer: publicTimer(db, timer),
        assignments: workerAssignments,
        pendingReviewCount:
          workerAssignments.filter((assignment) => assignment.status === "submitted").length
          + rewardRequests.filter((rewardRequest) => rewardRequest.workerId === worker.id).length,
        dailyCouponSetting: rewardState.dailyCouponSettings.find((setting) => setting.workerId === worker.id)!,
        todayDailyCouponGrant: rewardState.todayDailyCouponGrants[worker.id] || null,
        availableRewardCount: rewardState.rewardItems.filter(
          (item) => item.workerId === worker.id && item.status === "available",
        ).length,
      };
    }),
    tasks,
    reviews: assignments.filter((assignment) => assignment.status === "submitted"),
    rewardRequests,
    activities,
    transactions: transactionRows.map((row) => publicTransaction(row, row.worker_name)),
    ...rewardState,
  };
}
