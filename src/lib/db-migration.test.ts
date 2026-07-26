import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FAMILY_ID,
  migrateBossFamilyProfileSchema,
  migrateBusinessActorSchema,
  migrateFamilySchema,
  migratePublicFamilyDirectorySchema,
  migrateRepeatableTaskSchema,
  migrateRewardSchema,
  migrateTaskRewardSchema,
} from "@/lib/db";

describe("public family directory database migration", () => {
  it("enables the directory by default without overwriting a later administrator choice", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)");

    migratePublicFamilyDirectorySchema(db, 13);
    expect(db.prepare("SELECT value FROM system_settings WHERE key = ?")
      .get("public_family_directory_enabled")).toEqual({ value: "1" });
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = 13").get())
      .toEqual({ version: 13 });

    db.prepare("UPDATE system_settings SET value = '0' WHERE key = ?")
      .run("public_family_directory_enabled");
    migratePublicFamilyDirectorySchema(db, 14);
    expect(db.prepare("SELECT value FROM system_settings WHERE key = ?")
      .get("public_family_directory_enabled")).toEqual({ value: "0" });
    db.close();
  });
});

describe("boss family profile database migration", () => {
  it("adds an optional per-family display name without changing existing memberships", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
      CREATE TABLE families(id TEXT PRIMARY KEY);
      CREATE TABLE boss_accounts(id TEXT PRIMARY KEY);
      CREATE TABLE family_bosses(
        family_id TEXT NOT NULL,
        boss_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(family_id, boss_id)
      );
      INSERT INTO families(id) VALUES ('family-one');
      INSERT INTO boss_accounts(id) VALUES ('boss-one');
      INSERT INTO family_bosses(family_id, boss_id, created_at)
      VALUES ('family-one', 'boss-one', 1);
    `);

    migrateBossFamilyProfileSchema(db, 12);
    migrateBossFamilyProfileSchema(db, 13);

    expect(db.prepare(`
      SELECT family_id, boss_id, display_name_override, created_at
      FROM family_bosses
    `).get()).toEqual({
      family_id: "family-one",
      boss_id: "boss-one",
      display_name_override: null,
      created_at: 1,
    });
    expect(() => db.prepare(`
      UPDATE family_bosses SET display_name_override = '一号家庭爸爸'
      WHERE family_id = 'family-one' AND boss_id = 'boss-one'
    `).run()).not.toThrow();
    expect(() => db.prepare(`
      UPDATE family_bosses SET display_name_override = ''
      WHERE family_id = 'family-one' AND boss_id = 'boss-one'
    `).run()).toThrow();
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = 12").get())
      .toEqual({ version: 12 });
    db.close();
  });
});

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
    migrateRepeatableTaskSchema(db, 4);

    expect(db.prepare("SELECT excellent_multiplier_bps FROM tasks WHERE id = ?")
      .get("legacy-task")).toEqual({ excellent_multiplier_bps: 20_000 });
    expect(db.prepare("SELECT repeatable FROM tasks WHERE id = ?")
      .get("legacy-task")).toEqual({ repeatable: 0 });
    expect(db.prepare(`
      SELECT review_multiplier, review_tier, approved_reward_grant_id, excellent_multiplier_bps
      FROM task_assignments WHERE id = ?
    `).get("legacy-assignment")).toEqual({
      review_multiplier: 2,
      review_tier: "excellent",
      approved_reward_grant_id: null,
      excellent_multiplier_bps: 20_000,
    });
    expect(db.prepare("SELECT participation_number FROM task_assignments WHERE id = ?")
      .get("legacy-assignment")).toEqual({ participation_number: 1 });
    expect(() => db.prepare("UPDATE task_assignments SET review_multiplier = 3.5 WHERE id = ?")
      .run("legacy-assignment")).not.toThrow();
    expect(db.prepare("SELECT assignment_id FROM legacy_assignment_children").get())
      .toEqual({ assignment_id: "legacy-assignment" });
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = 7").get())
      .toEqual({ version: 7 });
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = 8").get())
      .toEqual({ version: 8 });
    db.close();
  });
});

describe("business actor database migration", () => {
  it("backfills legacy actors and keeps the migration idempotent", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
      CREATE TABLE transactions(
        id TEXT PRIMARY KEY,
        family_id TEXT NOT NULL,
        actor TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE audit_logs(
        id TEXT PRIMARY KEY,
        family_id TEXT NOT NULL,
        actor TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      INSERT INTO transactions VALUES
        ('transaction-admin', 'family-one', 'admin', 1),
        ('transaction-worker', 'family-one', 'worker:worker-one', 2),
        ('transaction-system', 'family-one', 'system', 3);
      INSERT INTO audit_logs VALUES
        ('audit-admin', 'family-one', 'admin', 1),
        ('audit-worker', 'family-one', 'worker:worker-one', 2);
    `);

    migrateBusinessActorSchema(db, 10);
    migrateBusinessActorSchema(db, 11);

    expect(db.prepare(`
      SELECT id, actor_type, actor_id, actor_name_snapshot, acting_for_worker_id
      FROM transactions ORDER BY id
    `).all()).toEqual([
      {
        id: "transaction-admin",
        actor_type: "legacy_admin",
        actor_id: null,
        actor_name_snapshot: "旧版管理员",
        acting_for_worker_id: null,
      },
      {
        id: "transaction-system",
        actor_type: "system",
        actor_id: null,
        actor_name_snapshot: "系统",
        acting_for_worker_id: null,
      },
      {
        id: "transaction-worker",
        actor_type: "worker",
        actor_id: "worker-one",
        actor_name_snapshot: "打工人",
        acting_for_worker_id: null,
      },
    ]);
    expect((db.pragma("table_info(audit_logs)") as Array<{ name: string }>).map((column) => column.name))
      .toEqual(expect.arrayContaining([
        "actor_type",
        "actor_id",
        "actor_name_snapshot",
        "acting_for_worker_id",
      ]));
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = 11").get())
      .toEqual({ version: 11 });
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM pragma_index_list('audit_logs')
      WHERE name = 'idx_audit_logs_family_actor_created'
    `).get()).toEqual({ count: 1 });
    db.close();
  });
});

describe("family database migration", () => {
  it("backfills legacy business data and enforces family boundaries", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(`
      CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
      CREATE TABLE workers(id TEXT PRIMARY KEY, is_active INTEGER NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE tasks(
        id TEXT PRIMARY KEY,
        target_worker_id TEXT,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE task_assignments(
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        approved_reward_grant_id TEXT,
        status TEXT NOT NULL,
        submitted_at INTEGER,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE consumption_activities(
        id TEXT PRIMARY KEY,
        is_active INTEGER NOT NULL,
        sort_order INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE transactions(
        id TEXT PRIMARY KEY,
        worker_id TEXT NOT NULL,
        assignment_id TEXT,
        consumption_activity_id TEXT,
        reward_item_id TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE reward_requests(
        id TEXT PRIMARY KEY,
        worker_id TEXT NOT NULL,
        approved_transaction_id TEXT,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE audit_logs(id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
      CREATE TABLE reward_definitions(
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        is_active INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE reward_grant_batches(
        id TEXT PRIMARY KEY,
        worker_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE worker_reward_items(
        id TEXT PRIMARY KEY,
        worker_id TEXT NOT NULL,
        grant_batch_id TEXT NOT NULL,
        definition_id TEXT,
        status TEXT NOT NULL,
        granted_at INTEGER NOT NULL
      );
      CREATE TABLE app_settings(
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      INSERT INTO workers VALUES ('legacy-worker', 1, 1);
      INSERT INTO tasks VALUES ('legacy-task', 'legacy-worker', 'published', 1);
      INSERT INTO task_assignments
        VALUES ('legacy-assignment', 'legacy-task', 'legacy-worker', NULL, 'submitted', 2, 2);
      INSERT INTO consumption_activities VALUES ('legacy-activity', 1, 10, 1);
      INSERT INTO reward_definitions VALUES ('legacy-definition', 'fixed_time', 1, 1);
      INSERT INTO reward_grant_batches VALUES ('legacy-batch', 'legacy-worker', 2);
      INSERT INTO worker_reward_items
        VALUES ('legacy-item', 'legacy-worker', 'legacy-batch', 'legacy-definition', 'available', 2);
      INSERT INTO transactions
        VALUES ('legacy-transaction', 'legacy-worker', 'legacy-assignment', 'legacy-activity', 'legacy-item', 2);
      INSERT INTO reward_requests
        VALUES ('legacy-request', 'legacy-worker', 'legacy-transaction', 'approved', 2);
      INSERT INTO audit_logs VALUES ('legacy-audit', 2);
      INSERT INTO app_settings VALUES ('reward_system_enabled', '1', 1);
    `);

    migrateFamilySchema(db, 10, "Asia/Shanghai");
    migrateFamilySchema(db, 11, "Asia/Shanghai");

    const scopedTables = [
      "workers",
      "tasks",
      "task_assignments",
      "consumption_activities",
      "transactions",
      "reward_requests",
      "audit_logs",
      "reward_definitions",
      "reward_grant_batches",
      "worker_reward_items",
    ];
    for (const table of scopedTables) {
      expect(db.prepare(`SELECT DISTINCT family_id FROM ${table}`).all()).toEqual([
        { family_id: DEFAULT_FAMILY_ID },
      ]);
    }
    expect(db.prepare("SELECT id, name, timezone, status FROM families WHERE id = ?")
      .get(DEFAULT_FAMILY_ID)).toEqual({
      id: DEFAULT_FAMILY_ID,
      name: "我的家庭",
      timezone: "Asia/Shanghai",
      status: "active",
    });
    expect(db.prepare("SELECT family_id, key, value FROM app_settings").get()).toEqual({
      family_id: DEFAULT_FAMILY_ID,
      key: "reward_system_enabled",
      value: "1",
    });

    db.prepare(`
      INSERT INTO families(id, name, timezone, status, entry_code, created_at, updated_at)
      VALUES ('family-two', '第二家庭', 'Asia/Shanghai', 'active', 'family-two-entry-code', 20, 20)
    `).run();
    db.prepare(`
      INSERT INTO boss_accounts(
        id, username, display_name, password_hash, auth_version, is_active, created_at, updated_at
      ) VALUES ('boss-two', 'boss.two', '第二家庭老板', 'test-password-hash', 1, 1, 20, 20)
    `).run();
    db.prepare("INSERT INTO family_bosses(family_id, boss_id, created_at) VALUES ('family-two', 'boss-two', 20)")
      .run();
    db.prepare("INSERT INTO app_settings(family_id, key, value, updated_at) VALUES ('family-two', 'reward_system_enabled', '0', 20)")
      .run();
    expect(db.prepare("SELECT COUNT(*) AS count FROM app_settings WHERE key = 'reward_system_enabled'").get())
      .toEqual({ count: 2 });

    db.prepare("INSERT INTO workers(id, family_id, is_active, created_at) VALUES ('worker-two', 'family-two', 1, 20)")
      .run();
    expect(() => db.prepare(`
      INSERT INTO tasks(id, family_id, target_worker_id, status, created_at)
      VALUES ('cross-family-task', ?, 'worker-two', 'published', 20)
    `).run(DEFAULT_FAMILY_ID)).toThrow(/FAMILY_MISMATCH/);
    expect(() => db.prepare("UPDATE workers SET family_id = 'family-two' WHERE id = 'legacy-worker'").run())
      .toThrow(/FAMILY_IMMUTABLE/);
    expect(() => db.prepare(`
      UPDATE app_settings SET family_id = 'family-two'
      WHERE family_id = ? AND key = 'reward_system_enabled'
    `).run(DEFAULT_FAMILY_ID)).toThrow(/FAMILY_IMMUTABLE/);

    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = 9").get()).toEqual({ version: 9 });
    expect(db.pragma("foreign_key_check")).toEqual([]);
    db.close();
  });
});
