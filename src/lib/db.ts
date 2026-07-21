import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "@/lib/config";

declare global {
  var __penWorkerDatabase: Database.Database | undefined;
  var __penWorkerSchemaVersion: number | undefined;
}

const CURRENT_SCHEMA_VERSION = 7;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 30),
  avatar TEXT NOT NULL DEFAULT 'star',
  theme TEXT NOT NULL DEFAULT 'purple',
  password_hash TEXT NOT NULL,
  auth_version INTEGER NOT NULL DEFAULT 1,
  balance_seconds INTEGER NOT NULL DEFAULT 0 CHECK(balance_seconds >= 0),
  daily_reward_seconds INTEGER NOT NULL DEFAULT 7200 CHECK(daily_reward_seconds BETWEEN 0 AND 86400),
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS worker_avatar_images (
  worker_id TEXT PRIMARY KEY REFERENCES workers(id) ON DELETE CASCADE,
  mime_type TEXT NOT NULL CHECK(mime_type IN ('image/webp', 'image/png', 'image/jpeg')),
  image_data BLOB NOT NULL CHECK(length(image_data) BETWEEN 1 AND 524288),
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 60),
  description TEXT NOT NULL DEFAULT '',
  reward_seconds INTEGER NOT NULL CHECK(reward_seconds > 0 AND reward_seconds <= 86400),
  target_worker_id TEXT REFERENCES workers(id) ON DELETE SET NULL,
  timing_mode TEXT NOT NULL DEFAULT 'optional' CHECK(timing_mode IN ('none', 'optional', 'required')),
  minimum_duration_seconds INTEGER CHECK(minimum_duration_seconds IS NULL OR minimum_duration_seconds >= 0),
  bonus_enabled INTEGER NOT NULL DEFAULT 0 CHECK(bonus_enabled IN (0, 1)),
  excellent_multiplier_bps INTEGER NOT NULL DEFAULT 20000 CHECK(excellent_multiplier_bps >= 10000),
  bonus_criteria TEXT,
  available_from INTEGER,
  due_at INTEGER,
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published', 'closed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS task_assignments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  worker_id TEXT NOT NULL REFERENCES workers(id),
  title_snapshot TEXT NOT NULL,
  description_snapshot TEXT NOT NULL,
  reward_seconds INTEGER NOT NULL CHECK(reward_seconds > 0),
  timing_mode TEXT NOT NULL CHECK(timing_mode IN ('none', 'optional', 'required')),
  minimum_duration_seconds INTEGER,
  bonus_enabled INTEGER NOT NULL CHECK(bonus_enabled IN (0, 1)),
  bonus_criteria TEXT,
  due_at INTEGER,
  status TEXT NOT NULL DEFAULT 'claimed' CHECK(status IN ('claimed', 'in_progress', 'submitted', 'revision_requested', 'approved', 'rejected', 'cancelled')),
  submission_note TEXT,
  review_multiplier REAL CHECK(review_multiplier IS NULL OR review_multiplier >= 1),
  review_tier TEXT CHECK(review_tier IS NULL OR review_tier IN ('normal', 'excellent')),
  review_note TEXT,
  reviewed_at INTEGER,
  approved_transaction_id TEXT UNIQUE,
  approved_reward_grant_id TEXT UNIQUE REFERENCES reward_grant_batches(id),
  excellent_multiplier_bps INTEGER NOT NULL DEFAULT 20000 CHECK(excellent_multiplier_bps >= 10000),
  assigned_by TEXT NOT NULL DEFAULT 'worker',
  claimed_at INTEGER NOT NULL,
  submitted_at INTEGER,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(task_id, worker_id)
);

CREATE TABLE IF NOT EXISTS consumption_activities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 30),
  icon TEXT NOT NULL DEFAULT 'gamepad',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS active_timers (
  worker_id TEXT PRIMARY KEY REFERENCES workers(id),
  timer_type TEXT NOT NULL CHECK(timer_type IN ('reward_task', 'consumption')),
  assignment_id TEXT REFERENCES task_assignments(id),
  consumption_activity_id TEXT REFERENCES consumption_activities(id),
  started_at INTEGER NOT NULL,
  started_by TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  CHECK(
    (timer_type = 'reward_task' AND assignment_id IS NOT NULL AND consumption_activity_id IS NULL)
    OR
    (timer_type = 'consumption' AND assignment_id IS NULL AND consumption_activity_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS timer_segments (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL REFERENCES workers(id),
  timer_type TEXT NOT NULL CHECK(timer_type IN ('reward_task', 'consumption')),
  assignment_id TEXT REFERENCES task_assignments(id),
  consumption_activity_id TEXT REFERENCES consumption_activities(id),
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  duration_seconds INTEGER NOT NULL CHECK(duration_seconds >= 0),
  started_by TEXT NOT NULL,
  ended_by TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS timer_adjustments (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL REFERENCES workers(id),
  assignment_id TEXT NOT NULL REFERENCES task_assignments(id),
  delta_seconds INTEGER NOT NULL CHECK(delta_seconds <> 0),
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL REFERENCES workers(id),
  type TEXT NOT NULL CHECK(type IN ('daily_reward', 'task_reward', 'consumption', 'admin_adjustment', 'coupon_reward')),
  title TEXT NOT NULL,
  amount_seconds INTEGER NOT NULL CHECK(amount_seconds <> 0),
  balance_after_seconds INTEGER NOT NULL CHECK(balance_after_seconds >= 0),
  assignment_id TEXT REFERENCES task_assignments(id),
  consumption_activity_id TEXT REFERENCES consumption_activities(id),
  reward_item_id TEXT REFERENCES worker_reward_items(id),
  actor TEXT NOT NULL,
  reason TEXT,
  request_id TEXT UNIQUE,
  started_at INTEGER,
  ended_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reward_requests (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL REFERENCES workers(id),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 60),
  description TEXT NOT NULL DEFAULT '',
  reward_seconds INTEGER NOT NULL CHECK(reward_seconds > 0 AND reward_seconds <= 86400),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'revision_requested', 'approved', 'rejected', 'cancelled')),
  review_note TEXT,
  reviewed_at INTEGER,
  approved_transaction_id TEXT UNIQUE REFERENCES transactions(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS transaction_reversals (
  id TEXT PRIMARY KEY,
  original_transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id),
  reversal_transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id),
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_grants (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL REFERENCES workers(id),
  reward_date TEXT NOT NULL,
  amount_seconds INTEGER NOT NULL CHECK(amount_seconds BETWEEN 0 AND 86400),
  transaction_id TEXT REFERENCES transactions(id),
  created_at INTEGER NOT NULL,
  UNIQUE(worker_id, reward_date)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  detail TEXT,
  request_id TEXT UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reward_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 60),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 600),
  icon TEXT NOT NULL,
  theme TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('random_time', 'fixed_time', 'physical')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  random_min_seconds INTEGER,
  random_max_seconds INTEGER,
  fixed_seconds INTEGER,
  physical_description TEXT,
  fulfillment_instructions TEXT,
  physical_category TEXT,
  current_image_id TEXT,
  validity_mode TEXT NOT NULL DEFAULT 'permanent'
    CHECK(validity_mode IN ('permanent', 'days_after_grant', 'fixed_at')),
  validity_days INTEGER,
  validity_fixed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(
    (kind = 'random_time'
      AND random_min_seconds BETWEEN 60 AND 86400
      AND random_max_seconds BETWEEN 60 AND 86400
      AND random_min_seconds <= random_max_seconds
      AND random_min_seconds % 60 = 0
      AND random_max_seconds % 60 = 0
      AND fixed_seconds IS NULL
      AND physical_description IS NULL
      AND fulfillment_instructions IS NULL
      AND physical_category IS NULL)
    OR
    (kind = 'fixed_time'
      AND fixed_seconds BETWEEN 60 AND 86400
      AND fixed_seconds % 60 = 0
      AND random_min_seconds IS NULL
      AND random_max_seconds IS NULL
      AND physical_description IS NULL
      AND fulfillment_instructions IS NULL
      AND physical_category IS NULL)
    OR
    (kind = 'physical'
      AND random_min_seconds IS NULL
      AND random_max_seconds IS NULL
      AND fixed_seconds IS NULL
      AND length(trim(physical_description)) BETWEEN 1 AND 600
      AND length(trim(fulfillment_instructions)) BETWEEN 1 AND 600
      AND physical_category = 'physical')
  ),
  CHECK(
    (validity_mode = 'permanent' AND validity_days IS NULL AND validity_fixed_at IS NULL)
    OR (validity_mode = 'days_after_grant' AND validity_days > 0 AND validity_fixed_at IS NULL)
    OR (validity_mode = 'fixed_at' AND validity_days IS NULL AND validity_fixed_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS reward_definition_images (
  id TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL REFERENCES reward_definitions(id) ON DELETE RESTRICT,
  mime_type TEXT NOT NULL CHECK(mime_type IN ('image/webp', 'image/png', 'image/jpeg')),
  image_data BLOB NOT NULL CHECK(length(image_data) BETWEEN 1 AND 524288),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS task_reward_bindings (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  definition_id TEXT NOT NULL REFERENCES reward_definitions(id) ON DELETE RESTRICT,
  grant_tier TEXT NOT NULL CHECK(grant_tier IN ('normal', 'excellent_bonus')),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  probability_percent INTEGER NOT NULL DEFAULT 100 CHECK(probability_percent BETWEEN 0 AND 100),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(task_id, definition_id, grant_tier)
);

CREATE TABLE IF NOT EXISTS assignment_reward_items (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES task_assignments(id) ON DELETE CASCADE,
  task_reward_binding_id TEXT REFERENCES task_reward_bindings(id) ON DELETE SET NULL,
  definition_id TEXT REFERENCES reward_definitions(id) ON DELETE RESTRICT,
  definition_version INTEGER,
  grant_tier TEXT NOT NULL CHECK(grant_tier IN ('normal', 'excellent_bonus')),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  probability_percent INTEGER NOT NULL DEFAULT 100 CHECK(probability_percent BETWEEN 0 AND 100),
  sort_order INTEGER NOT NULL DEFAULT 0,
  name_snapshot TEXT NOT NULL CHECK(length(trim(name_snapshot)) BETWEEN 1 AND 60),
  description_snapshot TEXT NOT NULL DEFAULT '',
  icon_snapshot TEXT NOT NULL,
  theme_snapshot TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('random_time', 'fixed_time', 'physical')),
  random_min_seconds INTEGER,
  random_max_seconds INTEGER,
  fixed_seconds INTEGER,
  physical_description TEXT,
  fulfillment_instructions TEXT,
  image_id TEXT REFERENCES reward_definition_images(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  CHECK(
    (kind = 'random_time'
      AND random_min_seconds BETWEEN 60 AND 86400
      AND random_max_seconds BETWEEN 60 AND 86400
      AND random_min_seconds <= random_max_seconds
      AND random_min_seconds % 60 = 0
      AND random_max_seconds % 60 = 0
      AND fixed_seconds IS NULL
      AND physical_description IS NULL
      AND fulfillment_instructions IS NULL
      AND image_id IS NULL)
    OR
    (kind = 'fixed_time'
      AND fixed_seconds BETWEEN 60 AND 86400
      AND fixed_seconds % 60 = 0
      AND random_min_seconds IS NULL
      AND random_max_seconds IS NULL
      AND physical_description IS NULL
      AND fulfillment_instructions IS NULL
      AND image_id IS NULL)
    OR
    (kind = 'physical'
      AND random_min_seconds IS NULL
      AND random_max_seconds IS NULL
      AND fixed_seconds IS NULL
      AND length(trim(physical_description)) BETWEEN 1 AND 600
      AND length(trim(fulfillment_instructions)) BETWEEN 1 AND 600)
  ),
  UNIQUE(assignment_id, definition_id, grant_tier)
);

CREATE TABLE IF NOT EXISTS reward_grant_batches (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL REFERENCES workers(id),
  source_type TEXT NOT NULL
    CHECK(source_type IN ('daily', 'task', 'admin_direct', 'achievement', 'adjustment')),
  source_id TEXT,
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS worker_reward_items (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL REFERENCES workers(id),
  grant_batch_id TEXT NOT NULL REFERENCES reward_grant_batches(id),
  definition_id TEXT REFERENCES reward_definitions(id) ON DELETE RESTRICT,
  definition_version INTEGER,
  source_type TEXT NOT NULL
    CHECK(source_type IN ('daily', 'task', 'admin_direct', 'achievement', 'adjustment')),
  source_id TEXT,
  granted_by TEXT NOT NULL,
  name_snapshot TEXT NOT NULL CHECK(length(trim(name_snapshot)) BETWEEN 1 AND 60),
  description_snapshot TEXT NOT NULL DEFAULT '',
  icon_snapshot TEXT NOT NULL,
  theme_snapshot TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('random_time', 'fixed_time', 'physical')),
  random_min_seconds INTEGER,
  random_max_seconds INTEGER,
  fixed_seconds INTEGER,
  physical_description TEXT,
  fulfillment_instructions TEXT,
  image_id TEXT REFERENCES reward_definition_images(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK(status IN ('available', 'redeemed', 'fulfilled', 'cancelled', 'expired')),
  expires_at INTEGER,
  granted_at INTEGER NOT NULL,
  redeemed_at INTEGER,
  fulfilled_at INTEGER,
  cancelled_at INTEGER,
  cancellation_reason TEXT,
  CHECK(
    (kind = 'random_time'
      AND random_min_seconds BETWEEN 60 AND 86400
      AND random_max_seconds BETWEEN 60 AND 86400
      AND random_min_seconds <= random_max_seconds
      AND random_min_seconds % 60 = 0
      AND random_max_seconds % 60 = 0
      AND fixed_seconds IS NULL
      AND physical_description IS NULL
      AND fulfillment_instructions IS NULL
      AND image_id IS NULL)
    OR
    (kind = 'fixed_time'
      AND fixed_seconds BETWEEN 60 AND 86400
      AND fixed_seconds % 60 = 0
      AND random_min_seconds IS NULL
      AND random_max_seconds IS NULL
      AND physical_description IS NULL
      AND fulfillment_instructions IS NULL
      AND image_id IS NULL)
    OR
    (kind = 'physical'
      AND random_min_seconds IS NULL
      AND random_max_seconds IS NULL
      AND fixed_seconds IS NULL
      AND length(trim(physical_description)) BETWEEN 1 AND 600
      AND length(trim(fulfillment_instructions)) BETWEEN 1 AND 600)
  )
);

CREATE TABLE IF NOT EXISTS assignment_reward_outcomes (
  id TEXT PRIMARY KEY,
  assignment_reward_item_id TEXT NOT NULL REFERENCES assignment_reward_items(id) ON DELETE CASCADE,
  sequence_number INTEGER NOT NULL CHECK(sequence_number > 0),
  roll_percent INTEGER NOT NULL CHECK(roll_percent BETWEEN 1 AND 100),
  awarded INTEGER NOT NULL CHECK(awarded IN (0, 1)),
  worker_reward_item_id TEXT UNIQUE REFERENCES worker_reward_items(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  CHECK(
    (awarded = 1 AND worker_reward_item_id IS NOT NULL)
    OR (awarded = 0 AND worker_reward_item_id IS NULL)
  ),
  UNIQUE(assignment_reward_item_id, sequence_number)
);

CREATE TABLE IF NOT EXISTS worker_daily_coupon_settings (
  worker_id TEXT PRIMARY KEY REFERENCES workers(id) ON DELETE CASCADE,
  is_enabled INTEGER NOT NULL DEFAULT 0 CHECK(is_enabled IN (0, 1)),
  daily_quantity INTEGER NOT NULL DEFAULT 0 CHECK(daily_quantity >= 0),
  random_min_seconds INTEGER NOT NULL DEFAULT 300
    CHECK(random_min_seconds BETWEEN 60 AND 86400 AND random_min_seconds % 60 = 0),
  random_max_seconds INTEGER NOT NULL DEFAULT 900
    CHECK(random_max_seconds BETWEEN 60 AND 86400 AND random_max_seconds % 60 = 0),
  updated_at INTEGER NOT NULL,
  CHECK(random_min_seconds <= random_max_seconds),
  CHECK((is_enabled = 1 AND daily_quantity > 0) OR (is_enabled = 0 AND daily_quantity = 0))
);

CREATE TABLE IF NOT EXISTS daily_coupon_grants (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL REFERENCES workers(id),
  local_date TEXT NOT NULL,
  enabled_snapshot INTEGER NOT NULL CHECK(enabled_snapshot IN (0, 1)),
  quantity_snapshot INTEGER NOT NULL CHECK(quantity_snapshot >= 0),
  random_min_seconds INTEGER NOT NULL,
  random_max_seconds INTEGER NOT NULL,
  actual_quantity INTEGER NOT NULL CHECK(actual_quantity >= 0),
  grant_batch_id TEXT NOT NULL UNIQUE REFERENCES reward_grant_batches(id),
  created_at INTEGER NOT NULL,
  UNIQUE(worker_id, local_date)
);

CREATE TABLE IF NOT EXISTS reward_coupon_uses (
  id TEXT PRIMARY KEY,
  reward_item_id TEXT NOT NULL UNIQUE REFERENCES worker_reward_items(id),
  worker_id TEXT NOT NULL REFERENCES workers(id),
  kind TEXT NOT NULL CHECK(kind IN ('random_time', 'fixed_time', 'physical')),
  random_min_seconds INTEGER,
  random_max_seconds INTEGER,
  result_seconds INTEGER,
  transaction_id TEXT UNIQUE REFERENCES transactions(id),
  confirmation_method TEXT,
  confirmed_worker_id TEXT REFERENCES workers(id),
  request_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  CHECK(
    (kind = 'random_time'
      AND random_min_seconds IS NOT NULL
      AND random_max_seconds IS NOT NULL
      AND result_seconds BETWEEN random_min_seconds AND random_max_seconds
      AND transaction_id IS NOT NULL
      AND confirmation_method IS NULL
      AND confirmed_worker_id IS NULL)
    OR
    (kind = 'fixed_time'
      AND random_min_seconds IS NULL
      AND random_max_seconds IS NULL
      AND result_seconds > 0
      AND transaction_id IS NOT NULL
      AND confirmation_method IS NULL
      AND confirmed_worker_id IS NULL)
    OR
    (kind = 'physical'
      AND random_min_seconds IS NULL
      AND random_max_seconds IS NULL
      AND result_seconds IS NULL
      AND transaction_id IS NULL
      AND confirmation_method = 'worker_password'
      AND confirmed_worker_id = worker_id)
  )
);

CREATE INDEX IF NOT EXISTS idx_tasks_status_target ON tasks(status, target_worker_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assignments_worker_status ON task_assignments(worker_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_assignments_status ON task_assignments(status, submitted_at);
CREATE INDEX IF NOT EXISTS idx_segments_assignment ON timer_segments(assignment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_adjustments_assignment ON timer_adjustments(assignment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_worker_created ON transactions(worker_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reward_requests_worker_status ON reward_requests(worker_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_reward_requests_status ON reward_requests(status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_reward_definitions_kind_active ON reward_definitions(kind, is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reward_images_definition ON reward_definition_images(definition_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_reward_bindings_task ON task_reward_bindings(task_id, grant_tier, sort_order);
CREATE INDEX IF NOT EXISTS idx_assignment_reward_items_assignment ON assignment_reward_items(assignment_id, grant_tier, sort_order);
CREATE INDEX IF NOT EXISTS idx_assignment_reward_outcomes_item ON assignment_reward_outcomes(assignment_reward_item_id, sequence_number);
CREATE INDEX IF NOT EXISTS idx_reward_batches_worker_created ON reward_grant_batches(worker_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reward_items_worker_status ON worker_reward_items(worker_id, status, granted_at DESC);
CREATE INDEX IF NOT EXISTS idx_reward_items_batch ON worker_reward_items(grant_batch_id);
CREATE INDEX IF NOT EXISTS idx_daily_coupon_grants_worker_date ON daily_coupon_grants(worker_id, local_date);
`;

export function migrateRewardSchema(db: Database.Database, now = Date.now()): void {
  const transactionColumns = db.pragma("table_info(transactions)") as Array<{ name: string }>;
  const alreadyMigrated = transactionColumns.some((column) => column.name === "reward_item_id");

  if (!alreadyMigrated) {
    db.pragma("foreign_keys = OFF");
    try {
      db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE transactions_new (
          id TEXT PRIMARY KEY,
          worker_id TEXT NOT NULL REFERENCES workers(id),
          type TEXT NOT NULL CHECK(type IN ('daily_reward', 'task_reward', 'consumption', 'admin_adjustment', 'coupon_reward')),
          title TEXT NOT NULL,
          amount_seconds INTEGER NOT NULL CHECK(amount_seconds <> 0),
          balance_after_seconds INTEGER NOT NULL CHECK(balance_after_seconds >= 0),
          assignment_id TEXT REFERENCES task_assignments(id),
          consumption_activity_id TEXT REFERENCES consumption_activities(id),
          reward_item_id TEXT REFERENCES worker_reward_items(id),
          actor TEXT NOT NULL,
          reason TEXT,
          request_id TEXT UNIQUE,
          started_at INTEGER,
          ended_at INTEGER,
          created_at INTEGER NOT NULL
        );
        INSERT INTO transactions_new(
          id, worker_id, type, title, amount_seconds, balance_after_seconds,
          assignment_id, consumption_activity_id, reward_item_id, actor, reason,
          request_id, started_at, ended_at, created_at
        )
        SELECT
          id, worker_id, type, title, amount_seconds, balance_after_seconds,
          assignment_id, consumption_activity_id, NULL, actor, reason,
          request_id, started_at, ended_at, created_at
        FROM transactions;
        DROP TABLE transactions;
        ALTER TABLE transactions_new RENAME TO transactions;
        COMMIT;
      `);
    } catch (error) {
      if (db.inTransaction) db.exec("ROLLBACK");
      throw error;
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_transactions_worker_created
      ON transactions(worker_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_transactions_reward_item
      ON transactions(reward_item_id);
  `);
  db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (6, ?)").run(now);
}

export function migrateTaskRewardSchema(db: Database.Database, now = Date.now()): void {
  const taskColumns = db.pragma("table_info(tasks)") as Array<{ name: string }>;
  const assignmentColumns = db.pragma("table_info(task_assignments)") as Array<{ name: string }>;
  const tasksMigrated = taskColumns.some((column) => column.name === "excellent_multiplier_bps");
  const assignmentsMigrated = assignmentColumns.some((column) => column.name === "approved_reward_grant_id");
  const reviewTierMigrated = assignmentColumns.some((column) => column.name === "review_tier");

  if (!tasksMigrated || !assignmentsMigrated) {
    db.pragma("foreign_keys = OFF");
    try {
      db.exec("BEGIN IMMEDIATE");
      if (!tasksMigrated) {
        db.exec(`
          ALTER TABLE tasks ADD COLUMN excellent_multiplier_bps INTEGER NOT NULL DEFAULT 20000
            CHECK(excellent_multiplier_bps >= 10000);
        `);
      }
      if (!assignmentsMigrated) {
        db.exec(`
          CREATE TABLE task_assignments_new (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL REFERENCES tasks(id),
            worker_id TEXT NOT NULL REFERENCES workers(id),
            title_snapshot TEXT NOT NULL,
            description_snapshot TEXT NOT NULL,
            reward_seconds INTEGER NOT NULL CHECK(reward_seconds > 0),
            timing_mode TEXT NOT NULL CHECK(timing_mode IN ('none', 'optional', 'required')),
            minimum_duration_seconds INTEGER,
            bonus_enabled INTEGER NOT NULL CHECK(bonus_enabled IN (0, 1)),
            bonus_criteria TEXT,
            due_at INTEGER,
            status TEXT NOT NULL DEFAULT 'claimed'
              CHECK(status IN ('claimed', 'in_progress', 'submitted', 'revision_requested', 'approved', 'rejected', 'cancelled')),
            submission_note TEXT,
            review_multiplier REAL CHECK(review_multiplier IS NULL OR review_multiplier >= 1),
            review_tier TEXT CHECK(review_tier IS NULL OR review_tier IN ('normal', 'excellent')),
            review_note TEXT,
            reviewed_at INTEGER,
            approved_transaction_id TEXT UNIQUE,
            approved_reward_grant_id TEXT UNIQUE REFERENCES reward_grant_batches(id),
            excellent_multiplier_bps INTEGER NOT NULL DEFAULT 20000 CHECK(excellent_multiplier_bps >= 10000),
            assigned_by TEXT NOT NULL DEFAULT 'worker',
            claimed_at INTEGER NOT NULL,
            submitted_at INTEGER,
            updated_at INTEGER NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            UNIQUE(task_id, worker_id)
          );
          INSERT INTO task_assignments_new(
            id, task_id, worker_id, title_snapshot, description_snapshot,
            reward_seconds, timing_mode, minimum_duration_seconds,
            bonus_enabled, bonus_criteria, due_at, status, submission_note,
            review_multiplier, review_tier, review_note, reviewed_at,
            approved_transaction_id, approved_reward_grant_id, excellent_multiplier_bps,
            assigned_by, claimed_at, submitted_at, updated_at, version
          )
          SELECT
            id, task_id, worker_id, title_snapshot, description_snapshot,
            reward_seconds, timing_mode, minimum_duration_seconds,
            bonus_enabled, bonus_criteria, due_at, status, submission_note,
            review_multiplier,
            CASE
              WHEN status = 'approved' AND review_multiplier > 1 THEN 'excellent'
              WHEN status = 'approved' THEN 'normal'
              ELSE NULL
            END,
            review_note, reviewed_at,
            approved_transaction_id, NULL,
            COALESCE((SELECT excellent_multiplier_bps FROM tasks WHERE tasks.id = task_assignments.task_id), 20000),
            assigned_by, claimed_at, submitted_at, updated_at, version
          FROM task_assignments;
          DROP TABLE task_assignments;
          ALTER TABLE task_assignments_new RENAME TO task_assignments;
        `);
      }
      db.exec("COMMIT");
    } catch (error) {
      if (db.inTransaction) db.exec("ROLLBACK");
      throw error;
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }

  if (assignmentsMigrated && !reviewTierMigrated) {
    db.exec(`
      ALTER TABLE task_assignments ADD COLUMN review_tier TEXT
        CHECK(review_tier IS NULL OR review_tier IN ('normal', 'excellent'));
      UPDATE task_assignments
      SET review_tier = CASE
        WHEN status = 'approved' AND review_multiplier > 1 THEN 'excellent'
        WHEN status = 'approved' THEN 'normal'
        ELSE NULL
      END;
    `);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_assignments_worker_status
      ON task_assignments(worker_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_assignments_status
      ON task_assignments(status, submitted_at);
  `);
  db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (7, ?)").run(now);
}

function initializeDatabase(db: Database.Database) {
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(SCHEMA);

  const now = Date.now();
  const seed = db.prepare(`
    INSERT OR IGNORE INTO consumption_activities
      (id, name, icon, sort_order, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)
  `);
  seed.run("consume-game", "玩游戏", "gamepad", 10, now, now);
  seed.run("consume-video", "看视频", "video", 20, now, now);
  db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, ?)").run(now);
  db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (2, ?)").run(now);
  db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (3, ?)").run(now);
  db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (4, ?)").run(now);
  db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (5, ?)").run(now);
  migrateRewardSchema(db, now);
  migrateTaskRewardSchema(db, now);
  db.prepare(`
    INSERT OR IGNORE INTO app_settings(key, value, updated_at)
    VALUES ('reward_system_enabled', '1', ?)
  `).run(now);
  db.prepare(`
    INSERT OR IGNORE INTO worker_daily_coupon_settings(
      worker_id, is_enabled, daily_quantity, random_min_seconds, random_max_seconds, updated_at
    )
    SELECT id, 0, 0, 300, 900, ? FROM workers
  `).run(now);
}

export function getDb(): Database.Database {
  let db = globalThis.__penWorkerDatabase;
  if (!db) {
    const databasePath = getConfig().databasePath;
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    db = new Database(databasePath);
    db.pragma("journal_mode = WAL");
  }

  if (globalThis.__penWorkerSchemaVersion !== CURRENT_SCHEMA_VERSION) {
    initializeDatabase(db);
    globalThis.__penWorkerSchemaVersion = CURRENT_SCHEMA_VERSION;
  }

  globalThis.__penWorkerDatabase = db;
  return db;
}

export function closeDbForTests(): void {
  globalThis.__penWorkerDatabase?.close();
  globalThis.__penWorkerDatabase = undefined;
  globalThis.__penWorkerSchemaVersion = undefined;
}

export type WorkerRow = {
  id: string;
  name: string;
  avatar: string;
  theme: string;
  password_hash: string;
  auth_version: number;
  balance_seconds: number;
  daily_reward_seconds: number;
  timezone: string;
  is_active: number;
  created_at: number;
  updated_at: number;
};

export type WorkerAvatarImageRow = {
  worker_id: string;
  mime_type: "image/webp" | "image/png" | "image/jpeg";
  image_data: Buffer;
  updated_at: number;
};

export type RewardRequestRow = {
  id: string;
  worker_id: string;
  title: string;
  description: string;
  reward_seconds: number;
  status: "pending" | "revision_requested" | "approved" | "rejected" | "cancelled";
  review_note: string | null;
  reviewed_at: number | null;
  approved_transaction_id: string | null;
  created_at: number;
  updated_at: number;
  version: number;
};

export type TaskRow = {
  id: string;
  title: string;
  description: string;
  reward_seconds: number;
  target_worker_id: string | null;
  timing_mode: "none" | "optional" | "required";
  minimum_duration_seconds: number | null;
  bonus_enabled: number;
  excellent_multiplier_bps: number;
  bonus_criteria: string | null;
  available_from: number | null;
  due_at: number | null;
  status: "published" | "closed";
  created_at: number;
  updated_at: number;
};

export type AssignmentRow = {
  id: string;
  task_id: string;
  worker_id: string;
  title_snapshot: string;
  description_snapshot: string;
  reward_seconds: number;
  timing_mode: "none" | "optional" | "required";
  minimum_duration_seconds: number | null;
  bonus_enabled: number;
  bonus_criteria: string | null;
  due_at: number | null;
  status: "claimed" | "in_progress" | "submitted" | "revision_requested" | "approved" | "rejected" | "cancelled";
  submission_note: string | null;
  review_multiplier: number | null;
  review_tier: "normal" | "excellent" | null;
  review_note: string | null;
  reviewed_at: number | null;
  approved_transaction_id: string | null;
  approved_reward_grant_id: string | null;
  excellent_multiplier_bps: number;
  assigned_by: string;
  claimed_at: number;
  submitted_at: number | null;
  updated_at: number;
  version: number;
};

export type ActiveTimerRow = {
  worker_id: string;
  timer_type: "reward_task" | "consumption";
  assignment_id: string | null;
  consumption_activity_id: string | null;
  started_at: number;
  started_by: string;
  request_id: string;
};

export type RewardKind = "random_time" | "fixed_time" | "physical";
export type RewardSource = "daily" | "task" | "admin_direct" | "achievement" | "adjustment";
export type RewardItemStatus = "available" | "redeemed" | "fulfilled" | "cancelled" | "expired";

export type RewardDefinitionRow = {
  id: string;
  name: string;
  description: string;
  icon: string;
  theme: string;
  kind: RewardKind;
  version: number;
  is_active: number;
  random_min_seconds: number | null;
  random_max_seconds: number | null;
  fixed_seconds: number | null;
  physical_description: string | null;
  fulfillment_instructions: string | null;
  physical_category: "physical" | null;
  current_image_id: string | null;
  validity_mode: "permanent" | "days_after_grant" | "fixed_at";
  validity_days: number | null;
  validity_fixed_at: number | null;
  created_at: number;
  updated_at: number;
};

export type RewardDefinitionImageRow = {
  id: string;
  definition_id: string;
  mime_type: "image/webp" | "image/png" | "image/jpeg";
  image_data: Buffer;
  created_at: number;
};

export type DailyCouponSettingRow = {
  worker_id: string;
  is_enabled: number;
  daily_quantity: number;
  random_min_seconds: number;
  random_max_seconds: number;
  updated_at: number;
};

export type DailyCouponGrantRow = {
  id: string;
  worker_id: string;
  local_date: string;
  enabled_snapshot: number;
  quantity_snapshot: number;
  random_min_seconds: number;
  random_max_seconds: number;
  actual_quantity: number;
  grant_batch_id: string;
  created_at: number;
};

export type WorkerRewardItemRow = {
  id: string;
  worker_id: string;
  grant_batch_id: string;
  definition_id: string | null;
  definition_version: number | null;
  source_type: RewardSource;
  source_id: string | null;
  granted_by: string;
  name_snapshot: string;
  description_snapshot: string;
  icon_snapshot: string;
  theme_snapshot: string;
  kind: RewardKind;
  random_min_seconds: number | null;
  random_max_seconds: number | null;
  fixed_seconds: number | null;
  physical_description: string | null;
  fulfillment_instructions: string | null;
  image_id: string | null;
  status: RewardItemStatus;
  expires_at: number | null;
  granted_at: number;
  redeemed_at: number | null;
  fulfilled_at: number | null;
  cancelled_at: number | null;
  cancellation_reason: string | null;
};

export type TaskRewardBindingRow = {
  id: string;
  task_id: string;
  definition_id: string;
  grant_tier: "normal" | "excellent_bonus";
  quantity: number;
  probability_percent: number;
  sort_order: number;
  created_at: number;
};

export type AssignmentRewardItemRow = {
  id: string;
  assignment_id: string;
  task_reward_binding_id: string | null;
  definition_id: string | null;
  definition_version: number | null;
  grant_tier: "normal" | "excellent_bonus";
  quantity: number;
  probability_percent: number;
  sort_order: number;
  name_snapshot: string;
  description_snapshot: string;
  icon_snapshot: string;
  theme_snapshot: string;
  kind: RewardKind;
  random_min_seconds: number | null;
  random_max_seconds: number | null;
  fixed_seconds: number | null;
  physical_description: string | null;
  fulfillment_instructions: string | null;
  image_id: string | null;
  created_at: number;
};
