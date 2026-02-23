import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  WebAuthnCredential,
  CredentialDeviceType,
  AuthenticatorTransportFuture,
} from "@simplewebauthn/server";

export interface StoredPasskey {
  userId: string;
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  transports?: AuthenticatorTransportFuture[];
  deviceType: CredentialDeviceType;
  backedUp: boolean;
  webauthnUserID: string;
  friendlyName?: string;
  deviceInfo?: string;
  lastUsedAt?: string;
}

export interface PasskeyStore {
  listByUserId(userId: string): Promise<StoredPasskey[]>;
  findByCredentialId(userId: string, credentialId: string): Promise<StoredPasskey | null>;
  findByCredentialIdGlobal?(credentialId: string): Promise<StoredPasskey | null>;
  save(credential: StoredPasskey): Promise<void>;
  updateCounter(userId: string, credentialId: string, counter: number): Promise<void>;
  updateLastUsed(userId: string, credentialId: string): Promise<void>;
  delete(userId: string, credentialId: string): Promise<void>;
}

export interface PasskeyChallengeStore {
  setRegistrationOptions(userId: string, options: PublicKeyCredentialCreationOptionsJSON): void;
  getRegistrationOptions(userId: string): PublicKeyCredentialCreationOptionsJSON | null;
  setAuthenticationOptions(userId: string, options: PublicKeyCredentialRequestOptionsJSON): void;
  getAuthenticationOptions(userId: string): PublicKeyCredentialRequestOptionsJSON | null;
  setAuthenticationOptionsByChallenge?(challenge: string, options: PublicKeyCredentialRequestOptionsJSON): void;
  getAuthenticationOptionsByChallenge?(challenge: string): PublicKeyCredentialRequestOptionsJSON | null;
}

export interface PasskeyRpConfig {
  rpName: string;
  rpID: string;
  origin: string;
}

export type UserVerification = "required" | "preferred" | "discouraged";

export type PreferredAuthenticatorType = "securityKey" | "localDevice" | "remoteDevice";

export interface StartRegistrationOptions {
  userId: string;
  userName: string;
  userDisplayName?: string;
  credentialStore: PasskeyStore;
  challengeStore: PasskeyChallengeStore;
  rpConfig: PasskeyRpConfig;
  residentKeyRequirement?: "discouraged" | "preferred" | "required";
  authenticatorAttachment?: "platform" | "cross-platform";
  userVerification?: UserVerification;
  preferredAuthenticatorType?: PreferredAuthenticatorType;
}

export async function startRegistration(
  options: StartRegistrationOptions
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const {
    userId,
    userName,
    userDisplayName,
    credentialStore,
    challengeStore,
    rpConfig,
    residentKeyRequirement,
    authenticatorAttachment,
    userVerification,
    preferredAuthenticatorType,
  } = options;
  const existing = await credentialStore.listByUserId(userId);
  const excludeCredentials = existing.map((p) => ({
    id: p.credentialId,
    transports: p.transports,
  }));
  const hasAuthenticatorSelection =
    residentKeyRequirement ||
    authenticatorAttachment ||
    userVerification;
  const authenticatorSelection = hasAuthenticatorSelection
    ? {
        residentKey: residentKeyRequirement,
        authenticatorAttachment,
        userVerification,
      }
    : undefined;
  const regOptions = await generateRegistrationOptions({
    rpName: rpConfig.rpName,
    rpID: rpConfig.rpID,
    userName,
    userDisplayName: userDisplayName ?? userName,
    attestationType: "none",
    excludeCredentials,
    authenticatorSelection,
    preferredAuthenticatorType,
  });
  challengeStore.setRegistrationOptions(userId, regOptions);
  return regOptions;
}

export interface MfaBackupProvider {
  hasMfaOrBackupCodes(userId: string): Promise<boolean>;
}

export interface FinishRegistrationOptions {
  userId: string;
  response: RegistrationResponseJSON;
  credentialStore: PasskeyStore;
  challengeStore: PasskeyChallengeStore;
  rpConfig: PasskeyRpConfig;
  name?: string;
  deviceInfo?: string;
  mfaBackupProvider: MfaBackupProvider;
}

export interface FinishRegistrationResult {
  verified: boolean;
  credentialId?: string;
  requiresMfaOrBackup?: boolean;
}

export async function finishRegistration(
  options: FinishRegistrationOptions
): Promise<FinishRegistrationResult> {
  const { userId, response, credentialStore, challengeStore, rpConfig, mfaBackupProvider } =
    options;
  const expectedOptions = challengeStore.getRegistrationOptions(userId);
  if (!expectedOptions) {
    return { verified: false };
  }
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: expectedOptions.challenge,
      expectedOrigin: rpConfig.origin,
      expectedRPID: rpConfig.rpID,
    });
  } catch {
    return { verified: false };
  }
  if (!verification.verified || !verification.registrationInfo) {
    return { verified: false };
  }
  const hasBackup = await mfaBackupProvider.hasMfaOrBackupCodes(userId);
  if (!hasBackup) {
    return {
      verified: false,
      requiresMfaOrBackup: true,
    };
  }
  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const webauthnUserID = expectedOptions.user.id;
  const deviceInfo =
    options.deviceInfo ??
    deriveDeviceInfo(credentialDeviceType, credential.transports);
  const stored: StoredPasskey = {
    userId,
    credentialId: credential.id,
    publicKey: credential.publicKey,
    counter: credential.counter,
    transports: credential.transports,
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    webauthnUserID,
    friendlyName: options.name,
    deviceInfo,
  };
  await credentialStore.save(stored);
  return { verified: true, credentialId: credential.id };
}

export interface StartAuthenticationOptions {
  userId?: string;
  credentialStore: PasskeyStore;
  challengeStore: PasskeyChallengeStore;
  rpConfig: PasskeyRpConfig;
  userVerification?: UserVerification;
  useDiscoverableCredentials?: boolean;
}

export async function startAuthentication(
  options: StartAuthenticationOptions
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const {
    userId,
    credentialStore,
    challengeStore,
    rpConfig,
    userVerification,
    useDiscoverableCredentials,
  } = options;
  let allowCredentials: { id: string; transports?: AuthenticatorTransportFuture[] }[] | undefined;
  if (useDiscoverableCredentials) {
    allowCredentials = undefined;
  } else if (userId) {
    const passkeys = await credentialStore.listByUserId(userId);
    allowCredentials = passkeys.map((p) => ({
      id: p.credentialId,
      transports: p.transports,
    }));
  } else {
    allowCredentials = undefined;
  }
  const authOptions = await generateAuthenticationOptions({
    rpID: rpConfig.rpID,
    allowCredentials: allowCredentials?.length ? allowCredentials : undefined,
    userVerification,
  });
  if (useDiscoverableCredentials && challengeStore.setAuthenticationOptionsByChallenge) {
    challengeStore.setAuthenticationOptionsByChallenge(authOptions.challenge, authOptions);
  } else if (userId) {
    challengeStore.setAuthenticationOptions(userId, authOptions);
  }
  return authOptions;
}

export interface FinishAuthenticationOptions {
  userId?: string;
  response: AuthenticationResponseJSON;
  credentialStore: PasskeyStore;
  challengeStore: PasskeyChallengeStore;
  rpConfig: PasskeyRpConfig;
}

export interface FinishAuthenticationResult {
  verified: boolean;
  credentialId?: string;
  userId?: string;
}

function decodeClientDataChallenge(clientDataJSON: string): string | null {
  try {
    const decoded = Buffer.from(clientDataJSON, "base64url").toString("utf-8");
    const clientData = JSON.parse(decoded) as { challenge?: string };
    return clientData.challenge ?? null;
  } catch {
    return null;
  }
}

export async function finishAuthentication(
  options: FinishAuthenticationOptions
): Promise<FinishAuthenticationResult> {
  const { userId, response, credentialStore, challengeStore, rpConfig } = options;
  let expectedOptions: PublicKeyCredentialRequestOptionsJSON | null;
  let passkey: StoredPasskey | null;
  if (userId !== undefined) {
    expectedOptions = challengeStore.getAuthenticationOptions(userId);
    passkey = expectedOptions
      ? await credentialStore.findByCredentialId(userId, response.id)
      : null;
  } else if (
    challengeStore.getAuthenticationOptionsByChallenge &&
    credentialStore.findByCredentialIdGlobal
  ) {
    const challenge = decodeClientDataChallenge(response.response.clientDataJSON);
    if (!challenge) return { verified: false };
    expectedOptions = challengeStore.getAuthenticationOptionsByChallenge(challenge);
    passkey = expectedOptions
      ? await credentialStore.findByCredentialIdGlobal(response.id)
      : null;
  } else {
    return { verified: false };
  }
  if (!expectedOptions || !passkey) {
    return { verified: false };
  }
  const publicKey = new Uint8Array(new ArrayBuffer(passkey.publicKey.length));
  publicKey.set(passkey.publicKey);
  const credential: WebAuthnCredential = {
    id: passkey.credentialId,
    publicKey,
    counter: passkey.counter,
    transports: passkey.transports,
  };
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: expectedOptions.challenge,
      expectedOrigin: rpConfig.origin,
      expectedRPID: rpConfig.rpID,
      credential,
    });
  } catch {
    return { verified: false };
  }
  if (!verification.verified) {
    return { verified: false };
  }
  const uid = passkey.userId;
  await credentialStore.updateCounter(uid, response.id, verification.authenticationInfo.newCounter);
  await credentialStore.updateLastUsed(uid, response.id);
  return {
    verified: true,
    credentialId: response.id,
    ...(userId === undefined ? { userId: uid } : {}),
  };
}

export interface RevokePasskeyOptions {
  userId: string;
  credentialId: string;
  credentialStore: PasskeyStore;
}

export interface RevokePasskeyResult {
  revoked: boolean;
}

export interface ListPasskeysOptions {
  userId: string;
  credentialStore: PasskeyStore;
}

export async function listPasskeys(
  options: ListPasskeysOptions
): Promise<StoredPasskey[]> {
  const { userId, credentialStore } = options;
  return credentialStore.listByUserId(userId);
}

export async function revokePasskey(
  options: RevokePasskeyOptions
): Promise<RevokePasskeyResult> {
  const { userId, credentialId, credentialStore } = options;
  const passkey = await credentialStore.findByCredentialId(userId, credentialId);
  if (!passkey) {
    return { revoked: false };
  }
  await credentialStore.delete(userId, credentialId);
  return { revoked: true };
}

function deriveDeviceInfo(
  deviceType: CredentialDeviceType,
  transports?: AuthenticatorTransportFuture[]
): string {
  const parts: string[] = [deviceType];
  if (transports?.length) parts.push(transports.join(", "));
  return parts.join(" · ");
}

export function createMemoryPasskeyStore(): PasskeyStore {
  const byUser = new Map<string, StoredPasskey[]>();
  return {
    async listByUserId(userId: string) {
      return byUser.get(userId) ?? [];
    },
    async findByCredentialId(userId: string, credentialId: string) {
      const list = byUser.get(userId) ?? [];
      return list.find((p) => p.credentialId === credentialId) ?? null;
    },
    async findByCredentialIdGlobal(credentialId: string) {
      for (const list of byUser.values()) {
        const p = list.find((c) => c.credentialId === credentialId);
        if (p) return p;
      }
      return null;
    },
    async save(credential: StoredPasskey) {
      const list = byUser.get(credential.userId) ?? [];
      if (list.some((p) => p.credentialId === credential.credentialId)) return;
      list.push({
        ...credential,
        publicKey: new Uint8Array(credential.publicKey),
      });
      byUser.set(credential.userId, list);
    },
    async updateCounter(userId: string, credentialId: string, counter: number) {
      const list = byUser.get(userId) ?? [];
      const p = list.find((c) => c.credentialId === credentialId);
      if (p) p.counter = counter;
    },
    async updateLastUsed(userId: string, credentialId: string) {
      const list = byUser.get(userId) ?? [];
      const p = list.find((c) => c.credentialId === credentialId);
      if (p) p.lastUsedAt = new Date().toISOString();
    },
    async delete(userId: string, credentialId: string) {
      const list = byUser.get(userId) ?? [];
      const next = list.filter((p) => p.credentialId !== credentialId);
      if (next.length === 0) byUser.delete(userId);
      else byUser.set(userId, next);
    },
  };
}

export function createMemoryPasskeyChallengeStore(): PasskeyChallengeStore {
  const regByUser = new Map<string, PublicKeyCredentialCreationOptionsJSON>();
  const authByUser = new Map<string, PublicKeyCredentialRequestOptionsJSON>();
  const authByChallenge = new Map<string, PublicKeyCredentialRequestOptionsJSON>();
  return {
    setRegistrationOptions(userId: string, options: PublicKeyCredentialCreationOptionsJSON) {
      regByUser.set(userId, options);
    },
    getRegistrationOptions(userId: string) {
      return regByUser.get(userId) ?? null;
    },
    setAuthenticationOptions(userId: string, options: PublicKeyCredentialRequestOptionsJSON) {
      authByUser.set(userId, options);
    },
    getAuthenticationOptions(userId: string) {
      return authByUser.get(userId) ?? null;
    },
    setAuthenticationOptionsByChallenge(
      challenge: string,
      options: PublicKeyCredentialRequestOptionsJSON
    ) {
      authByChallenge.set(challenge, options);
    },
    getAuthenticationOptionsByChallenge(challenge: string) {
      return authByChallenge.get(challenge) ?? null;
    },
  };
}
