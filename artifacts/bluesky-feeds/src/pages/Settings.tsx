import { motion } from "framer-motion";
import {
  Copy, ExternalLink, CheckCircle, XCircle, AlertTriangle,
  Server, Globe, Zap, Database, Cloud, ChevronRight,
  Link2, Eye, EyeOff, Loader2, BarChart2,
} from "lucide-react";
import WebhookNotifications from "@/components/WebhookNotifications";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useGetFirehoseStatus, customFetch } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

function useCopy(value: string) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return { copied, copy };
}

function CopyableCode({ value, label }: { value: string; label: string }) {
  const { copied, copy } = useCopy(value);
  return (
    <div className="mb-4 last:mb-0">
      <div className="text-xs text-muted-foreground mb-1.5 font-medium">{label}</div>
      <div className="flex items-center gap-2">
        <code className="flex-1 bg-muted/70 font-mono text-xs px-3 py-2.5 rounded-lg border border-border text-foreground truncate">
          {value}
        </code>
        <Button variant="ghost" size="icon" onClick={copy} className="flex-shrink-0 h-8 w-8">
          {copied ? <CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
        </Button>
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, children, delay = 0 }: {
  title: string; icon?: React.ElementType; children: React.ReactNode; delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="bg-card border border-card-border rounded-xl overflow-hidden mb-4"
    >
      <div className="flex items-center gap-2.5 px-5 md:px-6 py-4 border-b border-border">
        {Icon && (
          <div className="w-7 h-7 rounded-lg bg-primary/8 border border-primary/12 flex items-center justify-center flex-shrink-0">
            <Icon className="w-3.5 h-3.5 text-primary" />
          </div>
        )}
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      <div className="px-5 md:px-6 py-5">{children}</div>
    </motion.div>
  );
}

function EnvVarRow({ name, set, description }: { name: string; set: boolean; description: string }) {
  return (
    <div className={cn(
      "flex items-start gap-3 py-3 px-4 rounded-xl border transition-colors",
      set
        ? "bg-emerald-500/4 border-emerald-500/15"
        : "bg-red-500/4 border-red-500/15",
    )}>
      <div className="flex-shrink-0 mt-0.5">
        {set
          ? <CheckCircle className="w-4 h-4 text-emerald-500" />
          : <XCircle className="w-4 h-4 text-red-400" />
        }
      </div>
      <div className="flex-1 min-w-0">
        <code className="text-xs font-mono font-semibold text-foreground">{name}</code>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
      </div>
      <span className={cn("text-xs font-medium flex-shrink-0 mt-0.5", set ? "text-emerald-500" : "text-red-400")}>
        {set ? "Set" : "Missing"}
      </span>
    </div>
  );
}

const ENV_DESCRIPTIONS: Record<string, string> = {
  FEEDGEN_HOSTNAME: "Your deployed domain (e.g. feedforge-api.workers.dev). Used for the did:web and XRPC endpoints.",
  FEEDGEN_PUBLISHER_DID: "Your Bluesky DID (e.g. did:plc:xxxx). Required to publish feeds and show profile data.",
  BLUESKY_HANDLE: "Your Bluesky handle (e.g. you.bsky.social). Required for bulk follow/unfollow and search.",
  BLUESKY_APP_PASSWORD: "App password from bsky.app/settings/app-passwords. Required for write operations.",
  DATABASE_URL: "PostgreSQL connection string. Used by the Replit dev environment.",
};

// ─── D1 Usage Estimator ────────────────────────────────────────────────────────
const D1_LIMIT = 100_000;
const CRON_TICKS_PER_DAY = 480;          // every 3 min
const RANKING_RUNS_PER_DAY = 103;        // 14-min cooldown ≈ 103 runs/day
const CANDIDATES_PER_FEED = 50;          // candidateLimit in feed-ranking.ts
const AUTHOR_SCORING_WRITES = 20 * 2 * CRON_TICKS_PER_DAY;   // batchSize 20 × 2 writes × 480
const QUEUE_DRAIN_WRITES = 70 * CRON_TICKS_PER_DAY;           // ~70 items/tick (follow + unfollow)
const CRON_OVERHEAD_WRITES = 6 * CRON_TICKS_PER_DAY;          // settings stamps per tick

function D1UsageEstimator() {
  const { data: feeds, isLoading } = useQuery<{ isActive: boolean }[]>({
    queryKey: ["feeds-for-d1"],
    queryFn: () => customFetch("/api/feeds"),
    staleTime: 60_000,
  });

  const activeFeeds = (feeds ?? []).filter(f => f.isActive).length;

  // Per-feed: 1 DELETE + 50 INSERTs per ranking run
  const rankingWrites = activeFeeds * (1 + CANDIDATES_PER_FEED) * RANKING_RUNS_PER_DAY;
  const baseWrites = AUTHOR_SCORING_WRITES + QUEUE_DRAIN_WRITES + CRON_OVERHEAD_WRITES;
  const totalWrites = rankingWrites + baseWrites;
  const pct = Math.min(100, (totalWrites / D1_LIMIT) * 100);

  const status =
    pct >= 90 ? { color: "red", label: "Over limit", bar: "bg-red-500" } :
    pct >= 70 ? { color: "amber", label: "Getting close", bar: "bg-amber-400" } :
                { color: "emerald", label: "Healthy", bar: "bg-emerald-500" };

  const rows = [
    { label: "Feed ranking", writes: rankingWrites, note: `${activeFeeds} feed${activeFeeds !== 1 ? "s" : ""} × 51 writes × 103 runs/day` },
    { label: "Author scoring", writes: AUTHOR_SCORING_WRITES, note: "20 authors × 2 writes × 480 ticks" },
    { label: "Queue draining", writes: QUEUE_DRAIN_WRITES, note: "~70 follow/unfollow items × 480 ticks" },
    { label: "Cron overhead", writes: CRON_OVERHEAD_WRITES, note: "Settings stamps × 480 ticks" },
  ];

  return (
    <Section title="D1 Database Usage Estimator" icon={BarChart2} delay={0.05}>
      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Calculating…
        </div>
      ) : (
        <div className="space-y-4">
          {/* Headline gauge */}
          <div>
            <div className="flex items-end justify-between mb-1.5">
              <span className="text-xs font-medium text-muted-foreground">Estimated writes / day</span>
              <span className={cn(
                "text-xs font-semibold",
                status.color === "red" ? "text-red-500" :
                status.color === "amber" ? "text-amber-500" : "text-emerald-600"
              )}>
                {totalWrites.toLocaleString()} / {D1_LIMIT.toLocaleString()}
              </span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all duration-500", status.bar)}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <span className={cn(
                "text-[11px] font-medium",
                status.color === "red" ? "text-red-500" :
                status.color === "amber" ? "text-amber-500" : "text-emerald-600"
              )}>
                {status.label} — {pct.toFixed(0)}% of free tier
              </span>
              <span className="text-[11px] text-muted-foreground">
                {Math.max(0, D1_LIMIT - totalWrites).toLocaleString()} headroom
              </span>
            </div>
          </div>

          {/* Breakdown table */}
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium">Component</th>
                  <th className="text-right px-3 py-2 text-muted-foreground font-medium">Writes/day</th>
                  <th className="text-right px-3 py-2 text-muted-foreground font-medium hidden sm:table-cell">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map(row => (
                  <tr key={row.label} className="hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-foreground">{row.label}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{row.note}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold text-foreground tabular-nums">
                      {row.writes.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right text-muted-foreground hidden sm:table-cell">
                      {((row.writes / D1_LIMIT) * 100).toFixed(0)}%
                    </td>
                  </tr>
                ))}
                <tr className="bg-muted/40 font-semibold">
                  <td className="px-3 py-2.5 text-foreground text-xs font-semibold">Total</td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs font-semibold text-foreground tabular-nums">
                    {totalWrites.toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs text-muted-foreground hidden sm:table-cell">
                    {pct.toFixed(0)}%
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Tip */}
          {pct >= 70 && (
            <div className={cn(
              "flex gap-2 text-xs rounded-lg p-3 border",
              pct >= 90
                ? "bg-red-500/6 border-red-500/20 text-red-700"
                : "bg-amber-500/6 border-amber-500/20 text-amber-700"
            )}>
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>
                {pct >= 90
                  ? `You are over the 100K free limit with ${activeFeeds} active feeds. Deactivate some feeds or reduce keyword count to bring writes back down.`
                  : `With ${activeFeeds} active feeds you're at ${pct.toFixed(0)}% of the free limit. Each additional feed adds ~5,250 writes/day.`
                }
              </span>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Estimates assume 480 cron ticks/day (every 3 min) and the 14-min ranking cooldown. Actual usage varies with keyword match rate and follow queue activity.
          </p>
        </div>
      )}
    </Section>
  );
}

type DeployOption = "cf-full" | "cf-render" | "vercel" | "replit";

function Badge({ children, color = "gray" }: {
  children: React.ReactNode;
  color?: "green" | "blue" | "orange" | "gray";
}) {
  const colors = {
    green: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    blue: "bg-blue-500/10 text-blue-600 border-blue-500/20",
    orange: "bg-orange-500/10 text-orange-600 border-orange-500/20",
    gray: "bg-muted text-muted-foreground border-border",
  };
  return (
    <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full border", colors[color])}>
      {children}
    </span>
  );
}

function Step({ i, children }: { i: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] flex items-center justify-center font-bold mt-0.5">
        {i + 1}
      </span>
      <span className="text-muted-foreground leading-relaxed text-xs">{children}</span>
    </li>
  );
}

function Cmd({ children }: { children: string }) {
  const { copied, copy } = useCopy(children);
  return (
    <div className="flex items-center gap-2 mt-1 mb-2.5">
      <code className="flex-1 bg-muted/70 border border-border rounded-lg px-3 py-2 font-mono text-[11px] text-foreground overflow-x-auto">
        {children}
      </code>
      <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onClick={copy}>
        {copied ? <CheckCircle className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
      </Button>
    </div>
  );
}

function QuickConnect() {
  const [handle, setHandle] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<null | { ok: boolean; did?: string; error?: string }>(null);
  const [loading, setLoading] = useState(false);

  async function testConnection() {
    if (!handle || !appPassword) return;
    setLoading(true);
    setStatus(null);
    try {
      const res = await customFetch<{ ok: boolean; did?: string; handle?: string; error?: string }>(
        "/api/admin/test-connection",
        { method: "POST", body: JSON.stringify({ handle: handle.replace(/^@/, ""), appPassword }) },
      );
      setStatus(res);
    } catch (err) {
      setStatus({ ok: false, error: err instanceof Error ? err.message : "Connection failed" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-card-border rounded-xl overflow-hidden mb-4"
    >
      <div className="flex items-center gap-2.5 px-5 md:px-6 py-4 border-b border-border">
        <div className="w-7 h-7 rounded-lg bg-primary/8 border border-primary/12 flex items-center justify-center flex-shrink-0">
          <Link2 className="w-3.5 h-3.5 text-primary" />
        </div>
        <h2 className="text-sm font-semibold text-foreground">Bluesky Connection</h2>
        {status?.ok && (
          <span className="ml-auto flex items-center gap-1.5 text-xs font-medium text-emerald-600">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Connected
          </span>
        )}
      </div>

      <div className="px-5 md:px-6 py-5 space-y-4">
        <p className="text-xs text-muted-foreground">
          Enter your Bluesky credentials to test the connection. Use an{" "}
          <a
            href="https://bsky.app/settings/app-passwords"
            target="_blank"
            rel="noreferrer"
            className="text-primary underline"
          >
            App Password
          </a>
          {" "}— never your real password.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-foreground mb-1.5 block">Bluesky Handle</label>
            <Input
              value={handle}
              onChange={(e) => { setHandle(e.target.value); setStatus(null); }}
              placeholder="you.bsky.social"
              className="text-sm h-9"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground mb-1.5 block">App Password</label>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                value={appPassword}
                onChange={(e) => { setAppPassword(e.target.value); setStatus(null); }}
                placeholder="xxxx-xxxx-xxxx-xxxx"
                className="text-sm h-9 pr-9 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            size="sm"
            onClick={testConnection}
            disabled={loading || !handle || !appPassword}
            className="gap-1.5"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
            {loading ? "Testing…" : "Test Connection"}
          </Button>
          {status && (
            <motion.div
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              className={cn(
                "flex items-center gap-1.5 text-xs font-medium",
                status.ok ? "text-emerald-600" : "text-red-500",
              )}
            >
              {status.ok ? (
                <><CheckCircle className="w-3.5 h-3.5" /> Connected as {status.did}</>
              ) : (
                <><XCircle className="w-3.5 h-3.5" /> {status.error}</>
              )}
            </motion.div>
          )}
        </div>

        {status?.ok && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-muted/50 rounded-xl border border-border p-4 space-y-2.5"
          >
            <p className="text-xs font-semibold text-foreground">Set these as Cloudflare Worker secrets:</p>
            <div className="space-y-1.5">
              {[
                { label: "BLUESKY_HANDLE", value: handle.replace(/^@/, "") },
                { label: "BLUESKY_APP_PASSWORD", value: appPassword },
              ].map(({ label }) => {
                const cmd = `wrangler secret put ${label}`;
                return <Cmd key={label}>{cmd}</Cmd>;
              })}
            </div>
            <p className="text-[11px] text-muted-foreground/60">
              Run each command from <code className="bg-muted px-1 rounded">artifacts/cf-worker/</code>, then paste the value when prompted.
            </p>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

export default function Settings() {
  const { data: firehose } = useGetFirehoseStatus({ query: { queryKey: ["firehose-settings"] } });
  const { data: configStatus } = useQuery<Record<string, boolean>>({
    queryKey: ["config-status"],
    queryFn: () => customFetch("/api/config/status"),
    staleTime: 30_000,
  });
  const [activeOption, setActiveOption] = useState<DeployOption>("cf-full");

  const workerUrl = "feedforge-api.manmysterious2020.workers.dev";
  const hostname = window.location.hostname;
  const serviceDid = `did:web:${hostname}`;
  const didDocUrl = `https://${hostname}/.well-known/did.json`;
  const describeFeedUrl = `https://${hostname}/xrpc/app.bsky.feed.describeFeedGenerator`;
  const publisherDid = "(set FEEDGEN_PUBLISHER_DID)";
  const getFeedSkeletonUrl = `https://${hostname}/xrpc/app.bsky.feed.getFeedSkeleton?feed=at://${publisherDid}/app.bsky.feed.generator/YOUR_FEED`;

  const allSet = configStatus && Object.values(configStatus).every(Boolean);
  const missingCount = configStatus ? Object.values(configStatus).filter(v => !v).length : null;

  const deployOptions: {
    id: DeployOption; label: string; tagline: string;
    badges: { label: string; color: "green" | "blue" | "orange" | "gray" }[];
  }[] = [
    {
      id: "cf-full",
      label: "100% Cloudflare",
      tagline: "Workers + D1 + Pages + Cron — all free, no other services needed",
      badges: [{ label: "Free", color: "green" }, { label: "Recommended", color: "blue" }],
    },
    {
      id: "cf-render",
      label: "Cloudflare Pages + Render.com",
      tagline: "Real-time firehose — Cloudflare frontend + Render API + Neon PostgreSQL",
      badges: [{ label: "Free", color: "green" }],
    },
    {
      id: "vercel",
      label: "Vercel + Cloudflare Worker",
      tagline: "Deploy the frontend on Vercel, API on Cloudflare Worker — both free tiers",
      badges: [{ label: "Free", color: "green" }],
    },
    {
      id: "replit",
      label: "Replit Deploy",
      tagline: "All-in-one, easiest setup — frontend + API + firehose together",
      badges: [{ label: "Paid", color: "orange" }, { label: "Easiest", color: "gray" }],
    },
  ];

  return (
    <div className="px-4 py-5 md:px-8 md:py-8 max-w-3xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="mb-6 md:mb-8">
        <h1 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Configuration, XRPC endpoints, and deployment guides</p>
      </motion.div>

      {/* Quick Connect */}
      <QuickConnect />

      {/* Webhook Notifications */}
      <WebhookNotifications />

      {/* D1 Usage Estimator */}
      <D1UsageEstimator />

      {/* Environment Variables */}
      <Section title="Environment Variables" icon={Database} delay={0}>
        {missingCount !== null && (
          <div className={cn(
            "flex items-center gap-2.5 mb-5 p-3.5 rounded-xl border text-sm font-medium",
            allSet
              ? "bg-emerald-500/6 text-emerald-600 border-emerald-500/20"
              : "bg-amber-500/6 text-amber-600 border-amber-500/20",
          )}>
            {allSet
              ? <CheckCircle className="w-4 h-4 flex-shrink-0" />
              : <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            }
            <span>
              {allSet
                ? "All environment variables are configured."
                : `${missingCount} variable${missingCount > 1 ? "s" : ""} missing — some features are disabled.`}
            </span>
          </div>
        )}
        <div className="space-y-2">
          {configStatus
            ? Object.entries(configStatus).map(([name, set]) => (
              <EnvVarRow key={name} name={name} set={set} description={ENV_DESCRIPTIONS[name] ?? ""} />
            ))
            : Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-14 bg-muted/60 rounded-xl animate-pulse" />
            ))
          }
        </div>
        <div className="mt-4 flex gap-3 flex-wrap">
          <a href="https://bsky.app/settings" target="_blank" rel="noreferrer"
            className="text-xs text-primary hover:underline flex items-center gap-1 font-medium">
            Find your DID on Bluesky <ExternalLink className="w-3 h-3" />
          </a>
          <span className="text-muted-foreground/30 text-xs">·</span>
          <a href="https://bsky.app/settings/app-passwords" target="_blank" rel="noreferrer"
            className="text-xs text-primary hover:underline flex items-center gap-1 font-medium">
            Generate an App Password <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </Section>

      {/* Deployment Guide */}
      <Section title="Deployment Guide" icon={Globe} delay={0.05}>
        <div className="flex flex-col gap-2 mb-6">
          {deployOptions.map(opt => (
            <button
              key={opt.id}
              onClick={() => setActiveOption(opt.id)}
              className={cn(
                "flex items-start gap-3 p-4 rounded-xl border text-left transition-all duration-150",
                activeOption === opt.id
                  ? "border-primary/40 bg-primary/4 shadow-sm"
                  : "border-border hover:border-border hover:bg-muted/30",
              )}
            >
              <div className={cn(
                "w-4 h-4 rounded-full border-2 flex-shrink-0 mt-0.5 transition-all",
                activeOption === opt.id ? "border-primary bg-primary" : "border-muted-foreground/30",
              )} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-foreground">{opt.label}</span>
                  {opt.badges.map(b => <Badge key={b.label} color={b.color}>{b.label}</Badge>)}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{opt.tagline}</p>
              </div>
            </button>
          ))}
        </div>

        {activeOption === "cf-full" && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
            <div className="flex items-center gap-3 p-4 bg-emerald-500/6 border border-emerald-500/20 rounded-xl">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-emerald-600">Worker deployed and live</div>
                <a href={`https://${workerUrl}/api/healthz`} target="_blank" rel="noreferrer"
                  className="text-xs font-mono text-emerald-700 hover:underline break-all">
                  https://{workerUrl}
                </a>
              </div>
              <a href={`https://${workerUrl}/api/healthz`} target="_blank" rel="noreferrer">
                <ExternalLink className="w-3.5 h-3.5 text-emerald-600" />
              </a>
            </div>

            <div className="flex items-center justify-center gap-2 p-4 bg-muted/40 rounded-xl border border-border text-xs flex-wrap">
              {[
                { label: "Cloudflare Pages", sub: "React frontend" },
                { label: "Cloudflare Workers", sub: "Hono API" },
                { label: "Cloudflare D1", sub: "SQLite database" },
                { label: "Cron Trigger", sub: "Posts every 3 min" },
              ].map((item, i, arr) => (
                <div key={item.label} className="flex items-center gap-2">
                  <div className="text-center px-3 py-2 bg-orange-500/8 border border-orange-500/15 rounded-lg">
                    <div className="font-bold text-orange-600 text-xs">{item.label}</div>
                    <div className="text-muted-foreground text-[10px]">{item.sub}</div>
                  </div>
                  {i < arr.length - 1 && <ChevronRight className="w-3 h-3 text-muted-foreground/40 flex-shrink-0" />}
                </div>
              ))}
            </div>

            <div className="text-xs text-blue-600 bg-blue-500/8 border border-blue-500/15 rounded-lg p-3 flex gap-2">
              <Cloud className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-blue-500" />
              <span>
                The <code className="bg-blue-500/10 px-1 rounded font-mono">artifacts/cf-worker</code> package contains the complete backend.
                Posts are indexed every 3 minutes via Cron Triggers — perfect for Cloudflare's serverless runtime.
              </span>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-foreground mb-2">Step 1 — Install Wrangler & login</h4>
              <Cmd>npm install -g wrangler && wrangler login</Cmd>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-foreground mb-2">Step 2 — Create D1 database</h4>
              <Cmd>cd artifacts/cf-worker && pnpm install</Cmd>
              <Cmd>wrangler d1 create feedforge-db</Cmd>
              <p className="text-xs text-muted-foreground">Copy the <code className="bg-muted px-1 rounded font-mono">database_id</code> and paste it into <code className="bg-muted px-1 rounded font-mono">wrangler.toml</code></p>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-foreground mb-2">Step 3 — Run migrations</h4>
              <Cmd>wrangler d1 execute feedforge-db --remote --file ./migrations/0001_init.sql</Cmd>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-foreground mb-2">Step 4 — Set secrets</h4>
              <ol className="space-y-1.5 text-xs">
                {[
                  <>wrangler secret put FEEDGEN_PUBLISHER_DID → <span className="text-muted-foreground">did:plc:oobxeg4vljlqpp62k7fd6flp</span></>,
                  <>wrangler secret put BLUESKY_HANDLE → <span className="text-muted-foreground">bruceoyugi.bsky.social</span></>,
                  <>wrangler secret put BLUESKY_APP_PASSWORD → <span className="text-muted-foreground">your app password</span></>,
                  <>wrangler secret put FEEDGEN_HOSTNAME → <span className="text-muted-foreground">set AFTER deploying (Step 5)</span></>,
                ].map((cmd, i) => (
                  <li key={i} className="flex gap-2.5 items-start">
                    <span className="flex-shrink-0 w-4 h-4 rounded-full bg-primary/10 text-primary text-[10px] flex items-center justify-center font-bold mt-0.5">{i + 1}</span>
                    <code className="font-mono text-foreground">{cmd}</code>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-foreground mb-2">Step 5 — Deploy the Worker</h4>
              <Cmd>wrangler deploy</Cmd>
              <p className="text-xs text-muted-foreground">You'll get a URL like <code className="bg-muted px-1 rounded font-mono">feedforge-api.name.workers.dev</code> — set that as <code className="bg-muted px-1 rounded font-mono">FEEDGEN_HOSTNAME</code>.</p>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-foreground mb-2">Step 6 — Deploy frontend to Cloudflare Pages</h4>
              <ol className="space-y-2 text-xs list-none">
                {[
                  <>Go to <a href="https://pages.cloudflare.com" target="_blank" rel="noreferrer" className="text-primary underline">Cloudflare Pages</a> → Create a project → Connect to Git</>,
                  <>Build command: <code className="bg-muted px-1 rounded font-mono">pnpm --filter @workspace/bluesky-feeds run build</code></>,
                  <>Output directory: <code className="bg-muted px-1 rounded font-mono">artifacts/bluesky-feeds/dist/public</code></>,
                  <>Add env var: <code className="bg-muted px-1 rounded font-mono">VITE_API_BASE_URL=https://feedforge-api.name.workers.dev</code></>,
                  "Deploy — the _redirects file handles SPA routing automatically",
                ].map((step, i) => <Step key={i} i={i}>{step}</Step>)}
              </ol>
            </div>
            <div className="flex gap-3 flex-wrap pt-1">
              <a href="https://dash.cloudflare.com" target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1 font-medium">Cloudflare dashboard <ExternalLink className="w-3 h-3" /></a>
              <span className="text-muted-foreground/30 text-xs">·</span>
              <a href="https://developers.cloudflare.com/workers/" target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1 font-medium">Workers docs <ExternalLink className="w-3 h-3" /></a>
            </div>
          </motion.div>
        )}

        {activeOption === "cf-render" && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            <div className="text-xs text-amber-600 bg-amber-500/8 border border-amber-500/20 rounded-lg p-3 flex gap-2">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-amber-500" />
              <span>Use this for <strong>real-time post indexing</strong> via the firehose WebSocket. Requires a persistent server (Render.com free tier works).</span>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-foreground mb-2">Part 1 — API Server on Render.com</h4>
              <ol className="space-y-2 text-xs list-none">
                {[
                  <>Sign up at <a href="https://render.com" target="_blank" rel="noreferrer" className="text-primary underline">render.com</a> → New → Web Service → connect your repo</>,
                  <>Build command: <code className="bg-muted px-1 rounded font-mono">pnpm install && pnpm --filter @workspace/api-server run build</code></>,
                  <>Start command: <code className="bg-muted px-1 rounded font-mono">node artifacts/api-server/dist/index.mjs</code></>,
                  <>Add env vars: PORT=10000, DATABASE_URL (from Neon), FEEDGEN_PUBLISHER_DID, BLUESKY_HANDLE, BLUESKY_APP_PASSWORD, FEEDGEN_HOSTNAME</>,
                ].map((step, i) => <Step key={i} i={i}>{step}</Step>)}
              </ol>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-foreground mb-2">Part 2 — Frontend on Cloudflare Pages</h4>
              <ol className="space-y-2 text-xs list-none">
                {[
                  <>Go to <a href="https://pages.cloudflare.com" target="_blank" rel="noreferrer" className="text-primary underline">Cloudflare Pages</a> → Connect repo</>,
                  <>Build: <code className="bg-muted px-1 rounded font-mono">pnpm --filter @workspace/bluesky-feeds run build</code></>,
                  <>Output: <code className="bg-muted px-1 rounded font-mono">artifacts/bluesky-feeds/dist/public</code></>,
                  <>Add <code className="bg-muted px-1 rounded font-mono">VITE_API_BASE_URL</code> = your Render URL</>,
                ].map((step, i) => <Step key={i} i={i}>{step}</Step>)}
              </ol>
            </div>
            <div className="flex gap-3 flex-wrap">
              <a href="https://neon.tech" target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1 font-medium">Neon free Postgres <ExternalLink className="w-3 h-3" /></a>
              <span className="text-muted-foreground/30 text-xs">·</span>
              <a href="https://render.com" target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1 font-medium">Render.com <ExternalLink className="w-3 h-3" /></a>
            </div>
          </motion.div>
        )}

        {activeOption === "vercel" && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
            <div className="text-xs text-blue-600 bg-blue-500/8 border border-blue-500/15 rounded-lg p-3 flex gap-2">
              <Cloud className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-blue-500" />
              <span>
                The Cloudflare Worker (<code className="bg-muted px-1 rounded font-mono">{workerUrl}</code>) handles the API.
                Vercel hosts the React frontend only — no server-side code needed.
              </span>
            </div>

            <div>
              <p className="text-xs font-semibold text-foreground mb-2">1 — Deploy the Worker (already done)</p>
              <div className="flex items-center gap-3 p-3.5 bg-emerald-500/6 border border-emerald-500/20 rounded-xl">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-emerald-600">Worker live</div>
                  <a href={`https://${workerUrl}/api/healthz`} target="_blank" rel="noreferrer"
                    className="text-xs font-mono text-emerald-700 hover:underline break-all">
                    https://{workerUrl}
                  </a>
                </div>
                <a href={`https://${workerUrl}/api/healthz`} target="_blank" rel="noreferrer">
                  <ExternalLink className="w-3.5 h-3.5 text-emerald-600" />
                </a>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-foreground mb-2">2 — Deploy frontend to Vercel</p>
              <ol className="space-y-2 text-xs list-none">
                {[
                  <>Push this repo to GitHub, then go to <a href="https://vercel.com/new" target="_blank" rel="noreferrer" className="text-primary underline">vercel.com/new</a> and import it</>,
                  <>Set <strong>Root Directory</strong> to <code className="bg-muted px-1 rounded font-mono">artifacts/bluesky-feeds</code></>,
                  <>Set <strong>Build Command</strong> to <code className="bg-muted px-1 rounded font-mono">pnpm --filter @workspace/bluesky-feeds run build</code></>,
                  <>Set <strong>Output Directory</strong> to <code className="bg-muted px-1 rounded font-mono">dist/public</code></>,
                  <>Add environment variable: <code className="bg-muted px-1 rounded font-mono">VITE_API_BASE_URL=https://{workerUrl}</code></>,
                  "Deploy — Vercel handles SPA routing automatically via the included vercel.json",
                ].map((step, i) => <Step key={i} i={i}>{step}</Step>)}
              </ol>
            </div>

            <div className="bg-amber-500/6 border border-amber-500/15 rounded-lg p-3 text-xs text-amber-700 flex gap-2">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-amber-500" />
              <span>
                The Vercel frontend calls the Cloudflare Worker for all API requests.
                The XRPC feed endpoints (did.json, describeFeedGenerator, getFeedSkeleton) are served by the Worker at <code className="bg-muted px-1 rounded font-mono">{workerUrl}</code>.
                Set <code className="bg-muted px-1 rounded font-mono">FEEDGEN_HOSTNAME={workerUrl}</code> in your Worker secrets.
              </span>
            </div>

            <div className="flex gap-3 flex-wrap">
              <a href="https://vercel.com/new" target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1 font-medium">Vercel dashboard <ExternalLink className="w-3 h-3" /></a>
              <span className="text-muted-foreground/30 text-xs">·</span>
              <a href={`https://${workerUrl}/api/healthz`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1 font-medium">Check Worker health <ExternalLink className="w-3 h-3" /></a>
            </div>
          </motion.div>
        )}

        {activeOption === "replit" && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            <div className="text-xs text-orange-600 bg-orange-500/8 border border-orange-500/15 rounded-lg p-3 flex gap-2">
              <Zap className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-orange-500" />
              <span>Replit Deploy is paid (from ~$7/month) but requires zero configuration — everything runs together.</span>
            </div>
            <ol className="space-y-2 text-xs list-none">
              {[
                "Click the Deploy button in the top-right of your Replit workspace",
                <>Set <code className="bg-muted px-1 rounded font-mono">FEEDGEN_HOSTNAME</code> to your deployed domain in deployment secrets</>,
                "All other secrets carry over automatically",
                "Deploy — live at your Replit domain, no extra services needed",
              ].map((step, i) => <Step key={i} i={i}>{step}</Step>)}
            </ol>
          </motion.div>
        )}
      </Section>

      {/* XRPC Endpoints */}
      <Section title="XRPC Endpoints" icon={Server} delay={0.1}>
        <CopyableCode value={serviceDid} label="Service DID (did:web)" />
        <CopyableCode value={didDocUrl} label="DID Document URL" />
        <CopyableCode value={describeFeedUrl} label="describeFeedGenerator" />
        <CopyableCode value={getFeedSkeletonUrl} label="getFeedSkeleton (example)" />
        <div className="flex gap-3 mt-3 flex-wrap">
          <a href={didDocUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1 font-medium">Verify DID document <ExternalLink className="w-3 h-3" /></a>
          <span className="text-muted-foreground/30 text-xs">·</span>
          <a href="https://docs.bsky.app/docs/tutorials/creating-a-feed" target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1 font-medium">Feed generator docs <ExternalLink className="w-3 h-3" /></a>
        </div>
      </Section>

      {/* Indexer Status */}
      <Section title="Post Indexer" icon={Zap} delay={0.15}>
        <div className="text-xs text-blue-600 bg-blue-500/8 border border-blue-500/15 rounded-lg p-3 flex gap-2 mb-4">
          <Cloud className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-blue-500" />
          <span>
            On <strong>Cloudflare Workers</strong>, posts are indexed every 3 minutes via Cron Triggers.
            In Replit dev, the firehose WebSocket is used for real-time indexing.
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { label: "Firehose Status", value: firehose?.connected ? "Connected" : "Disconnected", color: firehose?.connected ? "text-emerald-500" : "text-red-400" },
            { label: "Session Indexed", value: (firehose?.postsIndexedTotal ?? 0).toLocaleString(), color: "text-foreground" },
            { label: "Reconnects", value: firehose?.reconnectCount ?? 0, color: "text-foreground" },
            { label: "CF Cron", value: "*/3 * * * *", mono: true },
            { label: "Indexer Mode", value: "Bluesky searchPosts API", mono: true },
          ].map(({ label, value, color, mono }: { label: string; value: string | number; color?: string; mono?: boolean }) => (
            <div key={label} className="bg-muted/50 rounded-xl px-3 py-2.5 border border-border/50">
              <div className="text-[10px] text-muted-foreground mb-1 font-medium uppercase tracking-wide">{label}</div>
              <div className={cn("text-sm font-semibold", color ?? "text-foreground", mono && "font-mono text-xs")}>{value}</div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
