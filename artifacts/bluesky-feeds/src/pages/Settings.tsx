import { motion } from "framer-motion";
import { Copy, ExternalLink, CheckCircle, XCircle, AlertTriangle, Server, Globe, Zap, Database } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useGetFirehoseStatus } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

function CopyableCode({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }
  return (
    <div className="mb-4">
      <div className="text-xs text-muted-foreground mb-1.5">{label}</div>
      <div className="flex items-center gap-2">
        <code className="flex-1 bg-muted font-mono text-sm px-3 py-2 rounded-lg border border-border text-foreground truncate">{value}</code>
        <Button variant="ghost" size="icon" onClick={copy} className="flex-shrink-0">
          {copied ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
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
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="bg-card border border-card-border rounded-xl p-6 shadow-sm mb-6"
    >
      <div className="flex items-center gap-2 mb-5">
        {Icon && <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center"><Icon className="w-3.5 h-3.5 text-primary" /></div>}
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      {children}
    </motion.div>
  );
}

function EnvVarRow({ name, set, description }: { name: string; set: boolean; description: string }) {
  return (
    <div className={cn("flex items-start gap-3 py-3 px-4 rounded-lg border", set ? "bg-emerald-500/5 border-emerald-500/20" : "bg-red-500/5 border-red-500/20")}>
      <div className="flex-shrink-0 mt-0.5">
        {set ? <CheckCircle className="w-4 h-4 text-emerald-500" /> : <XCircle className="w-4 h-4 text-red-400" />}
      </div>
      <div className="flex-1 min-w-0">
        <code className="text-xs font-mono font-semibold text-foreground">{name}</code>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <span className={cn("text-xs font-medium flex-shrink-0", set ? "text-emerald-500" : "text-red-400")}>
        {set ? "Set ✓" : "Missing"}
      </span>
    </div>
  );
}

const ENV_DESCRIPTIONS: Record<string, string> = {
  FEEDGEN_HOSTNAME: "Your deployed domain (e.g. your-app.replit.app). Used for the did:web and XRPC endpoints.",
  FEEDGEN_PUBLISHER_DID: "Your Bluesky DID (e.g. did:plc:xxxx). Required to publish feeds and show profile data.",
  BLUESKY_HANDLE: "Your Bluesky handle (e.g. you.bsky.social). Required for bulk follow/unfollow and search.",
  BLUESKY_APP_PASSWORD: "App password from bsky.app/settings/app-passwords. Required for write operations.",
  DATABASE_URL: "PostgreSQL connection string. Automatically set by Replit's built-in database.",
};

type DeployOption = "replit" | "cloudflare" | "vercel";

function Badge({ children, color = "gray" }: { children: React.ReactNode; color?: "green" | "blue" | "orange" | "gray" }) {
  const colors = {
    green: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    blue: "bg-blue-500/10 text-blue-600 border-blue-500/20",
    orange: "bg-orange-500/10 text-orange-600 border-orange-500/20",
    gray: "bg-muted text-muted-foreground border-border",
  };
  return (
    <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full border", colors[color])}>{children}</span>
  );
}

export default function Settings() {
  const { data: firehose } = useGetFirehoseStatus({ query: { queryKey: ["firehose-settings"] } });
  const { data: configStatus } = useQuery<Record<string, boolean>>({
    queryKey: ["config-status"],
    queryFn: () => fetch("/api/config/status").then(r => r.json()),
    staleTime: 30_000,
  });
  const [activeOption, setActiveOption] = useState<DeployOption>("cloudflare");

  const hostname = window.location.hostname;
  const publisherDid = "(set FEEDGEN_PUBLISHER_DID)";
  const serviceDid = `did:web:${hostname}`;
  const didDocUrl = `https://${hostname}/.well-known/did.json`;
  const describeFeedUrl = `https://${hostname}/xrpc/app.bsky.feed.describeFeedGenerator`;
  const getFeedSkeletonUrl = `https://${hostname}/xrpc/app.bsky.feed.getFeedSkeleton?feed=at://${publisherDid}/app.bsky.feed.generator/YOUR_FEED`;

  const allSet = configStatus && Object.values(configStatus).every(Boolean);
  const missingCount = configStatus ? Object.values(configStatus).filter(v => !v).length : null;

  const deployOptions: { id: DeployOption; label: string; tagline: string; badges: { label: string; color: "green" | "blue" | "orange" | "gray" }[] }[] = [
    { id: "cloudflare", label: "Cloudflare Pages + Render.com", tagline: "Best free option — global CDN frontend + persistent API server", badges: [{ label: "100% Free", color: "green" }, { label: "Recommended", color: "blue" }] },
    { id: "vercel", label: "Vercel + Render.com", tagline: "Popular alternative — same architecture, Vercel instead of Cloudflare", badges: [{ label: "100% Free", color: "green" }] },
    { id: "replit", label: "Replit Deploy", tagline: "All-in-one, easiest setup — frontend + API + firehose together", badges: [{ label: "Paid", color: "orange" }, { label: "Easiest", color: "gray" }] },
  ];

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">Configuration, XRPC endpoints, and deployment guides</p>
      </motion.div>

      {/* Env Var Status */}
      <Section title="Environment Variables" icon={Database} delay={0}>
        {missingCount !== null && (
          <div className={cn("flex items-center gap-2 mb-4 p-3 rounded-lg text-sm font-medium", allSet ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20" : "bg-amber-500/10 text-amber-600 border border-amber-500/20")}>
            {allSet ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            {allSet ? "All environment variables are configured." : `${missingCount} variable${missingCount > 1 ? "s" : ""} missing — some features are disabled.`}
          </div>
        )}
        <div className="space-y-2">
          {configStatus
            ? Object.entries(configStatus).map(([name, set]) => (
                <EnvVarRow key={name} name={name} set={set} description={ENV_DESCRIPTIONS[name] ?? ""} />
              ))
            : Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 bg-muted rounded-lg animate-pulse" />)}
        </div>
        <div className="mt-4 flex gap-2 flex-wrap">
          <a href="https://bsky.app/settings" target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">Find your DID on Bluesky <ExternalLink className="w-3 h-3" /></a>
          <span className="text-muted-foreground/40 text-xs">·</span>
          <a href="https://bsky.app/settings/app-passwords" target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">Generate an App Password <ExternalLink className="w-3 h-3" /></a>
        </div>
      </Section>

      {/* Deployment Guide */}
      <Section title="Deployment Guide" icon={Globe} delay={0.05}>

        {/* Why split? */}
        <div className="text-xs text-amber-600 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mb-5 flex gap-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>
            <strong>The key constraint:</strong> The firehose is a persistent WebSocket connection to Bluesky. It cannot run on serverless platforms (Cloudflare Workers, Vercel, etc.) — these shut down after each request. The <strong>API server must run on a persistent server</strong>. The frontend (static React app) can go anywhere.
          </span>
        </div>

        {/* Option selector */}
        <div className="flex flex-col gap-2 mb-5">
          {deployOptions.map(opt => (
            <button
              key={opt.id}
              onClick={() => setActiveOption(opt.id)}
              className={cn(
                "flex items-start gap-3 p-4 rounded-xl border text-left transition-all",
                activeOption === opt.id
                  ? "border-primary/50 bg-primary/5 shadow-sm"
                  : "border-border hover:border-border/80 hover:bg-muted/30",
              )}
            >
              <div className={cn("w-4 h-4 rounded-full border-2 flex-shrink-0 mt-0.5 transition-colors", activeOption === opt.id ? "border-primary bg-primary" : "border-muted-foreground/30")} />
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

        {/* Option A: Cloudflare + Render */}
        {activeOption === "cloudflare" && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            {/* Architecture diagram */}
            <div className="flex items-center justify-center gap-2 p-4 bg-muted/30 rounded-xl border border-border text-xs flex-wrap">
              <div className="text-center px-3 py-2 bg-orange-500/10 border border-orange-500/20 rounded-lg">
                <div className="font-bold text-orange-600">Cloudflare Pages</div>
                <div className="text-muted-foreground">React frontend (free)</div>
              </div>
              <div className="text-muted-foreground">→ calls API at →</div>
              <div className="text-center px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-lg">
                <div className="font-bold text-green-600">Render.com</div>
                <div className="text-muted-foreground">Express + firehose (free)</div>
              </div>
              <div className="text-muted-foreground">← connects →</div>
              <div className="text-center px-3 py-2 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <div className="font-bold text-blue-600">Neon / Supabase</div>
                <div className="text-muted-foreground">PostgreSQL (free)</div>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-foreground mb-2">Part 1 — API Server on Render.com (free)</h4>
              <ol className="space-y-2 text-xs">
                {[
                  <>Sign up at <a href="https://render.com" target="_blank" rel="noreferrer" className="text-primary underline">render.com</a> → New → Web Service → connect your GitHub repo</>,
                  <>Set <strong>Build command:</strong> <code className="bg-muted px-1 rounded font-mono">pnpm install && pnpm --filter @workspace/api-server run build</code></>,
                  <>Set <strong>Start command:</strong> <code className="bg-muted px-1 rounded font-mono">node artifacts/api-server/dist/index.mjs</code></>,
                  <>Add environment variables in Render dashboard: <code className="bg-muted px-1 rounded font-mono">PORT=10000</code>, <code className="bg-muted px-1 rounded font-mono">DATABASE_URL</code> (from Neon/Supabase), <code className="bg-muted px-1 rounded font-mono">FEEDGEN_PUBLISHER_DID</code>, <code className="bg-muted px-1 rounded font-mono">BLUESKY_HANDLE</code>, <code className="bg-muted px-1 rounded font-mono">BLUESKY_APP_PASSWORD</code>, <code className="bg-muted px-1 rounded font-mono">FEEDGEN_HOSTNAME</code> = your Render domain</>,
                  "Deploy — your API will be live at https://your-app.onrender.com",
                ].map((step, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="flex-shrink-0 w-4 h-4 rounded-full bg-primary/15 text-primary text-[10px] flex items-center justify-center font-bold mt-0.5">{i + 1}</span>
                    <span className="text-muted-foreground leading-relaxed">{step}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-foreground mb-2">Part 2 — Frontend on Cloudflare Pages (free)</h4>
              <ol className="space-y-2 text-xs">
                {[
                  <>Sign up at <a href="https://pages.cloudflare.com" target="_blank" rel="noreferrer" className="text-primary underline">pages.cloudflare.com</a> → Create application → Pages → Connect to Git</>,
                  <>Set <strong>Build command:</strong> <code className="bg-muted px-1 rounded font-mono">pnpm --filter @workspace/bluesky-feeds run build</code></>,
                  <>Set <strong>Build output directory:</strong> <code className="bg-muted px-1 rounded font-mono">artifacts/bluesky-feeds/dist/public</code></>,
                  <>Add environment variable: <code className="bg-muted px-1 rounded font-mono">VITE_API_BASE_URL</code> = <code className="bg-muted px-1 rounded font-mono">https://your-app.onrender.com</code></>,
                  <>Also set <code className="bg-muted px-1 rounded font-mono">BASE_PATH</code> = <code className="bg-muted px-1 rounded font-mono">/</code></>,
                  "Deploy — Cloudflare Pages handles SPA routing automatically via the _redirects file already in the project",
                ].map((step, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="flex-shrink-0 w-4 h-4 rounded-full bg-primary/15 text-primary text-[10px] flex items-center justify-center font-bold mt-0.5">{i + 1}</span>
                    <span className="text-muted-foreground leading-relaxed">{step}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="flex gap-2 flex-wrap pt-1">
              <a href="https://dash.cloudflare.com/?to=/:account/pages/new" target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">Cloudflare Pages dashboard <ExternalLink className="w-3 h-3" /></a>
              <span className="text-muted-foreground/40 text-xs">·</span>
              <a href="https://neon.tech" target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">Neon free Postgres <ExternalLink className="w-3 h-3" /></a>
              <span className="text-muted-foreground/40 text-xs">·</span>
              <a href="https://supabase.com" target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">Supabase free Postgres <ExternalLink className="w-3 h-3" /></a>
            </div>
          </motion.div>
        )}

        {/* Option B: Vercel + Render */}
        {activeOption === "vercel" && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            <div className="flex items-center justify-center gap-2 p-4 bg-muted/30 rounded-xl border border-border text-xs flex-wrap">
              <div className="text-center px-3 py-2 bg-black/10 dark:bg-white/10 border border-border rounded-lg">
                <div className="font-bold text-foreground">Vercel</div>
                <div className="text-muted-foreground">React frontend (free)</div>
              </div>
              <div className="text-muted-foreground">→ calls API at →</div>
              <div className="text-center px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-lg">
                <div className="font-bold text-green-600">Render.com</div>
                <div className="text-muted-foreground">Express + firehose (free)</div>
              </div>
              <div className="text-muted-foreground">← connects →</div>
              <div className="text-center px-3 py-2 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <div className="font-bold text-blue-600">Neon / Supabase</div>
                <div className="text-muted-foreground">PostgreSQL (free)</div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Same architecture as Cloudflare — deploy the API to Render.com the same way. The only difference is the frontend hosting.</p>
            <div>
              <h4 className="text-xs font-semibold text-foreground mb-2">Frontend on Vercel</h4>
              <ol className="space-y-2 text-xs">
                {[
                  <>Import your repo at <a href="https://vercel.com/new" target="_blank" rel="noreferrer" className="text-primary underline">vercel.com/new</a></>,
                  <>Vercel auto-detects the <code className="bg-muted px-1 rounded font-mono">vercel.json</code> already in the project root — no build settings needed</>,
                  <>Add environment variable: <code className="bg-muted px-1 rounded font-mono">VITE_API_BASE_URL</code> = <code className="bg-muted px-1 rounded font-mono">https://your-app.onrender.com</code></>,
                  <>Also set <code className="bg-muted px-1 rounded font-mono">BASE_PATH</code> = <code className="bg-muted px-1 rounded font-mono">/</code></>,
                  "Deploy — the vercel.json already handles SPA routing rewrites",
                ].map((step, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="flex-shrink-0 w-4 h-4 rounded-full bg-primary/15 text-primary text-[10px] flex items-center justify-center font-bold mt-0.5">{i + 1}</span>
                    <span className="text-muted-foreground leading-relaxed">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="flex gap-2 flex-wrap pt-1">
              <a href="https://vercel.com/new" target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">Import to Vercel <ExternalLink className="w-3 h-3" /></a>
              <span className="text-muted-foreground/40 text-xs">·</span>
              <a href="https://render.com" target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">Render.com <ExternalLink className="w-3 h-3" /></a>
              <span className="text-muted-foreground/40 text-xs">·</span>
              <a href="https://neon.tech" target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">Neon free Postgres <ExternalLink className="w-3 h-3" /></a>
            </div>
          </motion.div>
        )}

        {/* Option C: Replit Deploy */}
        {activeOption === "replit" && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            <div className="text-xs text-orange-600 bg-orange-500/10 border border-orange-500/20 rounded-lg p-3 flex gap-2">
              <Zap className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>Replit Deploy is paid (starting ~$7/month) but requires zero configuration — everything runs together with no split services.</span>
            </div>
            <div className="flex items-center justify-center gap-2 p-4 bg-muted/30 rounded-xl border border-border text-xs">
              <div className="text-center px-3 py-2 bg-orange-500/10 border border-orange-500/20 rounded-lg">
                <div className="font-bold text-orange-600">Replit Deploy</div>
                <div className="text-muted-foreground">Frontend + API + Firehose + DB (all-in-one)</div>
              </div>
            </div>
            <ol className="space-y-2 text-xs">
              {[
                "Click the Deploy button in the top-right of your Replit workspace",
                <>Set <code className="bg-muted px-1 rounded font-mono">FEEDGEN_HOSTNAME</code> to your deployed domain (e.g. <code className="bg-muted px-1 rounded font-mono">my-app.replit.app</code>) in the deployment secrets</>,
                "All other secrets (FEEDGEN_PUBLISHER_DID, BLUESKY_HANDLE, BLUESKY_APP_PASSWORD) are already configured and carried over automatically",
                "Deploy — everything is live at your Replit domain, no extra services needed",
              ].map((step, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="flex-shrink-0 w-4 h-4 rounded-full bg-primary/15 text-primary text-[10px] flex items-center justify-center font-bold mt-0.5">{i + 1}</span>
                  <span className="text-muted-foreground leading-relaxed">{step}</span>
                </li>
              ))}
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
        <div className="flex gap-3 mt-2 flex-wrap">
          <a href={didDocUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">Verify DID document <ExternalLink className="w-3 h-3" /></a>
          <span className="text-muted-foreground/40 text-xs">·</span>
          <a href="https://docs.bsky.app/docs/tutorials/creating-a-feed" target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">Bluesky feed generator docs <ExternalLink className="w-3 h-3" /></a>
        </div>
      </Section>

      {/* Firehose */}
      <Section title="Firehose Status" icon={Zap} delay={0.15}>
        <CopyableCode value={firehose?.endpoint || "wss://jetstream2.us-east.bsky.network/subscribe"} label="Jetstream Endpoint" />
        <div className="grid grid-cols-3 gap-3 mt-2">
          {[
            { label: "Status", value: firehose?.connected ? "Connected" : "Disconnected", color: firehose?.connected ? "text-emerald-500" : "text-red-400" },
            { label: "Session Indexed", value: (firehose?.postsIndexedTotal ?? 0).toLocaleString(), color: "text-foreground" },
            { label: "Reconnects", value: firehose?.reconnectCount ?? 0, color: "text-foreground" },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-muted/40 rounded-lg px-3 py-2.5">
              <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
              <div className={cn("text-sm font-semibold", color)}>{value}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          The firehose maintains a persistent WebSocket to Bluesky's Jetstream. This is why the full app cannot run on Cloudflare Workers or Vercel serverless — those platforms shut down idle processes. Use <strong>Render.com or Fly.io</strong> for the API server when deploying free.
        </p>
      </Section>
    </div>
  );
}
