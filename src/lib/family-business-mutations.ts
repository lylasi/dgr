import { z } from "zod";
import type { FamilyBusinessContext } from "@/lib/business-context";
import {
  rotateBossFamilyEntryCode,
  updateBossDisplayName,
  updateBossFamilyDisplayName,
  updateBossFamilyName,
} from "@/lib/account-service";
import {
  adjustBalance,
  assignTask,
  cancelAssignment,
  cancelConsumptionTimer,
  createConsumptionActivity,
  createTask,
  createWorker,
  grantQuickReward,
  manualConsumption,
  removeWorkerAvatarImage,
  reviewAssignment,
  reviewRewardRequest,
  reverseConsumptionTransaction,
  setAssignmentDuration,
  setTaskStatus,
  setWorkerAvatarImage,
  startTimer,
  stopTimer,
  toggleConsumptionActivity,
  updateTask,
  updateWorker,
} from "@/lib/service";
import {
  cancelRewardItem,
  copyRewardDefinition,
  createRewardDefinition,
  deleteRewardDefinition,
  grantRewardDefinition,
  removeRewardDefinitionImage,
  setRewardDefinitionActive,
  setRewardDefinitionImage,
  setRewardSystemEnabled,
  updateDailyCouponSetting,
  updateRewardDefinition,
} from "@/lib/reward-service";

const requestId = z.string().min(8).max(100).optional();
const workerId = z.string().uuid();
const rewardDefinitionId = z.string().uuid();
const taskRewardBinding = z.object({
  definitionId: rewardDefinitionId,
  grantTier: z.enum(["normal", "excellent_bonus"]),
  quantity: z.number().int().positive(),
  probabilityPercent: z.number().int().min(0).max(100).default(100),
});
const rewardDefinitionFields = {
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(600).default(""),
  icon: z.enum(["gift", "sparkles", "clock", "book", "toy", "food", "trip"]),
  theme: z.enum(["purple", "blue", "green", "orange", "pink"]),
  kind: z.enum(["random_time", "fixed_time", "physical"]),
  randomMinSeconds: z.number().int().min(60).max(86400).nullable().optional(),
  randomMaxSeconds: z.number().int().min(60).max(86400).nullable().optional(),
  fixedSeconds: z.number().int().min(60).max(86400).nullable().optional(),
  physicalDescription: z.string().trim().max(600).nullable().optional(),
  fulfillmentInstructions: z.string().trim().max(600).nullable().optional(),
};

export const familyBusinessMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update_boss_display_name"),
    displayName: z.string().trim().min(1).max(60),
    requestId,
  }),
  z.object({
    action: z.literal("update_boss_family_display_name"),
    displayName: z.string().trim().min(1).max(60).nullable(),
    requestId,
  }),
  z.object({
    action: z.literal("update_family_name"),
    name: z.string().trim().min(1).max(60),
    requestId,
  }),
  z.object({ action: z.literal("rotate_family_entry_code"), requestId }),
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
  z.object({ action: z.literal("create_reward_definition"), ...rewardDefinitionFields, requestId }),
  z.object({
    action: z.literal("update_reward_definition"),
    definitionId: rewardDefinitionId,
    ...rewardDefinitionFields,
    requestId,
  }),
  z.object({ action: z.literal("copy_reward_definition"), definitionId: rewardDefinitionId, requestId }),
  z.object({ action: z.literal("delete_reward_definition"), definitionId: rewardDefinitionId, requestId }),
  z.object({
    action: z.literal("set_reward_definition_active"),
    definitionId: rewardDefinitionId,
    active: z.boolean(),
    requestId,
  }),
  z.object({
    action: z.literal("upload_reward_definition_image"),
    definitionId: rewardDefinitionId,
    imageDataUrl: z.string().min(32).max(750000),
    requestId,
  }),
  z.object({ action: z.literal("remove_reward_definition_image"), definitionId: rewardDefinitionId, requestId }),
  z.object({
    action: z.literal("grant_reward_items"),
    workerId,
    definitionId: rewardDefinitionId,
    quantity: z.number().int().positive(),
    reason: z.string().trim().min(1).max(500),
    requestId,
  }),
  z.object({
    action: z.literal("cancel_reward_item"),
    rewardItemId: z.string().uuid(),
    reason: z.string().trim().min(1).max(500),
    requestId,
  }),
  z.object({
    action: z.literal("update_daily_coupon_setting"),
    workerId,
    isEnabled: z.boolean(),
    dailyQuantity: z.number().int().nonnegative(),
    randomMinSeconds: z.number().int().min(60).max(86400),
    randomMaxSeconds: z.number().int().min(60).max(86400),
    requestId,
  }),
  z.object({ action: z.literal("set_reward_system_enabled"), enabled: z.boolean(), requestId }),
  z.object({
    action: z.literal("create_task"),
    title: z.string().trim().min(1).max(60),
    description: z.string().trim().max(600).default(""),
    rewardSeconds: z.number().int().positive().max(86400),
    targetWorkerId: workerId.nullable().optional(),
    timingMode: z.enum(["none", "optional", "required"]),
    minimumDurationSeconds: z.number().int().min(0).max(86400).nullable().optional(),
    bonusEnabled: z.boolean(),
    excellentMultiplier: z.number().min(1).default(2),
    bonusCriteria: z.string().trim().max(300).nullable().optional(),
    rewardBindings: z.array(taskRewardBinding).default([]),
    repeatable: z.boolean().default(false),
    dueAt: z.number().int().positive().nullable().optional(),
    assignNow: z.boolean().optional(),
    requestId,
  }),
  z.object({
    action: z.literal("set_task_status"),
    taskId: z.string().uuid(),
    status: z.enum(["published", "closed"]),
    requestId,
  }),
  z.object({
    action: z.literal("update_task"),
    taskId: z.string().uuid(),
    title: z.string().trim().min(1).max(60),
    description: z.string().trim().max(600).default(""),
    rewardSeconds: z.number().int().positive().max(86400),
    targetWorkerId: workerId.nullable().optional(),
    timingMode: z.enum(["none", "optional", "required"]),
    minimumDurationSeconds: z.number().int().min(0).max(86400).nullable().optional(),
    bonusEnabled: z.boolean(),
    excellentMultiplier: z.number().min(1).default(2),
    bonusCriteria: z.string().trim().max(300).nullable().optional(),
    rewardBindings: z.array(taskRewardBinding).default([]),
    repeatable: z.boolean().default(false),
    dueAt: z.number().int().positive().nullable().optional(),
    requestId,
  }),
  z.object({ action: z.literal("assign_task"), taskId: z.string().uuid(), workerId, requestId }),
  z.object({
    action: z.literal("review"),
    assignmentId: z.string().uuid(),
    decision: z.enum(["approve", "excellent", "double", "revision", "reject"]),
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

export type FamilyBusinessMutation = z.infer<typeof familyBusinessMutationSchema>;

export async function applyFamilyBusinessMutation(
  context: FamilyBusinessContext,
  input: FamilyBusinessMutation,
): Promise<void> {
  switch (input.action) {
    case "update_boss_display_name":
      updateBossDisplayName(context, input);
      break;
    case "update_boss_family_display_name":
      updateBossFamilyDisplayName(context, input);
      break;
    case "update_family_name":
      updateBossFamilyName(context, input);
      break;
    case "rotate_family_entry_code":
      rotateBossFamilyEntryCode(context, input);
      break;
    case "create_worker":
      await createWorker(context, input);
      break;
    case "update_worker":
      await updateWorker(context, input);
      break;
    case "upload_worker_avatar":
      setWorkerAvatarImage(context, input);
      break;
    case "remove_worker_avatar":
      removeWorkerAvatarImage(context, input.workerId, input.requestId);
      break;
    case "create_reward_definition":
      createRewardDefinition(context, input);
      break;
    case "update_reward_definition":
      updateRewardDefinition(context, input);
      break;
    case "copy_reward_definition":
      copyRewardDefinition(context, input.definitionId, input.requestId);
      break;
    case "delete_reward_definition":
      deleteRewardDefinition(context, input.definitionId, input.requestId);
      break;
    case "set_reward_definition_active":
      setRewardDefinitionActive(context, input.definitionId, input.active, input.requestId);
      break;
    case "upload_reward_definition_image":
      setRewardDefinitionImage(context, input);
      break;
    case "remove_reward_definition_image":
      removeRewardDefinitionImage(context, input.definitionId, input.requestId);
      break;
    case "grant_reward_items":
      grantRewardDefinition(context, input);
      break;
    case "cancel_reward_item":
      cancelRewardItem(context, input);
      break;
    case "update_daily_coupon_setting":
      updateDailyCouponSetting(context, input);
      break;
    case "set_reward_system_enabled":
      setRewardSystemEnabled(context, input.enabled, input.requestId);
      break;
    case "create_task":
      createTask(context, input);
      break;
    case "set_task_status":
      setTaskStatus(context, input.taskId, input.status, input.requestId);
      break;
    case "update_task":
      updateTask(context, input);
      break;
    case "assign_task":
      assignTask(context, input.taskId, input.workerId, input.requestId);
      break;
    case "review":
      reviewAssignment(context, input);
      break;
    case "review_reward_request":
      reviewRewardRequest(context, input);
      break;
    case "timer_start":
      startTimer(context, input);
      break;
    case "timer_stop":
      stopTimer(context, input.workerId, input.requestId);
      break;
    case "cancel_consumption_timer":
      cancelConsumptionTimer(context, input);
      break;
    case "quick_reward":
      grantQuickReward(context, input);
      break;
    case "set_assignment_duration":
      setAssignmentDuration(context, input);
      break;
    case "cancel_assignment":
      cancelAssignment(context, input);
      break;
    case "manual_consumption":
      manualConsumption(context, input);
      break;
    case "reverse_consumption":
      reverseConsumptionTransaction(context, input);
      break;
    case "adjust_balance":
      adjustBalance(context, input);
      break;
    case "create_activity":
      createConsumptionActivity(context, input);
      break;
    case "toggle_activity":
      toggleConsumptionActivity(context, input.activityId, input.active, input.requestId);
      break;
  }
}
