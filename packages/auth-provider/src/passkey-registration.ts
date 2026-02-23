import type { PublicKeyCredentialCreationOptionsJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import type {
  PasskeyStore,
  PasskeyChallengeStore,
  PasskeyRpConfig,
  MfaBackupProvider,
  UserVerification,
  PreferredAuthenticatorType,
  FinishRegistrationResult,
} from "./passkeys.js";
import { startRegistration, finishRegistration } from "./passkeys.js";

export interface PasskeyRegistrationDeps {
  credentialStore: PasskeyStore;
  challengeStore: PasskeyChallengeStore;
  rpConfig: PasskeyRpConfig;
  mfaBackupProvider: MfaBackupProvider;
}

export interface StartPasskeyRegistrationParams {
  userId: string;
  userName: string;
  userDisplayName?: string;
  residentKeyRequirement?: "discouraged" | "preferred" | "required";
  authenticatorAttachment?: "platform" | "cross-platform";
  userVerification?: UserVerification;
  preferredAuthenticatorType?: PreferredAuthenticatorType;
}

export interface FinishPasskeyRegistrationParams {
  userId: string;
  response: RegistrationResponseJSON;
  name?: string;
  deviceInfo?: string;
}

export async function startPasskeyRegistration(
  deps: PasskeyRegistrationDeps,
  params: StartPasskeyRegistrationParams
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return startRegistration({
    userId: params.userId,
    userName: params.userName,
    userDisplayName: params.userDisplayName,
    credentialStore: deps.credentialStore,
    challengeStore: deps.challengeStore,
    rpConfig: deps.rpConfig,
    residentKeyRequirement: params.residentKeyRequirement,
    authenticatorAttachment: params.authenticatorAttachment,
    userVerification: params.userVerification,
    preferredAuthenticatorType: params.preferredAuthenticatorType,
  });
}

export async function finishPasskeyRegistration(
  deps: PasskeyRegistrationDeps,
  params: FinishPasskeyRegistrationParams
): Promise<FinishRegistrationResult> {
  return finishRegistration({
    userId: params.userId,
    response: params.response,
    credentialStore: deps.credentialStore,
    challengeStore: deps.challengeStore,
    rpConfig: deps.rpConfig,
    mfaBackupProvider: deps.mfaBackupProvider,
    name: params.name,
    deviceInfo: params.deviceInfo,
  });
}
