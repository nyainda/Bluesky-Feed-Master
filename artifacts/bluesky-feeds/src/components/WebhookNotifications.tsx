import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell, BellOff, Plus, Trash2, CheckCircle, XCircle, Loader2,
  Webhook, ChevronDown, ChevronUp, AlertTriangle, Zap, Activity,
  Clock, ExternalLink,
} from "lucide-react";
import { useListFeeds, useGetFirehoseStatus, useGetTopFeeds } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type WebhookFormat = "discord" | "slack" | "generic";

type FeedRule = {
  feedId: string;
  feedName: string;
  threshold: number;
  direction: "above" | "below";
};

type WebhookConfig = {
  id: string;
  url: string;
  format: WebhookFormat;
  label: string;
  enabled: boolean;
  firehoseAlert: boolean;
  feedRules: FeedRule[];
};

type NotificationEntry = {
  id: string;
  ts: number;
  webhookLabel: string;
  message: string;
  ok: boolean;
};

const STORAGE_KEY = "feedforge:webhooks:v1";
const HISTORY_KEY = "feedforge:webhook-history:v1";
const MAX_HISTORY = 50;

function loadWebhooks(): WebhookConfig[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveWebhooks(configs: WebhookConfig[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
}

function loadHistory(): NotificationEntry[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveHistory(entries: NotificationEntry[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)));
}

function buildPayload(format: WebhookFormat, message: string, label: string) {
  if (format === "discord") {
    return JSON.stringify({
      username: "FeedForge",
      embeds: [{
        title: "🔔 FeedForge Alert",
        description: message,
        color: 0x6366f1,
        footer: { text: label },
        timestamp: new Date().toISOString(),
      }],
    });
  }
  if (format === "slack") {
    return JSON.stringify({
      text: `*FeedForge Alert* — ${message}`,
    });
  }
  return JSON.stringify({
    source: "feedforge",
    webhook: label,
    message,
    timestamp: new Date().toISOString(),
  });
}

function formatRelative(ts: number) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function WebhookRow({
  config,
  feeds,
  onUpdate,
  onDelete,
  onTest,
  testing,
}: {
  config: WebhookConfig;
  feeds: { id: string; name: string }[];
  onUpdate: (updated: WebhookConfig) => void;
  onDelete: () => void;
  onTest: () => void;
  testing: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [urlDraft, setUrlDraft] = useState(config.url);
  const [labelDraft, setLabelDraft] = useState(config.label);

  function save() {
    onUpdate({ ...config, url: urlDraft.trim(), label: labelDraft.trim() || "Webhook" });
  }

  function addRule() {
    if (feeds.length === 0) return;
    const f = feeds[0];
    onUpdate({
      ...config,
      feedRules: [...config.feedRules, {
        feedId: f.id,
        feedName: f.name,
        threshold: 1000,
        direction: "above",
      }],
    });
  }

  function removeRule(i: number) {
    const rules = [...config.feedRules];
    rules.splice(i, 1);
    onUpdate({ ...config, feedRules: rules });
  }

  function updateRule(i: number, patch: Partial<FeedRule>) {
    const rules = config.feedRules.map((r, idx) => idx === i ? { ...r, ...patch } : r);
    onUpdate({ ...config, feedRules: rules });
  }

  return (
    <div className={cn(
      "border rounded-xl overflow-hidden transition-colors",
      config.enabled ? "border-primary/20 bg-primary/2" : "border-border bg-card",
    )}>
      <div className="flex items-center gap-3 px-4 py-3">
        <div className={cn(
          "w-2 h-2 rounded-full flex-shrink-0",
          config.enabled ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/30",
        )} />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-foreground truncate block">{config.label || "Webhook"}</span>
          <span className="text-[11px] text-muted-foreground font-mono truncate block">
            {config.url || "No URL set"}
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs px-2 gap-1"
            onClick={onTest}
            disabled={testing || !config.url}
            title="Send a test notification"
          >
            {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            <span className="hidden sm:inline">Test</span>
          </Button>
          <button
            onClick={() => onUpdate({ ...config, enabled: !config.enabled })}
            className={cn(
              "p-1.5 rounded-lg transition-colors",
              config.enabled
                ? "text-emerald-600 bg-emerald-500/8 hover:bg-emerald-500/15"
                : "text-muted-foreground hover:bg-muted/60",
            )}
            title={config.enabled ? "Disable" : "Enable"}
          >
            {config.enabled ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => setExpanded(e => !e)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-500/8 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-border"
          >
            <div className="px-4 py-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-medium text-foreground mb-1.5 block">Label</label>
                  <Input
                    value={labelDraft}
                    onChange={e => setLabelDraft(e.target.value)}
                    onBlur={save}
                    placeholder="My Discord server"
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-foreground mb-1.5 block">Format</label>
                  <select
                    value={config.format}
                    onChange={e => onUpdate({ ...config, format: e.target.value as WebhookFormat })}
                    className="w-full h-8 text-xs rounded-lg border border-input bg-background px-2.5 text-foreground"
                  >
                    <option value="discord">Discord</option>
                    <option value="slack">Slack</option>
                    <option value="generic">Generic JSON</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-foreground mb-1.5 block">Webhook URL</label>
                <Input
                  value={urlDraft}
                  onChange={e => setUrlDraft(e.target.value)}
                  onBlur={save}
                  placeholder="https://discord.com/api/webhooks/..."
                  className="h-8 text-xs font-mono"
                />
              </div>

              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.firehoseAlert}
                    onChange={e => onUpdate({ ...config, firehoseAlert: e.target.checked })}
                    className="accent-primary"
                  />
                  <span className="text-xs text-foreground font-medium">Alert when firehose indexer goes offline</span>
                </label>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-foreground">Feed post-count alerts</span>
                  <Button size="sm" variant="outline" className="h-6 text-[11px] gap-1 px-2" onClick={addRule}>
                    <Plus className="w-3 h-3" /> Add rule
                  </Button>
                </div>
                {config.feedRules.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">No rules — click Add rule to notify when a feed crosses a threshold.</p>
                ) : (
                  <div className="space-y-2">
                    {config.feedRules.map((rule, i) => (
                      <div key={i} className="flex items-center gap-2 flex-wrap">
                        <select
                          value={rule.feedId}
                          onChange={e => {
                            const f = feeds.find(f => f.id === e.target.value);
                            if (f) updateRule(i, { feedId: f.id, feedName: f.name });
                          }}
                          className="h-7 text-xs rounded-lg border border-input bg-background px-2 text-foreground flex-1 min-w-0"
                        >
                          {feeds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                        <select
                          value={rule.direction}
                          onChange={e => updateRule(i, { direction: e.target.value as "above" | "below" })}
                          className="h-7 text-xs rounded-lg border border-input bg-background px-2 text-foreground w-24"
                        >
                          <option value="above">exceeds</option>
                          <option value="below">drops below</option>
                        </select>
                        <input
                          type="number"
                          min={0}
                          value={rule.threshold}
                          onChange={e => updateRule(i, { threshold: parseInt(e.target.value) || 0 })}
                          className="h-7 text-xs rounded-lg border border-input bg-background px-2 text-foreground w-20 font-mono"
                        />
                        <span className="text-[11px] text-muted-foreground">posts</span>
                        <button onClick={() => removeRule(i)} className="p-1 rounded text-muted-foreground hover:text-red-500 transition-colors">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function WebhookNotifications() {
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>(() => loadWebhooks());
  const [history, setHistory] = useState<NotificationEntry[]>(() => loadHistory());
  const [testingId, setTestingId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const { data: feedsData } = useListFeeds({ query: { staleTime: 60_000, queryKey: ["webhook-feeds"] } });
  const { data: firehose } = useGetFirehoseStatus({ query: { refetchInterval: 30_000, queryKey: ["webhook-firehose"] } });
  const { data: topFeeds } = useGetTopFeeds({ query: { refetchInterval: 60_000, queryKey: ["webhook-top-feeds"] } });

  const feeds = (feedsData ?? []).map(f => ({ id: String(f.id), name: f.displayName }));

  const firehoseOfflineRef = useRef(false);
  const firedRulesRef = useRef<Set<string>>(new Set());

  const addHistory = useCallback((entry: Omit<NotificationEntry, "id">) => {
    const newEntry: NotificationEntry = { ...entry, id: `${Date.now()}-${Math.random()}` };
    setHistory(prev => {
      const next = [newEntry, ...prev].slice(0, MAX_HISTORY);
      saveHistory(next);
      return next;
    });
  }, []);

  const fireWebhook = useCallback(async (config: WebhookConfig, message: string): Promise<boolean> => {
    if (!config.url) return false;
    try {
      const res = await fetch(config.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: buildPayload(config.format, message, config.label),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    saveWebhooks(webhooks);
  }, [webhooks]);

  useEffect(() => {
    const enabledWebhooks = webhooks.filter(w => w.enabled && w.url);
    if (enabledWebhooks.length === 0) return;

    const isOffline = firehose ? !firehose.connected : false;
    const wasOffline = firehoseOfflineRef.current;

    if (isOffline && !wasOffline) {
      firehoseOfflineRef.current = true;
      for (const wh of enabledWebhooks) {
        if (!wh.firehoseAlert) continue;
        const msg = "⚠️ Firehose indexer is offline — posts are no longer being indexed in real time.";
        fireWebhook(wh, msg).then(ok => {
          addHistory({ ts: Date.now(), webhookLabel: wh.label, message: msg, ok });
        });
      }
    } else if (!isOffline) {
      firehoseOfflineRef.current = false;
    }
  }, [firehose, webhooks, fireWebhook, addHistory]);

  useEffect(() => {
    const enabledWebhooks = webhooks.filter(w => w.enabled && w.url);
    if (enabledWebhooks.length === 0 || !topFeeds) return;

    const feedPostCounts: Record<string, number> = {};
    for (const f of topFeeds) {
      feedPostCounts[String(f.feedId)] = f.postCount;
    }

    for (const wh of enabledWebhooks) {
      for (const rule of wh.feedRules) {
        const count = feedPostCounts[rule.feedId];
        if (count === undefined) continue;

        const key = `${wh.id}:${rule.feedId}:${rule.direction}:${rule.threshold}`;
        const alreadyFired = firedRulesRef.current.has(key);
        const triggered = rule.direction === "above" ? count > rule.threshold : count < rule.threshold;

        if (triggered && !alreadyFired) {
          firedRulesRef.current.add(key);
          const dirLabel = rule.direction === "above" ? "exceeded" : "dropped below";
          const msg = `📊 Feed "${rule.feedName}" post count ${dirLabel} ${rule.threshold.toLocaleString()} — currently at ${count.toLocaleString()} posts.`;
          fireWebhook(wh, msg).then(ok => {
            addHistory({ ts: Date.now(), webhookLabel: wh.label, message: msg, ok });
          });
        } else if (!triggered) {
          firedRulesRef.current.delete(key);
        }
      }
    }
  }, [topFeeds, webhooks, fireWebhook, addHistory]);

  function addWebhook() {
    const newWh: WebhookConfig = {
      id: `wh-${Date.now()}`,
      url: "",
      format: "discord",
      label: `Webhook ${webhooks.length + 1}`,
      enabled: false,
      firehoseAlert: true,
      feedRules: [],
    };
    setWebhooks(prev => [...prev, newWh]);
  }

  function updateWebhook(id: string, updated: WebhookConfig) {
    setWebhooks(prev => prev.map(w => w.id === id ? updated : w));
  }

  function deleteWebhook(id: string) {
    setWebhooks(prev => prev.filter(w => w.id !== id));
  }

  async function testWebhook(config: WebhookConfig) {
    setTestingId(config.id);
    const msg = "✅ This is a test notification from FeedForge — your webhook is connected!";
    const ok = await fireWebhook(config, msg);
    addHistory({ ts: Date.now(), webhookLabel: config.label, message: msg, ok });
    setTestingId(null);
  }

  const activeCount = webhooks.filter(w => w.enabled && w.url).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 }}
      className="bg-card border border-card-border rounded-xl overflow-hidden mb-4"
    >
      <div className="flex items-center gap-2.5 px-5 md:px-6 py-4 border-b border-border">
        <div className="w-7 h-7 rounded-lg bg-primary/8 border border-primary/12 flex items-center justify-center flex-shrink-0">
          <Webhook className="w-3.5 h-3.5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-foreground">Webhook Notifications</h2>
          <p className="text-[11px] text-muted-foreground">
            Get alerted in Discord, Slack, or any service when feeds hit thresholds or the indexer goes offline.
          </p>
        </div>
        {activeCount > 0 && (
          <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-500/8 border border-emerald-500/20 px-2.5 py-1 rounded-full flex-shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {activeCount} active
          </span>
        )}
      </div>

      <div className="px-5 md:px-6 py-5 space-y-3">
        {webhooks.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="w-10 h-10 rounded-2xl bg-muted border border-border flex items-center justify-center">
              <Bell className="w-4.5 h-4.5 text-muted-foreground/40" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">No webhooks configured</p>
              <p className="text-xs text-muted-foreground mt-1">Add one to get notified in Discord or Slack.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {webhooks.map(wh => (
              <WebhookRow
                key={wh.id}
                config={wh}
                feeds={feeds}
                onUpdate={updated => updateWebhook(wh.id, updated)}
                onDelete={() => deleteWebhook(wh.id)}
                onTest={() => testWebhook(wh)}
                testing={testingId === wh.id}
              />
            ))}
          </div>
        )}

        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 text-xs"
          onClick={addWebhook}
        >
          <Plus className="w-3.5 h-3.5" /> Add Webhook
        </Button>

        {history.length > 0 && (
          <div className="pt-2 border-t border-border/50">
            <button
              onClick={() => setShowHistory(v => !v)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Notification history ({history.length})</span>
              {showHistory ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
            </button>
            <AnimatePresence>
              {showHistory && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mt-2 space-y-1.5 max-h-56 overflow-y-auto pr-1">
                    {history.map(entry => (
                      <div key={entry.id} className="flex items-start gap-2 py-1.5 px-2.5 rounded-lg bg-muted/30 border border-border/40">
                        {entry.ok
                          ? <CheckCircle className="w-3 h-3 text-emerald-500 flex-shrink-0 mt-0.5" />
                          : <XCircle className="w-3 h-3 text-red-400 flex-shrink-0 mt-0.5" />}
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] text-foreground leading-snug">{entry.message}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {entry.webhookLabel} · {formatRelative(entry.ts)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => { setHistory([]); saveHistory([]); }}
                    className="text-[11px] text-muted-foreground hover:text-red-400 mt-2 transition-colors"
                  >
                    Clear history
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        <div className="bg-muted/40 border border-border rounded-lg px-3 py-2.5 flex gap-2 items-start">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Webhooks fire from your browser while the dashboard is open. For 24/7 alerts, keep a tab open or deploy to Cloudflare Workers.{" "}
            <a href="https://support.discord.com/hc/en-us/articles/228383668" target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">
              Discord setup <ExternalLink className="w-2.5 h-2.5" />
            </a>
          </p>
        </div>
      </div>
    </motion.div>
  );
}
