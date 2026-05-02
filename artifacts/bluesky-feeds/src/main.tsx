import { createRoot } from "react-dom/client";
import { setBaseUrl } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

// When deploying the frontend to Vercel (separately from the API),
// set VITE_API_BASE_URL to your Replit-deployed API URL:
//   e.g. https://your-app.replit.app
// In Replit dev/production both services share the same domain so
// no base URL is needed — relative /api paths work via the shared proxy.
const apiBase = import.meta.env.VITE_API_BASE_URL;
if (apiBase) {
  setBaseUrl(apiBase.replace(/\/+$/, ""));
}

createRoot(document.getElementById("root")!).render(<App />);
