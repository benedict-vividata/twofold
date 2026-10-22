import { LogOut } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { adminApi, ApiError } from "../../api";
import { Logo } from "../../components/Logo";
import { ThemeToggle } from "../../components/ThemeToggle";
import { IconButton, Spinner } from "../../components/ui";

/** Interviewer pages: checks the sign-in once, then renders the header and the page. */
export function AdminShell({ children }: { children: ReactNode }): React.JSX.Element {
  const [, navigate] = useLocation();
  const [state, setState] = useState<"checking" | "ok">("checking");

  useEffect(() => {
    adminApi
      .me()
      .then(() => {
        setState("ok");
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401)
          navigate("/login", { replace: true });
        else setState("ok");
      });
  }, [navigate]);

  if (state === "checking") {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-5 text-faint" />
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur">
        <div className="mx-auto flex h-13 max-w-6xl items-center gap-4 px-5">
          <Link href="/sessions" className="rounded-md">
            <Logo />
          </Link>
          <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-muted">
            Interviewer
          </span>
          <span className="flex-1" />
          <ThemeToggle />
          <IconButton
            label="Sign out"
            onClick={() => {
              void adminApi.logout().finally(() => {
                navigate("/login");
              });
            }}
          >
            <LogOut className="size-4" />
          </IconButton>
        </div>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}
