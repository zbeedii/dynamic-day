import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import AppShell from "@/components/AppShell";
import DecisionDialog from "@/components/DecisionDialog";
import Reward from "@/components/Reward";
import UndoBar from "@/components/UndoBar";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { LocaleProvider } from "@/context/LocaleContext";
import { DayProvider } from "@/context/DayContext";
import Execution from "@/pages/Execution";
import Login from "@/pages/Login";
import Planning from "@/pages/Planning";
import QuickView from "@/pages/QuickView";

function Shell() {
  return (
    <DayProvider>
      <Routes>
        <Route
          path="/"
          element={
            <AppShell>
              <QuickView />
            </AppShell>
          }
        />
        <Route
          path="/plan"
          element={
            <AppShell>
              <Planning />
            </AppShell>
          }
        />
        <Route path="/focus" element={<Execution />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <DecisionDialog />
      <UndoBar />
      <Reward />
    </DayProvider>
  );
}

function Gate() {
  const { user } = useAuth();
  if (user === null)
    return (
      <div className="min-h-screen grid place-items-center" data-testid="auth-loading">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  if (user === false) return <Login />;
  return <Shell />;
}

export default function App() {
  if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
    window.addEventListener("load", () => navigator.serviceWorker.register(`${process.env.PUBLIC_URL || ""}/service-worker.js`).catch(() => {}));
  }
  return (
    <BrowserRouter>
      <LocaleProvider>
        <AuthProvider>
          <Gate />
          <Toaster position="top-center" />
        </AuthProvider>
      </LocaleProvider>
    </BrowserRouter>
  );
}
