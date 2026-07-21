import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrateRewardSchema, migrateTaskRewardSchema } from "@/lib/db";

describe("reward database migration", () => {
  it("preserves legacy transaction rows while extending the constrained type", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
      CREATE TABLE workers(id TEXT PRIMARY KEY);
      CREATE TABLE task_assignments(id TEXT PRIMARY KEY);
      CREATE TABLE consumption_activities(id TEXT PRIMARY KEY);
      CREATE TABLE worker_reward_items(id TEXT PRIMARY KEY);
      CREATE TABLE transactions (
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
      CREATE TABLE daily_grants(
        id TEXT PRIMARY KEY,
        transaction_id TEXT REFERENCES transactions(id)
      );
      CREATE TABLE reward_requests(
        id TEXT PRIMARY KEY,
        approved_transaction_id TEXT REFERENCES transactions(id)
      );
      INSERT INTO workers(id) VALUES ('legacy-worker');
      INSERT INTO transactions(
        id, worker_id, type, title, amount_seconds, balance_after_seconds,
        actor, request_id, created_at
      ) VALUES ('legacy-transaction', 'legacy-worker', 'daily_reward', '旧每日奖励', 7200, 7200,
        'system', 'legacy-request', 1);
      INSERT INTO daily_grants(id, transaction_id) VALUES ('legacy-daily', 'legacy-transaction');
      INSERT INTO reward_requests(id, approved_transaction_id) VALUES ('legacy-request-row', 'legacy-transaction');
    `);

    migrateRewardSchema(db, 2);

    expect(db.prepare("SELECT id, type, title, amount_seconds FROM transactions").get()).toEqual({
      id: "legacy-transaction",
      type: "daily_reward",
      title: "旧每日奖励",
      amount_seconds: 7200,
    });
    expect((db.pragma("table_info(transactions)") as Array<{ name: string }>).some(
      (column) => column.name === "reward_item_id",
    )).toBe(true);
    expect(() => db.prepare(`
      INSERT INTO transactions(
        id, worker_id, type, title, amount_seconds, balance_after_seconds,
        reward_item_id, actor, created_at
      ) VALUES ('coupon-transaction', 'legacy-worker', 'coupon_reward', '奖励券', 600, 7800,
        NULL, 'system', 2)
    `).run()).not.toThrow();
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.prepare("SELECT transaction_id FROM daily_grants").get()).toEqual({ transaction_id: "legacy-transaction" });
    expect(db.prepare("SELECT approved_transaction_id FROM reward_requests").get()).toEqual({ approved_transaction_id: "legacy-transaction" });
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = 6").get()).toEqual({ version: 6 });
    db.close();
  });

  it("migrates legacy tasks and assignments to configurable excellent rewards without breaking children", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(`
      CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
      CREATE TABLE workers(id TEXT PRIMARY KEY);
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        reward_seconds INTEGER NOT NULL,
        target_worker_id TEXT REFERENCES workers(id),
        timing_mode TEXT NOT NULL,
        minimum_duration_seconds INTEGER,
        bonus_enabled INTEGER NOT NULL,
        bonus_criteria TEXT,
        available_from INTEGER,
        due_at INTEGER,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE reward_grant_batches(id TEXT PRIMARY KEY);
      CREATE TABLE task_assignments (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        worker_id TEXT NOT NULL REFERENCES workers(id),
        title_snapshot TEXT NOT NULL,
        description_snapshot TEXT NOT NULL,
        reward_seconds INTEGER NOT NULL,
        timing_mode TEXT NOT NULL,
        minimum_duration_seconds INTEGER,
        bonus_enabled INTEGER NOT NULL,
        bonus_criteria TEXT,
        due_at INTEGER,
        status TEXT NOT NULL,
        submission_note TEXT,
        review_multiplier INTEGER CHECK(review_multiplier IS NULL OR review_multiplier IN (1, 2)),
        review_note TEXT,
        reviewed_at INTEGER,
        approved_transaction_id TEXT UNIQUE,
        assigned_by TEXT NOT NULL,
        claimed_at INTEGER NOT NULL,
        submitted_at INTEGER,
        updated_at INTEGER NOT NULL,
        version INTEGER NOT NULL,
        UNIQUE(task_id, worker_id)
      );
      CREATE TABLE legacy_assignment_children(
        id TEXT PRIMARY KEY,
        assignment_id TEXT NOT NULL REFERENCES task_assignments(id)
      );
      INSERT INTO workers(id) VALUES ('legacy-worker');
      INSERT INTO tasks(
        id, title, description, reward_seconds, target_worker_id, timing_mode,
        minimum_duration_seconds, bonus_enabled, bonus_criteria, status, created_at, updated_at
      ) VALUES (
        'legacy-task', '旧任务', '迁移测试', 1800, 'legacy-worker', 'none',
        NULL, 1, '旧优秀标准', 'published', 1, 1
      );
      INSERT INTO task_assignments(
        id, task_id, worker_id, title_snapshot, description_snapshot,
        reward_seconds, timing_mode, minimum_duration_seconds, bonus_enabled,
        bonus_criteria, due_at, status, submission_note, review_multiplier,
        review_note, reviewed_at, approved_transaction_id, assigned_by,
        claimed_at, submitted_at, updated_at, version
      ) VALUES (
        'legacy-assignment', 'legacy-task', 'legacy-worker', '旧任务', '迁移测试',
        1800, 'none', NULL, 1, '旧优秀标准', NULL, 'approved', '完成', 2,
        '优秀', 2, 'legacy-transaction', 'admin', 1, 2, 2, 1
      );
      INSERT INTO legacy_assignment_children(id, assignment_id)
      VALUES ('legacy-child', 'legacy-assignment');
    `);

    migrateTaskRewardSchema(db, 3);

    expect(db.prepare("SELECT excellent_multiplier_bps FROM tasks WHERE id = ?")
      .get("legacy-task")).toEqual({ excellent_multiplier_bps: 20_000 });
    expect(db.prepare(`
      SELECT review_multiplier, review_tier, approved_reward_grant_id, excellent_multiplier_bps
      FROM task_assignments WHERE id = ?
    `).get("legacy-assignment")).toEqual({
      review_multiplier: 2,
      review_tier: "excellent",
      approved_reward_grant_id: null,
      excellent_multiplier_bps: 20_000,
    });
    expect(() => db.prepare("UPDATE task_assignments SET review_multiplier = 3.5 WHERE id = ?")
      .run("legacy-assignment")).not.toThrow();
    expect(db.prepare("SELECT assignment_id FROM legacy_assignment_children").get())
      .toEqual({ assignment_id: "legacy-assignment" });
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = 7").get())
      .toEqual({ version: 7 });
    db.close();
  });
});
