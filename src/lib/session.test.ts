import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetConfigForTests } from "@/lib/config";
import { DEFAULT_FAMILY_ID } from "@/lib/db";
import {
  createEmptySession,
  currentSystemAdminFingerprint,
  decodeSession,
  encodeSession,
} from "@/lib/session";

const sessionSecret = "session-v2-test-secret-with-more-than-thirty-two-characters";

function signedPayload(payload: unknown) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", sessionSecret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

describe("session v2", () => {
  beforeEach(() => {
    process.env.SYSTEM_ADMIN_PASSWORD = "session-system-admin";
    process.env.SESSION_SECRET = sessionSecret;
    resetConfigForTests();
  });

  afterEach(() => {
    resetConfigForTests();
    delete process.env.SYSTEM_ADMIN_PASSWORD;
    delete process.env.SESSION_SECRET;
  });

  it("migrates a valid v1 administrator and worker cookie to v2", () => {
    const decoded = decodeSession(signedPayload({
      version: 1,
      expiresAt: Date.now() + 60_000,
      adminFingerprint: currentSystemAdminFingerprint(),
      workers: { "legacy-worker": 3 },
      active: { type: "worker", workerId: "legacy-worker" },
    }));

    expect(decoded).toMatchObject({
      version: 2,
      systemAdminFingerprint: currentSystemAdminFingerprint(),
      bosses: {},
      workers: { "legacy-worker": 3 },
      active: {
        type: "worker",
        workerId: "legacy-worker",
        familyId: DEFAULT_FAMILY_ID,
      },
    });

    const admin = decodeSession(signedPayload({
      version: 1,
      expiresAt: Date.now() + 60_000,
      adminFingerprint: currentSystemAdminFingerprint(),
      workers: {},
      active: { type: "admin" },
    }));
    expect(admin.active).toEqual({ type: "system_admin" });
  });

  it("round-trips all v2 authorization maps and identities", () => {
    const session = createEmptySession();
    session.systemAdminFingerprint = currentSystemAdminFingerprint();
    session.bosses["boss-one"] = 2;
    session.workers["worker-one"] = 4;
    session.active = {
      type: "boss_as_worker",
      bossId: "boss-one",
      workerId: "worker-one",
      familyId: "family-one",
    };

    expect(decodeSession(encodeSession(session))).toEqual(session);
  });

  it("drops malformed v2 fields and rejects missing family context", () => {
    const decoded = decodeSession(signedPayload({
      version: 2,
      expiresAt: Date.now() + 60_000,
      systemAdminFingerprint: 123,
      bosses: { valid: 2, zero: 0, text: "3" },
      workers: null,
      active: { type: "worker", workerId: "worker-without-family" },
    }));

    expect(decoded.systemAdminFingerprint).toBeUndefined();
    expect(decoded.bosses).toEqual({ valid: 2 });
    expect(decoded.workers).toEqual({});
    expect(decoded.active).toBeUndefined();
  });

  it("replaces expired, unsigned, and tampered cookies with an empty session", () => {
    const expired = decodeSession(signedPayload({
      version: 2,
      expiresAt: Date.now() - 1,
      bosses: { old: 1 },
      workers: {},
      active: { type: "system_admin" },
    }));
    expect(expired.version).toBe(2);
    expect(expired.bosses).toEqual({});
    expect(expired.active).toBeUndefined();
    expect(expired.expiresAt).toBeGreaterThan(Date.now());

    expect(decodeSession("not-a-session").active).toBeUndefined();
    const valid = encodeSession(createEmptySession());
    expect(decodeSession(`${valid}tampered`).workers).toEqual({});
  });
});
