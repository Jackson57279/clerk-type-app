export type Soc2AuditResult = "passed" | "qualified" | "failed";

export interface Soc2AuditRecord {
  id: string;
  completedAt: string;
  periodStart: string;
  periodEnd: string;
  auditor?: string;
  result: Soc2AuditResult;
  createdAt: string;
}

export interface Soc2AuditStore {
  save(record: Soc2AuditRecord): Promise<void>;
  getLatest(): Promise<Soc2AuditRecord | null>;
}

export interface RecordAuditInput {
  id: string;
  completedAt: string;
  periodStart: string;
  periodEnd: string;
  auditor?: string;
  result: Soc2AuditResult;
}

const DEFAULT_ANNUAL_MONTHS = 12;

export async function recordAuditCompleted(
  input: RecordAuditInput,
  store: Soc2AuditStore
): Promise<Soc2AuditRecord> {
  const record: Soc2AuditRecord = {
    ...input,
    createdAt: new Date().toISOString(),
  };
  await store.save(record);
  return record;
}

export async function getLastAudit(
  store: Soc2AuditStore
): Promise<Soc2AuditRecord | null> {
  return store.getLatest();
}

export function getNextAuditDueDate(
  lastAudit: Soc2AuditRecord,
  annualIntervalMonths: number = DEFAULT_ANNUAL_MONTHS
): Date {
  const completed = new Date(lastAudit.completedAt);
  const next = new Date(completed);
  next.setUTCMonth(next.getUTCMonth() + annualIntervalMonths);
  return next;
}

export function isAuditDue(
  lastAudit: Soc2AuditRecord | null,
  asOf: Date,
  annualIntervalMonths: number = DEFAULT_ANNUAL_MONTHS
): boolean {
  if (!lastAudit) return true;
  const nextDue = getNextAuditDueDate(lastAudit, annualIntervalMonths);
  return asOf >= nextDue;
}
