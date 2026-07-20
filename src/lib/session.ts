import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { getConfig } from "@/lib/config";

export const SESSION_COOKIE = "pen_worker_session";

export type ActiveIdentity =
  | { type: "admin" }
  | { type: "worker"; workerId: string };

export type SessionPayload = {
  version: 1;
  expiresAt: number;
  adminFingerprint?: string;
  workers: Record<string, number>;
  active?: ActiveIdentity;
};

export function createEmptySession(): SessionPayload {
  const config = getConfig();
  return {
    version: 1,
    expiresAt: Date.now() + config.sessionMaxAgeSeconds * 1000,
    workers: {},
  };
}

function hmac(value: string): string {
  return createHmac("sha256", getConfig().sessionSecret).update(value).digest("base64url");
}

export function currentAdminFingerprint(): string {
  return hmac(`admin-password:${getConfig().adminPassword}`);
}

export function isAdminAuthorized(session: SessionPayload): boolean {
  return session.adminFingerprint === currentAdminFingerprint();
}

export function encodeSession(session: SessionPayload): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${hmac(payload)}`;
}

export function decodeSession(value?: string): SessionPayload {
  if (!value) return createEmptySession();
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return createEmptySession();

  const expected = Buffer.from(hmac(payload));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return createEmptySession();
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionPayload;
    if (parsed.version !== 1 || parsed.expiresAt <= Date.now() || typeof parsed.workers !== "object") {
      return createEmptySession();
    }
    return parsed;
  } catch {
    return createEmptySession();
  }
}

export function getRequestSession(request: NextRequest): SessionPayload {
  return decodeSession(request.cookies.get(SESSION_COOKIE)?.value);
}

export function writeSession(response: NextResponse, session: SessionPayload): void {
  const config = getConfig();
  session.expiresAt = Date.now() + config.sessionMaxAgeSeconds * 1000;
  response.cookies.set(SESSION_COOKIE, encodeSession(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
    path: "/",
    maxAge: config.sessionMaxAgeSeconds,
  });
}

export function clearSession(response: NextResponse): void {
  const config = getConfig();
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
    path: "/",
    maxAge: 0,
  });
}
