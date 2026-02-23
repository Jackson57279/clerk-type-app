import { validateRole, addMember, type MemberRole } from "./membership-management.js";
import type { MembershipStore } from "./membership-management.js";
import type { Organization } from "./organization-crud.js";
import { assertOrganizationCanAddMember } from "./seat-management.js";
import type { OrganizationMembership } from "./member-approval.js";
import { generateSecureToken } from "./secure-token.js";
import type { RealtimeWebhookPayload } from "./realtime-webhook.js";
import { randomUUID } from "node:crypto";

export type InvitationStatus = "pending" | "accepted" | "revoked";

export const INVITATION_EXPIRY_DAYS = 7;

export interface Invitation {
  id: string;
  organizationId: string;
  email: string;
  role: MemberRole;
  token: string;
  invitedByUserId: string | null;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInvitationInput {
  organizationId: string;
  email: string;
  role: MemberRole;
  invitedByUserId?: string | null;
  expiresInDays?: number;
}

export interface InvitationStore {
  create(data: {
    organizationId: string;
    email: string;
    role: string;
    token: string;
    invitedByUserId: string | null;
    expiresAt: string;
  }): Promise<Invitation>;
  getById(id: string): Promise<Invitation | null>;
  getByToken(token: string): Promise<Invitation | null>;
  getPendingByEmailAndOrg(email: string, organizationId: string): Promise<Invitation | null>;
  listByOrganization(organizationId: string, status?: InvitationStatus): Promise<Invitation[]>;
  updateStatus(id: string, status: InvitationStatus): Promise<Invitation>;
}

export function isInvitationExpired(inv: Invitation): boolean {
  return new Date(inv.expiresAt) < new Date();
}

export function isInvitationValid(inv: Invitation): boolean {
  return inv.status === "pending" && !isInvitationExpired(inv);
}

export async function createInvitation(
  store: InvitationStore,
  org: Organization,
  membershipStore: MembershipStore,
  input: CreateInvitationInput
): Promise<Invitation> {
  validateRole(input.role);
  const email = input.email.trim().toLowerCase();
  if (!email) {
    throw new Error("Email is required");
  }
  const existingPending = await store.getPendingByEmailAndOrg(email, input.organizationId);
  if (existingPending) {
    throw new Error("A pending invitation already exists for this email in this organization");
  }
  const members = await membershipStore.listByOrganization(input.organizationId);
  const approvalMemberships: OrganizationMembership[] = members.map((m) => ({
    userId: m.userId,
    organizationId: m.organizationId,
    role: m.role,
    status: "active" as const,
  }));
  assertOrganizationCanAddMember({
    organizationId: org.id,
    memberships: approvalMemberships,
    seatLimit: org.maxMembers,
  });
  const expiresInDays = input.expiresInDays ?? INVITATION_EXPIRY_DAYS;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiresInDays);
  const token = generateSecureToken();
  return store.create({
    organizationId: input.organizationId,
    email,
    role: input.role,
    token,
    invitedByUserId: input.invitedByUserId ?? null,
    expiresAt: expiresAt.toISOString(),
  });
}

export async function getInvitation(
  store: InvitationStore,
  id: string
): Promise<Invitation | null> {
  return store.getById(id);
}

export async function getInvitationByToken(
  store: InvitationStore,
  token: string
): Promise<Invitation | null> {
  return store.getByToken(token);
}

export interface AcceptInvitationOptions {
  emitWebhook?: (payload: RealtimeWebhookPayload) => Promise<void>;
}

export async function acceptInvitation(
  invitationStore: InvitationStore,
  membershipStore: MembershipStore,
  org: Organization,
  token: string,
  userId: string,
  options: AcceptInvitationOptions = {}
): Promise<{ invitation: Invitation; membership: Awaited<ReturnType<typeof addMember>> }> {
  const invitation = await invitationStore.getByToken(token);
  if (!invitation) {
    throw new Error("Invitation not found");
  }
  if (!isInvitationValid(invitation)) {
    if (invitation.status !== "pending") {
      throw new Error(`Invitation is no longer valid (status: ${invitation.status})`);
    }
    throw new Error("Invitation has expired");
  }
  if (invitation.organizationId !== org.id) {
    throw new Error("Invitation does not belong to this organization");
  }
  const membership = await addMember(
    membershipStore,
    org,
    userId,
    invitation.role
  );
  const updated = await invitationStore.updateStatus(invitation.id, "accepted");
  if (options.emitWebhook) {
    await options.emitWebhook({
      type: "organization_invitation.accepted",
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      data: {
        invitation_id: updated.id,
        organization_id: updated.organizationId,
        user_id: userId,
        role: updated.role,
        email: updated.email,
      },
    });
  }
  return { invitation: updated, membership };
}

export async function revokeInvitation(
  store: InvitationStore,
  id: string
): Promise<Invitation> {
  const inv = await store.getById(id);
  if (!inv) {
    throw new Error("Invitation not found");
  }
  if (inv.status !== "pending") {
    throw new Error(`Cannot revoke invitation with status: ${inv.status}`);
  }
  return store.updateStatus(id, "revoked");
}

export async function listOrganizationInvitations(
  store: InvitationStore,
  organizationId: string,
  status?: InvitationStatus
): Promise<Invitation[]> {
  return store.listByOrganization(organizationId, status);
}
