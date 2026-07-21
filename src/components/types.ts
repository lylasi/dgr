export type Identity = { type: "admin" } | { type: "worker"; workerId: string };

export type WorkerPublic = {
  id: string;
  name: string;
  avatar: string;
  theme: string;
  avatarUrl: string | null;
  authorized?: boolean;
};

export type Worker = WorkerPublic & {
  authVersion: number;
  balanceSeconds: number;
  dailyRewardSeconds: number;
  timezone: string;
  isActive: boolean;
};

export type Task = {
  id: string;
  title: string;
  description: string;
  rewardSeconds: number;
  targetWorkerId: string | null;
  timingMode: "none" | "optional" | "required";
  minimumDurationSeconds: number | null;
  bonusEnabled: boolean;
  excellentMultiplier: number;
  bonusCriteria: string | null;
  availableFrom: number | null;
  dueAt: number | null;
  status: "published" | "closed";
  createdAt: number;
  rewardBindings: TaskRewardBinding[];
  assignmentCount?: number;
  assignedWorkerIds?: string[];
};

export type Assignment = {
  id: string;
  taskId: string;
  workerId: string;
  title: string;
  description: string;
  rewardSeconds: number;
  timingMode: "none" | "optional" | "required";
  minimumDurationSeconds: number | null;
  bonusEnabled: boolean;
  excellentMultiplier: number;
  bonusCriteria: string | null;
  dueAt: number | null;
  status: "claimed" | "in_progress" | "submitted" | "revision_requested" | "approved" | "rejected" | "cancelled";
  submissionNote: string | null;
  reviewMultiplier: number | null;
  reviewTier: "normal" | "excellent" | null;
  reviewNote: string | null;
  reviewedAt: number | null;
  claimedAt: number;
  submittedAt: number | null;
  durationSeconds: number;
  rewardItems: AssignmentRewardItem[];
};

export type RewardRequest = {
  id: string;
  workerId: string;
  workerName?: string;
  title: string;
  description: string;
  rewardSeconds: number;
  status: "pending" | "revision_requested" | "approved" | "rejected" | "cancelled";
  reviewNote: string | null;
  reviewedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type ActiveTimer = {
  workerId: string;
  type: "reward_task" | "consumption";
  assignmentId: string | null;
  consumptionActivityId: string | null;
  startedAt: number;
  startedBy: string;
  title: string;
};

export type Activity = {
  id: string;
  name: string;
  icon: string;
  sortOrder: number;
  isActive: boolean;
};

export type RewardKind = "random_time" | "fixed_time" | "physical";
export type RewardSource = "daily" | "task" | "admin_direct" | "achievement" | "adjustment";
export type RewardItemStatus = "available" | "redeemed" | "fulfilled" | "cancelled" | "expired";

export type RewardDefinition = {
  id: string;
  name: string;
  description: string;
  icon: string;
  theme: string;
  kind: RewardKind;
  version: number;
  isActive: boolean;
  randomMinSeconds: number | null;
  randomMaxSeconds: number | null;
  fixedSeconds: number | null;
  physicalDescription: string | null;
  fulfillmentInstructions: string | null;
  imageUrl: string | null;
  validityMode: "permanent";
  createdAt: number;
  updatedAt: number;
};

export type TaskRewardBinding = RewardDefinition & {
  bindingId: string;
  definitionId: string;
  grantTier: "normal" | "excellent_bonus";
  quantity: number;
  probabilityPercent: number;
};

export type AssignmentRewardItem = {
  id: string;
  definitionId: string | null;
  definitionVersion: number | null;
  grantTier: "normal" | "excellent_bonus";
  quantity: number;
  probabilityPercent: number;
  name: string;
  description: string;
  icon: string;
  theme: string;
  kind: RewardKind;
  randomMinSeconds: number | null;
  randomMaxSeconds: number | null;
  fixedSeconds: number | null;
  physicalDescription: string | null;
  fulfillmentInstructions: string | null;
  imageUrl: string | null;
  outcomeCount: number;
  awardedQuantity: number | null;
};

export type RewardItem = {
  id: string;
  workerId: string;
  workerName?: string;
  grantBatchId: string;
  definitionId: string | null;
  definitionVersion: number | null;
  sourceType: RewardSource;
  sourceId: string | null;
  grantedBy: string;
  grantReason: string;
  name: string;
  description: string;
  icon: string;
  theme: string;
  kind: RewardKind;
  randomMinSeconds: number | null;
  randomMaxSeconds: number | null;
  fixedSeconds: number | null;
  physicalDescription: string | null;
  fulfillmentInstructions: string | null;
  imageUrl: string | null;
  status: RewardItemStatus;
  expiresAt: number | null;
  grantedAt: number;
  redeemedAt: number | null;
  fulfilledAt: number | null;
  cancelledAt: number | null;
  cancellationReason: string | null;
  resultSeconds: number | null;
  transactionId: string | null;
  usedAt: number | null;
};

export type DailyCouponSetting = {
  workerId: string;
  isEnabled: boolean;
  dailyQuantity: number;
  randomMinSeconds: number;
  randomMaxSeconds: number;
  updatedAt: number;
};

export type DailyCouponGrant = {
  id: string;
  workerId: string;
  localDate: string;
  enabledSnapshot: boolean;
  quantitySnapshot: number;
  randomMinSeconds: number;
  randomMaxSeconds: number;
  actualQuantity: number;
  createdAt: number;
};

export type Transaction = {
  id: string;
  workerId: string;
  workerName?: string;
  type: "daily_reward" | "task_reward" | "consumption" | "admin_adjustment" | "coupon_reward";
  title: string;
  amountSeconds: number;
  balanceAfterSeconds: number;
  actor: string;
  reason: string | null;
  rewardItemId: string | null;
  startedAt: number | null;
  endedAt: number | null;
  createdAt: number;
  isReversed: boolean;
  reversalOfTransactionId: string | null;
};

export type WorkerState = {
  worker: Worker;
  availableTasks: Task[];
  assignments: Assignment[];
  rewardRequests: RewardRequest[];
  activeTimer: ActiveTimer | null;
  activities: Activity[];
  transactions: Transaction[];
  rewardSystemEnabled: boolean;
  rewardItems: RewardItem[];
  availableRewardCount: number;
  dailyCouponSetting: DailyCouponSetting;
  todayDailyCouponGrant: DailyCouponGrant | null;
  summary: {
    todayIncomeSeconds: number;
    todaySpentSeconds: number;
    pendingRewardSeconds: number;
    dailyGrantAmountSeconds: number | null;
  };
};

export type AdminWorker = Worker & {
  activeTimer: ActiveTimer | null;
  assignments: Assignment[];
  pendingReviewCount: number;
  dailyCouponSetting: DailyCouponSetting;
  todayDailyCouponGrant: DailyCouponGrant | null;
  availableRewardCount: number;
};

export type AdminState = {
  workers: AdminWorker[];
  tasks: Task[];
  reviews: Assignment[];
  rewardRequests: RewardRequest[];
  activities: Activity[];
  transactions: Transaction[];
  rewardSystemEnabled: boolean;
  rewardDefinitions: RewardDefinition[];
  rewardItems: RewardItem[];
  dailyCouponSettings: DailyCouponSetting[];
  dailyCouponGrants: DailyCouponGrant[];
  todayDailyCouponGrants: Record<string, DailyCouponGrant>;
};

export type BootstrapState = {
  workers: WorkerPublic[];
  adminAuthorized: boolean;
  activeIdentity: Identity | null;
};
