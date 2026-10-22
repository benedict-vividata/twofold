import { Compass } from "lucide-react";
import { Link, Redirect, Route, Switch } from "wouter";
import { EmptyState, buttonClass } from "./components/ui";
import { AdminShell } from "./pages/admin/AdminShell";
import { LoginPage } from "./pages/admin/LoginPage";
import { NewSessionPage } from "./pages/admin/NewSessionPage";
import { SessionPage } from "./pages/admin/SessionPage";
import { SessionsPage } from "./pages/admin/SessionsPage";
import { CandidatePage } from "./pages/candidate/CandidatePage";

export function App(): React.JSX.Element {
  return (
    <Switch>
      <Route path="/c/:token">{(params) => <CandidatePage token={params.token} />}</Route>
      <Route path="/login">
        <LoginPage />
      </Route>
      <Route path="/">
        <Redirect to="/sessions" replace />
      </Route>
      <Route path="/sessions">
        <AdminShell>
          <SessionsPage />
        </AdminShell>
      </Route>
      <Route path="/sessions/new">
        <AdminShell>
          <NewSessionPage />
        </AdminShell>
      </Route>
      <Route path="/sessions/:id">
        {(params) => (
          <AdminShell>
            <SessionPage id={params.id} />
          </AdminShell>
        )}
      </Route>
      <Route>
        <div className="flex h-full items-center justify-center">
          <EmptyState
            icon={<Compass className="size-5" />}
            title="Nothing here"
            action={
              <Link href="/sessions" className={buttonClass()}>
                Go to sessions
              </Link>
            }
          >
            Candidates: use the link your interviewer sent you.
          </EmptyState>
        </div>
      </Route>
    </Switch>
  );
}
