import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../app/AuthProvider";
import { LoadingState } from "./PageState";

export function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <LoadingState />;
  }

  if (!user) {
    return <Navigate to="/access" replace state={{ from: location }} />;
  }

  return children;
}
