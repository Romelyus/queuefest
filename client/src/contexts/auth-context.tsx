import { createContext, useContext, useState, useCallback, useEffect } from "react";
import type { User, UserRoleType } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";

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
  const [user, setUser] = useState<User | null>(null);

  const login = useCallback(async (braceletId: string, eventId: string) => {
    const res = await apiRequest("POST", "/api/auth/login", { braceletId, eventId });
    const u = await res.json();
    setUser(u);
    return u;
  }, []);

  const adminLogin = useCallback(async (password: string, eventId?: string) => {
    const res = await apiRequest("POST", "/api/auth/admin-login", { password, eventId });
    const u = await res.json();
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(() => {
    setUser(null);
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
