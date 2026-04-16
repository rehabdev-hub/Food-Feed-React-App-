// src/context/AuthContext.jsx
import { createContext, useContext, useEffect, useState } from "react";
import supabase from "../supabaseClient";

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser]   = useState(null);
  const [loading, setLoading] = useState(true);

  // optional: ensure a profiles row exists for this user (used by posts FK, etc.)
  async function ensureProfile(u) {
    try {
      if (!u) return;
      await supabase.from("profiles").upsert({ id: u.id }, { onConflict: "id" });
    } catch (e) {
      // non-blocking
      console.warn("profiles upsert skipped:", e?.message);
    }
  }

  useEffect(() => {
    let ignore = false;

    // 1) Get current user once
    supabase.auth.getUser()
      .then(({ data }) => {
        if (!ignore) setUser(data?.user ?? null);
        if (data?.user) ensureProfile(data.user);
      })
      .finally(() => { if (!ignore) setLoading(false); });

    // 2) Subscribe to auth state changes
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) ensureProfile(u);
    });

    return () => {
      ignore = true;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  // ✅ Logout function (Supabase)
  const logout = async () => {
    try {
      await supabase.auth.signOut();
      setUser(null);
      console.log("✅ User logged out successfully");
    } catch (error) {
      console.error("❌ Logout failed:", error.message);
    }
  };

  // Prevent app from rendering before Supabase is ready
  if (loading) {
    return <div style={{ textAlign: "center", marginTop: "50px" }}>Loading...</div>;
  }

  return (
    <AuthContext.Provider value={{ user, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

// ✅ Custom Hook for easy usage
export const useAuth = () => useContext(AuthContext);
