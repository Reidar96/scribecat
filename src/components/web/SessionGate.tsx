import { useEffect, type ReactNode } from "react";

import { LoginView } from "@/components/web/LoginView";
import { platform } from "@/platform";
import { useSessionStore } from "@/store/useSessionStore";

/**
 * Keeps the app behind the password login on platforms that have one. On
 * the desktop it renders its children and nothing else.
 *
 * Two ways out of a session are treated differently: when the server ends
 * it (expired, revoked), the login form only goes on top and the app keeps
 * its state, so signing in again continues where the user left off, unsaved
 * edits included. When the user signs out, the app unmounts and the next
 * sign-in starts it fresh.
 */
export function SessionGate({ children }: { children: ReactNode }) {
  const status = useSessionStore((state) => state.status);
  const expired = useSessionStore((state) => state.expired);
  const check = useSessionStore((state) => state.check);

  useEffect(() => {
    void check();
  }, [check]);

  if (!platform.features.session) {
    return <>{children}</>;
  }

  if (status === "checking") {
    return null;
  }

  const showApp = status === "signed-in" || expired;

  return (
    <>
      {showApp ? children : null}
      {status !== "signed-in" ? <LoginView isOverlay={expired} /> : null}
    </>
  );
}
