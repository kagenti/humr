import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import "./App.css";
import { initAuth } from "./auth.js";
import { queryClient } from "./query-client.js";

async function main() {
  const user = await initAuth();
  if (!user) return; // Redirecting to Keycloak, don't render

  const { default: App } = await import("./app.js");
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );
}

main();
