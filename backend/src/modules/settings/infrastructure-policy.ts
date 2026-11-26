import { z } from "zod";

export const backgroundScheduleSchema = z.object({
  enabled: z.boolean(),
  intervalMinutes: z.number().int().min(5).max(1440).multipleOf(5),
  quietEnabled: z.boolean(),
  quietStart: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  quietEnd: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
}).strict().refine(value => !value.quietEnabled || value.quietStart !== value.quietEnd,
  "Choose different start and end times");

export const infrastructureSchema = z.object({
  schedule: backgroundScheduleSchema,
  calculator: z.object({
    computeCu: z.number().min(0.25).max(16),
    computeRateUsd: z.number().min(0).max(10),
    freeAllowanceCuHours: z.number().min(0).max(100000),
    plan: z.enum(["free", "paid"]),
    hostingBudgetUsd: z.number().min(0).max(100000),
  }).strict(),
}).strict();
export type InfrastructureSettings = z.infer<typeof infrastructureSchema>;
export const DEFAULT_INFRASTRUCTURE: InfrastructureSettings = {
  schedule: { enabled: true, intervalMinutes: 15, quietEnabled: true, quietStart: "01:00", quietEnd: "12:00" },
  calculator: { computeCu: 0.25, computeRateUsd: 0.106, freeAllowanceCuHours: 0, plan: "paid", hostingBudgetUsd: 0 },
};

export function isQuietTime(schedule: InfrastructureSettings["schedule"], now = new Date()): boolean {
  if (!schedule.quietEnabled) return false;
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  return schedule.quietStart < schedule.quietEnd
    ? time >= schedule.quietStart && time < schedule.quietEnd
    : time >= schedule.quietStart || time < schedule.quietEnd;
}

export function estimateCompute(settings: InfrastructureSettings, days = 30, idleMinutes = 5) {
  const { schedule, calculator } = settings;
  const minute = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const quietMinutes = schedule.quietEnabled ? (minute(schedule.quietEnd) - minute(schedule.quietStart) + 1440) % 1440 : 0;
  const operatingMinutes = 1440 - quietMinutes;
  const runsPerDay = schedule.enabled ? Math.ceil(operatingMinutes / schedule.intervalMinutes) : 0;
  // Upper approximation for the scheduled worker alone; traffic and query duration are excluded.
  const computeHours = Math.min(1440, runsPerDay * idleMinutes) * days / 60;
  const cuHours = computeHours * calculator.computeCu;
  return { runsPerDay, runsPerMonth: runsPerDay * days, cuHours,
    computeUsd: calculator.plan === "paid" ? cuHours * calculator.computeRateUsd : 0,
    exceedsFreeAllowance: calculator.plan === "free" && cuHours > calculator.freeAllowanceCuHours };
}
