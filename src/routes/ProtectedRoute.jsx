// src/routes/ProtectedRoute.jsx
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

function ProtectedRoute({ children }) {
  const { user } = useAuth();

  // If user is not logged in, redirect to Login page
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Otherwise, show the protected page
  return children;
}

export default ProtectedRoute;
