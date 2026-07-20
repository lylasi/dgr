import type { NextRequest } from "next/server";
import { z } from "zod";
import { AppError, jsonError, jsonOk } from "@/lib/http";
import {
  cancelAssignment,
  cancelConsumptionTimer,
  claimTask,
  getWorkerState,
  manualConsumption,
  cancelRewardRequest,
  resubmitRewardRequest,
  setAssignmentDuration,
  startTimer,
  stopTimer,
  submitRewardRequest,
  submitAssignment,
  workerAuthorizationValid,
} from "@/lib/service";
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
]);

function requireWorker(request: NextRequest) {
  const session = getRequestSession(request);
  if (session.active?.type !== "worker") {
    throw new AppError("请先登录打工人角色。", 401, "WORKER_LOGIN_REQUIRED");
  }
  const workerId = session.active.workerId;
  if (!workerAuthorizationValid(workerId, session.workers[workerId] || -1)) {
    throw new AppError("登录已失效，请重新输入密码。", 401, "WORKER_LOGIN_REQUIRED");
  }
  return workerId;
}

export async function GET(request: NextRequest) {
  try {
    const workerId = requireWorker(request);
    return jsonOk(getWorkerState(workerId));
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const workerId = requireWorker(request);
    const input = mutationSchema.parse(await request.json());
    const actor = `worker:${workerId}` as const;

    switch (input.action) {
      case "claim_task":
        claimTask(workerId, input.taskId, input.requestId);
        break;
      case "start_task_timer":
        startTimer({
          workerId,
          timerType: "reward_task",
          targetId: input.assignmentId,
          actor,
          requestId: input.requestId,
        });
        break;
      case "start_consumption":
        startTimer({
          workerId,
          timerType: "consumption",
          targetId: input.activityId,
          actor,
          requestId: input.requestId,
        });
        break;
      case "stop_timer":
        stopTimer(workerId, actor, input.requestId);
        break;
      case "cancel_consumption_timer":
        cancelConsumptionTimer({ workerId, actor, requestId: input.requestId });
        break;
      case "set_assignment_duration":
        setAssignmentDuration({ ...input, actor });
        break;
      case "cancel_assignment":
        cancelAssignment({ ...input, actor });
        break;
      case "manual_consumption":
        manualConsumption({ ...input, workerId, actor });
        break;
      case "submit_task":
        submitAssignment({
          workerId,
          assignmentId: input.assignmentId,
          note: input.note,
          actor,
          requestId: input.requestId,
        });
        break;
      case "submit_reward_request":
        submitRewardRequest({ ...input, workerId });
        break;
      case "resubmit_reward_request":
        resubmitRewardRequest({ ...input, workerId });
        break;
      case "cancel_reward_request":
        cancelRewardRequest({ ...input, workerId });
        break;
    }
    return jsonOk(getWorkerState(workerId));
  } catch (error) {
    return jsonError(error);
  }
}
