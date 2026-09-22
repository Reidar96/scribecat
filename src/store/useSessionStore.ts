import { create } from "zustand";

import i18n from "@/i18n";
import { platform, SessionError } from "@/platform";
import { useAppStore } from "@/store/useAppStore";

/**
 * "checking": asking the server whether the cookie is still good.
 * "signed-in" / "signed-out": the answer.
 * "unreachable": the server did not answer at all; shown on the login form.
 */
export type SessionStatus = "checking" | "signed-in" | "signed-out" | "unreachable";

type SessionState = {
  status: SessionStatus;
  /** Translated message for the login form; null when the last attempt was fine. */
  loginError: string | null;
  isLoggingIn: boolean;
  /**
   * The session ended without the user asking for it (expired or revoked).
   * The app stays mounted underneath the login form in that case.
   */
  expired: boolean;
  /** Asks the server once at startup. */
  check: () => Promise<void>;
  login: (password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  /** The server refused a request for lack of a session (expired, revoked). */
  markSignedOut: () => void;
};

function messageFor(error: unknown): string {
  if (error instanceof SessionError) {
    switch (error.code) {
      case "invalid_password":
        return i18n.t("login.wrongPassword");
      case "too_many_attempts":
        return i18n.t("login.tooManyAttempts", { count: Math.max(1, Math.ceil((error.retryAfterSeconds ?? 60) / 60)) });
      case "unreachable":
        return i18n.t("login.serverUnreachable");
      default:
        return error.message;
    }
  }

  return error instanceof Error ? error.message : i18n.t("login.failed");
}

/**
 * Password session against the ScribeCat server. Only meaningful where the
 * platform has a session API (the browser); on the desktop `check` resolves
 * to "signed-in" immediately and nothing else is ever called.
 */
export const useSessionStore = create<SessionState>((set, get) => ({
  status: "checking",
  loginError: null,
  isLoggingIn: false,
  expired: false,

  check: async () => {
    const session = platform.session;

    if (!session) {
      set({ status: "signed-in" });
      return;
    }

    try {
      const { authenticated } = await session.getStatus();
      set({ status: authenticated ? "signed-in" : "signed-out" });
    } catch (error) {
      set({
        status: error instanceof SessionError && error.code === "unauthorized" ? "signed-out" : "unreachable",
        loginError: error instanceof SessionError && error.code === "unauthorized" ? null : messageFor(error)
      });
    }
  },

  login: async (password) => {
    const session = platform.session;

    if (!session) {
      return true;
    }

    set({ isLoggingIn: true, loginError: null });

    try {
      await session.login(password);

      // A save that ran into the expired session left its error in place of
      // the editor; with the session back, that message is stale.
      if (get().expired) {
        useAppStore.setState({ saveError: null, fileError: null });
      }

      set({ status: "signed-in", isLoggingIn: false, loginError: null, expired: false });

      return true;
    } catch (error) {
      set({ isLoggingIn: false, loginError: messageFor(error) });

      return false;
    }
  },

  logout: async () => {
    const session = platform.session;

    if (!session) {
      return;
    }

    try {
      await session.logout();
    } catch {
      // The cookie may already be gone (session expired underneath us); the
      // outcome the user asked for is the same either way.
    }

    set({ status: "signed-out", loginError: null, expired: false });
  },

  markSignedOut: () => {
    set((state) => (state.status === "signed-in" ? { status: "signed-out", loginError: null, expired: true } : state));
  }
}));

// A 401 on any request means the session is gone; the login form takes over
// while the app underneath keeps its state (including unsaved edits), so
// signing in again continues where the user left off.
platform.session?.onUnauthorized(() => useSessionStore.getState().markSignedOut());
