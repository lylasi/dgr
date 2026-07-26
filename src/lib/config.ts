import path from "node:path";

export type AppConfig = {
  systemAdminPassword: string;
  sessionSecret: string;
  timezone: string;
  databasePath: string;
  sessionMaxAgeSeconds: number;
  cookieSecure: boolean;
};

let cachedConfig: AppConfig | undefined;

export function getConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;

  const systemAdminPassword = process.env.SYSTEM_ADMIN_PASSWORD?.trim()
    || process.env.ADMIN_PASSWORD?.trim();
  const sessionSecret = process.env.SESSION_SECRET?.trim();

  if (!systemAdminPassword) {
    throw new Error(
      "缺少 SYSTEM_ADMIN_PASSWORD（升级期间也可继续使用 ADMIN_PASSWORD），请通过环境变量、.env.local 或 .env 配置。",
    );
  }
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET 必须至少包含 32 个字符。");
  }

  const maxAgeDays = Number(process.env.SESSION_MAX_AGE_DAYS ?? "180");
  const rawDatabasePath = process.env.DATABASE_PATH || "./data/pen-worker.db";

  cachedConfig = {
    systemAdminPassword,
    sessionSecret,
    timezone: process.env.APP_TIMEZONE || "Asia/Shanghai",
    databasePath: path.isAbsolute(rawDatabasePath)
      ? rawDatabasePath
      : path.resolve(/* turbopackIgnore: true */ process.cwd(), rawDatabasePath),
    sessionMaxAgeSeconds:
      Number.isFinite(maxAgeDays) && maxAgeDays > 0
        ? Math.floor(maxAgeDays * 24 * 60 * 60)
        : 180 * 24 * 60 * 60,
    cookieSecure: process.env.COOKIE_SECURE === "true",
  };

  return cachedConfig;
}

export function resetConfigForTests() {
  cachedConfig = undefined;
}
