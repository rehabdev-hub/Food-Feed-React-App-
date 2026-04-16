import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaEnvelope, FaLock } from "react-icons/fa";
import supabase from "../../supabaseClient"; // ⬅️ Supabase client
import "./Login.css";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [resetMsg, setResetMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  const navigate = useNavigate();

  // Optional: ensure a profile row exists after sign-in
  const ensureProfile = async (user) => {
    if (!user) return;
    await supabase.from("profiles").upsert({ id: user.id }, { onConflict: "id" });
  };

  // 🔐 Login (Supabase)
  const handleLogin = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    setResetMsg("");

    try {
      const { data, error: signInErr } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInErr) throw signInErr;

      await ensureProfile(data.user);

      setSuccess("Login successful!");
      setTimeout(() => navigate("/"), 800);
    } catch (err) {
      console.error(err);
      // Common Supabase auth errors handling
      const code = err?.message?.toLowerCase?.() || "";
      if (code.includes("invalid login credentials")) {
        setError("Invalid email or password");
      } else if (code.includes("email not confirmed")) {
        setError("Please confirm your email before logging in.");
      } else {
        setError(err?.message || "Unable to sign in. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  // 🔄 Forgot Password (Supabase reset flow)
  const handlePasswordReset = async () => {
    if (resetBusy) return;
    setError("");
    setResetMsg("");

    if (!email) {
      setError("Please enter your email address first.");
      return;
    }

    try {
      setResetBusy(true);

      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/update-password`, // make sure this route exists
      });

      if (resetErr) throw resetErr;

      // Neutral message (don’t reveal account existence)
      setResetMsg(
        "If an account exists for this email, a password reset link has been sent. Please check your inbox (and Spam/Promotions)."
      );
    } catch (err) {
      console.error(err);
      // Keep neutral messaging for safety
      setResetMsg(
        "If an account exists for this email, a password reset link has been sent. Please check your inbox (and Spam/Promotions)."
      );
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2>Welcome to FSF</h2>
        <p>
          Login to continue to <b>FSF</b>
        </p>

        {error && <p className="error">{error}</p>}
        {success && <p className="success">{success}</p>}
        {resetMsg && <p className="info">{resetMsg}</p>}

        <form onSubmit={handleLogin}>
          <div className="input-group">
            <FaEnvelope className="icon" />
            <input
              type="email"
              placeholder="Email Address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="input-group">
            <FaLock className="icon" />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          <button type="submit" className="auth-btn" disabled={busy}>
            {busy ? "Logging in…" : "Login"}
          </button>
        </form>

        <div className="extra-links">
          <button
            type="button"
            className="link-btn"
            onClick={handlePasswordReset}
            disabled={resetBusy}
            aria-busy={resetBusy}
          >
            {resetBusy ? "Sending…" : "Forgot Password?"}
          </button>
          <p>
            Don’t have an account? <a href="/register">Register</a>
          </p>
        </div>
      </div>
    </div>
  );
}

export { Login };
