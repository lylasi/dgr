import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { DEFAULT_FAMILY_ID } from "@/lib/db";

export const SESSION_COOKIE = "pen_worker_session";

export type ActiveIdentity =
  | { type: "system_admin" }
  | { type: "boss"; bossId: string; familyId: string }
  | { type: "worker"; workerId: string; familyId: string }
  | { type: "boss_as_worker"; bossId: string; workerId: string; familyId: string };

export type SessionPayload = {
  version: 2;
  expiresAt: number;
  systemAdminFingerprint?: string;
  bosses: Record<string, number>;
  workers: Record<string, number>;
  active?: ActiveIdentity;
};

type LegacySessionPayload = {
  version: 1;
  expiresAt: number;
  adminFingerprint?: string;
  workers?: Record<string, number>;
  active?: { type: "admin" } | { type: "worker"; workerId: string };
};

export function createEmptySession(): SessionPayload {
  const config = getConfig();
  return {
    version: 2,
    expiresAt: Date.now() + config.sessionMaxAgeSeconds * 1000,
    bosses: {},
    workers: {},
  };
}

function hmac(value: string): string {
  return createHmac("sha256", getConfig().sessionSecret).update(value).digest("base64url");
}

export function currentSystemAdminFingerprint(): string {
  // Retain the original namespace so valid v1 administrator cookies survive
  // the semantic rename from administrator to system administrator.
  return hmac(`admin-password:${getConfig().systemAdminPassword}`);
}

export function isSystemAdminAuthorized(session: SessionPayload): boolean {
  return session.systemAdminFingerprint === currentSystemAdminFingerprint();
}

/** @deprecated Transitional alias for server tests and old imports. */
export const currentAdminFingerprint = currentSystemAdminFingerprint;
/** @deprecated Transitional alias for server tests and old imports. */
export const isAdminAuthorized = isSystemAdminAuthorized;

export function encodeSession(session: SessionPayload): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${hmac(payload)}`;
}

function authorizationMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([id, version]) => id.length > 0 && Number.isInteger(version) && Number(version) > 0),
  ) as Record<string, number>;
}

function activeIdentity(value: unknown, legacy = false): ActiveIdentity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const identity = value as Record<string, unknown>;
  if ((legacy && identity.type === "admin") || identity.type === "system_admin") {
    return { type: "system_admin" };
  }
  if (identity.type === "boss" && typeof identity.bossId === "string" && typeof identity.familyId === "string") {
    return { type: "boss", bossId: identity.bossId, familyId: identity.familyId };
  }
  if (identity.type === "worker" && typeof identity.workerId === "string") {
    const familyId = typeof identity.familyId === "string"
      ? identity.familyId
      : legacy ? DEFAULT_FAMILY_ID : undefined;
    if (!familyId) return undefined;
    return {
      type: "worker",
      workerId: identity.workerId,
      familyId,
    };
  }
  if (
    identity.type === "boss_as_worker"
    && typeof identity.bossId === "string"
    && typeof identity.workerId === "string"
    && typeof identity.familyId === "string"
  ) {
    return {
      type: "boss_as_worker",
      bossId: identity.bossId,
      workerId: identity.workerId,
      familyId: identity.familyId,
    };
  }
  return undefined;
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
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as
      | SessionPayload
      | LegacySessionPayload;
    if (!Number.isFinite(parsed.expiresAt) || parsed.expiresAt <= Date.now()) {
      return createEmptySession();
    }
    if (parsed.version === 2) {
      return {
        version: 2,
        expiresAt: parsed.expiresAt,
        systemAdminFingerprint: typeof parsed.systemAdminFingerprint === "string"
          ? parsed.systemAdminFingerprint
          : undefined,
        bosses: authorizationMap(parsed.bosses),
        workers: authorizationMap(parsed.workers),
        active: activeIdentity(parsed.active),
      };
    }
    if (parsed.version === 1) {
      return {
        version: 2,
        expiresAt: parsed.expiresAt,
        systemAdminFingerprint: typeof parsed.adminFingerprint === "string"
          ? parsed.adminFingerprint
          : undefined,
        bosses: {},
        workers: authorizationMap(parsed.workers),
        active: activeIdentity(parsed.active, true),
      };
    }
    return createEmptySession();
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
