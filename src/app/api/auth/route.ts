import type { NextRequest } from "next/server";
import { z } from "zod";
import { getConfig } from "@/lib/config";
import { AppError, jsonError, jsonOk } from "@/lib/http";
import { safeTextEqual } from "@/lib/password";
import { assertLoginAllowed, clearLoginFailures, recordLoginFailure } from "@/lib/rate-limit";
import { authenticateWorker, workerAuthorizationValid } from "@/lib/service";
import {
  clearSession,
  createEmptySession,
  currentAdminFingerprint,
  getRequestSession,
  isAdminAuthorized,
  writeSession,
} from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("admin_login"), password: z.string().min(1).max(200) }),
  z.object({
    action: z.literal("worker_login"),
    workerId: z.string().uuid(),
    password: z.string().min(1).max(200),
  }),
  z.object({
    action: z.literal("switch"),
    identity: z.discriminatedUnion("type", [
      z.object({ type: z.literal("admin") }),
      z.object({ type: z.literal("worker"), workerId: z.string().uuid() }),
    ]),
  }),
  z.object({ action: z.literal("logout_current") }),
  z.object({ action: z.literal("logout_all") }),
]);

function clientKey(request: NextRequest, identity: string) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return `${forwarded || "local"}:${identity}`;
}

export async function POST(request: NextRequest) {
  try {
    const input = schema.parse(await request.json());
    let session = getRequestSession(request);

    if (input.action === "admin_login") {
      const key = clientKey(request, "admin");
      assertLoginAllowed(key);
      if (!safeTextEqual(input.password, getConfig().adminPassword)) {
        recordLoginFailure(key);
        throw new AppError("密码不正确，请再试一次。", 401, "INVALID_PASSWORD");
      }
      clearLoginFailures(key);
      session.adminFingerprint = currentAdminFingerprint();
      session.active = { type: "admin" };
    } else if (input.action === "worker_login") {
      const key = clientKey(request, input.workerId);
      assertLoginAllowed(key);
      try {
        const auth = await authenticateWorker(input.workerId, input.password);
        clearLoginFailures(key);
        session.workers[input.workerId] = auth.authVersion;
        session.active = { type: "worker", workerId: input.workerId };
      } catch (error) {
        recordLoginFailure(key);
        throw error;
      }
    } else if (input.action === "switch") {
      if (input.identity.type === "admin") {
        if (!isAdminAuthorized(session)) throw new AppError("请先输入管理员密码。", 401, "LOGIN_REQUIRED");
      } else if (!workerAuthorizationValid(input.identity.workerId, session.workers[input.identity.workerId] || -1)) {
        delete session.workers[input.identity.workerId];
        throw new AppError("请先输入这个角色的密码。", 401, "LOGIN_REQUIRED");
      }
      session.active = input.identity;
    } else if (input.action === "logout_current") {
      if (session.active?.type === "admin") delete session.adminFingerprint;
      if (session.active?.type === "worker") delete session.workers[session.active.workerId];
      delete session.active;
    } else {
      session = createEmptySession();
      const response = jsonOk({ activeIdentity: null });
      clearSession(response);
      return response;
    }

    const response = jsonOk({ activeIdentity: session.active || null });
    writeSession(response, session);
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
