import type { NextRequest } from "next/server";
import { AppError, jsonError } from "@/lib/http";
import { getRequestSession, isSystemAdminAuthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function rejectLegacyBusinessAccess(request: NextRequest): never {
  const session = getRequestSession(request);
  if (session.active?.type === "system_admin" && isSystemAdminAuthorized(session)) {
    throw new AppError(
      "系统管理员不参与家庭日常业务，请使用对应家庭的老板账号。",
      403,
      "SYSTEM_ADMIN_BUSINESS_FORBIDDEN",
    );
  }
  throw new AppError("请先登录家庭老板账号。", 401, "ADMIN_LOGIN_REQUIRED");
}

export async function GET(request: NextRequest) {
  try {
    rejectLegacyBusinessAccess(request);
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    rejectLegacyBusinessAccess(request);
  } catch (error) {
    return jsonError(error);
  }
}
