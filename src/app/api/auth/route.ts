import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  authenticateBoss,
  bossAuthorizationVersionValid,
  changeBossPassword,
  getAuthorizedBossContext,
} from "@/lib/account-service";
import type { FamilyBusinessContext } from "@/lib/business-context";
import { getConfig } from "@/lib/config";
import { AppError, jsonError, jsonOk } from "@/lib/http";
import { safeTextEqual } from "@/lib/password";
import { assertLoginAllowed, clearLoginFailures, recordLoginFailure } from "@/lib/rate-limit";
import {
  authenticateWorker,
  getWorkerAuth,
  workerAuthorizationValid,
  workerBelongsToFamily,
} from "@/lib/service";
import {
  clearSession,
  createEmptySession,
  currentSystemAdminFingerprint,
  getRequestSession,
  isSystemAdminAuthorized,
  writeSession,
  type ActiveIdentity,
} from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("system_admin_login"), password: z.string().min(1).max(200) }),
  // Kept during the staged migration for already-open browser clients.
  z.object({ action: z.literal("admin_login"), password: z.string().min(1).max(200) }),
  z.object({
    action: z.literal("boss_login"),
    username: z.string().trim().min(1).max(50),
    password: z.string().min(1).max(200),
    familyId: z.string().uuid().optional(),
  }),
  z.object({
    action: z.literal("worker_login"),
    workerId: z.string().uuid(),
    password: z.string().min(1).max(200),
  }),
  z.object({
    action: z.literal("boss_change_password"),
    currentPassword: z.string().min(1).max(200),
    newPassword: z.string().min(8).max(200),
    requestId: z.string().trim().min(8).max(100).optional(),
  }),
  z.object({
    action: z.literal("switch"),
    identity: z.discriminatedUnion("type", [
      z.object({ type: z.literal("system_admin") }),
      z.object({ type: z.literal("admin") }),
      z.object({
        type: z.literal("boss"),
        bossId: z.string().uuid(),
        familyId: z.string().uuid(),
      }),
      z.object({
        type: z.literal("worker"),
        workerId: z.string().uuid(),
        familyId: z.string().uuid().optional(),
      }),
      z.object({
        type: z.literal("boss_as_worker"),
        bossId: z.string().uuid(),
        workerId: z.string().uuid(),
        familyId: z.string().uuid(),
      }),
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
    let extra: Record<string, unknown> = {};

    if (input.action === "system_admin_login" || input.action === "admin_login") {
      const key = clientKey(request, "system-admin");
      assertLoginAllowed(key);
      if (!safeTextEqual(input.password, getConfig().systemAdminPassword)) {
        recordLoginFailure(key);
        throw new AppError("密码不正确，请再试一次。", 401, "INVALID_PASSWORD");
      }
      clearLoginFailures(key);
      session.systemAdminFingerprint = currentSystemAdminFingerprint();
      session.active = { type: "system_admin" };
    } else if (input.action === "boss_login") {
      const key = clientKey(request, `boss:${input.username.trim().toLocaleLowerCase()}`);
      assertLoginAllowed(key);
      let auth: Awaited<ReturnType<typeof authenticateBoss>>;
      try {
        auth = await authenticateBoss(input.username, input.password);
        clearLoginFailures(key);
      } catch (error) {
        recordLoginFailure(key);
        throw error;
      }
      session.bosses[auth.bossId] = auth.authVersion;
      const selectedFamily = input.familyId
        ? auth.families.find((family) => family.familyId === input.familyId)
        : auth.families.length === 1 ? auth.families[0] : null;
      if (input.familyId && !selectedFamily) {
        throw new AppError("这个老板不能进入所选家庭。", 403, "BOSS_FAMILY_FORBIDDEN");
      }
      if (selectedFamily) {
        session.active = {
          type: "boss",
          bossId: auth.bossId,
          familyId: selectedFamily.familyId,
        };
      } else {
        delete session.active;
      }
      extra = {
        boss: {
          id: auth.bossId,
          username: auth.username,
          displayName: auth.displayName,
        },
        families: auth.families,
        familySelectionRequired: !selectedFamily,
      };
    } else if (input.action === "worker_login") {
      const key = clientKey(request, input.workerId);
      assertLoginAllowed(key);
      try {
        const auth = await authenticateWorker(input.workerId, input.password);
        clearLoginFailures(key);
        session.workers[input.workerId] = auth.authVersion;
        session.active = {
          type: "worker",
          workerId: input.workerId,
          familyId: auth.familyId,
        };
      } catch (error) {
        recordLoginFailure(key);
        throw error;
      }
    } else if (input.action === "boss_change_password") {
      const active = session.active;
      if (active?.type !== "boss") {
        throw new AppError("请先返回老板后台再修改密码。", 401, "BOSS_LOGIN_REQUIRED");
      }
      const currentVersion = session.bosses[active.bossId] || -1;
      const context = getAuthorizedBossContext(active.bossId, currentVersion, active.familyId);
      if (!context) {
        delete session.bosses[active.bossId];
        delete session.active;
        throw new AppError("老板登录或家庭授权已失效，请重新登录。", 401, "BOSS_LOGIN_REQUIRED");
      }
      const key = clientKey(request, `boss-password:${active.bossId}`);
      assertLoginAllowed(key);
      const businessContext: FamilyBusinessContext = {
        familyId: context.familyId,
        actor: {
          type: "boss",
          bossId: context.bossId,
          displayName: context.displayName,
        },
      };
      let authVersion: number;
      try {
        authVersion = await changeBossPassword(businessContext, input);
        clearLoginFailures(key);
      } catch (error) {
        if (error instanceof AppError && error.code === "INVALID_BOSS_CURRENT_PASSWORD") {
          recordLoginFailure(key);
        }
        throw error;
      }
      session.bosses[active.bossId] = authVersion;
      extra = { passwordChanged: true };
    } else if (input.action === "switch") {
      let nextIdentity: ActiveIdentity;
      if (input.identity.type === "system_admin" || input.identity.type === "admin") {
        if (!isSystemAdminAuthorized(session)) {
          throw new AppError("请先输入系统管理员密码。", 401, "LOGIN_REQUIRED");
        }
        nextIdentity = { type: "system_admin" };
      } else if (input.identity.type === "boss") {
        const bossVersion = session.bosses[input.identity.bossId] || -1;
        if (!bossAuthorizationVersionValid(input.identity.bossId, bossVersion)) {
          delete session.bosses[input.identity.bossId];
          throw new AppError("请重新登录老板账号。", 401, "LOGIN_REQUIRED");
        }
        const context = getAuthorizedBossContext(
          input.identity.bossId,
          bossVersion,
          input.identity.familyId,
        );
        if (!context) {
          throw new AppError("这个老板不能进入所选家庭。", 403, "BOSS_FAMILY_FORBIDDEN");
        }
        nextIdentity = input.identity;
      } else if (input.identity.type === "boss_as_worker") {
        const current = session.active;
        if (
          (current?.type !== "boss" && current?.type !== "boss_as_worker")
          || current.bossId !== input.identity.bossId
          || current.familyId !== input.identity.familyId
        ) {
          throw new AppError(
            "请先以当前家庭的老板身份进入。",
            403,
            "BOSS_PROXY_SWITCH_FORBIDDEN",
          );
        }
        const bossVersion = session.bosses[input.identity.bossId] || -1;
        const context = getAuthorizedBossContext(
          input.identity.bossId,
          bossVersion,
          input.identity.familyId,
        );
        if (!context) {
          delete session.bosses[input.identity.bossId];
          throw new AppError("请重新登录老板账号。", 401, "LOGIN_REQUIRED");
        }
        if (!workerBelongsToFamily(input.identity.workerId, input.identity.familyId)) {
          throw new AppError("没有找到这个打工人。", 404, "WORKER_NOT_FOUND");
        }
        nextIdentity = input.identity;
      } else {
        const familyId = input.identity.familyId || getWorkerAuth(input.identity.workerId).familyId;
        if (!workerAuthorizationValid(
          input.identity.workerId,
          session.workers[input.identity.workerId] || -1,
          familyId,
        )) {
          delete session.workers[input.identity.workerId];
          throw new AppError("请先输入这个角色的密码。", 401, "LOGIN_REQUIRED");
        }
        nextIdentity = { ...input.identity, familyId };
      }
      session.active = nextIdentity;
    } else if (input.action === "logout_current") {
      if (session.active?.type === "system_admin") delete session.systemAdminFingerprint;
      if (session.active?.type === "boss") delete session.bosses[session.active.bossId];
      if (session.active?.type === "boss_as_worker") delete session.bosses[session.active.bossId];
      if (session.active?.type === "worker") delete session.workers[session.active.workerId];
      delete session.active;
    } else {
      session = createEmptySession();
      const response = jsonOk({ activeIdentity: null });
      clearSession(response);
      return response;
    }

    const response = jsonOk({ activeIdentity: session.active || null, ...extra });
    writeSession(response, session);
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
