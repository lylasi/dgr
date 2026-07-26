import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  getAuthorizedBossContext,
  getBossPortalState,
} from "@/lib/account-service";
import type { FamilyBusinessContext } from "@/lib/business-context";
import {
  applyFamilyBusinessMutation,
  familyBusinessMutationSchema,
} from "@/lib/family-business-mutations";
import { AppError, jsonError, jsonOk } from "@/lib/http";
import { getAdminState, listWorkerTransactions } from "@/lib/service";
import { getRequestSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireBoss(request: NextRequest) {
  const session = getRequestSession(request);
  if (session.active?.type !== "boss") {
    throw new AppError("请先登录老板账号。", 401, "BOSS_LOGIN_REQUIRED");
  }
  const context = getAuthorizedBossContext(
    session.active.bossId,
    session.bosses[session.active.bossId] || -1,
    session.active.familyId,
  );
  if (!context) {
    throw new AppError("老板登录或家庭授权已失效，请重新登录。", 401, "BOSS_LOGIN_REQUIRED");
  }
  const businessContext: FamilyBusinessContext = {
    familyId: context.familyId,
    actor: {
      type: "boss",
      bossId: context.bossId,
      displayName: context.displayName,
    },
  };
  return { accountContext: context, businessContext };
}

function getBossBusinessState(context: ReturnType<typeof requireBoss>) {
  return {
    ...getBossPortalState(context.accountContext),
    ...getAdminState(context.businessContext),
  };
}

export async function GET(request: NextRequest) {
  try {
    const context = requireBoss(request);
    if (request.nextUrl.searchParams.get("view") === "transactions") {
      const query = z.object({
        workerId: z.string().uuid(),
        page: z.coerce.number().int().min(1).max(1_000_000).default(1),
        pageSize: z.coerce.number().int().min(1).max(30).default(30),
        type: z.enum(["daily_reward", "task_reward", "consumption", "admin_adjustment", "coupon_reward"]).optional(),
        direction: z.enum(["income", "spent"]).optional(),
        startDate: z.iso.date().optional(),
        endDate: z.iso.date().optional(),
        query: z.string().trim().max(100).optional(),
      }).parse(Object.fromEntries(request.nextUrl.searchParams));
      if (query.startDate && query.endDate && query.startDate > query.endDate) {
        throw new AppError("结束日期不能早于开始日期。", 400, "INVALID_DATE_RANGE");
      }
      return jsonOk(listWorkerTransactions(context.businessContext, query.workerId, query));
    }
    return jsonOk(getBossBusinessState(context));
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = requireBoss(request);
    const input = familyBusinessMutationSchema.parse(await request.json());
    await applyFamilyBusinessMutation(context.businessContext, input);
    return jsonOk(getBossBusinessState(requireBoss(request)));
  } catch (error) {
    return jsonError(error);
  }
}
