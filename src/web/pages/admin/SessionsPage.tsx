import { ChevronRight, Plus, RefreshCw, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { HARNESS_LABELS, type Environment, type SessionSummary } from "../../../shared/model";
import { adminApi, errorMessage } from "../../api";
import {
  Card,
  Dot,
  EmptyState,
  ErrorNote,
  IconButton,
  Spinner,
  buttonClass,
} from "../../components/ui";
import { relativeTime } from "../../lib/format";
import { SessionStatusBadge } from "./status";

function HarnessStrip({
  environment,
  onRefresh,
}: {
  environment: Environment | null;
  onRefresh: () => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {environment?.harnesses.map((harness) => (
        <span
          key={harness.kind}
          title={harness.detail}
          className="inline-flex h-7 items-center gap-2 rounded-full border border-line bg-surface px-3 text-[12px] text-muted shadow-xs"
        >
          <Dot tone={harness.authenticated ? "ok" : harness.installed ? "warn" : "bad"} />
          <span className="font-medium text-ink">{harness.label}</span>
          {harness.authenticated ? "ready" : harness.installed ? "not signed in" : "not installed"}
        </span>
      ))}
      <IconButton label="Re-check assistants" onClick={onRefresh} className="size-7">
        <RefreshCw className="size-3.5" />
      </IconButton>
    </div>
  );
}

export function SessionsPage(): React.JSX.Element {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [environment, setEnvironment] = useState<Environment | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    adminApi
      .sessions()
      .then((list) => {
        setSessions(list);
        setError(null);
      })
      .catch((failure: unknown) => {
        setError(errorMessage(failure));
      });
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => {
      clearInterval(timer);
    };
  }, [load]);

  const refreshEnvironment = useCallback((force: boolean) => {
    adminApi
      .environment(force)
      .then(setEnvironment)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshEnvironment(false);
  }, [refreshEnvironment]);

  useEffect(() => {
    document.title = "Sessions · Twofold";
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Sessions</h1>
          <p className="mt-1 text-[13px] text-muted">
            Each session is one candidate, one repository and one task.
          </p>
        </div>
        <Link href="/sessions/new" className={buttonClass("primary")}>
          <Plus className="size-4" /> New session
        </Link>
      </div>

      <div className="mt-5">
        <HarnessStrip
          environment={environment}
          onRefresh={() => {
            refreshEnvironment(true);
          }}
        />
      </div>

      {error !== null && (
        <div className="mt-6">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <Card className="mt-6 overflow-hidden">
        {sessions === null ? (
          <div className="flex justify-center py-16">
            <Spinner className="size-5 text-faint" />
          </div>
        ) : sessions.length === 0 ? (
          <EmptyState
            icon={<Users className="size-5" />}
            title="No sessions yet"
            action={
              <Link href="/sessions/new" className={buttonClass("primary")}>
                <Plus className="size-4" /> Create a session
              </Link>
            }
          >
            Start with the built-in sample repository to see how a session feels from both sides.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {sessions.map((session) => (
              <li key={session.id}>
                <Link
                  href={`/sessions/${session.id}`}
                  className="group grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-1 px-5 py-4 transition hover:bg-surface-2 sm:grid-cols-[minmax(0,1fr)_170px_110px_90px_16px]"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-medium">
                      {session.candidateName === "" ? "Unnamed candidate" : session.candidateName}
                    </div>
                    <div className="truncate text-[12.5px] text-muted">{session.title}</div>
                  </div>
                  <div className="justify-self-end sm:justify-self-start">
                    <SessionStatusBadge status={session.status} />
                  </div>
                  <div className="hidden text-[12.5px] text-muted sm:block">
                    {session.decided}/{session.rounds} rounds · {HARNESS_LABELS[session.harness]}
                  </div>
                  <div className="hidden text-[12.5px] text-faint sm:block">
                    {relativeTime(session.createdAt)}
                  </div>
                  <ChevronRight className="hidden size-4 text-faint transition group-hover:translate-x-0.5 group-hover:text-ink sm:block" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
