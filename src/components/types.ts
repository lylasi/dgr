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
  bonusCriteria: string | null;
  availableFrom: number | null;
  dueAt: number | null;
  status: "published" | "closed";
  createdAt: number;
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
  bonusCriteria: string | null;
  dueAt: number | null;
  status: "claimed" | "in_progress" | "submitted" | "revision_requested" | "approved" | "rejected" | "cancelled";
  submissionNote: string | null;
  reviewMultiplier: 1 | 2 | null;
  reviewNote: string | null;
  reviewedAt: number | null;
  claimedAt: number;
  submittedAt: number | null;
  durationSeconds: number;
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

export type Transaction = {
  id: string;
  workerId: string;
  workerName?: string;
  type: "daily_reward" | "task_reward" | "consumption" | "admin_adjustment";
  title: string;
  amountSeconds: number;
  balanceAfterSeconds: number;
  actor: string;
  reason: string | null;
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
};

export type AdminState = {
  workers: AdminWorker[];
  tasks: Task[];
  reviews: Assignment[];
  rewardRequests: RewardRequest[];
  activities: Activity[];
  transactions: Transaction[];
};

export type BootstrapState = {
  workers: WorkerPublic[];
  adminAuthorized: boolean;
  activeIdentity: Identity | null;
};
