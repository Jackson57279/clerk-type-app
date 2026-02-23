import type { MemberRole } from "./member-approval.js";
import { validateRole, type MembershipStore } from "./membership-management.js";
import type { Team } from "./team-crud.js";

export const TEAM_ROLES: MemberRole[] = [
  "owner",
  "admin",
  "editor",
  "member",
  "guest",
];

export interface TeamMembership {
  id: string;
  userId: string;
  teamId: string;
  role: MemberRole;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateTeamMembershipInput {
  userId: string;
  teamId: string;
  role: MemberRole;
  permissions?: string[];
}

export interface UpdateTeamMembershipInput {
  role?: MemberRole;
  permissions?: string[];
}

export interface TeamMembershipStore {
  create(data: CreateTeamMembershipInput): Promise<TeamMembership>;
  getById(id: string): Promise<TeamMembership | null>;
  getByUserAndTeam(userId: string, teamId: string): Promise<TeamMembership | null>;
  listByTeam(teamId: string): Promise<TeamMembership[]>;
  listByUser(userId: string): Promise<TeamMembership[]>;
  update(id: string, data: UpdateTeamMembershipInput): Promise<TeamMembership>;
  delete(id: string): Promise<void>;
}

export async function addTeamMember(
  teamMembershipStore: TeamMembershipStore,
  membershipStore: MembershipStore,
  team: Team,
  userId: string,
  role: MemberRole,
  options?: { permissions?: string[] }
): Promise<TeamMembership> {
  validateRole(role);
  const orgMembership = await membershipStore.getByUserAndOrg(userId, team.organizationId);
  if (!orgMembership) {
    throw new Error("User must be a member of the organization to be added to a team");
  }
  const existing = await teamMembershipStore.getByUserAndTeam(userId, team.id);
  if (existing) {
    throw new Error("User is already a member of this team");
  }
  return teamMembershipStore.create({
    userId,
    teamId: team.id,
    role,
    permissions: options?.permissions ?? [],
  });
}

export async function removeTeamMember(
  store: TeamMembershipStore,
  membershipId: string
): Promise<void> {
  const membership = await store.getById(membershipId);
  if (!membership) {
    throw new Error("Team membership not found");
  }
  await store.delete(membershipId);
}

export async function updateTeamMemberRole(
  store: TeamMembershipStore,
  membershipId: string,
  role: MemberRole
): Promise<TeamMembership> {
  validateRole(role);
  const membership = await store.getById(membershipId);
  if (!membership) {
    throw new Error("Team membership not found");
  }
  return store.update(membershipId, { role });
}

export async function getTeamMembership(
  store: TeamMembershipStore,
  id: string
): Promise<TeamMembership | null> {
  return store.getById(id);
}

export async function getTeamMembershipByUserAndTeam(
  store: TeamMembershipStore,
  userId: string,
  teamId: string
): Promise<TeamMembership | null> {
  return store.getByUserAndTeam(userId, teamId);
}

export async function listTeamMembers(
  store: TeamMembershipStore,
  teamId: string
): Promise<TeamMembership[]> {
  return store.listByTeam(teamId);
}

export async function listUserTeamMemberships(
  store: TeamMembershipStore,
  userId: string
): Promise<TeamMembership[]> {
  return store.listByUser(userId);
}
