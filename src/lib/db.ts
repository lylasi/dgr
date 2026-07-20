import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "@/lib/config";

declare global {
  var __penWorkerDatabase: Database.Database | undefined;
}

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
  review_multiplier INTEGER CHECK(review_multiplier IS NULL OR review_multiplier IN (1, 2)),
  review_note TEXT,
  reviewed_at INTEGER,
  approved_transaction_id TEXT UNIQUE,
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
  type TEXT NOT NULL CHECK(type IN ('daily_reward', 'task_reward', 'consumption', 'admin_adjustment')),
  title TEXT NOT NULL,
  amount_seconds INTEGER NOT NULL CHECK(amount_seconds <> 0),
  balance_after_seconds INTEGER NOT NULL CHECK(balance_after_seconds >= 0),
  assignment_id TEXT REFERENCES task_assignments(id),
  consumption_activity_id TEXT REFERENCES consumption_activities(id),
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

CREATE INDEX IF NOT EXISTS idx_tasks_status_target ON tasks(status, target_worker_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assignments_worker_status ON task_assignments(worker_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_assignments_status ON task_assignments(status, submitted_at);
CREATE INDEX IF NOT EXISTS idx_segments_assignment ON timer_segments(assignment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_adjustments_assignment ON timer_adjustments(assignment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_worker_created ON transactions(worker_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reward_requests_worker_status ON reward_requests(worker_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_reward_requests_status ON reward_requests(status, created_at ASC);
`;

export function getDb(): Database.Database {
  if (globalThis.__penWorkerDatabase) return globalThis.__penWorkerDatabase;

  const databasePath = getConfig().databasePath;
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
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

  globalThis.__penWorkerDatabase = db;
  return db;
}

export function closeDbForTests(): void {
  globalThis.__penWorkerDatabase?.close();
  globalThis.__penWorkerDatabase = undefined;
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
  review_multiplier: 1 | 2 | null;
  review_note: string | null;
  reviewed_at: number | null;
  approved_transaction_id: string | null;
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
