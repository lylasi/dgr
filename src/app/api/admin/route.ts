import type { NextRequest } from "next/server";
import { z } from "zod";
import { AppError, jsonError, jsonOk } from "@/lib/http";
import {
  adjustBalance,
  assignTask,
  cancelAssignment,
  cancelConsumptionTimer,
  closeTask,
  createConsumptionActivity,
  createTask,
  createWorker,
  getAdminState,
  grantQuickReward,
  manualConsumption,
  removeWorkerAvatarImage,
  reviewAssignment,
  reviewRewardRequest,
  reverseConsumptionTransaction,
  setAssignmentDuration,
  setWorkerAvatarImage,
  startTimer,
  stopTimer,
  toggleConsumptionActivity,
  updateWorker,
} from "@/lib/service";
import { getRequestSession, isAdminAuthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestId = z.string().min(8).max(100).optional();
const workerId = z.string().uuid();

const mutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_worker"),
    name: z.string().trim().min(1).max(30),
    password: z.string().min(4).max(100),
    avatar: z.string().min(1).max(30),
    theme: z.string().min(1).max(30),
    dailyRewardSeconds: z.number().int().min(0).max(86400),
    requestId,
  }),
  z.object({
    action: z.literal("update_worker"),
    workerId,
    name: z.string().trim().min(1).max(30).optional(),
    avatar: z.string().min(1).max(30).optional(),
    theme: z.string().min(1).max(30).optional(),
    dailyRewardSeconds: z.number().int().min(0).max(86400).optional(),
    password: z.string().min(4).max(100).optional(),
    isActive: z.boolean().optional(),
    requestId,
  }),
  z.object({
    action: z.literal("upload_worker_avatar"),
    workerId,
    imageDataUrl: z.string().min(32).max(750000),
    requestId,
  }),
  z.object({ action: z.literal("remove_worker_avatar"), workerId, requestId }),
  z.object({
    action: z.literal("create_task"),
    title: z.string().trim().min(1).max(60),
    description: z.string().trim().max(600).default(""),
    rewardSeconds: z.number().int().positive().max(86400),
    targetWorkerId: workerId.nullable().optional(),
    timingMode: z.enum(["none", "optional", "required"]),
    minimumDurationSeconds: z.number().int().min(0).max(86400).nullable().optional(),
    bonusEnabled: z.boolean(),
    bonusCriteria: z.string().trim().max(300).nullable().optional(),
    dueAt: z.number().int().positive().nullable().optional(),
    assignNow: z.boolean().optional(),
    requestId,
  }),
  z.object({ action: z.literal("close_task"), taskId: z.string().uuid(), requestId }),
  z.object({ action: z.literal("assign_task"), taskId: z.string().uuid(), workerId, requestId }),
  z.object({
    action: z.literal("review"),
    assignmentId: z.string().uuid(),
    decision: z.enum(["approve", "double", "revision", "reject"]),
    note: z.string().trim().max(500).default(""),
    requestId,
  }),
  z.object({
    action: z.literal("review_reward_request"),
    rewardRequestId: z.string().uuid(),
    decision: z.enum(["approve", "revision", "reject"]),
    note: z.string().trim().max(500).default(""),
    requestId,
  }),
  z.object({
    action: z.literal("timer_start"),
    workerId,
    timerType: z.enum(["reward_task", "consumption"]),
    targetId: z.string().min(1),
    requestId,
  }),
  z.object({ action: z.literal("timer_stop"), workerId, requestId }),
  z.object({ action: z.literal("cancel_consumption_timer"), workerId, requestId }),
  z.object({
    action: z.literal("quick_reward"),
    workerId,
    title: z.string().trim().min(1).max(60),
    rewardSeconds: z.number().int().positive().max(86400),
    note: z.string().trim().max(500).default(""),
    requestId,
  }),
  z.object({
    action: z.literal("set_assignment_duration"),
    assignmentId: z.string().uuid(),
    durationSeconds: z.number().int().min(0).max(86400),
    reason: z.string().trim().max(300).optional(),
    requestId,
  }),
  z.object({
    action: z.literal("cancel_assignment"),
    assignmentId: z.string().uuid(),
    reason: z.string().trim().max(300).optional(),
    requestId,
  }),
  z.object({
    action: z.literal("manual_consumption"),
    workerId,
    activityId: z.string().min(1),
    durationSeconds: z.number().int().positive().max(86400),
    requestId,
  }),
  z.object({
    action: z.literal("reverse_consumption"),
    transactionId: z.string().uuid(),
    reason: z.string().trim().max(300).optional(),
    requestId,
  }),
  z.object({
    action: z.literal("adjust_balance"),
    workerId,
    amountSeconds: z.number().int().min(-86400).max(86400).refine((value) => value !== 0),
    reason: z.string().trim().min(2).max(300),
    requestId,
  }),
  z.object({
    action: z.literal("create_activity"),
    name: z.string().trim().min(1).max(30),
    icon: z.string().max(30).optional(),
    requestId,
  }),
  z.object({
    action: z.literal("toggle_activity"),
    activityId: z.string().min(1),
    active: z.boolean(),
    requestId,
  }),
]);

function requireAdmin(request: NextRequest) {
  const session = getRequestSession(request);
  if (session.active?.type !== "admin" || !isAdminAuthorized(session)) {
    throw new AppError("请先使用管理员密码登录。", 401, "ADMIN_LOGIN_REQUIRED");
  }
}

export async function GET(request: NextRequest) {
  try {
    requireAdmin(request);
    return jsonOk(getAdminState());
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    requireAdmin(request);
    const input = mutationSchema.parse(await request.json());

    switch (input.action) {
      case "create_worker":
        await createWorker(input);
        break;
      case "update_worker":
        await updateWorker(input);
        break;
      case "upload_worker_avatar":
        setWorkerAvatarImage(input);
        break;
      case "remove_worker_avatar":
        removeWorkerAvatarImage(input.workerId, input.requestId);
        break;
      case "create_task":
        createTask(input);
        break;
      case "close_task":
        closeTask(input.taskId, input.requestId);
        break;
      case "assign_task":
        assignTask(input.taskId, input.workerId, input.requestId);
        break;
      case "review":
        reviewAssignment(input);
        break;
      case "review_reward_request":
        reviewRewardRequest(input);
        break;
      case "timer_start":
        startTimer({ ...input, actor: "admin" });
        break;
      case "timer_stop":
        stopTimer(input.workerId, "admin", input.requestId);
        break;
      case "cancel_consumption_timer":
        cancelConsumptionTimer({ ...input, actor: "admin" });
        break;
      case "quick_reward":
        grantQuickReward(input);
        break;
      case "set_assignment_duration":
        setAssignmentDuration({ ...input, actor: "admin" });
        break;
      case "cancel_assignment":
        cancelAssignment({ ...input, actor: "admin" });
        break;
      case "manual_consumption":
        manualConsumption({ ...input, actor: "admin" });
        break;
      case "reverse_consumption":
        reverseConsumptionTransaction(input);
        break;
      case "adjust_balance":
        adjustBalance(input);
        break;
      case "create_activity":
        createConsumptionActivity(input);
        break;
      case "toggle_activity":
        toggleConsumptionActivity(input.activityId, input.active, input.requestId);
        break;
    }

    return jsonOk(getAdminState());
  } catch (error) {
    return jsonError(error);
  }
}
