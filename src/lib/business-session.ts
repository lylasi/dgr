import { getAuthorizedBossContext } from "@/lib/account-service";
import {
  systemAdminBusinessContext,
  type FamilyBusinessContext,
} from "@/lib/business-context";
import { DEFAULT_FAMILY_ID } from "@/lib/db";
import {
  getWorkerAuth,
  workerAuthorizationValid,
  workerBelongsToFamily,
} from "@/lib/service";
import {
  isSystemAdminAuthorized,
  type SessionPayload,
} from "@/lib/session";

/**
 * Resolves a signed session into the family boundary and real business actor.
 * A null result means the active identity has been revoked or is incomplete.
 */
export function businessContextFromSession(
  session: SessionPayload,
): FamilyBusinessContext | null {
  const active = session.active;
  if (!active) return null;

  if (active.type === "system_admin") {
    return isSystemAdminAuthorized(session)
      ? systemAdminBusinessContext(DEFAULT_FAMILY_ID)
      : null;
  }

  if (active.type === "boss" || active.type === "boss_as_worker") {
    const boss = getAuthorizedBossContext(
      active.bossId,
      session.bosses[active.bossId] || -1,
      active.familyId,
    );
    if (!boss) return null;
    if (active.type === "boss") {
      return {
        familyId: boss.familyId,
        actor: {
          type: "boss",
          bossId: boss.bossId,
          displayName: boss.displayName,
        },
      };
    }
    if (!workerBelongsToFamily(active.workerId, active.familyId)) return null;
    return {
      familyId: boss.familyId,
      actor: {
        type: "boss_as_worker",
        bossId: boss.bossId,
        displayName: boss.displayName,
        workerId: active.workerId,
      },
    };
  }

  const version = session.workers[active.workerId] || -1;
  if (!workerAuthorizationValid(active.workerId, version, active.familyId)) return null;
  const worker = getWorkerAuth(active.workerId);
  return {
    familyId: active.familyId,
    actor: {
      type: "worker",
      workerId: active.workerId,
      displayName: worker.displayName,
    },
  };
}
