import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { useSessionStore } from "@/store/useSessionStore";

type LoginViewProps = {
  /**
   * True while the app underneath is still mounted: the session ran out
   * mid-session, the form sits on top, and signing in again continues where
   * the user left off (unsaved edits included).
   */
  isOverlay: boolean;
};

/**
 * The password form of the server edition. One password, no user name: the
 * instance belongs to one person (see server/README.md).
 */
export function LoginView({ isOverlay }: LoginViewProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const login = useSessionStore((state) => state.login);
  const loginError = useSessionStore((state) => state.loginError);
  const isLoggingIn = useSessionStore((state) => state.isLoggingIn);
  const status = useSessionStore((state) => state.status);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (!password || isLoggingIn) {
      return;
    }

    const ok = await login(password);

    if (ok) {
      setPassword("");
    } else {
      inputRef.current?.select();
    }
  };

  return (
    <div className="login-view ai-dialog" role="dialog" aria-modal="true" aria-labelledby="login-title">
      <form className="ai-dialog__panel login-view__panel" onSubmit={(event) => void handleSubmit(event)}>
        <img className="login-view__logo" src="./favicon.svg" alt="" aria-hidden="true" />
        <h1 id="login-title" className="login-view__title">
          {t("login.title")}
        </h1>
        <p className="login-view__lead">{isOverlay ? t("login.sessionExpired") : t("login.lead")}</p>
        <label className="ai-dialog__field">
          <span>{t("login.password")}</span>
          <input
            ref={inputRef}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={isLoggingIn}
            data-testid="password"
          />
        </label>
        {loginError ? (
          <p className="login-view__error" role="alert">
            {loginError}
          </p>
        ) : status === "unreachable" ? (
          <p className="login-view__error" role="alert">
            {t("login.serverUnreachable")}
          </p>
        ) : null}
        <Button type="submit" disabled={!password || isLoggingIn} data-testid="login">
          {isLoggingIn ? t("login.signingIn") : t("login.submit")}
        </Button>
      </form>
    </div>
  );
}
