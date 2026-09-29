import { DEVICE_COOKIE } from "./device-state.js";

export const DEVICE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const attributes = "Secure; HttpOnly; SameSite=Strict; Path=/";

export function serializeDeviceCookie(credential: string): string {
  return `${DEVICE_COOKIE}=${credential}; ${attributes}; Max-Age=${DEVICE_COOKIE_MAX_AGE_SECONDS}`;
}

export function serializeExpiredDeviceCookie(): string {
  return `${DEVICE_COOKIE}=; ${attributes}; Max-Age=0`;
}

/** The credential is only used inside the server auth boundary after verification. */
export function deviceCredentialFromCookie(header: string | undefined): string | null {
  const part = header
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${DEVICE_COOKIE}=`));
  const value = part?.slice(DEVICE_COOKIE.length + 1);
  return value && /^[A-Za-z0-9._-]{1,128}$/.test(value) ? value : null;
}
