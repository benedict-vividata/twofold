import { KeyRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { adminApi, errorMessage } from "../../api";
import { Logo } from "../../components/Logo";
import { Button, Card, ErrorNote, Field, Input } from "../../components/ui";

function tokenFromHash(): string | null {
  const match = /token=([^&]+)/.exec(window.location.hash);
  return match?.[1] === undefined ? null : decodeURIComponent(match[1]);
}

export function LoginPage(): React.JSX.Element {
  const [, navigate] = useLocation();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(() => tokenFromHash() !== null);
  const [error, setError] = useState<string | null>(null);

  const signIn = useCallback(
    async (value: string): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        await adminApi.login(value);
        navigate("/sessions", { replace: true });
      } catch (failure) {
        setError(errorMessage(failure));
      } finally {
        setBusy(false);
      }
    },
    [navigate],
  );

  // The server prints a link with the token in the fragment, which never
  // reaches the server's logs or the browser's history once consumed.
  useEffect(() => {
    const value = tokenFromHash();
    if (value === null) return;
    window.history.replaceState(null, "", window.location.pathname);
    adminApi
      .login(value)
      .then(() => {
        navigate("/sessions", { replace: true });
      })
      .catch((failure: unknown) => {
        setError(errorMessage(failure));
        setBusy(false);
      });
  }, [navigate]);

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <Card className="p-6">
          <h1 className="text-[17px] font-semibold tracking-tight">Interviewer sign-in</h1>
          <p className="mt-1 text-[13px] text-muted">
            Use the token printed when the server starts, or run{" "}
            <code className="font-mono text-[12px]">./twofold url</code>.
          </p>
          <form
            className="mt-5 flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void signIn(token.trim());
            }}
          >
            <Field label="Admin token" htmlFor="token">
              <Input
                id="token"
                type="password"
                autoComplete="current-password"
                value={token}
                onChange={(event) => {
                  setToken(event.target.value);
                }}
                autoFocus
              />
            </Field>
            {error !== null && <ErrorNote>{error}</ErrorNote>}
            <Button
              type="submit"
              variant="primary"
              loading={busy}
              disabled={token.trim() === ""}
              icon={<KeyRound className="size-3.5" />}
            >
              Sign in
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
