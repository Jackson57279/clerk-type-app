import { isActiveMember, type OrganizationMembership } from "./member-approval.js";

export interface SeatUsage {
  organizationId: string;
  seatCount: number;
}

export function countActiveSeats(
  memberships: OrganizationMembership[]
): number {
  return memberships.filter((m) => isActiveMember(m)).length;
}

export function canAddSeat(
  seatsInUse: number,
  seatLimit: number | null
): boolean {
  if (seatLimit === null) return true;
  return seatsInUse < seatLimit;
}

export function getSeatUsage(
  organizationId: string,
  memberships: OrganizationMembership[]
): SeatUsage {
  return {
    organizationId,
    seatCount: countActiveSeats(memberships),
  };
}

export interface OrganizationMembershipsInput {
  organizationId: string;
  memberships: OrganizationMembership[];
}

export interface OrganizationSeatInfo {
  organizationId: string;
  memberships: OrganizationMembership[];
  seatLimit: number | null;
}

export function canOrganizationAddMember(info: OrganizationSeatInfo): boolean {
  const seatsInUse = countActiveSeats(info.memberships);
  return canAddSeat(seatsInUse, info.seatLimit);
}

export function getBillingSeatReport(
  organizations: OrganizationMembershipsInput[]
): SeatUsage[] {
  return organizations.map(({ organizationId, memberships }) =>
    getSeatUsage(organizationId, memberships)
  );
}

export interface BillingSeatPayload {
  organizationId: string;
  seatCount: number;
  at: string;
}

export function getBillingSeatPayloads(
  organizations: OrganizationMembershipsInput[],
  at: Date = new Date()
): BillingSeatPayload[] {
  const iso = at.toISOString();
  return getBillingSeatReport(organizations).map((u) => ({
    organizationId: u.organizationId,
    seatCount: u.seatCount,
    at: iso,
  }));
}
