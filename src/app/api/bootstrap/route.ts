import type { NextRequest } from "next/server";
import {
  getActiveFamilyByEntryCode,
  getActiveFamilySummary,
  getAuthorizedBossSummary,
  getPublicFamilyDirectoryState,
} from "@/lib/account-service";
import { businessContextFromSession } from "@/lib/business-session";
import { AppError, jsonError, jsonOk } from "@/lib/http";
import {
  listPublicWorkers,
  workerAuthorizationValid,
} from "@/lib/service";
import {
  getRequestSession,
  isSystemAdminAuthorized,
  writeSession,
  type ActiveIdentity,
} from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = getRequestSession(request);
    const entryCodeParameter = request.nextUrl.searchParams.get("entryCode");
    const entryCode = entryCodeParameter?.trim() || null;
    const entryFamily = entryCodeParameter === null
      ? null
      : entryCode ? getActiveFamilyByEntryCode(entryCode) : null;
    if (entryCodeParameter !== null && !entryFamily) {
      throw new AppError("这个家庭入口不存在或已经失效。", 404, "FAMILY_ENTRY_NOT_FOUND");
    }
    if (session.systemAdminFingerprint && !isSystemAdminAuthorized(session)) {
      delete session.systemAdminFingerprint;
    }
    const bosses = [];
    for (const [bossId, version] of Object.entries(session.bosses)) {
      const boss = getAuthorizedBossSummary(bossId, version);
      if (!boss) delete session.bosses[bossId];
      else bosses.push(boss);
    }
    for (const [workerId, version] of Object.entries(session.workers)) {
      if (!workerAuthorizationValid(workerId, version)) delete session.workers[workerId];
    }

    const activeContext = businessContextFromSession(session);
    if (session.active && !activeContext) delete session.active;
    const activeFamilyId = session.active?.type === "boss"
      || session.active?.type === "worker"
      || session.active?.type === "boss_as_worker"
      ? activeContext?.familyId || null
      : null;
    const family = entryFamily
      || (activeFamilyId ? getActiveFamilySummary(activeFamilyId) : null);
    if ((entryFamily || activeFamilyId) && !family) {
      throw new AppError("当前没有可用的家庭入口。", 404, "FAMILY_NOT_FOUND");
    }

    const workers = family ? listPublicWorkers(family.id).map((worker) => ({
      id: worker.id,
      familyId: worker.familyId,
      name: worker.name,
      avatar: worker.avatar,
      theme: worker.theme,
      avatarUrl: worker.avatarUrl && entryCode
        ? `${worker.avatarUrl}&entryCode=${encodeURIComponent(entryCode)}`
        : worker.avatarUrl,
      authorized: Boolean(session.workers[worker.id]),
    })) : [];
    const publicDirectory = entryCodeParameter === null && !activeFamilyId
      ? getPublicFamilyDirectoryState()
      : { enabled: false, families: [] };
    const systemAdminAuthorized = isSystemAdminAuthorized(session);
    const entryConflictsWithActiveFamily = Boolean(
      entryFamily && activeFamilyId && entryFamily.id !== activeFamilyId,
    );
    const response = jsonOk({
      family,
      publicFamilyDirectoryEnabled: publicDirectory.enabled,
      publicFamilies: publicDirectory.families,
      workers,
      bosses,
      systemAdminAuthorized,
      // Transitional response field for old browser bundles.
      adminAuthorized: systemAdminAuthorized,
      activeIdentity: (entryConflictsWithActiveFamily ? null : session.active || null) as ActiveIdentity | null,
    });
    writeSession(response, session);
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
