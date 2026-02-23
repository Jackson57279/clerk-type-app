export interface User {
  id: string;
  email?: string | null;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

export interface Session {
  sessionId: string;
  userId: string;
  orgId?: string | null;
  expiresAt?: string | null;
}

export interface AuthState {
  isLoaded: boolean;
  isSignedIn: boolean;
  session: Session | null;
  user: User | null;
  error: string | null;
}

export type GetSessionResult =
  | { ok: true; session: Session; user: User }
  | { ok: false; error?: string };

export interface ClerkProviderProps {
  publishableKey: string;
  apiUrl?: string | null;
  getSession?: () => Promise<GetSessionResult>;
  children: import("react").ReactNode;
}
