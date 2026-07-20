import { AppError } from "@/lib/http";

type Attempt = { count: number; blockedUntil: number; lastAttempt: number };

declare global {
  var __penWorkerLoginAttempts: Map<string, Attempt> | undefined;
}

const attempts = globalThis.__penWorkerLoginAttempts || new Map<string, Attempt>();
globalThis.__penWorkerLoginAttempts = attempts;

export function assertLoginAllowed(key: string) {
  const entry = attempts.get(key);
  if (entry && entry.blockedUntil > Date.now()) {
    const seconds = Math.max(1, Math.ceil((entry.blockedUntil - Date.now()) / 1000));
    throw new AppError(`试得有点多啦，请 ${seconds} 秒后再试。`, 429, "LOGIN_RATE_LIMITED");
  }
}

export function recordLoginFailure(key: string) {
  const now = Date.now();
  const previous = attempts.get(key);
  const count = previous && now - previous.lastAttempt < 15 * 60 * 1000 ? previous.count + 1 : 1;
  const delay = count >= 5 ? Math.min(60_000, 2 ** Math.min(count - 5, 6) * 1_000) : 0;
  attempts.set(key, { count, blockedUntil: now + delay, lastAttempt: now });
}

export function clearLoginFailures(key: string) {
  attempts.delete(key);
}
