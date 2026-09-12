import { useState, type FormEvent } from "react";

import { api, ApiError } from "./api";

type LoginViewProps = {
  onLoggedIn: () => void;
};

export function LoginView({ onLoggedIn }: LoginViewProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      await api.login(password);
      setPassword("");
      onLoggedIn();
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 401 ? "Wrong password." : "Could not sign in. Is the server reachable?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>ScribeDog</h1>
        <p className="muted">Enter the password for this vault.</p>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
            data-testid="password"
          />
        </label>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={busy || password.length === 0} data-testid="login">
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
