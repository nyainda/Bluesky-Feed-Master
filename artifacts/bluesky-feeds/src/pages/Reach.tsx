import { useState } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch, getBaseUrl, useListFeeds } from "@workspace/api-client-react";
import { format, formatDistanceToNow } from "date-fns";
import {
  Globe, Radio, Rss, Zap, Plus, Trash2, ToggleLeft, ToggleRight,
  Copy, Check, CheckCircle2, XCircle, Clock, RefreshCw, ExternalLink,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type Platform = {
  id: number;
  platform: "mastodon" | "twitter" | "threads";
  label: string;
  config: Record<string, string | boolean>;
  enabled: boolean;
  createdAt: string;
};

type SyndicationLogEntry = {
  id: number;
  post_uri: string;
  platform: string;
  status: "success" | "failed" | "pending";
  external_id: string | null;
  error: string | null;
  created_at: string;
};

type AmplifyItem = {
  id: number;
  post_uri: string;
  post_text: string;
  amplify_at: string;
  status: "pending" | "done" | "failed";
  done_at: string | null;
  error: string | null;
  created_at: string;
};

// ─── Platform metadata ────────────────────────────────────────────────────────

const PLATFORM_META: Record<string, {
  label: string;
  color: string;
  fields: { key: string; label: string; placeholder: string; type?: string }[];
}> = {
  mastodon: {
    label: "Mastodon",
    color: "hsl(264 89% 55%)",
    fields: [
      { key: "instanceUrl", label: "Instance URL", placeholder: "https://mastodon.social" },
      { key: "accessToken", label: "Access Token", placeholder: "Your Mastodon access token", type: "password" },
    ],
  },
  twitter: {
    label: "Twitter / X",
    color: "hsl(0 0% 10%)",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "Consumer Key", type: "password" },
      { key: "apiKeySecret", label: "API Key Secret", placeholder: "Consumer Secret", type: "password" },
      { key: "twitterAccessToken", label: "Access Token", placeholder: "OAuth Access Token", type: "password" },
      { key: "twitterAccessTokenSecret", label: "Access Token Secret", placeholder: "OAuth Token Secret", type: "password" },
    ],
  },
  threads: {
    label: "Threads",
    color: "hsl(330 70% 45%)",
    fields: [
      { key: "threadsUserId", label: "User ID", placeholder: "Your Threads numeric user ID" },
      { key: "threadsAccessToken", label: "Access Token", placeholder: "Meta Graph API long-lived access token", type: "password" },
    ],
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function postUriToUrl(uri: string): string {
  const match = uri.match(/^at:\/\/(did:[^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/);
  if (match) return `https://bsky.app/profile/${match[1]}/post/${match[2]}`;
  return "https://bsky.app";
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); }}
      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors flex-shrink-0"
      title="Copy URL"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

// ─── Add Platform Form ────────────────────────────────────────────────────────

function AddPlatformForm({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [platform, setPlatform] = useState<"mastodon" | "twitter" | "threads">("mastodon");
  const [label, setLabel] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const meta = PLATFORM_META[platform];

  async function handleSubmit() {
    if (!label.trim()) { toast({ title: "Display name is required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      await customFetch("/api/syndication/platforms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, label: label.trim(), config: fields }),
      });
      await qc.invalidateQueries({ queryKey: ["syndication-platforms"] });
      toast({ title: `${meta.label} connected` });
      onDone();
    } catch {
      toast({ title: "Failed to add platform", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">Connect a Platform</span>
        <button onClick={onDone} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
      </div>
      <div className="flex gap-2">
        {(["mastodon", "twitter", "threads"] as const).map((p) => (
          <button
            key={p}
            onClick={() => { setPlatform(p); setFields({}); setLabel(""); }}
            className={cn(
              "flex-1 py-1.5 rounded-lg border text-xs font-medium transition-colors",
              platform === p ? "border-primary/40 bg-primary/8 text-primary" : "border-border text-muted-foreground hover:bg-muted/50",
            )}
          >
            {PLATFORM_META[p].label}
          </button>
        ))}
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">Display Name</label>
        <Input value={label} onChange={e => setLabel(e.target.value)} placeholder={`My ${meta.label}`} className="h-8 text-xs" />
      </div>
      {meta.fields.map((f) => (
        <div key={f.key}>
          <label className="text-xs font-medium text-muted-foreground block mb-1">{f.label}</label>
          <Input
            type={f.type ?? "text"}
            value={fields[f.key] ?? ""}
            onChange={e => setFields(prev => ({ ...prev, [f.key]: e.target.value }))}
            placeholder={f.placeholder}
            className="h-8 text-xs"
          />
        </div>
      ))}
      {platform === "twitter" && (
        <p className="text-[11px] text-amber-500/80 bg-amber-500/8 border border-amber-500/20 rounded-lg px-3 py-2 leading-relaxed">
          Requires a Twitter Developer App with OAuth 1.0a credentials. Free tier: 500 posts/month.
        </p>
      )}
      {platform === "threads" && (
        <p className="text-[11px] text-amber-500/80 bg-amber-500/8 border border-amber-500/20 rounded-lg px-3 py-2 leading-relaxed">
          Requires Meta Threads API access. Get your User ID and long-lived token from Meta for Developers.
        </p>
      )}
      <Button onClick={handleSubmit} disabled={saving} size="sm" className="w-full h-8 text-xs gap-1.5">
        {saving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
        {saving ? "Saving…" : `Connect ${meta.label}`}
      </Button>
    </motion.div>
  );
}

// ─── Platform Card ────────────────────────────────────────────────────────────

function PlatformCard({ platform, onDelete, onToggle }: { platform: Platform; onDelete: () => void; onToggle: () => void }) {
  const meta = PLATFORM_META[platform.platform] ?? { label: platform.platform, color: "hsl(0 0% 50%)", fields: [] };
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40 last:border-0">
      <div className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center text-white text-xs font-bold"
        style={{ background: meta.color }}>
        {meta.label[0]}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-foreground truncate">{platform.label}</div>
        <div className="text-[11px] text-muted-foreground">{meta.label}</div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={cn(
          "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
          platform.enabled ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground",
        )}>
          {platform.enabled ? "ON" : "OFF"}
        </span>
        <button onClick={onToggle} className="text-muted-foreground hover:text-foreground transition-colors">
          {platform.enabled ? <ToggleRight className="w-5 h-5 text-emerald-500" /> : <ToggleLeft className="w-5 h-5" />}
        </button>
        <button onClick={onDelete} className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/8 transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── RSS Section ──────────────────────────────────────────────────────────────

function RssSection() {
  const { data: feedsData } = useListFeeds();
  const feeds = feedsData ?? [];
  const workerUrl = getBaseUrl() ?? window.location.origin;

  if (feeds.length === 0) return (
    <div className="flex flex-col items-center justify-center h-32 gap-2">
      <Rss className="w-8 h-8 text-muted-foreground/20" />
      <p className="text-sm text-muted-foreground">No feeds created yet</p>
    </div>
  );

  return (
    <div className="divide-y divide-border/40">
      {feeds.map((feed) => {
        const rssUrl = `${workerUrl}/api/feeds/${feed.id}/rss`;
        return (
          <div key={feed.id} className="px-4 py-3 flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center flex-shrink-0">
              <Rss className="w-3.5 h-3.5 text-orange-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-foreground truncate">{feed.displayName}</div>
              <div className="text-[11px] text-muted-foreground font-mono truncate">{rssUrl}</div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <CopyButton text={rssUrl} />
              <a href={rssUrl} target="_blank" rel="noreferrer"
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors">
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        );
      })}
      <div className="px-4 py-3 bg-muted/5">
        <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
          Share these RSS URLs with Feedly, Reeder, Zapier, IFTTT, or email newsletter services to distribute your feed globally.
        </p>
      </div>
    </div>
  );
}

// ─── Syndication Log ──────────────────────────────────────────────────────────

function SyndicationLog() {
  const { data, isLoading } = useQuery<{ log: SyndicationLogEntry[] }>({
    queryKey: ["syndication-log"],
    queryFn: () => customFetch("/api/syndication/log?limit=20"),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const log = data?.log ?? [];

  if (isLoading) return <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-8 rounded bg-muted animate-pulse" />)}</div>;
  if (log.length === 0) return (
    <div className="flex flex-col items-center justify-center h-28 gap-2">
      <Radio className="w-7 h-7 text-muted-foreground/20" />
      <p className="text-sm text-muted-foreground">No cross-posts yet — compose a post to start</p>
    </div>
  );

  return (
    <div className="divide-y divide-border/40">
      {log.map((entry) => (
        <div key={entry.id} className="px-4 py-2.5 flex items-center gap-3">
          {entry.status === "success"
            ? <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
            : entry.status === "failed"
            ? <XCircle className="w-4 h-4 text-destructive flex-shrink-0" />
            : <Clock className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-foreground capitalize">{PLATFORM_META[entry.platform]?.label ?? entry.platform}</span>
              {entry.error && <span className="text-[10px] text-destructive truncate max-w-48">{entry.error}</span>}
            </div>
            <span className="text-[11px] text-muted-foreground">{formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}</span>
          </div>
          <a href={postUriToUrl(entry.post_uri)} target="_blank" rel="noreferrer"
            className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      ))}
    </div>
  );
}

// ─── Amplification Queue ──────────────────────────────────────────────────────

function AmplificationSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [postUri, setPostUri] = useState("");
  const [postCid, setPostCid] = useState("");
  const [postText, setPostText] = useState("");
  const [amplifyAt, setAmplifyAt] = useState("");

  const { data, isLoading } = useQuery<{ queue: AmplifyItem[] }>({
    queryKey: ["amplify-queue"],
    queryFn: () => customFetch("/api/syndication/amplify"),
    staleTime: 30_000,
  });
  const queue = data?.queue ?? [];

  const add = useMutation({
    mutationFn: (body: object) => customFetch("/api/syndication/amplify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["amplify-queue"] });
      toast({ title: "Repost scheduled!" });
      setShowForm(false);
      setPostUri(""); setPostCid(""); setPostText(""); setAmplifyAt("");
    },
    onError: () => toast({ title: "Failed to schedule repost", variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => customFetch(`/api/syndication/amplify/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["amplify-queue"] }),
  });

  function getDefaultTime() {
    const d = new Date(Date.now() + 4 * 3600 * 1000);
    return d.toISOString().slice(0, 16);
  }

  return (
    <div>
      {isLoading ? (
        <div className="p-4 space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-8 rounded bg-muted animate-pulse" />)}</div>
      ) : queue.length === 0 && !showForm ? (
        <div className="flex flex-col items-center justify-center h-24 gap-2">
          <Zap className="w-7 h-7 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground">No reposts scheduled</p>
        </div>
      ) : (
        <div className="divide-y divide-border/40">
          {queue.map((item) => (
            <div key={item.id} className="px-4 py-2.5 flex items-center gap-3">
              {item.status === "done"
                ? <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                : item.status === "failed"
                ? <XCircle className="w-4 h-4 text-destructive flex-shrink-0" />
                : <Clock className="w-4 h-4 text-amber-500 flex-shrink-0" />}
              <div className="flex-1 min-w-0">
                {item.post_text && <p className="text-xs text-foreground truncate">{item.post_text.slice(0, 80)}</p>}
                <span className="text-[11px] text-muted-foreground">
                  {item.status === "pending"
                    ? `Reposts ${format(new Date(item.amplify_at), "MMM d, h:mm a")}`
                    : item.status === "done" && item.done_at
                    ? `Reposted ${formatDistanceToNow(new Date(item.done_at), { addSuffix: true })}`
                    : `Failed: ${item.error?.slice(0, 60)}`}
                </span>
              </div>
              {item.status === "pending" && (
                <button onClick={() => remove.mutate(item.id)}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/8 transition-colors flex-shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="px-4 py-3 border-t border-border/50">
        {!showForm ? (
          <Button size="sm" variant="outline" className="w-full h-8 text-xs gap-1.5"
            onClick={() => { setShowForm(true); setAmplifyAt(getDefaultTime()); }}>
            <Zap className="w-3 h-3" /> Schedule a Repost
          </Button>
        ) : (
          <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Post URI</label>
              <Input value={postUri} onChange={e => setPostUri(e.target.value)}
                placeholder="at://did:plc:xxx/app.bsky.feed.post/rkey" className="h-8 text-xs font-mono" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Post CID</label>
              <Input value={postCid} onChange={e => setPostCid(e.target.value)}
                placeholder="bafyreia..." className="h-8 text-xs font-mono" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Post Text <span className="text-muted-foreground/50">(optional)</span></label>
              <Input value={postText} onChange={e => setPostText(e.target.value)}
                placeholder="What the post says…" className="h-8 text-xs" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Repost At</label>
              <Input type="datetime-local" value={amplifyAt} onChange={e => setAmplifyAt(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1 h-8 text-xs gap-1"
                onClick={() => add.mutate({ postUri, postCid, postText, amplifyAt })}
                disabled={!postUri || !postCid || !amplifyAt || add.isPending}>
                {add.isPending ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                {add.isPending ? "Scheduling…" : "Schedule"}
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Reach() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showAddPlatform, setShowAddPlatform] = useState(false);

  const { data: platformsData, isLoading: loadingPlatforms } = useQuery<{ platforms: Platform[] }>({
    queryKey: ["syndication-platforms"],
    queryFn: () => customFetch("/api/syndication/platforms"),
    staleTime: 30_000,
  });
  const platforms = platformsData?.platforms ?? [];

  const deletePlatform = useMutation({
    mutationFn: (id: number) => customFetch(`/api/syndication/platforms/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["syndication-platforms"] }); toast({ title: "Platform removed" }); },
  });

  const togglePlatform = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      customFetch(`/api/syndication/platforms/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["syndication-platforms"] }),
  });

  const enabledCount = platforms.filter((p) => p.enabled).length;

  return (
    <div className="px-4 py-5 md:px-8 md:py-8 max-w-5xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
            <Globe className="w-4 h-4 text-primary" />
          </div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">Global Reach</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Cross-post to multiple platforms, distribute via RSS, and amplify posts at peak hours.
        </p>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="space-y-5">
          {/* Platform Syndication */}
          <motion.section initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 }}>
            <div className="bg-card border border-card-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between bg-muted/10">
                <div className="flex items-center gap-2">
                  <Radio className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold text-foreground">Platform Syndication</span>
                  {enabledCount > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 font-medium">{enabledCount} active</span>
                  )}
                </div>
                {!showAddPlatform && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowAddPlatform(true)}>
                    <Plus className="w-3 h-3" /> Connect
                  </Button>
                )}
              </div>
              {showAddPlatform && (
                <div className="p-4 border-b border-border/50">
                  <AddPlatformForm onDone={() => setShowAddPlatform(false)} />
                </div>
              )}
              {loadingPlatforms ? (
                <div className="p-4 space-y-2">{Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-12 rounded bg-muted animate-pulse" />)}</div>
              ) : platforms.length === 0 && !showAddPlatform ? (
                <div className="flex flex-col items-center justify-center h-36 gap-3 px-6 text-center">
                  <Globe className="w-9 h-9 text-muted-foreground/20" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">No platforms connected</p>
                    <p className="text-xs text-muted-foreground mt-1">Connect Mastodon, Twitter/X, or Threads to auto cross-post whenever you compose on Bluesky.</p>
                  </div>
                </div>
              ) : (
                platforms.map((p) => (
                  <PlatformCard
                    key={p.id}
                    platform={p}
                    onDelete={() => deletePlatform.mutate(p.id)}
                    onToggle={() => togglePlatform.mutate({ id: p.id, enabled: !p.enabled })}
                  />
                ))
              )}
              <div className="px-4 py-3 border-t border-border/50 bg-muted/5">
                <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                  Posts are automatically cross-posted when you use Compose → Post Now.
                </p>
              </div>
            </div>
          </motion.section>

          {/* Cross-post History */}
          <motion.section initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
            <div className="bg-card border border-card-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border/50 flex items-center gap-2 bg-muted/10">
                <CheckCircle2 className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-semibold text-foreground">Cross-post History</span>
              </div>
              <SyndicationLog />
            </div>
          </motion.section>
        </div>

        <div className="space-y-5">
          {/* RSS / Global Distribution */}
          <motion.section initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }}>
            <div className="bg-card border border-card-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border/50 flex items-center gap-2 bg-muted/10">
                <Rss className="w-4 h-4 text-orange-500" />
                <span className="text-sm font-semibold text-foreground">RSS / Global Distribution</span>
              </div>
              <RssSection />
            </div>
          </motion.section>

          {/* Amplification */}
          <motion.section initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.10 }}>
            <div className="bg-card border border-card-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border/50 flex items-center gap-2 bg-muted/10">
                <Zap className="w-4 h-4 text-yellow-500" />
                <span className="text-sm font-semibold text-foreground">Bluesky Amplification</span>
                <span className="text-[10px] text-muted-foreground ml-auto">Schedule reposts</span>
              </div>
              <AmplificationSection />
            </div>
          </motion.section>

          {/* How it works */}
          <motion.section initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
            <div className="bg-card border border-card-border rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-muted-foreground" /> How it works
              </h3>
              <div className="space-y-2.5">
                {[
                  { icon: Radio, label: "Auto-syndication", desc: "Every post you compose is simultaneously sent to all active platforms." },
                  { icon: Rss, label: "RSS subscription", desc: "Anyone with an RSS reader can follow your feed. Works with Zapier, IFTTT, and email newsletters." },
                  { icon: Zap, label: "Amplification", desc: "Schedule reposts of your own content at different times to reach audiences in other time zones." },
                ].map(({ icon: Icon, label, desc }) => (
                  <div key={label} className="flex items-start gap-2.5">
                    <div className="w-6 h-6 rounded-md bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Icon className="w-3 h-3 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="text-xs font-medium text-foreground">{label}</div>
                      <div className="text-[11px] text-muted-foreground/70 leading-relaxed mt-0.5">{desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.section>
        </div>
      </div>
    </div>
  );
}
