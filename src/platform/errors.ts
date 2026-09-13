import i18n from "@/i18n";

/**
 * Thrown by a platform implementation for an operation its shell cannot do
 * (a native dialog in the browser, or a file operation the server edition
 * does not offer yet). Carries a translated message, because the store
 * surfaces `error.message` straight into the UI (see store/appStore/errors.ts).
 */
export class PlatformUnavailableError extends Error {
  constructor(message = i18n.t("platform.notAvailable")) {
    super(message);
    this.name = "PlatformUnavailableError";
  }
}

/** A refused login or a request made without a valid session. */
export class SessionError extends Error {
  constructor(
    readonly code: "invalid_password" | "unauthorized" | "unreachable" | "error",
    message: string
  ) {
    super(message);
    this.name = "SessionError";
  }
}
