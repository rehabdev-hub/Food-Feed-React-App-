import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { FaUser, FaEnvelope, FaLock, FaUserTag } from "react-icons/fa";
import supabase from "../../supabaseClient";
import "../Login/Login.css";

function Register() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    profileType: "", // "seller" | "buyer"
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const navigate = useNavigate();

  const handleChange = (e) =>
    setFormData({ ...formData, [e.target.name]: e.target.value });

  // ensure a row in profiles (so FK in posts etc. is happy)
  const ensureProfile = async (userId, fullName, profileType) => {
    if (!userId) return;
    // IMPORTANT: profiles table must have columns: id (uuid), full_name (text), profile_type (text or enum)
    const { error } = await supabase
      .from("profiles")
      .upsert(
        {
          id: userId,
          full_name: fullName || null,
          profile_type: profileType || null, // <— store selection
        },
        { onConflict: "id" }
      );
    if (error) throw error;
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    try {
      const { email, password, name, profileType } = formData;

      if (!profileType) {
        setError("Please select your profile type (Seller or Buyer).");
        return;
      }

      // 🔐 Supabase sign up (email/password) + custom metadata
      const { data, error: signUpErr } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: name,
            profile_type: profileType, // <— save to auth metadata as well
          },
        },
      });
      if (signUpErr) throw signUpErr;

      // Create/merge profile row
      if (data?.user?.id) {
        await ensureProfile(data.user.id, name, profileType);
      }

      setSuccess("🎉 Account created! Please check your email to confirm your account.");
      // If email confirmations disabled, you can redirect:
      // setTimeout(() => navigate("/"), 1200);
    } catch (err) {
      console.error(err);
      const msg = err?.message || "Failed to create account. Please try again.";
      setError(msg);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2>Create Account</h2>
        <p>Join Food Feed to share your favorite recipes!</p>

        {error && <p className="error">{error}</p>}
        {success && <p className="success">{success}</p>}

        <form onSubmit={handleRegister}>
          <div className="input-group">
            <FaUser className="icon" />
            <input
              type="text"
              name="name"
              placeholder="Full Name"
              value={formData.name}
              onChange={handleChange}
              required
            />
          </div>

          <div className="input-group">
            <FaEnvelope className="icon" />
            <input
              type="email"
              name="email"
              placeholder="Email Address"
              value={formData.email}
              onChange={handleChange}
              required
              autoComplete="email"
            />
          </div>

          <div className="input-group">
            <FaLock className="icon" />
            <input
              type="password"
              name="password"
              placeholder="Password"
              value={formData.password}
              onChange={handleChange}
              required
              autoComplete="new-password"
            />
          </div>

          {/* NEW: Profile Type dropdown */}
          <div className="input-group">
            <FaUserTag className="icon" />
            <select
              name="profileType"
              value={formData.profileType}
              onChange={handleChange}
              required
              aria-label="Select profile type"
            >
              <option className="drop-list" value="" disabled>
                Select Profile Type
              </option>
              <option className="drop-list" value="seller">Seller</option>
              <option className="drop-list" value="buyer">Buyer</option>
            </select>
          </div>

          <button type="submit" className="auth-btn">Register</button>
        </form>

        <div className="extra-links">
          <p>
            Already have an account? <Link to="/login">Login</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export { Register };
