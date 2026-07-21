import { randomInt, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  getDb,
  type AssignmentRewardItemRow,
  type DailyCouponGrantRow,
  type DailyCouponSettingRow,
  type RewardDefinitionImageRow,
  type RewardDefinitionRow,
  type RewardKind,
  type TaskRewardBindingRow,
  type WorkerRewardItemRow,
  type WorkerRow,
} from "@/lib/db";
import { AppError } from "@/lib/http";
import { verifyPassword } from "@/lib/password";
import { dateKey, MINUTE } from "@/lib/time";

type Db = Database.Database;
type Actor = "admin" | `worker:${string}` | "system";

type RewardDefinitionInput = {
  name: string;
  description?: string;
  icon: string;
  theme: string;
  kind: RewardKind;
  randomMinSeconds?: number | null;
  randomMaxSeconds?: number | null;
  fixedSeconds?: number | null;
  physicalDescription?: string | null;
  fulfillmentInstructions?: string | null;
};

type RewardItemJoined = WorkerRewardItemRow & {
  grant_reason: string;
  result_seconds: number | null;
  transaction_id: string | null;
  used_at: number | null;
  worker_name?: string;
};

const REWARD_ICONS = new Set(["gift", "sparkles", "clock", "book", "toy", "food", "trip"]);
const REWARD_THEMES = new Set(["purple", "blue", "green", "orange", "pink"]);

function uniqueId() {
  return randomUUID();
}

function normalizedRequestId(value?: string) {
  return value?.trim() || uniqueId();
}

function getWorker(db: Db, workerId: string, includeInactive = false): WorkerRow {
  const worker = db.prepare("SELECT * FROM workers WHERE id = ?").get(workerId) as WorkerRow | undefined;
  if (!worker || (!includeInactive && !worker.is_active)) {
    throw new AppError("没有找到这个打工人。", 404, "WORKER_NOT_FOUND");
  }
  return worker;
}

function getDefinition(db: Db, definitionId: string): RewardDefinitionRow {
  const definition = db
    .prepare("SELECT * FROM reward_definitions WHERE id = ?")
    .get(definitionId) as RewardDefinitionRow | undefined;
  if (!definition) throw new AppError("没有找到这个奖励券模板。", 404, "REWARD_DEFINITION_NOT_FOUND");
  return definition;
}

function getRewardItem(db: Db, rewardItemId: string): WorkerRewardItemRow {
  const item = db
    .prepare("SELECT * FROM worker_reward_items WHERE id = ?")
    .get(rewardItemId) as WorkerRewardItemRow | undefined;
  if (!item) throw new AppError("没有找到这张奖励券。", 404, "REWARD_ITEM_NOT_FOUND");
  return item;
}

function audit(
  db: Db,
  actor: Actor,
  action: string,
  targetType: string,
  targetId: string | null,
  detail: string,
  requestId: string,
) {
  db.prepare(`
    INSERT INTO audit_logs(id, actor, action, target_type, target_id, detail, request_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uniqueId(), actor, action, targetType, targetId, detail, requestId, Date.now());
}

function previousAuditTarget(db: Db, requestId: string) {
  return db
    .prepare("SELECT target_id, action FROM audit_logs WHERE request_id = ?")
    .get(requestId) as { target_id: string | null; action: string } | undefined;
}

function rewardSystemEnabledWithin(db: Db): boolean {
  const setting = db
    .prepare("SELECT value FROM app_settings WHERE key = 'reward_system_enabled'")
    .get() as { value: string } | undefined;
  return setting?.value !== "0";
}

function assertRewardSystemEnabled(db: Db) {
  if (!rewardSystemEnabledWithin(db)) {
    throw new AppError("奖励系统现在暂停使用，请稍后再试。", 409, "REWARD_SYSTEM_DISABLED");
  }
}

function assertMinuteRange(minSeconds: number | null | undefined, maxSeconds: number | null | undefined) {
  if (
    !Number.isSafeInteger(minSeconds)
    || !Number.isSafeInteger(maxSeconds)
    || minSeconds! < MINUTE
    || maxSeconds! > 1_440 * MINUTE
    || minSeconds! > maxSeconds!
    || minSeconds! % MINUTE !== 0
    || maxSeconds! % MINUTE !== 0
  ) {
    throw new AppError("随机分钟范围必须是 1～1440 的整数分钟，且最小值不能大于最大值。", 400, "INVALID_RANDOM_RANGE");
  }
}

function assertFixedSeconds(value: number | null | undefined) {
  if (!Number.isSafeInteger(value) || value! < MINUTE || value! > 1_440 * MINUTE || value! % MINUTE !== 0) {
    throw new AppError("固定时长必须是 1～1440 的整数分钟。", 400, "INVALID_FIXED_DURATION");
  }
}

function normalizeDefinition(input: RewardDefinitionInput) {
  const name = input.name.trim();
  const description = (input.description || "").trim();
  const physicalDescription = input.physicalDescription?.trim() || null;
  const fulfillmentInstructions = input.fulfillmentInstructions?.trim() || null;
  if (!name || name.length > 60) {
    throw new AppError("模板名称需要填写 1～60 个字。", 400, "INVALID_REWARD_NAME");
  }
  if (description.length > 600) {
    throw new AppError("模板说明不能超过 600 个字。", 400, "INVALID_REWARD_DESCRIPTION");
  }
  if (!REWARD_ICONS.has(input.icon)) {
    throw new AppError("请选择有效的奖励图标。", 400, "INVALID_REWARD_ICON");
  }
  if (!REWARD_THEMES.has(input.theme)) {
    throw new AppError("请选择有效的奖励主题色。", 400, "INVALID_REWARD_THEME");
  }

  if (input.kind === "random_time") {
    assertMinuteRange(input.randomMinSeconds, input.randomMaxSeconds);
  } else if (input.kind === "fixed_time") {
    assertFixedSeconds(input.fixedSeconds);
  } else if (
    !physicalDescription
    || physicalDescription.length > 600
    || !fulfillmentInstructions
    || fulfillmentInstructions.length > 600
  ) {
    throw new AppError("实物券需要填写实物说明和交付说明，每项不超过 600 个字。", 400, "INVALID_PHYSICAL_REWARD");
  }

  return {
    name,
    description,
    icon: input.icon,
    theme: input.theme,
    kind: input.kind,
    randomMinSeconds: input.kind === "random_time" ? input.randomMinSeconds! : null,
    randomMaxSeconds: input.kind === "random_time" ? input.randomMaxSeconds! : null,
    fixedSeconds: input.kind === "fixed_time" ? input.fixedSeconds! : null,
    physicalDescription: input.kind === "physical" ? physicalDescription : null,
    fulfillmentInstructions: input.kind === "physical" ? fulfillmentInstructions : null,
    physicalCategory: input.kind === "physical" ? "physical" : null,
  };
}

function imageUrl(imageId: string | null) {
  return imageId ? `/api/reward-image/${imageId}` : null;
}

function publicDefinition(row: RewardDefinitionRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    theme: row.theme,
    kind: row.kind,
    version: row.version,
    isActive: Boolean(row.is_active),
    randomMinSeconds: row.random_min_seconds,
    randomMaxSeconds: row.random_max_seconds,
    fixedSeconds: row.fixed_seconds,
    physicalDescription: row.physical_description,
    fulfillmentInstructions: row.fulfillment_instructions,
    imageUrl: imageUrl(row.current_image_id),
    validityMode: "permanent" as const,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicRewardItem(row: RewardItemJoined) {
  return {
    id: row.id,
    workerId: row.worker_id,
    workerName: row.worker_name,
    grantBatchId: row.grant_batch_id,
    definitionId: row.definition_id,
    definitionVersion: row.definition_version,
    sourceType: row.source_type,
    sourceId: row.source_id,
    grantedBy: row.granted_by,
    grantReason: row.grant_reason,
    name: row.name_snapshot,
    description: row.description_snapshot,
    icon: row.icon_snapshot,
    theme: row.theme_snapshot,
    kind: row.kind,
    randomMinSeconds: row.random_min_seconds,
    randomMaxSeconds: row.random_max_seconds,
    fixedSeconds: row.fixed_seconds,
    physicalDescription: row.physical_description,
    fulfillmentInstructions: row.fulfillment_instructions,
    imageUrl: imageUrl(row.image_id),
    status: row.status,
    expiresAt: row.expires_at,
    grantedAt: row.granted_at,
    redeemedAt: row.redeemed_at,
    fulfilledAt: row.fulfilled_at,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
    resultSeconds: row.result_seconds,
    transactionId: row.transaction_id,
    usedAt: row.used_at,
  };
}

export type TaskRewardBindingInput = {
  definitionId: string;
  grantTier: "normal" | "excellent_bonus";
  quantity: number;
  probabilityPercent?: number;
};

function assertTaskRewardBinding(input: TaskRewardBindingInput) {
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
    throw new AppError("任务奖励券数量必须是正整数。", 400, "INVALID_REWARD_QUANTITY");
  }
  const probability = input.probabilityPercent ?? 100;
  if (!Number.isInteger(probability) || probability < 0 || probability > 100) {
    throw new AppError("奖励券出现概率必须是 0～100 的整数百分比。", 400, "INVALID_REWARD_PROBABILITY");
  }
  return probability;
}

export function replaceTaskRewardBindingsWithin(
  db: Db,
  taskId: string,
  inputs: TaskRewardBindingInput[],
  bonusEnabled: boolean,
  now = Date.now(),
) {
  const merged = new Map<string, TaskRewardBindingInput & { probabilityPercent: number }>();
  for (const input of inputs) {
    const probabilityPercent = assertTaskRewardBinding(input);
    if (input.grantTier === "excellent_bonus" && !bonusEnabled) {
      throw new AppError("未开启优秀完成时不能配置优秀额外奖励券。", 400, "EXCELLENT_REWARD_NOT_ALLOWED");
    }
    const definition = getDefinition(db, input.definitionId);
    if (!definition.is_active) {
      throw new AppError(`奖励券模板“${definition.name}”已经停用。`, 409, "REWARD_DEFINITION_DISABLED");
    }
    const key = `${input.grantTier}:${input.definitionId}`;
    const previous = merged.get(key);
    if (previous) {
      if (previous.probabilityPercent !== probabilityPercent) {
        throw new AppError("同一区域重复的奖励券必须使用相同概率。", 400, "REWARD_PROBABILITY_CONFLICT");
      }
      const quantity = previous.quantity + input.quantity;
      if (!Number.isSafeInteger(quantity)) {
        throw new AppError("任务奖励券数量过大。", 400, "INVALID_REWARD_QUANTITY");
      }
      previous.quantity = quantity;
    } else {
      merged.set(key, { ...input, probabilityPercent });
    }
  }

  db.prepare("DELETE FROM task_reward_bindings WHERE task_id = ?").run(taskId);
  let sortOrder = 0;
  for (const input of merged.values()) {
    sortOrder += 10;
    db.prepare(`
      INSERT INTO task_reward_bindings(
        id, task_id, definition_id, grant_tier, quantity,
        probability_percent, sort_order, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uniqueId(),
      taskId,
      input.definitionId,
      input.grantTier,
      input.quantity,
      input.probabilityPercent,
      sortOrder,
      now,
    );
  }
}

export function getPublicTaskRewardBindings(db: Db, taskId: string) {
  const bindings = db.prepare(`
    SELECT * FROM task_reward_bindings
    WHERE task_id = ?
    ORDER BY grant_tier, sort_order, created_at
  `).all(taskId) as TaskRewardBindingRow[];
  return bindings.map((binding) => ({
    bindingId: binding.id,
    definitionId: binding.definition_id,
    grantTier: binding.grant_tier,
    quantity: binding.quantity,
    probabilityPercent: binding.probability_percent,
    ...publicDefinition(getDefinition(db, binding.definition_id)),
  }));
}

export function snapshotAssignmentRewardsWithin(
  db: Db,
  assignmentId: string,
  taskId: string,
  now = Date.now(),
) {
  db.prepare("DELETE FROM assignment_reward_items WHERE assignment_id = ?").run(assignmentId);
  const bindings = db.prepare(`
    SELECT * FROM task_reward_bindings
    WHERE task_id = ?
    ORDER BY grant_tier, sort_order, created_at
  `).all(taskId) as TaskRewardBindingRow[];
  for (const binding of bindings) {
    const definition = getDefinition(db, binding.definition_id);
    db.prepare(`
      INSERT INTO assignment_reward_items(
        id, assignment_id, task_reward_binding_id, definition_id, definition_version,
        grant_tier, quantity, probability_percent, sort_order,
        name_snapshot, description_snapshot, icon_snapshot, theme_snapshot, kind,
        random_min_seconds, random_max_seconds, fixed_seconds,
        physical_description, fulfillment_instructions, image_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uniqueId(),
      assignmentId,
      binding.id,
      definition.id,
      definition.version,
      binding.grant_tier,
      binding.quantity,
      binding.probability_percent,
      binding.sort_order,
      definition.name,
      definition.description,
      definition.icon,
      definition.theme,
      definition.kind,
      definition.random_min_seconds,
      definition.random_max_seconds,
      definition.fixed_seconds,
      definition.physical_description,
      definition.fulfillment_instructions,
      definition.current_image_id,
      now,
    );
  }
}

type AssignmentRewardItemWithOutcome = AssignmentRewardItemRow & {
  outcome_count: number;
  awarded_quantity: number;
};

export function getPublicAssignmentRewardItems(db: Db, assignmentId: string) {
  const rows = db.prepare(`
    SELECT i.*,
      COUNT(o.id) AS outcome_count,
      COALESCE(SUM(o.awarded), 0) AS awarded_quantity
    FROM assignment_reward_items i
    LEFT JOIN assignment_reward_outcomes o ON o.assignment_reward_item_id = i.id
    WHERE i.assignment_id = ?
    GROUP BY i.id
    ORDER BY i.grant_tier, i.sort_order, i.created_at
  `).all(assignmentId) as AssignmentRewardItemWithOutcome[];
  return rows.map((row) => ({
    id: row.id,
    definitionId: row.definition_id,
    definitionVersion: row.definition_version,
    grantTier: row.grant_tier,
    quantity: row.quantity,
    probabilityPercent: row.probability_percent,
    name: row.name_snapshot,
    description: row.description_snapshot,
    icon: row.icon_snapshot,
    theme: row.theme_snapshot,
    kind: row.kind,
    randomMinSeconds: row.random_min_seconds,
    randomMaxSeconds: row.random_max_seconds,
    fixedSeconds: row.fixed_seconds,
    physicalDescription: row.physical_description,
    fulfillmentInstructions: row.fulfillment_instructions,
    imageUrl: imageUrl(row.image_id),
    outcomeCount: row.outcome_count,
    awardedQuantity: row.outcome_count > 0 ? row.awarded_quantity : null,
  }));
}

export function isRewardSystemEnabled() {
  return rewardSystemEnabledWithin(getDb());
}

export function setRewardSystemEnabled(enabled: boolean, requestId?: string) {
  const db = getDb();
  const mutationId = normalizedRequestId(requestId);
  return db.transaction(() => {
    const previous = previousAuditTarget(db, mutationId);
    if (previous) return { duplicated: true, enabled: rewardSystemEnabledWithin(db) };
    const now = Date.now();
    db.prepare(`
      INSERT INTO app_settings(key, value, updated_at) VALUES ('reward_system_enabled', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(enabled ? "1" : "0", now);
    audit(
      db,
      "admin",
      enabled ? "reward_system_enabled" : "reward_system_disabled",
      "app_setting",
      "reward_system_enabled",
      enabled ? "启用奖励系统" : "暂停奖励系统的新发放和使用",
      mutationId,
    );
    return { duplicated: false, enabled };
  }).immediate();
}

export function createRewardDefinition(input: RewardDefinitionInput & { requestId?: string }) {
  const db = getDb();
  const values = normalizeDefinition(input);
  const mutationId = normalizedRequestId(input.requestId);
  return db.transaction(() => {
    const previous = previousAuditTarget(db, mutationId);
    if (previous?.target_id) return previous.target_id;
    const id = uniqueId();
    const now = Date.now();
    db.prepare(`
      INSERT INTO reward_definitions(
        id, name, description, icon, theme, kind, version, is_active,
        random_min_seconds, random_max_seconds, fixed_seconds,
        physical_description, fulfillment_instructions, physical_category,
        current_image_id, validity_mode, validity_days, validity_fixed_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?, NULL, 'permanent', NULL, NULL, ?, ?)
    `).run(
      id,
      values.name,
      values.description,
      values.icon,
      values.theme,
      values.kind,
      values.randomMinSeconds,
      values.randomMaxSeconds,
      values.fixedSeconds,
      values.physicalDescription,
      values.fulfillmentInstructions,
      values.physicalCategory,
      now,
      now,
    );
    audit(db, "admin", "reward_definition_created", "reward_definition", id, `创建模板：${values.name}`, mutationId);
    return id;
  }).immediate();
}

export function updateRewardDefinition(input: RewardDefinitionInput & { definitionId: string; requestId?: string }) {
  const db = getDb();
  const values = normalizeDefinition(input);
  const mutationId = normalizedRequestId(input.requestId);
  return db.transaction(() => {
    const previous = previousAuditTarget(db, mutationId);
    if (previous) return { duplicated: true };
    const current = getDefinition(db, input.definitionId);
    const now = Date.now();
    db.prepare(`
      UPDATE reward_definitions SET
        name = ?, description = ?, icon = ?, theme = ?, kind = ?,
        random_min_seconds = ?, random_max_seconds = ?, fixed_seconds = ?,
        physical_description = ?, fulfillment_instructions = ?, physical_category = ?,
        current_image_id = ?, version = version + 1, updated_at = ?
      WHERE id = ?
    `).run(
      values.name,
      values.description,
      values.icon,
      values.theme,
      values.kind,
      values.randomMinSeconds,
      values.randomMaxSeconds,
      values.fixedSeconds,
      values.physicalDescription,
      values.fulfillmentInstructions,
      values.physicalCategory,
      values.kind === "physical" ? current.current_image_id : null,
      now,
      current.id,
    );
    audit(db, "admin", "reward_definition_updated", "reward_definition", current.id, `更新模板：${values.name}`, mutationId);
    return { duplicated: false };
  }).immediate();
}

export function copyRewardDefinition(definitionId: string, requestId?: string) {
  const db = getDb();
  const mutationId = normalizedRequestId(requestId);
  return db.transaction(() => {
    const previous = previousAuditTarget(db, mutationId);
    if (previous?.target_id) return previous.target_id;
    const source = getDefinition(db, definitionId);
    const id = uniqueId();
    const now = Date.now();
    const copiedName = `${source.name}（副本）`.slice(0, 60);
    db.prepare(`
      INSERT INTO reward_definitions(
        id, name, description, icon, theme, kind, version, is_active,
        random_min_seconds, random_max_seconds, fixed_seconds,
        physical_description, fulfillment_instructions, physical_category,
        current_image_id, validity_mode, validity_days, validity_fixed_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?, NULL, 'permanent', NULL, NULL, ?, ?)
    `).run(
      id,
      copiedName,
      source.description,
      source.icon,
      source.theme,
      source.kind,
      source.random_min_seconds,
      source.random_max_seconds,
      source.fixed_seconds,
      source.physical_description,
      source.fulfillment_instructions,
      source.physical_category,
      now,
      now,
    );

    if (source.current_image_id) {
      const image = db
        .prepare("SELECT * FROM reward_definition_images WHERE id = ?")
        .get(source.current_image_id) as RewardDefinitionImageRow | undefined;
      if (image) {
        const copiedImageId = uniqueId();
        db.prepare(`
          INSERT INTO reward_definition_images(id, definition_id, mime_type, image_data, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(copiedImageId, id, image.mime_type, image.image_data, now);
        db.prepare("UPDATE reward_definitions SET current_image_id = ? WHERE id = ?").run(copiedImageId, id);
      }
    }
    audit(db, "admin", "reward_definition_copied", "reward_definition", id, `复制模板：${source.name}`, mutationId);
    return id;
  }).immediate();
}

export function setRewardDefinitionActive(definitionId: string, active: boolean, requestId?: string) {
  const db = getDb();
  const mutationId = normalizedRequestId(requestId);
  return db.transaction(() => {
    const previous = previousAuditTarget(db, mutationId);
    if (previous) return { duplicated: true };
    const definition = getDefinition(db, definitionId);
    db.prepare("UPDATE reward_definitions SET is_active = ?, updated_at = ? WHERE id = ?")
      .run(active ? 1 : 0, Date.now(), definition.id);
    audit(
      db,
      "admin",
      active ? "reward_definition_enabled" : "reward_definition_disabled",
      "reward_definition",
      definition.id,
      `${active ? "启用" : "停用"}模板：${definition.name}`,
      mutationId,
    );
    return { duplicated: false };
  }).immediate();
}

function rewardImageMime(data: Buffer): RewardDefinitionImageRow["mime_type"] | null {
  if (
    data.length >= 12
    && data.subarray(0, 4).toString("ascii") === "RIFF"
    && data.subarray(8, 12).toString("ascii") === "WEBP"
  ) return "image/webp";
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return "image/png";
  }
  if (data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255) return "image/jpeg";
  return null;
}

export function setRewardDefinitionImage(input: {
  definitionId: string;
  imageDataUrl: string;
  requestId?: string;
}) {
  const match = /^data:image\/(?:webp|png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(input.imageDataUrl);
  if (!match) throw new AppError("图片格式不正确，请选择 JPG、PNG 或 WebP 图片。", 400, "INVALID_REWARD_IMAGE");
  const imageData = Buffer.from(match[1], "base64");
  const mimeType = rewardImageMime(imageData);
  if (!mimeType) throw new AppError("无法识别这张奖励图片。", 400, "INVALID_REWARD_IMAGE");
  if (imageData.length > 512 * 1024) {
    throw new AppError("压缩后的奖励图片不能超过 512KB。", 400, "REWARD_IMAGE_TOO_LARGE");
  }

  const db = getDb();
  const mutationId = normalizedRequestId(input.requestId);
  return db.transaction(() => {
    const previous = previousAuditTarget(db, mutationId);
    if (previous?.target_id) return imageUrl(previous.target_id);
    const definition = getDefinition(db, input.definitionId);
    if (definition.kind !== "physical") {
      throw new AppError("只有实物券可以上传自定义图片。", 409, "IMAGE_NOT_ALLOWED");
    }
    const imageId = uniqueId();
    const now = Date.now();
    db.prepare(`
      INSERT INTO reward_definition_images(id, definition_id, mime_type, image_data, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(imageId, definition.id, mimeType, imageData, now);
    db.prepare(`
      UPDATE reward_definitions
      SET current_image_id = ?, version = version + 1, updated_at = ?
      WHERE id = ?
    `).run(imageId, now, definition.id);
    audit(
      db,
      "admin",
      "reward_definition_image_updated",
      "reward_definition_image",
      imageId,
      `更新实物券图片：${mimeType}，${imageData.length} 字节`,
      mutationId,
    );
    return imageUrl(imageId);
  }).immediate();
}

export function removeRewardDefinitionImage(definitionId: string, requestId?: string) {
  const db = getDb();
  const mutationId = normalizedRequestId(requestId);
  return db.transaction(() => {
    const previous = previousAuditTarget(db, mutationId);
    if (previous) return { duplicated: true };
    const definition = getDefinition(db, definitionId);
    if (definition.kind !== "physical") {
      throw new AppError("只有实物券可以设置自定义图片。", 409, "IMAGE_NOT_ALLOWED");
    }
    if (definition.current_image_id) {
      db.prepare(`
        UPDATE reward_definitions
        SET current_image_id = NULL, version = version + 1, updated_at = ?
        WHERE id = ?
      `).run(Date.now(), definition.id);
    }
    audit(
      db,
      "admin",
      "reward_definition_image_removed",
      "reward_definition",
      definition.id,
      "恢复显示默认奖励图标",
      mutationId,
    );
    return { duplicated: false };
  }).immediate();
}

export function getRewardDefinitionImage(imageId: string): RewardDefinitionImageRow | null {
  return (getDb()
    .prepare("SELECT * FROM reward_definition_images WHERE id = ?")
    .get(imageId) as RewardDefinitionImageRow | undefined) || null;
}

function ensureDailySettingWithin(db: Db, workerId: string, now = Date.now()): DailyCouponSettingRow {
  db.prepare(`
    INSERT OR IGNORE INTO worker_daily_coupon_settings(
      worker_id, is_enabled, daily_quantity, random_min_seconds, random_max_seconds, updated_at
    ) VALUES (?, 0, 0, 300, 900, ?)
  `).run(workerId, now);
  return db
    .prepare("SELECT * FROM worker_daily_coupon_settings WHERE worker_id = ?")
    .get(workerId) as DailyCouponSettingRow;
}

function publicDailySetting(row: DailyCouponSettingRow) {
  return {
    workerId: row.worker_id,
    isEnabled: Boolean(row.is_enabled),
    dailyQuantity: row.daily_quantity,
    randomMinSeconds: row.random_min_seconds,
    randomMaxSeconds: row.random_max_seconds,
    updatedAt: row.updated_at,
  };
}

function publicDailyGrant(row: DailyCouponGrantRow) {
  return {
    id: row.id,
    workerId: row.worker_id,
    localDate: row.local_date,
    enabledSnapshot: Boolean(row.enabled_snapshot),
    quantitySnapshot: row.quantity_snapshot,
    randomMinSeconds: row.random_min_seconds,
    randomMaxSeconds: row.random_max_seconds,
    actualQuantity: row.actual_quantity,
    createdAt: row.created_at,
  };
}

export function updateDailyCouponSetting(input: {
  workerId: string;
  isEnabled: boolean;
  dailyQuantity: number;
  randomMinSeconds: number;
  randomMaxSeconds: number;
  requestId?: string;
}) {
  assertMinuteRange(input.randomMinSeconds, input.randomMaxSeconds);
  if (!Number.isSafeInteger(input.dailyQuantity) || input.dailyQuantity < 0) {
    throw new AppError("每日派发张数必须是非负整数。", 400, "INVALID_DAILY_QUANTITY");
  }
  if (input.isEnabled && input.dailyQuantity < 1) {
    throw new AppError("开启每日派券时，派发张数至少为 1。", 400, "INVALID_DAILY_QUANTITY");
  }
  const quantity = input.isEnabled ? input.dailyQuantity : 0;
  const db = getDb();
  const mutationId = normalizedRequestId(input.requestId);
  return db.transaction(() => {
    const previous = previousAuditTarget(db, mutationId);
    if (previous) return { duplicated: true };
    getWorker(db, input.workerId, true);
    const now = Date.now();
    db.prepare(`
      INSERT INTO worker_daily_coupon_settings(
        worker_id, is_enabled, daily_quantity, random_min_seconds, random_max_seconds, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(worker_id) DO UPDATE SET
        is_enabled = excluded.is_enabled,
        daily_quantity = excluded.daily_quantity,
        random_min_seconds = excluded.random_min_seconds,
        random_max_seconds = excluded.random_max_seconds,
        updated_at = excluded.updated_at
    `).run(
      input.workerId,
      input.isEnabled ? 1 : 0,
      quantity,
      input.randomMinSeconds,
      input.randomMaxSeconds,
      now,
    );
    audit(
      db,
      "admin",
      "daily_coupon_setting_updated",
      "worker",
      input.workerId,
      input.isEnabled
        ? `每日派发 ${quantity} 张 ${input.randomMinSeconds / MINUTE}～${input.randomMaxSeconds / MINUTE} 分钟随机券`
        : "关闭每日免费派券",
      mutationId,
    );
    return { duplicated: false };
  }).immediate();
}

function insertRewardItemFromDefinition(
  db: Db,
  definition: RewardDefinitionRow,
  values: {
    workerId: string;
    batchId: string;
    sourceType: "admin_direct";
    sourceId?: string | null;
    grantedBy: Actor;
    now: number;
  },
) {
  const id = uniqueId();
  db.prepare(`
    INSERT INTO worker_reward_items(
      id, worker_id, grant_batch_id, definition_id, definition_version,
      source_type, source_id, granted_by,
      name_snapshot, description_snapshot, icon_snapshot, theme_snapshot, kind,
      random_min_seconds, random_max_seconds, fixed_seconds,
      physical_description, fulfillment_instructions, image_id,
      status, expires_at, granted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', NULL, ?)
  `).run(
    id,
    values.workerId,
    values.batchId,
    definition.id,
    definition.version,
    values.sourceType,
    values.sourceId || null,
    values.grantedBy,
    definition.name,
    definition.description,
    definition.icon,
    definition.theme,
    definition.kind,
    definition.random_min_seconds,
    definition.random_max_seconds,
    definition.fixed_seconds,
    definition.physical_description,
    definition.fulfillment_instructions,
    definition.current_image_id,
    values.now,
  );
  return id;
}

function insertDailyRewardItem(
  db: Db,
  values: {
    workerId: string;
    batchId: string;
    dailyGrantId: string;
    minSeconds: number;
    maxSeconds: number;
    now: number;
  },
) {
  const id = uniqueId();
  db.prepare(`
    INSERT INTO worker_reward_items(
      id, worker_id, grant_batch_id, definition_id, definition_version,
      source_type, source_id, granted_by,
      name_snapshot, description_snapshot, icon_snapshot, theme_snapshot, kind,
      random_min_seconds, random_max_seconds, fixed_seconds,
      physical_description, fulfillment_instructions, image_id,
      status, expires_at, granted_at
    ) VALUES (?, ?, ?, NULL, NULL, 'daily', ?, 'system',
      '每日随机时间券', '今天的小惊喜，使用时会随机获得时间币。', 'sparkles', 'purple', 'random_time',
      ?, ?, NULL, NULL, NULL, NULL, 'available', NULL, ?)
  `).run(
    id,
    values.workerId,
    values.batchId,
    values.dailyGrantId,
    values.minSeconds,
    values.maxSeconds,
    values.now,
  );
  return id;
}

function insertTaskRewardItem(
  db: Db,
  snapshot: AssignmentRewardItemRow,
  values: {
    workerId: string;
    batchId: string;
    assignmentId: string;
    now: number;
  },
) {
  const id = uniqueId();
  db.prepare(`
    INSERT INTO worker_reward_items(
      id, worker_id, grant_batch_id, definition_id, definition_version,
      source_type, source_id, granted_by,
      name_snapshot, description_snapshot, icon_snapshot, theme_snapshot, kind,
      random_min_seconds, random_max_seconds, fixed_seconds,
      physical_description, fulfillment_instructions, image_id,
      status, expires_at, granted_at
    ) VALUES (?, ?, ?, ?, ?, 'task', ?, 'admin', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', NULL, ?)
  `).run(
    id,
    values.workerId,
    values.batchId,
    snapshot.definition_id,
    snapshot.definition_version,
    values.assignmentId,
    snapshot.name_snapshot,
    snapshot.description_snapshot,
    snapshot.icon_snapshot,
    snapshot.theme_snapshot,
    snapshot.kind,
    snapshot.random_min_seconds,
    snapshot.random_max_seconds,
    snapshot.fixed_seconds,
    snapshot.physical_description,
    snapshot.fulfillment_instructions,
    snapshot.image_id,
    values.now,
  );
  return id;
}

export function grantAssignmentRewardsWithin(
  db: Db,
  input: {
    assignmentId: string;
    workerId: string;
    excellent: boolean;
    reviewNote: string;
    requestId: string;
    now: number;
  },
) {
  const snapshots = db.prepare(`
    SELECT * FROM assignment_reward_items
    WHERE assignment_id = ?
      AND (grant_tier = 'normal' OR (? = 1 AND grant_tier = 'excellent_bonus'))
    ORDER BY grant_tier, sort_order, created_at
  `).all(input.assignmentId, input.excellent ? 1 : 0) as AssignmentRewardItemRow[];
  if (snapshots.length === 0) {
    return { batchId: null, configuredQuantity: 0, awardedQuantity: 0 };
  }
  assertRewardSystemEnabled(db);
  const batchId = uniqueId();
  const batchRequestId = `task-review:${input.requestId}`;
  db.prepare(`
    INSERT INTO reward_grant_batches(
      id, worker_id, source_type, source_id, actor, reason, request_id, created_at
    ) VALUES (?, ?, 'task', ?, 'admin', ?, ?, ?)
  `).run(
    batchId,
    input.workerId,
    input.assignmentId,
    input.reviewNote || (input.excellent ? "优秀完成任务" : "任务审核通过"),
    batchRequestId,
    input.now,
  );

  let configuredQuantity = 0;
  let awardedQuantity = 0;
  for (const snapshot of snapshots) {
    for (let sequence = 1; sequence <= snapshot.quantity; sequence += 1) {
      configuredQuantity += 1;
      const rollPercent = randomInt(1, 101);
      const awarded = rollPercent <= snapshot.probability_percent;
      const rewardItemId = awarded
        ? insertTaskRewardItem(db, snapshot, {
          workerId: input.workerId,
          batchId,
          assignmentId: input.assignmentId,
          now: input.now,
        })
        : null;
      if (awarded) awardedQuantity += 1;
      db.prepare(`
        INSERT INTO assignment_reward_outcomes(
          id, assignment_reward_item_id, sequence_number,
          roll_percent, awarded, worker_reward_item_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        uniqueId(),
        snapshot.id,
        sequence,
        rollPercent,
        awarded ? 1 : 0,
        rewardItemId,
        input.now,
      );
    }
  }
  return { batchId, configuredQuantity, awardedQuantity };
}

export function grantDailyCouponsWithin(db: Db, workerId: string, now = Date.now()) {
  const worker = getWorker(db, workerId, true);
  if (!worker.is_active || !rewardSystemEnabledWithin(db)) return false;
  const setting = ensureDailySettingWithin(db, workerId, now);
  const localDate = dateKey(now, worker.timezone);
  const existing = db
    .prepare("SELECT id FROM daily_coupon_grants WHERE worker_id = ? AND local_date = ?")
    .get(workerId, localDate);
  if (existing) return false;

  const dailyGrantId = uniqueId();
  const batchId = uniqueId();
  const mutationId = `daily-coupon:${workerId}:${localDate}`;
  const quantity = setting.is_enabled ? setting.daily_quantity : 0;
  const inserted = db.prepare(`
    INSERT OR IGNORE INTO reward_grant_batches(
      id, worker_id, source_type, source_id, actor, reason, request_id, created_at
    ) VALUES (?, ?, 'daily', ?, 'system', ?, ?, ?)
  `).run(
    batchId,
    workerId,
    dailyGrantId,
    quantity > 0 ? `每日免费派发 ${quantity} 张随机时间券` : "今日每日派券设置为关闭",
    mutationId,
    now,
  );
  if (!inserted.changes) return false;

  db.prepare(`
    INSERT INTO daily_coupon_grants(
      id, worker_id, local_date, enabled_snapshot, quantity_snapshot,
      random_min_seconds, random_max_seconds, actual_quantity, grant_batch_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    dailyGrantId,
    workerId,
    localDate,
    setting.is_enabled,
    setting.daily_quantity,
    setting.random_min_seconds,
    setting.random_max_seconds,
    quantity,
    batchId,
    now,
  );
  for (let index = 0; index < quantity; index += 1) {
    insertDailyRewardItem(db, {
      workerId,
      batchId,
      dailyGrantId,
      minSeconds: setting.random_min_seconds,
      maxSeconds: setting.random_max_seconds,
      now,
    });
  }
  return true;
}

export function grantRewardDefinition(input: {
  workerId: string;
  definitionId: string;
  quantity: number;
  reason: string;
  requestId?: string;
}) {
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
    throw new AppError("发放数量必须是正整数。", 400, "INVALID_REWARD_QUANTITY");
  }
  const reason = input.reason.trim();
  if (!reason || reason.length > 500) {
    throw new AppError("请填写 1～500 个字的发放原因。", 400, "REWARD_REASON_REQUIRED");
  }
  const db = getDb();
  const mutationId = normalizedRequestId(input.requestId);
  return db.transaction(() => {
    const previous = db
      .prepare("SELECT id FROM reward_grant_batches WHERE request_id = ?")
      .get(mutationId) as { id: string } | undefined;
    if (previous) {
      const rows = db
        .prepare("SELECT id FROM worker_reward_items WHERE grant_batch_id = ? ORDER BY granted_at, id")
        .all(previous.id) as Array<{ id: string }>;
      return { duplicated: true, batchId: previous.id, rewardItemIds: rows.map((row) => row.id) };
    }
    assertRewardSystemEnabled(db);
    getWorker(db, input.workerId);
    const definition = getDefinition(db, input.definitionId);
    if (!definition.is_active) {
      throw new AppError("这个奖励券模板已经停用。", 409, "REWARD_DEFINITION_DISABLED");
    }
    const batchId = uniqueId();
    const now = Date.now();
    db.prepare(`
      INSERT INTO reward_grant_batches(
        id, worker_id, source_type, source_id, actor, reason, request_id, created_at
      ) VALUES (?, ?, 'admin_direct', ?, 'admin', ?, ?, ?)
    `).run(batchId, input.workerId, definition.id, reason, mutationId, now);
    const rewardItemIds: string[] = [];
    for (let index = 0; index < input.quantity; index += 1) {
      rewardItemIds.push(insertRewardItemFromDefinition(db, definition, {
        workerId: input.workerId,
        batchId,
        sourceType: "admin_direct",
        sourceId: definition.id,
        grantedBy: "admin",
        now,
      }));
    }
    audit(
      db,
      "admin",
      "reward_items_granted",
      "reward_grant_batch",
      batchId,
      `发放 ${definition.name} × ${input.quantity}；原因：${reason}`,
      mutationId,
    );
    return { duplicated: false, batchId, rewardItemIds };
  }).immediate();
}

export function cancelRewardItem(input: {
  rewardItemId: string;
  reason: string;
  requestId?: string;
}) {
  const reason = input.reason.trim();
  if (!reason || reason.length > 500) {
    throw new AppError("请填写 1～500 个字的撤销原因。", 400, "CANCELLATION_REASON_REQUIRED");
  }
  const db = getDb();
  const mutationId = normalizedRequestId(input.requestId);
  return db.transaction(() => {
    const previous = previousAuditTarget(db, mutationId);
    if (previous) {
      if (previous.target_id !== input.rewardItemId) {
        throw new AppError("请求编号已用于另一项操作。", 409, "REQUEST_ID_CONFLICT");
      }
      return { duplicated: true };
    }
    const item = getRewardItem(db, input.rewardItemId);
    if (item.status !== "available") {
      throw new AppError("只有尚未使用的奖励券可以撤销。", 409, "REWARD_ITEM_NOT_AVAILABLE");
    }
    const now = Date.now();
    db.prepare(`
      UPDATE worker_reward_items
      SET status = 'cancelled', cancelled_at = ?, cancellation_reason = ?
      WHERE id = ? AND status = 'available'
    `).run(now, reason, item.id);
    audit(db, "admin", "reward_item_cancelled", "worker_reward_item", item.id, reason, mutationId);
    return { duplicated: false };
  }).immediate();
}

type RewardUseRow = {
  id: string;
  reward_item_id: string;
  worker_id: string;
  kind: RewardKind;
  result_seconds: number | null;
  transaction_id: string | null;
  request_id: string;
  created_at: number;
};

function previousUse(db: Db, mutationId: string, rewardItemId: string) {
  const use = db
    .prepare("SELECT * FROM reward_coupon_uses WHERE request_id = ?")
    .get(mutationId) as RewardUseRow | undefined;
  if (use && use.reward_item_id !== rewardItemId) {
    throw new AppError("请求编号已用于另一张奖励券。", 409, "REQUEST_ID_CONFLICT");
  }
  return use;
}

function assertUsableRewardItem(db: Db, workerId: string, rewardItemId: string, now: number) {
  assertRewardSystemEnabled(db);
  const item = getRewardItem(db, rewardItemId);
  if (item.worker_id !== workerId) {
    throw new AppError("不能使用别人的奖励券。", 403, "FORBIDDEN");
  }
  if (item.status !== "available") {
    throw new AppError("这张奖励券已经处理过了。", 409, "REWARD_ITEM_NOT_AVAILABLE");
  }
  if (item.expires_at !== null && item.expires_at <= now) {
    db.prepare("UPDATE worker_reward_items SET status = 'expired' WHERE id = ? AND status = 'available'").run(item.id);
    throw new AppError("这张奖励券已经过期。", 409, "REWARD_ITEM_EXPIRED");
  }
  return item;
}

export function redeemTimeReward(input: {
  workerId: string;
  rewardItemId: string;
  requestId?: string;
}) {
  const db = getDb();
  const mutationId = normalizedRequestId(input.requestId);
  return db.transaction(() => {
    const existing = previousUse(db, mutationId, input.rewardItemId);
    if (existing) {
      return {
        duplicated: true,
        resultSeconds: existing.result_seconds!,
        transactionId: existing.transaction_id!,
      };
    }
    const now = Date.now();
    const item = assertUsableRewardItem(db, input.workerId, input.rewardItemId, now);
    if (item.kind === "physical") {
      throw new AppError("实物券需要在收到实物后输入当前密码确认。", 409, "PHYSICAL_CONFIRMATION_REQUIRED");
    }
    const worker = getWorker(db, input.workerId);
    const resultSeconds = item.kind === "random_time"
      ? randomInt(item.random_min_seconds! / MINUTE, item.random_max_seconds! / MINUTE + 1) * MINUTE
      : item.fixed_seconds!;
    const nextBalance = worker.balance_seconds + resultSeconds;
    const transactionId = uniqueId();
    db.prepare("UPDATE workers SET balance_seconds = ?, updated_at = ? WHERE id = ?")
      .run(nextBalance, now, worker.id);
    db.prepare(`
      INSERT INTO transactions(
        id, worker_id, type, title, amount_seconds, balance_after_seconds,
        assignment_id, consumption_activity_id, reward_item_id,
        actor, reason, request_id, started_at, ended_at, created_at
      ) VALUES (?, ?, 'coupon_reward', ?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, NULL, ?)
    `).run(
      transactionId,
      worker.id,
      item.kind === "random_time" ? `随机时间券：${item.name_snapshot}` : `固定时间券：${item.name_snapshot}`,
      resultSeconds,
      nextBalance,
      item.id,
      `worker:${worker.id}`,
      item.kind === "random_time" ? `随机获得 ${resultSeconds / MINUTE} 分钟` : `使用固定 ${resultSeconds / MINUTE} 分钟券`,
      mutationId,
      now,
    );
    db.prepare(`
      INSERT INTO reward_coupon_uses(
        id, reward_item_id, worker_id, kind,
        random_min_seconds, random_max_seconds, result_seconds, transaction_id,
        confirmation_method, confirmed_worker_id, request_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
    `).run(
      uniqueId(),
      item.id,
      worker.id,
      item.kind,
      item.kind === "random_time" ? item.random_min_seconds : null,
      item.kind === "random_time" ? item.random_max_seconds : null,
      resultSeconds,
      transactionId,
      mutationId,
      now,
    );
    const updated = db.prepare(`
      UPDATE worker_reward_items SET status = 'redeemed', redeemed_at = ?
      WHERE id = ? AND status = 'available'
    `).run(now, item.id);
    if (updated.changes !== 1) {
      throw new AppError("这张奖励券已经被使用。", 409, "REWARD_ITEM_NOT_AVAILABLE");
    }
    audit(
      db,
      `worker:${worker.id}`,
      "reward_item_redeemed",
      "worker_reward_item",
      item.id,
      `获得 ${resultSeconds / MINUTE} 分钟时间币`,
      mutationId,
    );
    return { duplicated: false, resultSeconds, transactionId, balanceSeconds: nextBalance };
  }).immediate();
}

export async function confirmPhysicalReward(input: {
  workerId: string;
  rewardItemId: string;
  password: string;
  requestId?: string;
}) {
  const db = getDb();
  const mutationId = normalizedRequestId(input.requestId);
  const existing = previousUse(db, mutationId, input.rewardItemId);
  if (existing) return { duplicated: true, fulfilledAt: existing.created_at };

  const item = getRewardItem(db, input.rewardItemId);
  if (item.worker_id !== input.workerId) {
    throw new AppError("不能确认别人的实物券。", 403, "FORBIDDEN");
  }
  if (item.kind !== "physical") {
    throw new AppError("只有实物券需要密码确认。", 409, "NOT_PHYSICAL_REWARD");
  }
  if (item.status !== "available") {
    throw new AppError("这张实物券已经处理过了。", 409, "REWARD_ITEM_NOT_AVAILABLE");
  }
  assertRewardSystemEnabled(db);
  const worker = getWorker(db, input.workerId);
  if (!(await verifyPassword(input.password, worker.password_hash))) {
    throw new AppError("密码不正确，请再试一次。", 401, "INVALID_PASSWORD");
  }

  return db.transaction(() => {
    const duplicate = previousUse(db, mutationId, input.rewardItemId);
    if (duplicate) return { duplicated: true, fulfilledAt: duplicate.created_at };
    const now = Date.now();
    const current = assertUsableRewardItem(db, input.workerId, input.rewardItemId, now);
    if (current.kind !== "physical") {
      throw new AppError("只有实物券需要密码确认。", 409, "NOT_PHYSICAL_REWARD");
    }
    db.prepare(`
      INSERT INTO reward_coupon_uses(
        id, reward_item_id, worker_id, kind,
        random_min_seconds, random_max_seconds, result_seconds, transaction_id,
        confirmation_method, confirmed_worker_id, request_id, created_at
      ) VALUES (?, ?, ?, 'physical', NULL, NULL, NULL, NULL, 'worker_password', ?, ?, ?)
    `).run(uniqueId(), current.id, input.workerId, input.workerId, mutationId, now);
    const updated = db.prepare(`
      UPDATE worker_reward_items SET status = 'fulfilled', fulfilled_at = ?
      WHERE id = ? AND status = 'available'
    `).run(now, current.id);
    if (updated.changes !== 1) {
      throw new AppError("这张实物券已经被确认。", 409, "REWARD_ITEM_NOT_AVAILABLE");
    }
    audit(
      db,
      `worker:${input.workerId}`,
      "physical_reward_fulfilled",
      "worker_reward_item",
      current.id,
      "打工人使用当前密码确认已经收到实物",
      mutationId,
    );
    return { duplicated: false, fulfilledAt: now };
  }).immediate();
}

const rewardItemSelect = `
  SELECT i.*, b.reason AS grant_reason,
    u.result_seconds AS result_seconds,
    u.transaction_id AS transaction_id,
    u.created_at AS used_at
  FROM worker_reward_items i
  JOIN reward_grant_batches b ON b.id = i.grant_batch_id
  LEFT JOIN reward_coupon_uses u ON u.reward_item_id = i.id
`;

function listWorkerRewardItems(db: Db, workerId: string) {
  return (db.prepare(`
    ${rewardItemSelect}
    WHERE i.worker_id = ?
    ORDER BY i.granted_at DESC, i.id DESC
    LIMIT 300
  `).all(workerId) as RewardItemJoined[]).map(publicRewardItem);
}

function listAdminRewardItems(db: Db) {
  return (db.prepare(`
    SELECT i.*, b.reason AS grant_reason,
      u.result_seconds AS result_seconds,
      u.transaction_id AS transaction_id,
      u.created_at AS used_at,
      w.name AS worker_name
    FROM worker_reward_items i
    JOIN reward_grant_batches b ON b.id = i.grant_batch_id
    JOIN workers w ON w.id = i.worker_id
    LEFT JOIN reward_coupon_uses u ON u.reward_item_id = i.id
    ORDER BY i.granted_at DESC, i.id DESC
    LIMIT 500
  `).all() as RewardItemJoined[]).map(publicRewardItem);
}

export function getWorkerRewardState(workerId: string, now = Date.now()) {
  const db = getDb();
  const worker = getWorker(db, workerId);
  const setting = ensureDailySettingWithin(db, workerId, now);
  const today = dateKey(now, worker.timezone);
  const dailyGrant = db
    .prepare("SELECT * FROM daily_coupon_grants WHERE worker_id = ? AND local_date = ?")
    .get(workerId, today) as DailyCouponGrantRow | undefined;
  const rewardItems = listWorkerRewardItems(db, workerId);
  return {
    rewardSystemEnabled: rewardSystemEnabledWithin(db),
    rewardItems,
    availableRewardCount: rewardItems.filter((item) => item.status === "available").length,
    dailyCouponSetting: publicDailySetting(setting),
    todayDailyCouponGrant: dailyGrant ? publicDailyGrant(dailyGrant) : null,
  };
}

export function getAdminRewardState(now = Date.now()) {
  const db = getDb();
  const definitions = (db
    .prepare("SELECT * FROM reward_definitions ORDER BY is_active DESC, created_at DESC")
    .all() as RewardDefinitionRow[]).map(publicDefinition);
  const settings = (db
    .prepare("SELECT * FROM worker_daily_coupon_settings ORDER BY worker_id")
    .all() as DailyCouponSettingRow[]).map(publicDailySetting);
  const dailyGrants = (db
    .prepare("SELECT * FROM daily_coupon_grants ORDER BY created_at DESC LIMIT 200")
    .all() as DailyCouponGrantRow[]).map(publicDailyGrant);
  const workers = db
    .prepare("SELECT id, timezone FROM workers")
    .all() as Array<{ id: string; timezone: string }>;
  const todayByWorker = Object.fromEntries(workers.map((worker) => [worker.id, dateKey(now, worker.timezone)]));
  const todayDailyCouponGrants = Object.fromEntries(
    dailyGrants
      .filter((grant) => todayByWorker[grant.workerId] === grant.localDate)
      .map((grant) => [grant.workerId, grant]),
  );
  return {
    rewardSystemEnabled: rewardSystemEnabledWithin(db),
    rewardDefinitions: definitions,
    rewardItems: listAdminRewardItems(db),
    dailyCouponSettings: settings,
    dailyCouponGrants: dailyGrants,
    todayDailyCouponGrants,
  };
}
