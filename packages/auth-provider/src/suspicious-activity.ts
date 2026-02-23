import { hashDeviceFingerprint } from "./device-binding.js";

const VELOCITY_WINDOW_MS = 5 * 60 * 1000;
const MAX_LOGINS_IN_WINDOW = 5;
const MAX_SPEED_KMH = 1200;
const LOCATION_PRECISION = 2;

export type SuspiciousReason =
  | "new_device"
  | "new_location"
  | "impossible_travel"
  | "velocity";

export interface LoginContext {
  userId: string;
  deviceFingerprint?: string | null;
  location?: { lat: number; lng: number } | null;
}

export interface SuspiciousActivityResult {
  suspicious: boolean;
  reasons: SuspiciousReason[];
}

interface UserActivityState {
  knownDeviceHashes: Set<string>;
  knownLocationKeys: Set<string>;
  lastLoginLocation: { lat: number; lng: number; timestamp: number } | null;
  loginTimestamps: number[];
}

const userState = new Map<string, UserActivityState>();

function getOrCreateState(userId: string): UserActivityState {
  let state = userState.get(userId);
  if (!state) {
    state = {
      knownDeviceHashes: new Set(),
      knownLocationKeys: new Set(),
      lastLoginLocation: null,
      loginTimestamps: [],
    };
    userState.set(userId, state);
  }
  return state;
}

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function locationKey(lat: number, lng: number, precision: number): string {
  const factor = 10 ** precision;
  return `${Math.round(lat * factor) / factor},${Math.round(lng * factor) / factor}`;
}

export interface SuspiciousActivityOptions {
  velocityWindowMs?: number;
  maxLoginsInWindow?: number;
  maxSpeedKmh?: number;
  locationPrecision?: number;
}

export function evaluateLogin(
  context: LoginContext,
  options: SuspiciousActivityOptions = {}
): SuspiciousActivityResult {
  const velocityWindowMs = options.velocityWindowMs ?? VELOCITY_WINDOW_MS;
  const maxLoginsInWindow = options.maxLoginsInWindow ?? MAX_LOGINS_IN_WINDOW;
  const maxSpeedKmh = options.maxSpeedKmh ?? MAX_SPEED_KMH;
  const locationPrecision = options.locationPrecision ?? LOCATION_PRECISION;

  const reasons: SuspiciousReason[] = [];
  const now = Date.now();
  const state = getOrCreateState(context.userId);

  const recentLogins = state.loginTimestamps.filter(
    (t) => t > now - velocityWindowMs
  );
  recentLogins.push(now);
  state.loginTimestamps = recentLogins;
  if (recentLogins.length > maxLoginsInWindow) {
    reasons.push("velocity");
  }

  if (context.deviceFingerprint != null && context.deviceFingerprint !== "") {
    const hash = hashDeviceFingerprint(context.deviceFingerprint);
    if (!state.knownDeviceHashes.has(hash)) {
      reasons.push("new_device");
      state.knownDeviceHashes.add(hash);
    }
  }

  if (context.location != null) {
    const { lat, lng } = context.location;
    const key = locationKey(lat, lng, locationPrecision);
    if (!state.knownLocationKeys.has(key)) {
      reasons.push("new_location");
      state.knownLocationKeys.add(key);
    }

    const last = state.lastLoginLocation;
    if (last != null) {
      const distanceKm = haversineKm(last.lat, last.lng, lat, lng);
      const timeHours = (now - last.timestamp) / (1000 * 60 * 60);
      const minTimeHours = 1 / 60;
      const effectiveHours = Math.max(timeHours, minTimeHours);
      const speedKmh = distanceKm / effectiveHours;
      if (speedKmh > maxSpeedKmh) {
        reasons.push("impossible_travel");
      }
    }
    state.lastLoginLocation = { lat, lng, timestamp: now };
  }

  return {
    suspicious: reasons.length > 0,
    reasons,
  };
}

export function createSuspiciousActivityDetector(
  options: SuspiciousActivityOptions = {}
) {
  const store = new Map<string, UserActivityState>();

  function getOrCreate(userId: string): UserActivityState {
    let state = store.get(userId);
    if (!state) {
      state = {
        knownDeviceHashes: new Set(),
        knownLocationKeys: new Set(),
        lastLoginLocation: null,
        loginTimestamps: [],
      };
      store.set(userId, state);
    }
    return state;
  }

  return {
    evaluateLogin(context: LoginContext): SuspiciousActivityResult {
      const velocityWindowMs =
        options.velocityWindowMs ?? VELOCITY_WINDOW_MS;
      const maxLoginsInWindow =
        options.maxLoginsInWindow ?? MAX_LOGINS_IN_WINDOW;
      const maxSpeedKmh = options.maxSpeedKmh ?? MAX_SPEED_KMH;
      const locationPrecision =
        options.locationPrecision ?? LOCATION_PRECISION;

      const reasons: SuspiciousReason[] = [];
      const now = Date.now();
      const state = getOrCreate(context.userId);

      const recentLogins = state.loginTimestamps.filter(
        (t) => t > now - velocityWindowMs
      );
      recentLogins.push(now);
      state.loginTimestamps = recentLogins;
      if (recentLogins.length > maxLoginsInWindow) {
        reasons.push("velocity");
      }

      if (
        context.deviceFingerprint != null &&
        context.deviceFingerprint !== ""
      ) {
        const hash = hashDeviceFingerprint(context.deviceFingerprint);
        if (!state.knownDeviceHashes.has(hash)) {
          reasons.push("new_device");
          state.knownDeviceHashes.add(hash);
        }
      }

      if (context.location != null) {
        const { lat, lng } = context.location;
        const key = locationKey(lat, lng, locationPrecision);
        if (!state.knownLocationKeys.has(key)) {
          reasons.push("new_location");
          state.knownLocationKeys.add(key);
        }

        const last = state.lastLoginLocation;
        if (last != null) {
          const distanceKm = haversineKm(last.lat, last.lng, lat, lng);
          const timeHours = (now - last.timestamp) / (1000 * 60 * 60);
          const minTimeHours = 1 / 60;
          const effectiveHours = Math.max(timeHours, minTimeHours);
          const speedKmh = distanceKm / effectiveHours;
          if (speedKmh > maxSpeedKmh) {
            reasons.push("impossible_travel");
          }
        }
        state.lastLoginLocation = { lat, lng, timestamp: now };
      }

      return {
        suspicious: reasons.length > 0,
        reasons,
      };
    },
    clearUser(userId: string): void {
      store.delete(userId);
    },
  };
}

export function clearUserActivity(userId: string): void {
  userState.delete(userId);
}
