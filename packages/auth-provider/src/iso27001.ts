export type Iso27001AuditResult = "passed" | "nonconformity" | "observation";

export interface Iso27001AuditRecord {
  id: string;
  completedAt: string;
  scope: string;
  periodStart: string;
  periodEnd: string;
  result: Iso27001AuditResult;
  certificationBody?: string;
  createdAt: string;
}

export interface Iso27001AuditStore {
  save(record: Iso27001AuditRecord): Promise<void>;
  getLatest(): Promise<Iso27001AuditRecord | null>;
}

export interface RecordIso27001AuditInput {
  id: string;
  completedAt: string;
  scope: string;
  periodStart: string;
  periodEnd: string;
  result: Iso27001AuditResult;
  certificationBody?: string;
}

const DEFAULT_REVIEW_INTERVAL_MONTHS = 12;

export async function recordInternalAuditCompleted(
  input: RecordIso27001AuditInput,
  store: Iso27001AuditStore
): Promise<Iso27001AuditRecord> {
  const record: Iso27001AuditRecord = {
    ...input,
    createdAt: new Date().toISOString(),
  };
  await store.save(record);
  return record;
}

export async function getLastInternalAudit(
  store: Iso27001AuditStore
): Promise<Iso27001AuditRecord | null> {
  return store.getLatest();
}

export function getNextReviewDueDate(
  lastAudit: Iso27001AuditRecord,
  intervalMonths: number = DEFAULT_REVIEW_INTERVAL_MONTHS
): Date {
  const completed = new Date(lastAudit.completedAt);
  const next = new Date(completed);
  next.setUTCMonth(next.getUTCMonth() + intervalMonths);
  return next;
}

export function isReviewDue(
  lastAudit: Iso27001AuditRecord | null,
  asOf: Date,
  intervalMonths: number = DEFAULT_REVIEW_INTERVAL_MONTHS
): boolean {
  if (!lastAudit) return true;
  const nextDue = getNextReviewDueDate(lastAudit, intervalMonths);
  return asOf >= nextDue;
}

export interface Iso27001ComplianceStatus {
  compliant: boolean;
  lastAudit: Iso27001AuditRecord | null;
  reviewDue: boolean;
  nextReviewDue: Date | null;
}

export async function getComplianceStatus(
  store: Iso27001AuditStore,
  asOf: Date = new Date(),
  intervalMonths: number = DEFAULT_REVIEW_INTERVAL_MONTHS
): Promise<Iso27001ComplianceStatus> {
  const lastAudit = await getLastInternalAudit(store);
  const reviewDue = isReviewDue(lastAudit, asOf, intervalMonths);
  const nextReviewDue = lastAudit
    ? getNextReviewDueDate(lastAudit, intervalMonths)
    : null;
  const compliant =
    lastAudit !== null &&
    lastAudit.result === "passed" &&
    !reviewDue;
  return {
    compliant,
    lastAudit,
    reviewDue,
    nextReviewDue,
  };
}
