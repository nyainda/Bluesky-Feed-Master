import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Returns which environment variables are configured (without exposing values)
router.get("/config/status", (_req, res) => {
  const vars = [
    "FEEDGEN_HOSTNAME",
    "FEEDGEN_PUBLISHER_DID",
    "BLUESKY_HANDLE",
    "BLUESKY_APP_PASSWORD",
    "DATABASE_URL",
  ];
  const status: Record<string, boolean> = {};
  for (const v of vars) {
    status[v] = Boolean(process.env[v]);
  }
  res.json(status);
});

export default router;
