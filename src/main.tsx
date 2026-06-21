import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import { AuthProvider } from "./app/AuthProvider";
import { AppShell } from "./components/AppShell";
import { RequireAdmin } from "./components/RequireAdmin";
import { RequireAuth } from "./components/RequireAuth";
import { AccessPage } from "./pages/AccessPage";
import { AdminAccessCodesPage } from "./pages/AdminAccessCodesPage";
import { AdminDashboardPage } from "./pages/AdminDashboardPage";
import { AdminUploadPage } from "./pages/AdminUploadPage";
import { GalleryPage } from "./pages/GalleryPage";
import { LandingPage } from "./pages/LandingPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import "./styles.css";

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <LandingPage /> },
      { path: "/access", element: <AccessPage /> },
      {
        path: "/gallery/:jobId",
        element: (
          <RequireAuth>
            <GalleryPage />
          </RequireAuth>
        )
      },
      {
        path: "/admin",
        element: (
          <RequireAdmin>
            <AdminDashboardPage />
          </RequireAdmin>
        )
      },
      {
        path: "/admin/jobs/:jobId/upload",
        element: (
          <RequireAdmin>
            <AdminUploadPage />
          </RequireAdmin>
        )
      },
      {
        path: "/admin/jobs/:jobId/access-codes",
        element: (
          <RequireAdmin>
            <AdminAccessCodesPage />
          </RequireAdmin>
        )
      },
      { path: "*", element: <NotFoundPage /> }
    ]
  }
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </React.StrictMode>
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
