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
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="mb-4">
      <div className="text-xs text-muted-foreground mb-1.5">{label}</div>
      <div className="flex items-center gap-2">
        <code className="flex-1 bg-muted font-mono text-sm px-3 py-2 rounded-lg border border-border text-foreground truncate">
          {value}
        </code>
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
        {set
          ? <CheckCircle className="w-4 h-4 text-emerald-500" />
          : <XCircle className="w-4 h-4 text-red-400" />}
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
  BLUESKY_HANDLE: "Your Bluesky handle (e.g. you.bsky.social). Required for bulk follow/unfollow.",
  BLUESKY_APP_PASSWORD: "App password from bsky.app/settings/app-passwords. Required for write operations.",
  DATABASE_URL: "PostgreSQL connection string. Automatically set by Replit's built-in database.",
};

export default function Settings() {
  const { data: firehose } = useGetFirehoseStatus({ query: { queryKey: ["firehose-settings"] } });
  const { data: configStatus } = useQuery<Record<string, boolean>>({
    queryKey: ["config-status"],
    queryFn: () => fetch("/api/config/status").then(r => r.json()),
    staleTime: 30_000,
  });

  const hostname = window.location.hostname;
  const publisherDid = "(set FEEDGEN_PUBLISHER_DID)";
  const serviceDid = `did:web:${hostname}`;
  const didDocUrl = `https://${hostname}/.well-known/did.json`;
  const describeFeedUrl = `https://${hostname}/xrpc/app.bsky.feed.describeFeedGenerator`;
  const getFeedSkeletonUrl = `https://${hostname}/xrpc/app.bsky.feed.getFeedSkeleton?feed=at://${publisherDid}/app.bsky.feed.generator/YOUR_FEED`;

  const allSet = configStatus && Object.values(configStatus).every(Boolean);
  const missingCount = configStatus ? Object.values(configStatus).filter(v => !v).length : null;

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
          <a href="https://bsky.app/settings" target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
            Find your DID on Bluesky <ExternalLink className="w-3 h-3" />
          </a>
          <span className="text-muted-foreground/40 text-xs">·</span>
          <a href="https://bsky.app/settings/app-passwords" target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
            Generate an App Password <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </Section>

      {/* Deployment Guide */}
      <Section title="Deployment Guide" icon={Globe} delay={0.05}>
        <div className="space-y-5">

          {/* Replit Deploy */}
          <div className="border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-6 h-6 rounded-md bg-orange-500/15 flex items-center justify-center"><Zap className="w-3.5 h-3.5 text-orange-500" /></div>
              <h3 className="text-sm font-semibold">Option A — Replit Deploy (Recommended)</h3>
              <span className="ml-auto text-xs text-emerald-600 font-medium bg-emerald-500/10 px-2 py-0.5 rounded-full">Easiest</span>
            </div>
            <p className="text-xs text-muted-foreground mb-3">Deploys the full app (API + frontend + firehose) together. The firehose WebSocket connection requires a persistent process — Replit Deploy handles this automatically.</p>
            <ol className="space-y-2 text-xs text-foreground">
              {[
                "Click the Deploy button in the top-right of your Replit workspace",
                <>Set <code className="bg-muted px-1 rounded font-mono">FEEDGEN_HOSTNAME</code> to your deployed domain (e.g. <code className="bg-muted px-1 rounded font-mono">my-app.replit.app</code>)</>,
                "All other secrets (FEEDGEN_PUBLISHER_DID, BLUESKY_HANDLE, BLUESKY_APP_PASSWORD) are already configured as secrets — Replit copies them to production automatically",
                "Deploy and your full feed generator will be live at your domain",
              ].map((step, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="flex-shrink-0 w-4 h-4 rounded-full bg-primary/15 text-primary text-[10px] flex items-center justify-center font-bold mt-0.5">{i + 1}</span>
                  <span className="text-muted-foreground leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Vercel Frontend + Replit API */}
          <div className="border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-6 h-6 rounded-md bg-black/10 dark:bg-white/10 flex items-center justify-center">
                <Server className="w-3.5 h-3.5" />
              </div>
              <h3 className="text-sm font-semibold">Option B — Vercel (Frontend) + Replit (API)</h3>
            </div>
            <div className="text-xs text-amber-600 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mb-3 flex gap-2">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span><strong>Important:</strong> The Express API + firehose WebSocket <em>cannot</em> run on Vercel (serverless). The API server must stay on Replit Deploy. Only the frontend goes to Vercel.</span>
            </div>
            <ol className="space-y-2 text-xs">
              {[
                <>Deploy the API server on <strong>Replit Deploy</strong> first (Option A, but only the API). Your API URL will be something like <code className="bg-muted px-1 rounded font-mono">https://my-app.replit.app</code></>,
                <>In Vercel, import this repository and set the following build settings:<br /><code className="bg-muted px-1.5 py-0.5 rounded font-mono block mt-1">Build: pnpm --filter @workspace/bluesky-feeds run build</code><code className="bg-muted px-1.5 py-0.5 rounded font-mono block mt-1">Output: artifacts/bluesky-feeds/dist/public</code></>,
                <>Add a Vercel environment variable: <code className="bg-muted px-1 rounded font-mono">VITE_API_BASE_URL</code> = <code className="bg-muted px-1 rounded font-mono">https://your-api.replit.app</code><br /><span className="text-muted-foreground">This tells the frontend where to find the API server.</span></>,
                "Deploy to Vercel — the frontend will proxy all /api calls to your Replit API server.",
              ].map((step, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="flex-shrink-0 w-4 h-4 rounded-full bg-primary/15 text-primary text-[10px] flex items-center justify-center font-bold mt-0.5">{i + 1}</span>
                  <span className="text-muted-foreground leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
            <div className="mt-3 flex gap-2 flex-wrap">
              <a href="https://vercel.com/new" target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                Import to Vercel <ExternalLink className="w-3 h-3" />
              </a>
              <span className="text-muted-foreground/40 text-xs">·</span>
              <a href="https://vercel.com/docs/projects/environment-variables" target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                Vercel env vars docs <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>
      </Section>

      {/* XRPC Endpoints */}
      <Section title="XRPC Endpoints" icon={Server} delay={0.1}>
        <CopyableCode value={serviceDid} label="Service DID (did:web)" />
        <CopyableCode value={didDocUrl} label="DID Document URL" />
        <CopyableCode value={describeFeedUrl} label="describeFeedGenerator" />
        <CopyableCode value={getFeedSkeletonUrl} label="getFeedSkeleton (example)" />
        <div className="flex gap-3 mt-2 flex-wrap">
          <a href={didDocUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
            Verify DID document <ExternalLink className="w-3 h-3" />
          </a>
          <span className="text-muted-foreground/40 text-xs">·</span>
          <a href="https://docs.bsky.app/docs/tutorials/creating-a-feed" target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
            Bluesky feed generator docs <ExternalLink className="w-3 h-3" />
          </a>
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
          The firehose maintains a persistent WebSocket connection to Bluesky's Jetstream service. It automatically reconnects on disconnect. <strong>This is why the full app cannot run on Vercel</strong> — serverless functions are stateless and short-lived.
        </p>
      </Section>
    </div>
  );
}
