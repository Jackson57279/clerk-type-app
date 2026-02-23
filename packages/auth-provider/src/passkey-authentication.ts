import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import type {
  PasskeyStore,
  PasskeyChallengeStore,
  PasskeyRpConfig,
  UserVerification,
  FinishAuthenticationResult,
} from "./passkeys.js";
import { startAuthentication, finishAuthentication } from "./passkeys.js";

export interface PasskeyAuthenticationDeps {
  credentialStore: PasskeyStore;
  challengeStore: PasskeyChallengeStore;
  rpConfig: PasskeyRpConfig;
}

export interface StartPasskeyAuthenticationParams {
  userId?: string;
  userVerification?: UserVerification;
  useDiscoverableCredentials?: boolean;
}

export interface FinishPasskeyAuthenticationParams {
  response: AuthenticationResponseJSON;
  userId?: string;
}

export async function startPasskeyAuthentication(
  deps: PasskeyAuthenticationDeps,
  params: StartPasskeyAuthenticationParams = {}
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return startAuthentication({
    userId: params.userId,
    credentialStore: deps.credentialStore,
    challengeStore: deps.challengeStore,
    rpConfig: deps.rpConfig,
    userVerification: params.userVerification,
    useDiscoverableCredentials: params.useDiscoverableCredentials,
  });
}

export async function finishPasskeyAuthentication(
  deps: PasskeyAuthenticationDeps,
  params: FinishPasskeyAuthenticationParams
): Promise<FinishAuthenticationResult> {
  return finishAuthentication({
    userId: params.userId,
    response: params.response,
    credentialStore: deps.credentialStore,
    challengeStore: deps.challengeStore,
    rpConfig: deps.rpConfig,
  });
}
