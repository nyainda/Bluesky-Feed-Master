import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setBaseUrl, customFetch } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient();

const apiBase = import.meta.env.VITE_API_BASE_URL;
// In dev the Vite server proxies /api/* → CF Worker so we use relative paths.
// In a production build there is no Vite proxy — set the base URL directly.
if (import.meta.env.PROD && apiBase) {
  setBaseUrl(apiBase.replace(/\/+$/, ""));
}

async function runConnectionDiagnostics() {
  const isDev = import.meta.env.DEV;
  const base = isDev
    ? window.location.origin + " (via dev proxy → CF Worker)"
    : apiBase
      ? apiBase.replace(/\/+$/, "")
      : window.location.origin;

  console.groupCollapsed(
    "%c🔌 FeedForge API Diagnostics",
    "color:#6366f1;font-weight:bold;font-size:13px",
  );

  console.log(
    "%cAPI base URL:%c " + base,
    "color:#94a3b8;font-weight:bold",
    "color:#e2e8f0",
  );

  const sourceLabel = isDev
    ? "Vite dev proxy → " + (apiBase ?? "localhost:5000") + " ✓"
    : apiBase
      ? "VITE_API_BASE_URL env var ✓"
      : "relative (same domain)";

  console.log(
    "%cSource:%c " + sourceLabel,
    "color:#94a3b8;font-weight:bold",
    apiBase ? "color:#4ade80" : "color:#fbbf24",
  );

  const endpoints: Array<{ label: string; path: string }> = [
    { label: "Health", path: "/api/healthz" },
    { label: "Config status", path: "/api/config/status" },
    { label: "Profile", path: "/api/bluesky/profile" },
    { label: "Followers", path: "/api/bluesky/followers?limit=1" },
    { label: "Following", path: "/api/bluesky/following?limit=1" },
    { label: "Not-following-back", path: "/api/bluesky/not-following-back" },
    { label: "Feeds", path: "/api/feeds" },
    { label: "Stats overview", path: "/api/stats/overview" },
    { label: "Firehose status", path: "/api/stats/firehose" },
  ];

  const results = await Promise.allSettled(
    endpoints.map(async ({ label, path }) => {
      const start = performance.now();
      const data = await customFetch(path);
      const ms = Math.round(performance.now() - start);
      return { label, path, ms, data };
    }),
  );

  let allOk = true;

  for (const result of results) {
    if (result.status === "fulfilled") {
      const { label, path, ms } = result.value;

      console.log(
        `%c  ✓ ${label.padEnd(22)}%c${path}  %c${ms}ms`,
        "color:#4ade80;font-weight:bold",
        "color:#64748b",
        "color:#94a3b8",
      );
    } else {
      allOk = false;

      const ep = endpoints[results.indexOf(result)];

      console.warn(
        `%c  ✗ ${ep.label.padEnd(22)}%c${ep.path}`,
        "color:#f87171;font-weight:bold",
        "color:#64748b",
        result.reason,
      );
    }
  }

  if (allOk) {
    console.log(
      "%c\n  ✅ All endpoints reachable — FeedForge is fully connected.\n",
      "color:#4ade80;font-weight:bold",
    );
  } else {
    console.warn(
      "%c\n  ⚠️ Some endpoints failed. Check VITE_API_BASE_URL and Worker status.\n",
      "color:#fbbf24;font-weight:bold",
    );
  }

  console.groupEnd();
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
);

runConnectionDiagnostics().catch(() => {});
