import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { client, errMsg } from "@/api";

const AuthContext = createContext(null);

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = checking, false = anonymous

  const check = useCallback(async () => {
    try {
      const { data } = await client.get("/auth/me");
      setUser(data);
    } catch {
      setUser(false);
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  const submit = async (path, email, password) => {
    try {
      const { data } = await client.post(`/auth/${path}`, { email, password });
      if (data.access_token) localStorage.setItem("dd_token", data.access_token);
      setUser(data);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  };

  const logout = async () => {
    try {
      await client.post("/auth/logout");
    } catch {
      /* ignore */
    }
    localStorage.removeItem("dd_token");
    setUser(false);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        login: (e, p) => submit("login", e, p),
        register: (e, p) => submit("register", e, p),
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
