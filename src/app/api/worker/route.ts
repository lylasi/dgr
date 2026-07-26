import type { NextRequest } from "next/server";
import { z } from "zod";
import { AppError, jsonError, jsonOk } from "@/lib/http";
import { businessContextFromSession } from "@/lib/business-session";
import {
  cancelAssignment,
  cancelConsumptionTimer,
  claimTask,
  getWorkerState,
  listWorkerTransactions,
  manualConsumption,
  cancelRewardRequest,
  resubmitRewardRequest,
  setAssignmentDuration,
  startTimer,
  stopTimer,
  submitRewardRequest,
  submitAssignment,
  syncWorker,
} from "@/lib/service";
import { assertLoginAllowed, clearLoginFailures, recordLoginFailure } from "@/lib/rate-limit";
import { confirmPhysicalReward, redeemTimeReward } from "@/lib/reward-service";
import { getRequestSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestId = z.string().min(8).max(100).optional();
const mutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim_task"), taskId: z.string().uuid(), requestId }),
  z.object({ action: z.literal("start_task_timer"), assignmentId: z.string().uuid(), requestId }),
  z.object({ action: z.literal("start_consumption"), activityId: z.string().min(1), requestId }),
  z.object({ action: z.literal("stop_timer"), requestId }),
  z.object({ action: z.literal("cancel_consumption_timer"), requestId }),
  z.object({
    action: z.literal("set_assignment_duration"),
    assignmentId: z.string().uuid(),
    durationSeconds: z.number().int().min(0).max(86400),
    requestId,
  }),
  z.object({ action: z.literal("cancel_assignment"), assignmentId: z.string().uuid(), requestId }),
  z.object({
    action: z.literal("manual_consumption"),
    activityId: z.string().min(1),
    durationSeconds: z.number().int().positive().max(86400),
    requestId,
  }),
  z.object({
    action: z.literal("submit_task"),
    assignmentId: z.string().uuid(),
    note: z.string().trim().max(500).default(""),
    requestId,
  }),
  z.object({
    action: z.literal("submit_reward_request"),
    title: z.string().trim().min(1).max(60),
    description: z.string().trim().max(600).default(""),
    rewardSeconds: z.number().int().positive().max(86400),
    requestId,
  }),
  z.object({
    action: z.literal("resubmit_reward_request"),
    rewardRequestId: z.string().uuid(),
    title: z.string().trim().min(1).max(60),
    description: z.string().trim().max(600).default(""),
    rewardSeconds: z.number().int().positive().max(86400),
    requestId,
  }),
  z.object({ action: z.literal("cancel_reward_request"), rewardRequestId: z.string().uuid(), requestId }),
  z.object({ action: z.literal("redeem_reward_item"), rewardItemId: z.string().uuid(), requestId }),
  z.object({
    action: z.literal("confirm_physical_reward"),
    rewardItemId: z.string().uuid(),
    password: z.string().min(1).max(200),
    requestId,
  }),
]);

function requireWorker(request: NextRequest) {
  const session = getRequestSession(request);
  if (session.active?.type !== "worker" && session.active?.type !== "boss_as_worker") {
    throw new AppError("请先登录打工人角色。", 401, "WORKER_LOGIN_REQUIRED");
  }
  const workerId = session.active.workerId;
  const context = businessContextFromSession(session);
  if (!context) {
    throw new AppError("登录已失效，请重新输入密码。", 401, "WORKER_LOGIN_REQUIRED");
  }
  return { context, workerId };
}

function credentialAttemptKey(request: NextRequest, workerId: string) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return `${forwarded || "local"}:${workerId}`;
}

export async function GET(request: NextRequest) {
  try {
    const { context, workerId } = requireWorker(request);
    if (request.nextUrl.searchParams.get("view") === "transactions") {
      const query = z.object({
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
      return jsonOk(listWorkerTransactions(context, workerId, query));
    }
    return jsonOk(getWorkerState(context, workerId));
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { context, workerId } = requireWorker(request);
    const input = mutationSchema.parse(await request.json());

    switch (input.action) {
      case "claim_task":
        claimTask(context, workerId, input.taskId, input.requestId);
        break;
      case "start_task_timer":
        startTimer(context, {
          workerId,
          timerType: "reward_task",
          targetId: input.assignmentId,
          requestId: input.requestId,
        });
        break;
      case "start_consumption":
        startTimer(context, {
          workerId,
          timerType: "consumption",
          targetId: input.activityId,
          requestId: input.requestId,
        });
        break;
      case "stop_timer":
        stopTimer(context, workerId, input.requestId);
        break;
      case "cancel_consumption_timer":
        cancelConsumptionTimer(context, { workerId, requestId: input.requestId });
        break;
      case "set_assignment_duration":
        setAssignmentDuration(context, input);
        break;
      case "cancel_assignment":
        cancelAssignment(context, input);
        break;
      case "manual_consumption":
        manualConsumption(context, { ...input, workerId });
        break;
      case "submit_task":
        submitAssignment(context, {
          workerId,
          assignmentId: input.assignmentId,
          note: input.note,
          requestId: input.requestId,
        });
        break;
      case "submit_reward_request":
        submitRewardRequest(context, { ...input, workerId });
        break;
      case "resubmit_reward_request":
        resubmitRewardRequest(context, { ...input, workerId });
        break;
      case "cancel_reward_request":
        cancelRewardRequest(context, { ...input, workerId });
        break;
      case "redeem_reward_item":
        syncWorker(context, workerId);
        redeemTimeReward(context, { ...input, workerId });
        break;
      case "confirm_physical_reward": {
        const key = credentialAttemptKey(request, workerId);
        assertLoginAllowed(key);
        try {
          syncWorker(context, workerId);
          await confirmPhysicalReward(context, { ...input, workerId });
          clearLoginFailures(key);
        } catch (error) {
          if (error instanceof AppError && error.code === "INVALID_PASSWORD") recordLoginFailure(key);
          throw error;
        }
        break;
      }
    }
    return jsonOk(getWorkerState(context, workerId));
  } catch (error) {
    return jsonError(error);
  }
}
