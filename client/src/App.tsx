import { useEffect } from "react";
import { Switch, Route, Router } from "wouter";
import { queryClient, apiRequest } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/auth-context";
import { SpeedInsights } from "@vercel/speed-insights/react";
import LoginPage from "@/pages/login";
import UserDashboard from "@/pages/user-dashboard";
import JoinQueuePage from "@/pages/join-queue";
import ManagerPage from "@/pages/manager";
import AdminPage from "@/pages/admin";
import NotFound from "@/pages/not-found";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={LoginPage} />
      <Route path="/dashboard" component={UserDashboard} />
      <Route path="/join/:tableId" component={JoinQueuePage} />
      <Route path="/manager" component={ManagerPage} />
      <Route path="/admin" component={AdminPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

// Keep-alive: ping the backend every 5 minutes to prevent Vercel cold starts
function useKeepAlive() {
  useEffect(() => {
    const interval = setInterval(() => {
      apiRequest("GET", "/api/health").catch(() => {});
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);
}

function App() {
  useKeepAlive();
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <Toaster />
          <SpeedInsights />
          <Router>
            <AppRouter />
          </Router>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
