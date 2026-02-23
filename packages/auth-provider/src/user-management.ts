export interface ManagedUser {
  id: string;
  email: string;
  externalId?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  active: boolean;
}

export interface ListUsersOptions {
  limit: number;
  cursor?: string;
  search?: string;
}

export interface ListUsersResult {
  users: ManagedUser[];
  nextCursor?: string;
}

export interface UserManagementStore {
  findById(id: string): Promise<ManagedUser | null>;
  listUsers(options: ListUsersOptions): Promise<ListUsersResult>;
}

export async function getUserById(
  store: UserManagementStore,
  userId: string
): Promise<ManagedUser | null> {
  return store.findById(userId);
}

export async function listUsers(
  store: UserManagementStore,
  options: ListUsersOptions
): Promise<ListUsersResult> {
  return store.listUsers(options);
}
