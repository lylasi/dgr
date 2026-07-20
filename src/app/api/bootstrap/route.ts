import type { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { listPublicWorkers, workerAuthorizationValid } from "@/lib/service";
import {
  getRequestSession,
  isAdminAuthorized,
  writeSession,
  type ActiveIdentity,
} from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = getRequestSession(request);
    if (session.adminFingerprint && !isAdminAuthorized(session)) {
      delete session.adminFingerprint;
    }
    for (const [workerId, version] of Object.entries(session.workers)) {
      if (!workerAuthorizationValid(workerId, version)) delete session.workers[workerId];
    }

    const active = session.active;
    const activeValid =
      active?.type === "admin"
        ? isAdminAuthorized(session)
        : active?.type === "worker"
          ? Boolean(session.workers[active.workerId])
          : false;
    if (!activeValid) delete session.active;

    const workers = listPublicWorkers().map((worker) => ({
      id: worker.id,
      name: worker.name,
      avatar: worker.avatar,
      theme: worker.theme,
      avatarUrl: worker.avatarUrl,
      authorized: Boolean(session.workers[worker.id]),
    }));
    const response = jsonOk({
      workers,
      adminAuthorized: isAdminAuthorized(session),
      activeIdentity: (session.active || null) as ActiveIdentity | null,
    });
    writeSession(response, session);
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
