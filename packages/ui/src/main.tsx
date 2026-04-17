import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./App.css";
import { initAuth } from "./auth.js";

async function main() {
  const user = await initAuth();
  if (!user) return; // Redirecting to Keycloak, don't render

  const { default: App } = await import("./app.js");
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

main();
