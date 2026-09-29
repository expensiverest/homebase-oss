export { Authenticator, createAuthenticator, type AuthDecision, type AuthenticatorOptions } from "./auth.js";
export { DeviceState, DEVICE_COOKIE, type PublicDevice } from "./device-state.js";
export {
  DEVICE_COOKIE_MAX_AGE_SECONDS,
  serializeDeviceCookie,
  serializeExpiredDeviceCookie,
  deviceCredentialFromCookie,
} from "./device-cookie.js";
