import { createContext, useContext, useState, useCallback, useEffect } from "react";
import type { User, UserRoleType } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";

const AUTH_STORAGE_KEY = "queuefest_auth_user";

function loadStoredUser(): User | null {
  try {
    const raw = sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // sessionStorage unavailable or corrupted — silently ignore
  }
  return null;
}

function saveUser(user: User | null) {
  try {
    if (user) {
      sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
    } else {
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: (braceletId: string, eventId: string) => Promise<User>;
  adminLogin: (password: string, eventId?: string) => Promise<User>;
  logout: () => void;
  isAdmin: boolean;
  isManager: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(loadStoredUser);

  // Re-validate stored user on mount — fetch fresh data from server
  useEffect(() => {
    const stored = loadStoredUser();
    if (stored?.id) {
      apiRequest("GET", `/api/auth/user/${stored.id}`)
        .then((res) => res.json())
        .then((freshUser) => {
          setUser(freshUser);
          saveUser(freshUser);
        })
        .catch(() => {
          // User no longer valid on server (e.g. server restarted, memory cleared)
          // Keep the stored user anyway — it will be re-created on next action
        });
    }
  }, []);

  const login = useCallback(async (braceletId: string, eventId: string) => {
    const res = await apiRequest("POST", "/api/auth/login", { braceletId, eventId });
    const u = await res.json();
    setUser(u);
    saveUser(u);
    return u;
  }, []);

  const adminLogin = useCallback(async (password: string, eventId?: string) => {
    const res = await apiRequest("POST", "/api/auth/admin-login", { password, eventId });
    const u = await res.json();
    setUser(u);
    saveUser(u);
    return u;
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    saveUser(null);
    // Note: we intentionally do NOT clear queryClient cache here
    // to avoid resetting app-wide state (#10 fix)
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        login,
        adminLogin,
        logout,
        isAdmin: user?.role === "admin",
        isManager: user?.role === "manager" || user?.role === "admin",
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
