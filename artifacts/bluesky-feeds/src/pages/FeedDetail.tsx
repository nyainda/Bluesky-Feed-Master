import { useState, useRef, useEffect } from "react";
import { useParams, Link } from "wouter";
import {
  useGetFeed, useGetFeedKeywords, useGetFeedPosts,
  useAddFeedKeyword, useDeleteFeedKeyword, usePublishFeed,
  useGetFeedKeywordStats, useGetFeedTopAuthors, useGetFeedHourly, useGetBlueskyFeedInfo,
  getGetFeedQueryKey, getGetFeedKeywordsQueryKey, getGetFeedPostsQueryKey, getListFeedsQueryKey,
  customFetch,
  GetFeedPostsMode,
} from "@workspace/api-client-react";
import type { Keyword } from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Tag, X, Plus, ArrowLeft, ExternalLink, ChevronRight, ChevronLeft,
  Upload, CheckCircle, AlertTriangle, BarChart3, FileText, Hash,
  Users, Heart, TrendingUp, Play, RefreshCw, Rss, ArrowUpRight,
  Repeat2, MessageCircle, Image, Zap, Trophy, Clock,
  Sparkles, ToggleLeft, ToggleRight, Loader2, Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow, format } from "date-fns";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import { cn } from "@/lib/utils";

const COLORS = [
  "hsl(210 100% 58%)",
  "hsl(199 89% 48%)",
  "hsl(168 84% 39%)",
  "hsl(262 83% 58%)",
  "hsl(338 75% 55%)",
  "hsl(43 96% 56%)",
  "hsl(20 90% 55%)",
];

function shortenDid(did: string) {
  if (did.length <= 20) return did;
  return did.substring(0, 14) + "…" + did.substring(did.length - 6);
}

type BskyProfile = { handle: string; displayName?: string; avatar?: string };
const bskyProfileCache = new Map<string, BskyProfile>();

async function resolveProfiles(dids: string[]): Promise<Map<string, BskyProfile>> {
  const unresolved = dids.filter(d => !bskyProfileCache.has(d));
  for (let i = 0; i < unresolved.length; i += 25) {
    const chunk = unresolved.slice(i, i + 25);
    const qs = chunk.map(d => `actors=${encodeURIComponent(d)}`).join("&");
    try {
      const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfiles?${qs}`);
      if (res.ok) {
        const data = await res.json() as { profiles: Array<{ did: string; handle: string; displayName?: string; avatar?: string }> };
        for (const p of data.profiles ?? []) {
          bskyProfileCache.set(p.did, { handle: p.handle, displayName: p.displayName, avatar: p.avatar });
        }
      }
    } catch { /* ignore */ }
  }
  const result = new Map<string, BskyProfile>();
  for (const did of dids) {
    const cached = bskyProfileCache.get(did);
    if (cached) result.set(did, cached);
  }
  return result;
}

function PostAuthorAvatar({ profile, did }: { profile?: BskyProfile; did: string }) {
  const initials = (profile?.displayName ?? profile?.handle ?? did)?.[0]?.toUpperCase() ?? "?";
  if (profile?.avatar) {
    return (
      <img
        src={profile.avatar}
        alt={profile.handle}
        className="w-8 h-8 rounded-full flex-shrink-0 ring-1 ring-border object-cover"
      />
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/15 flex items-center justify-center flex-shrink-0">
      <span className="text-xs font-bold text-primary">{initials}</span>
    </div>
  );
}
function formatHour(iso: string) {
  try { return format(new Date(iso), "HH:mm"); } catch { return iso; }
}
function postIdFromUri(uri: string) { return uri.split("/").pop() ?? ""; }

function tooltipStyle() {
  return {
    contentStyle: {
      background: "hsl(240 8% 6%)",
      border: "1px solid hsl(240 4% 14%)",
      borderRadius: "10px",
      fontSize: "11px",
      color: "hsl(0 0% 97%)",
      padding: "8px 12px",
    },
    cursor: { stroke: "hsl(210 100% 62% / .2)", strokeWidth: 1 },
  };
}

type TabType = "posts" | "test" | "analytics" | "keywords";

// ─── Live Feed Tester ─────────────────────────────────────────────────────────

type SkeletonPost = { post: string };
type ResolvedPost = {
  uri: string;
  text: string;
  author: { did: string; handle: string; displayName?: string; avatar?: string };
  likeCount: number;
  repostCount: number;
  replyCount: number;
  indexedAt: string;
  createdAt: string;
};

function LiveFeedTester({ recordName, publishedAt }: { recordName: string; publishedAt: string | null }) {
  const [running, setRunning] = useState(false);
  const [skeleton, setSkeleton] = useState<SkeletonPost[] | null>(null);
  const [resolved, setResolved] = useState<ResolvedPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const publisherDid = "did:plc:oobxeg4vljlqpp62k7fd6flp";

  async function runTest() {
    setRunning(true);
    setError(null);
    setSkeleton(null);
    setResolved(null);
    try {
      const feedUri = `at://${publisherDid}/app.bsky.feed.generator/${recordName}`;
      const skeletonResult = await customFetch<{ feed: SkeletonPost[]; cursor?: string }>(
        `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=10`,
      );
      setSkeleton(skeletonResult.feed);

      if (skeletonResult.feed.length > 0) {
        const uris = skeletonResult.feed.slice(0, 10).map(p => p.post);
        const params = uris.map(u => `uris[]=${encodeURIComponent(u)}`).join("&");
        const r = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?${params}`);
        const postsData = await r.json() as { posts: Array<{
          uri: string; indexedAt: string; likeCount?: number; repostCount?: number; replyCount?: number;
          record: { text?: string; createdAt?: string };
          author: { did: string; handle: string; displayName?: string; avatar?: string };
        }> };
        setResolved(postsData.posts.map(p => ({
          uri: p.uri,
          text: p.record.text ?? "",
          author: { did: p.author.did, handle: p.author.handle, displayName: p.author.displayName, avatar: p.author.avatar },
          likeCount: p.likeCount ?? 0,
          repostCount: p.repostCount ?? 0,
          replyCount: p.replyCount ?? 0,
          indexedAt: p.indexedAt,
          createdAt: p.record.createdAt ?? p.indexedAt,
        })));
      }
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message ?? "Unknown error");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-muted/10">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Live Feed Test</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Calls <code className="bg-muted px-1 py-0.5 rounded text-[10px] font-mono">getFeedSkeleton</code> exactly as the Bluesky app would, then resolves posts via the public API.
              </p>
            </div>
            <Button
              onClick={runTest}
              disabled={running}
              className="gap-2 flex-shrink-0"
              size="sm"
            >
              {running
                ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Testing…</>
                : <><Play className="w-3.5 h-3.5" />Run Test</>
              }
            </Button>
          </div>
        </div>

        {!skeleton && !error && !running && (
          <div className="flex flex-col items-center justify-center h-40 gap-3 text-center px-6">
            <div className="w-12 h-12 rounded-2xl bg-primary/8 border border-primary/15 flex items-center justify-center">
              <Rss className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Ready to test</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {publishedAt
                  ? "Feed is published — click Run Test to verify it's serving posts correctly."
                  : "This feed hasn't been published yet. Run Test to see if it has indexed posts locally."
                }
              </p>
            </div>
          </div>
        )}

        {running && (
          <div className="flex flex-col items-center justify-center h-40 gap-3">
            <div className="w-10 h-10 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
            <p className="text-sm text-muted-foreground">Calling getFeedSkeleton…</p>
          </div>
        )}

        {error && (
          <div className="p-5">
            <div className="flex items-start gap-3 p-4 bg-destructive/8 border border-destructive/20 rounded-xl">
              <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-destructive">Feed test failed</p>
                <p className="text-xs text-muted-foreground mt-0.5">{error}</p>
                <p className="text-xs text-muted-foreground mt-2">
                  Make sure the feed is active and has keywords with indexed posts.
                </p>
              </div>
            </div>
          </div>
        )}

        {skeleton && (
          <div>
            <div className="px-5 py-3 border-b border-border/50 flex items-center gap-3 bg-muted/10">
              <div className={cn(
                "flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full",
                skeleton.length > 0
                  ? "text-emerald-600 bg-emerald-500/8 border border-emerald-500/20"
                  : "text-amber-600 bg-amber-500/8 border border-amber-500/20",
              )}>
                <span className={cn("w-1.5 h-1.5 rounded-full", skeleton.length > 0 ? "bg-emerald-500" : "bg-amber-500")} />
                {skeleton.length > 0 ? `${skeleton.length} posts in skeleton` : "Empty skeleton — no indexed posts yet"}
              </div>
              {skeleton.length > 0 && resolved && (
                <span className="text-xs text-muted-foreground ml-auto">{resolved.length} resolved from Bluesky</span>
              )}
            </div>

            {skeleton.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-36 gap-2 text-center px-6">
                <p className="text-sm text-muted-foreground">
                  No posts indexed yet. Add keywords to the feed and wait for the indexer to run.
                </p>
                <Link href={`/feeds/${recordName}`}>
                  <span className="text-xs text-primary hover:underline cursor-pointer">Go to Keywords →</span>
                </Link>
              </div>
            ) : resolved ? (
              <div className="divide-y divide-border/50">
                {resolved.map((post, i) => (
                  <motion.div
                    key={post.uri}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="px-5 py-4 hover:bg-muted/20 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      {post.author.avatar ? (
                        <img src={post.author.avatar} alt={post.author.handle} className="w-8 h-8 rounded-full flex-shrink-0 ring-1 ring-border object-cover" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/15 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-primary">{(post.author.displayName || post.author.handle)[0].toUpperCase()}</span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <a
                            href={`https://bsky.app/profile/${post.author.handle}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs font-semibold text-foreground hover:text-primary transition-colors"
                          >
                            {post.author.displayName || post.author.handle}
                          </a>
                          <span className="text-[10px] text-muted-foreground/50">@{post.author.handle}</span>
                          <span className="text-muted-foreground/30 text-[10px]">·</span>
                          <span className="text-[10px] text-muted-foreground">
                            {formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}
                          </span>
                        </div>
                        <p className="text-sm text-foreground leading-relaxed line-clamp-3 mb-2">{post.text}</p>
                        <div className="flex items-center gap-3">
                          <span className="flex items-center gap-1 text-[11px] text-rose-500">
                            <Heart className="w-3 h-3" />{post.likeCount}
                          </span>
                          <span className="flex items-center gap-1 text-[11px] text-emerald-600">
                            <Repeat2 className="w-3 h-3" />{post.repostCount}
                          </span>
                          <span className="flex items-center gap-1 text-[11px] text-blue-500">
                            <MessageCircle className="w-3 h-3" />{post.replyCount}
                          </span>
                          <a
                            href={`https://bsky.app/profile/${post.author.did}/post/${postIdFromUri(post.uri)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-auto text-muted-foreground hover:text-primary transition-colors"
                          >
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="p-5 space-y-2">
                {skeleton.map((item, i) => (
                  <div key={i} className="text-xs font-mono bg-muted/50 px-3 py-2 rounded-lg border border-border/40 text-muted-foreground truncate">
                    {item.post}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* XRPC info */}
      <div className="bg-muted/30 border border-border rounded-xl p-4">
        <div className="text-xs text-muted-foreground space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">Feed URI:</span>
            <code className="font-mono text-[10px] break-all">
              at://{publisherDid}/app.bsky.feed.generator/{recordName}
            </code>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">Endpoint:</span>
            <code className="font-mono text-[10px]">/xrpc/app.bsky.feed.getFeedSkeleton</code>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Feed Avatar Editor ────────────────────────────────────────────────────────

const AVATAR_EMOJIS = [
  "🚀","✨","🌟","💡","🔥","⚡","🎯","💻","📱","🤖",
  "🧠","💎","🌈","🎨","📸","🎵","📰","🏆","🌍","🌱",
  "💬","📊","🔍","🛠️","👾","🦋","🎪","🔮","🎭","🌙",
];

function isAvatarEmoji(val: string | undefined): boolean {
  return Boolean(val && !val.startsWith("http") && !val.startsWith("data:"));
}

function AvatarPreview({ val, className }: { val?: string; className?: string }) {
  if (!val) return <Image className="w-5 h-5 text-muted-foreground/30" />;
  if (isAvatarEmoji(val)) return <span className="text-2xl leading-none select-none">{val}</span>;
  return <img src={val} alt="avatar" className={cn("w-full h-full object-cover", className)} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />;
}

async function resizeImageFile(file: File, maxPx = 128): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = maxPx; canvas.height = maxPx;
        const ctx = canvas.getContext("2d")!;
        const size = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - size) / 2, (img.height - size) / 2, size, size, 0, 0, maxPx, maxPx);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = reject;
      img.src = e.target!.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function FeedAvatarEditor({ feedId, avatarUrl, onSaved }: { feedId: number; avatarUrl?: string; onSaved: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"emoji" | "url" | "upload">("emoji");
  const [urlInput, setUrlInput] = useState(avatarUrl ?? "");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function save(value: string | null) {
    setSaving(true);
    try {
      await customFetch(`/api/feeds/${feedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: value || null }),
      });
      onSaved();
      setOpen(false);
      toast({ title: value ? "Feed image saved — click Re-publish to update Bluesky" : "Feed image removed" });
    } catch {
      toast({ title: "Failed to save image", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImageFile(file);
      await save(dataUrl);
    } catch {
      toast({ title: "Failed to process image", variant: "destructive" });
    } finally {
      e.target.value = "";
    }
  }

  const triggerBtn = (
    <button
      onClick={() => { setUrlInput(avatarUrl ?? ""); setOpen(true); }}
      title="Set feed image"
      className="w-14 h-14 rounded-xl bg-muted border border-border/60 overflow-hidden flex-shrink-0 group relative hover:border-primary/40 transition-all"
    >
      <div className="w-full h-full flex items-center justify-center">
        <AvatarPreview val={avatarUrl} />
      </div>
      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-xl">
        <span className="text-[9px] text-white font-medium">Edit</span>
      </div>
    </button>
  );

  return (
    <div className="flex-shrink-0 relative">
      {triggerBtn}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-[calc(100%+8px)] left-0 z-50 w-64 bg-background border border-border rounded-xl shadow-xl p-3">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-xs font-semibold text-foreground">Feed Image</span>
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {/* Tabs */}
            <div className="flex gap-1 mb-3 bg-muted rounded-lg p-0.5">
              {(["emoji", "url", "upload"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "flex-1 text-[10px] py-1 rounded-md capitalize font-medium transition-all",
                    tab === t
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t}
                </button>
              ))}
            </div>

            {tab === "emoji" && (
              <div className="space-y-2">
                <div className="grid grid-cols-6 gap-1">
                  {AVATAR_EMOJIS.map(emoji => (
                    <button
                      key={emoji}
                      onClick={() => save(emoji)}
                      disabled={saving}
                      className={cn(
                        "w-8 h-8 flex items-center justify-center text-lg rounded-lg transition-colors disabled:opacity-50",
                        avatarUrl === emoji ? "bg-primary/15 ring-1 ring-primary" : "hover:bg-muted"
                      )}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
                {avatarUrl && (
                  <button onClick={() => save(null)} disabled={saving} className="w-full text-[10px] py-1 rounded border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors disabled:opacity-50">
                    Remove image
                  </button>
                )}
              </div>
            )}

            {tab === "url" && (
              <div className="space-y-2">
                <div className="w-12 h-12 mx-auto rounded-lg bg-muted border border-border overflow-hidden flex items-center justify-center">
                  <AvatarPreview val={urlInput || undefined} />
                </div>
                <input
                  autoFocus
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  placeholder="https://example.com/image.png"
                  className="w-full text-[10px] px-2 py-1.5 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                  onKeyDown={e => { if (e.key === "Enter") save(urlInput.trim() || null); }}
                />
                <div className="flex gap-1.5">
                  <button onClick={() => save(urlInput.trim() || null)} disabled={saving || !urlInput.trim()} className="flex-1 text-[10px] py-1 rounded-lg bg-primary text-primary-foreground font-medium disabled:opacity-50 transition-opacity">
                    {saving ? "Saving…" : "Save URL"}
                  </button>
                  {avatarUrl && (
                    <button onClick={() => save(null)} disabled={saving} className="text-[10px] px-2 py-1 rounded-lg border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors disabled:opacity-50">
                      Remove
                    </button>
                  )}
                </div>
              </div>
            )}

            {tab === "upload" && (
              <div className="space-y-2">
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={saving}
                  className="w-full flex flex-col items-center gap-1.5 py-5 rounded-lg border-2 border-dashed border-border hover:border-primary/50 hover:bg-primary/5 transition-all disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
                  ) : (
                    <Upload className="w-5 h-5 text-muted-foreground" />
                  )}
                  <span className="text-[10px] text-muted-foreground font-medium">{saving ? "Uploading…" : "Click to choose image"}</span>
                  <span className="text-[9px] text-muted-foreground/60">Resized to 128×128 JPEG</span>
                </button>
                {avatarUrl && (
                  <button onClick={() => save(null)} disabled={saving} className="w-full text-[10px] py-1 rounded-lg border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors disabled:opacity-50">
                    Remove image
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Publish Dialog ───────────────────────────────────────────────────────────

function PublishDialog({ feedId, feedName, open, onOpenChange }: {
  feedId: number; feedName: string; open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const publishFeed = usePublishFeed();
  const [result, setResult] = useState<{ uri: string; feedUri: string } | null>(null);
  const [apiError, setApiError] = useState<{ message: string; missing?: string[] } | null>(null);

  function handlePublish() {
    setResult(null); setApiError(null);
    publishFeed.mutate({ id: feedId }, {
      onSuccess: (data) => {
        setResult(data);
        queryClient.invalidateQueries({ queryKey: getGetFeedQueryKey(feedId) });
        queryClient.invalidateQueries({ queryKey: getListFeedsQueryKey() });
        toast({ title: "Feed published to Bluesky!" });
      },
      onError: async (err: unknown) => {
        const resp = err as { response?: Response };
        if (resp?.response) {
          try { const body = await resp.response.clone().json(); setApiError({ message: body.message || "Unknown error", missing: body.missing }); }
          catch { setApiError({ message: "Publish failed" }); }
        } else { setApiError({ message: String(err) }); }
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { setResult(null); setApiError(null); } onOpenChange(v); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Publish "{feedName}" to Bluesky</DialogTitle>
        </DialogHeader>
        {!result && !apiError && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This creates or updates the <code className="font-mono bg-muted px-1 rounded text-xs">app.bsky.feed.generator</code> record, making the feed discoverable in the Bluesky app.
            </p>
            <div className="bg-muted/50 rounded-xl p-4 space-y-2.5 border border-border">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Required</p>
              {[
                { name: "FEEDGEN_HOSTNAME", desc: "Your deployed domain", link: null },
                { name: "FEEDGEN_PUBLISHER_DID", desc: "Your Bluesky DID", link: "https://bsky.app/settings" },
                { name: "BLUESKY_HANDLE", desc: "e.g. yourname.bsky.social", link: null },
                { name: "BLUESKY_APP_PASSWORD", desc: "App password from settings", link: "https://bsky.app/settings/app-passwords" },
              ].map(({ name, desc, link }) => (
                <div key={name} className="flex items-start gap-2">
                  <code className="font-mono text-[10px] bg-background border border-border px-1.5 py-0.5 rounded flex-shrink-0">{name}</code>
                  <span className="text-xs text-muted-foreground">{desc} {link && <a href={link} target="_blank" rel="noreferrer" className="text-primary hover:underline ml-1"><ExternalLink className="w-2.5 h-2.5 inline" /></a>}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {apiError && (
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-4 bg-destructive/8 border border-destructive/20 rounded-xl">
              <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-destructive">Publish failed</p>
                <p className="text-xs text-muted-foreground mt-1">{apiError.message}</p>
              </div>
            </div>
            {apiError.missing && (
              <div className="space-y-1.5">
                {apiError.missing.map(v => (
                  <div key={v} className="text-xs font-mono bg-muted px-2.5 py-1.5 rounded-lg border border-border text-destructive">{v}</div>
                ))}
              </div>
            )}
          </div>
        )}
        {result && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-emerald-500">
              <CheckCircle className="w-5 h-5" />
              <span className="font-semibold">Published successfully!</span>
            </div>
            <code className="text-xs font-mono bg-muted px-3 py-2 rounded-lg block break-all border border-border">{result.feedUri}</code>
            <p className="text-xs text-muted-foreground">
              It may take a few minutes to appear in the Bluesky app. You can now test it with the Test tab.
            </p>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>{result ? "Close" : "Cancel"}</Button>
          {!result && (
            <Button size="sm" onClick={handlePublish} disabled={publishFeed.isPending}>
              <Upload className="w-4 h-4 mr-2" />{publishFeed.isPending ? "Publishing…" : "Publish"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FeedDetail() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id, 10);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<TabType>("posts");
  const [publishOpen, setPublishOpen] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [newKeyword, setNewKeyword] = useState("");
  const [postMode, setPostMode] = useState<"recent" | "ranked">("recent");
  const [likedPosts, setLikedPosts] = useState<Set<string>>(new Set());
  const [repostedPosts, setRepostedPosts] = useState<Set<string>>(new Set());
  const [engagingPost, setEngagingPost] = useState<string | null>(null);
  const [feedProfiles, setFeedProfiles] = useState<Map<string, BskyProfile>>(new Map());
  const [replyTarget, setReplyTarget] = useState<{ uri: string; cid: string; text: string; author: string } | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [replySentUri, setReplySentUri] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<{ word: string; count: number; avgEngagement: number }[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [autoAmplify, setAutoAmplify] = useState({ enabled: false, minScore: 0.3, maxPerDay: 3, delayMinutes: 60 });
  const [savingAmplify, setSavingAmplify] = useState(false);

  const { data: feed, isLoading: loadingFeed } = useGetFeed(id);
  const { data: keywords } = useGetFeedKeywords(id);
  const { data: postsPage, isLoading: loadingPosts } = useGetFeedPosts(
    id,
    { limit: 25, cursor: postMode === "ranked" ? undefined : cursor, mode: postMode as GetFeedPostsMode },
    {
      query: {
        queryKey: getGetFeedPostsQueryKey(id, { limit: 25, cursor: postMode === "ranked" ? undefined : cursor, mode: postMode as GetFeedPostsMode }),
        enabled: !isNaN(id),
      },
    },
  );
  const { data: keywordStats } = useGetFeedKeywordStats(id, { query: { enabled: !isNaN(id), queryKey: ["kw-stats", id] } });
  const { data: topAuthors } = useGetFeedTopAuthors(id, { query: { enabled: !isNaN(id), queryKey: ["top-authors", id] } });
  const { data: hourly } = useGetFeedHourly(id, { query: { enabled: !isNaN(id), queryKey: ["feed-hourly-detail", id] } });
  const { data: bskyInfo } = useGetBlueskyFeedInfo(feed?.recordName ?? "", {
    query: { enabled: !!feed?.publishedAt && !!feed?.recordName, retry: false, queryKey: ["bsky-info", feed?.recordName] },
  });

  const addKeyword = useAddFeedKeyword();
  const deleteKeyword = useDeleteFeedKeyword();

  const hourlyChart = (hourly || []).map(b => ({ time: formatHour(b.hour), posts: b.count }));
  const pieData = (keywordStats || []).slice(0, 7).map((k, i) => ({ name: k.keyword, value: k.postCount, color: COLORS[i % COLORS.length] }));

  function handleAddKeyword(e: React.FormEvent) {
    e.preventDefault();
    if (!newKeyword.trim()) return;
    addKeyword.mutate({ id, data: { keyword: newKeyword.trim() } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetFeedKeywordsQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getGetFeedQueryKey(id) });
        setNewKeyword("");
        toast({ title: "Keyword added" });
      },
      onError: () => toast({ title: "Failed to add keyword", variant: "destructive" }),
    });
  }

  async function handleLike(uri: string, cid: string) {
    if (engagingPost) return;
    setEngagingPost(uri + "-like");
    try {
      await customFetch("/api/bluesky/like", { method: "POST", body: JSON.stringify({ uri, cid }) });
      setLikedPosts(prev => new Set([...prev, uri]));
    } catch {
      toast({ title: "Couldn't like post", description: "Make sure Bluesky credentials are configured.", variant: "destructive" });
    } finally {
      setEngagingPost(null);
    }
  }

  async function handleRepost(uri: string, cid: string) {
    if (engagingPost) return;
    setEngagingPost(uri + "-repost");
    try {
      await customFetch("/api/bluesky/repost", { method: "POST", body: JSON.stringify({ uri, cid }) });
      setRepostedPosts(prev => new Set([...prev, uri]));
    } catch {
      toast({ title: "Couldn't repost", description: "Make sure Bluesky credentials are configured.", variant: "destructive" });
    } finally {
      setEngagingPost(null);
    }
  }

  function handleDeleteKeyword(kw: Keyword) {
    deleteKeyword.mutate({ id, keywordId: kw.id }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetFeedKeywordsQueryKey(id) }); toast({ title: "Keyword removed" }); },
      onError: () => toast({ title: "Failed to remove keyword", variant: "destructive" }),
    });
  }

  async function handleSuggestKeywords() {
    setLoadingSuggestions(true);
    setShowSuggestions(true);
    try {
      const result = await customFetch<{ word: string; count: number; avgEngagement: number }[]>(
        `/api/feeds/${id}/keyword-suggestions`,
      );
      setSuggestions(result);
      if (result.length === 0) toast({ title: "No new suggestions found", description: "Try indexing more posts first." });
    } catch {
      toast({ title: "Failed to get suggestions", variant: "destructive" });
    } finally {
      setLoadingSuggestions(false);
    }
  }

  useEffect(() => {
    if (!postsPage?.posts?.length) return;
    const dids = [...new Set(postsPage.posts.map(p => p.author))];
    resolveProfiles(dids).then(resolved => {
      setFeedProfiles(prev => new Map([...prev, ...resolved]));
    });
  }, [postsPage?.posts]);

  async function handleReply() {
    if (!replyText.trim() || !replyTarget || sendingReply) return;
    setSendingReply(true);
    try {
      const result = await customFetch<{ success: boolean; uri?: string }>("/api/bluesky/compose", {
        method: "POST",
        body: JSON.stringify({ text: replyText.trim(), replyTo: { uri: replyTarget.uri, cid: replyTarget.cid } }),
      });
      setReplySentUri(result.uri ?? null);
      setReplyText("");
    } catch {
      toast({ title: "Couldn't send reply", description: "Make sure Bluesky credentials are configured.", variant: "destructive" });
    } finally {
      setSendingReply(false);
    }
  }

  function atUriToBskyUrl(uri: string): string {
    const parts = uri.split("/");
    const did = parts[2] ?? "";
    const rkey = parts[4] ?? "";
    return `https://bsky.app/profile/${did}/post/${rkey}`;
  }

  async function handleSaveAutoAmplify(settings: typeof autoAmplify) {
    setSavingAmplify(true);
    try {
      await customFetch(`/api/feeds/${id}/auto-amplify`, { method: "POST", body: JSON.stringify(settings) });
      setAutoAmplify(settings);
      toast({ title: settings.enabled ? "Auto-repost enabled" : "Auto-repost disabled" });
    } catch {
      toast({ title: "Failed to save settings", variant: "destructive" });
    } finally {
      setSavingAmplify(false);
    }
  }

  // Load auto-amplify settings when on keywords tab
  useQuery({
    queryKey: ["auto-amplify", id],
    queryFn: async () => {
      const result = await customFetch<typeof autoAmplify>(`/api/feeds/${id}/auto-amplify`);
      setAutoAmplify(result);
      return result;
    },
    enabled: !isNaN(id) && tab === "keywords",
    staleTime: 30_000,
  });

  if (loadingFeed) return (
    <div className="px-4 py-5 md:px-8 md:py-8 max-w-5xl mx-auto">
      <div className="h-6 w-40 bg-muted rounded animate-pulse mb-5" />
      <div className="h-32 bg-card border border-card-border rounded-xl animate-pulse" />
    </div>
  );
  if (!feed) return (
    <div className="px-4 py-5 md:px-8 md:py-8 max-w-5xl mx-auto text-center py-20">
      <p className="text-muted-foreground">Feed not found</p>
      <Link href="/feeds"><Button variant="outline" className="mt-4">Back to Feeds</Button></Link>
    </div>
  );

  const tabs: { id: TabType; label: string; icon: React.ElementType; count?: number }[] = [
    { id: "posts", label: "Posts", icon: FileText, count: feed.postCount },
    { id: "test", label: "Test Live", icon: Play },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "keywords", label: "Keywords", icon: Hash, count: keywords?.length ?? 0 },
  ];

  return (
    <div className="px-4 py-5 md:px-8 md:py-8 max-w-5xl mx-auto">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-5 md:mb-6">
        <Link href="/feeds">
          <span className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer mb-4 w-fit transition-colors">
            <ArrowLeft className="w-3 h-3" /> Back to Feeds
          </span>
        </Link>
        <div className="flex items-start gap-4">
          {/* Feed avatar */}
          <FeedAvatarEditor feedId={id} avatarUrl={(feed as unknown as Record<string, unknown>).avatarUrl as string | undefined} onSaved={() => queryClient.invalidateQueries({ queryKey: getGetFeedQueryKey(id) })} />

          <div className="flex-1 min-w-0 flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap mb-1">
                <h1 className="text-xl md:text-2xl font-bold text-foreground">{feed.displayName}</h1>
                <span className={cn(
                  "text-xs font-medium px-2 py-0.5 rounded-full border",
                  feed.isActive
                    ? "text-emerald-600 bg-emerald-500/8 border-emerald-500/20"
                    : "text-muted-foreground bg-muted border-border",
                )}>
                  {feed.isActive ? "Active" : "Inactive"}
                </span>
                {feed.publishedAt && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full border text-primary bg-primary/8 border-primary/20">
                    Published
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2.5 text-xs text-muted-foreground flex-wrap">
                <code className="bg-muted px-2 py-0.5 rounded font-mono">{feed.recordName}</code>
                <span>{feed.postCount.toLocaleString()} posts indexed</span>
                {Boolean((feed as unknown as Record<string, unknown>).lastIndexedAt) && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Last post {formatDistanceToNow(new Date((feed as unknown as Record<string, unknown>).lastIndexedAt as string), { addSuffix: true })}
                  </span>
                )}
                {feed.publishedAt && <span>Published {formatDistanceToNow(new Date(feed.publishedAt), { addSuffix: true })}</span>}
              </div>
              {feed.description && <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">{feed.description}</p>}
            </div>
            <Button
              onClick={() => setPublishOpen(true)}
              variant={feed.publishedAt ? "outline" : "default"}
              size="sm"
              className="flex-shrink-0 gap-1.5"
            >
              <Upload className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{feed.publishedAt ? "Re-publish" : "Publish to Bluesky"}</span>
              <span className="sm:hidden">{feed.publishedAt ? "Re-publish" : "Publish"}</span>
            </Button>
          </div>
        </div>
      </motion.div>

      {/* Bluesky info banner */}
      {bskyInfo && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mb-5 bg-gradient-to-r from-primary/6 via-primary/3 to-transparent border border-primary/20 rounded-xl p-4"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center flex-shrink-0">
              <Heart className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-foreground">
                {bskyInfo.likeCount.toLocaleString()} people saved this feed
              </div>
              {bskyInfo.description && <div className="text-xs text-muted-foreground truncate mt-0.5">{bskyInfo.description}</div>}
            </div>
            <a
              href={`https://bsky.app/profile/did:plc:oobxeg4vljlqpp62k7fd6flp/feed/${feed.recordName}`}
              target="_blank"
              rel="noreferrer"
              className="p-2 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/8 transition-colors flex-shrink-0"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </motion.div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-border mb-5 overflow-x-auto scrollbar-thin -mx-4 px-4 md:mx-0 md:px-0">
        {tabs.map(({ id: tabId, label, icon: Icon, count }) => (
          <button
            key={tabId}
            onClick={() => setTab(tabId)}
            className={cn(
              "flex items-center gap-1.5 px-3 md:px-4 py-2.5 text-xs md:text-sm font-medium border-b-2 -mb-px transition-all whitespace-nowrap flex-shrink-0",
              tab === tabId
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="w-3.5 h-3.5 flex-shrink-0" />
            {label}
            {count !== undefined && (
              <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full tabular-nums", tab === tabId ? "bg-primary/12 text-primary" : "bg-muted text-muted-foreground")}>
                {count.toLocaleString()}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        {/* POSTS */}
        {tab === "posts" && (
          <motion.div key="posts" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {/* Feed health alert */}
            {postsPage && postsPage.posts.length === 0 && (
              <div className="flex items-start gap-3 bg-amber-500/8 border border-amber-500/20 rounded-xl px-4 py-3 mb-3">
                <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Feed has no indexed posts</p>
                  <p className="text-xs text-amber-600/80 dark:text-amber-500/80 mt-0.5">Try adding more keywords or broader terms. The indexer runs every 3 minutes.</p>
                </div>
              </div>
            )}
            {postsPage && postsPage.posts.length > 0 && (() => {
              const newest = Math.max(...postsPage.posts.map(p => new Date(p.indexedAt).getTime()));
              const hoursOld = (Date.now() - newest) / 3_600_000;
              return hoursOld > 24 ? (
                <div className="flex items-start gap-3 bg-amber-500/8 border border-amber-500/20 rounded-xl px-4 py-3 mb-3">
                  <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-amber-700 dark:text-amber-400">No new posts in 24+ hours</p>
                    <p className="text-xs text-amber-600/80 dark:text-amber-500/80 mt-0.5">Your keywords may not be matching recent content. Consider broadening them in the Keywords tab.</p>
                  </div>
                </div>
              ) : null;
            })()}
            <div className="bg-card border border-card-border rounded-xl overflow-hidden">
              {/* Header with mode toggle */}
              <div className="px-4 md:px-5 py-3 border-b border-border flex items-center justify-between gap-3 bg-muted/10 flex-wrap">
                <div className="flex items-center gap-1 bg-muted/50 border border-border rounded-lg p-0.5">
                  <button
                    onClick={() => { setPostMode("recent"); setCursor(undefined); setCursorStack([]); }}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                      postMode === "recent"
                        ? "bg-background text-foreground shadow-sm border border-border"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Clock className="w-3 h-3" />
                    Recent
                  </button>
                  <button
                    onClick={() => { setPostMode("ranked"); setCursor(undefined); setCursorStack([]); }}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                      postMode === "ranked"
                        ? "bg-background text-foreground shadow-sm border border-border"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Trophy className="w-3 h-3" />
                    Ranked
                  </button>
                </div>
                {postMode === "ranked" && (
                  <button
                    onClick={async () => {
                      try {
                        await customFetch("/api/admin/trigger-rank", { method: "POST" });
                        queryClient.invalidateQueries({ queryKey: getGetFeedPostsQueryKey(id, { limit: 25, cursor: undefined, mode: "ranked" as GetFeedPostsMode }) });
                        toast({ title: "Rankings refreshed" });
                      } catch {
                        toast({ title: "Ranking failed", variant: "destructive" });
                      }
                    }}
                    className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1 border border-border rounded-md px-2 py-1 hover:bg-muted/50"
                    title="Recompute all feed rankings now"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Refresh scores
                  </button>
                )}
                <span className="text-xs text-muted-foreground tabular-nums ml-auto">
                  {(postsPage?.total ?? 0).toLocaleString()} total
                  {postsPage?.mode && postsPage.mode !== postMode && (
                    <span className="ml-1 text-amber-500">(showing recent — no ranked scores yet, click Refresh scores)</span>
                  )}
                </span>
              </div>

              {loadingPosts ? (
                <div className="p-4 space-y-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />)}</div>
              ) : !postsPage || postsPage.posts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-52 text-center gap-3 px-6">
                  <div className="w-12 h-12 rounded-2xl bg-muted border border-border flex items-center justify-center">
                    {postMode === "ranked" ? <Trophy className="w-5 h-5 text-muted-foreground/40" /> : <FileText className="w-5 h-5 text-muted-foreground/40" />}
                  </div>
                  <div>
                    {postMode === "ranked" ? (
                      <>
                        <p className="text-sm font-semibold text-foreground">No ranked scores yet</p>
                        <p className="text-xs text-muted-foreground mt-1 max-w-xs">Scores are precomputed by the feed ranking worker. They appear here once the first ranking pass completes.</p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-semibold text-foreground">No posts yet</p>
                        <p className="text-xs text-muted-foreground mt-1 max-w-xs">Add keywords in the Keywords tab to start matching posts from the Bluesky firehose.</p>
                      </>
                    )}
                  </div>
                  {postMode !== "ranked" && (
                    <Button size="sm" variant="outline" onClick={() => setTab("keywords")} className="gap-1.5">
                      <Hash className="w-3.5 h-3.5" /> Add Keywords
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  <div className="divide-y divide-border/50">
                    {postsPage.posts.map((post) => {
                      const isRanked = postsPage.mode === "ranked" && post.rank != null;
                      return (
                        <div key={post.id} className="px-4 md:px-5 py-3.5 hover:bg-muted/20 transition-colors">
                          <div className="flex items-start gap-3">
                            {/* Rank badge in ranked mode */}
                            {isRanked && (
                              <div className={cn(
                                "flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold tabular-nums border",
                                post.rank === 1
                                  ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-600"
                                  : post.rank === 2
                                  ? "bg-slate-400/10 border-slate-400/30 text-slate-500"
                                  : post.rank === 3
                                  ? "bg-orange-500/10 border-orange-500/30 text-orange-600"
                                  : "bg-muted border-border text-muted-foreground",
                              )}>
                                #{post.rank}
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              {(() => {
                                const profile = feedProfiles.get(post.author);
                                const handle = profile?.handle ?? shortenDid(post.author);
                                const displayName = profile?.displayName;
                                return (
                                  <div className="flex items-start gap-2.5 mb-1.5">
                                    <a href={`https://bsky.app/profile/${handle}`} target="_blank" rel="noreferrer" className="flex-shrink-0 mt-0.5">
                                      <PostAuthorAvatar profile={profile} did={post.author} />
                                    </a>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-baseline gap-1.5 flex-wrap mb-0.5">
                                        {displayName && (
                                          <a href={`https://bsky.app/profile/${handle}`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-foreground hover:text-primary transition-colors leading-tight">{displayName}</a>
                                        )}
                                        <span className={cn("text-xs text-muted-foreground", !displayName && "font-medium text-foreground")}>@{handle}</span>
                                        <span className="text-muted-foreground/30 text-xs">·</span>
                                        <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(post.indexedAt), { addSuffix: true })}</span>
                                        {post.likes > 0 && (
                                          <span className="flex items-center gap-0.5 text-[11px] text-rose-500 ml-1">
                                            <Heart className="w-2.5 h-2.5" />{post.likes}
                                          </span>
                                        )}
                                        {post.reposts > 0 && (
                                          <span className="flex items-center gap-0.5 text-[11px] text-emerald-600">
                                            <Repeat2 className="w-2.5 h-2.5" />{post.reposts}
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-sm text-foreground leading-relaxed line-clamp-3">{post.text}</p>
                                    </div>
                                  </div>
                                );
                              })()}
                              {/* Ranking scores row */}
                              {isRanked && (
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/8 border border-primary/20 text-primary">
                                    <TrendingUp className="w-2.5 h-2.5" />
                                    final {post.finalScore?.toFixed(4) ?? "—"}
                                  </span>
                                  <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/8 border border-emerald-500/20 text-emerald-600">
                                    <Zap className="w-2.5 h-2.5" />
                                    quality {post.qualityScore?.toFixed(4) ?? "—"}
                                  </span>
                                  {post.computedAt && (
                                    <span className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
                                      <Clock className="w-2.5 h-2.5" />
                                      scored {formatDistanceToNow(new Date(post.computedAt), { addSuffix: true })}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <button
                                onClick={() => handleLike(post.uri, post.cid)}
                                disabled={!!engagingPost || likedPosts.has(post.uri)}
                                title={likedPosts.has(post.uri) ? "Liked" : "Like on Bluesky"}
                                className={cn(
                                  "p-1.5 rounded-lg transition-colors",
                                  likedPosts.has(post.uri)
                                    ? "text-rose-500 bg-rose-500/10"
                                    : "text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10",
                                  engagingPost === post.uri + "-like" && "opacity-50",
                                )}
                              >
                                <Heart className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleRepost(post.uri, post.cid)}
                                disabled={!!engagingPost || repostedPosts.has(post.uri)}
                                title={repostedPosts.has(post.uri) ? "Reposted" : "Repost on Bluesky"}
                                className={cn(
                                  "p-1.5 rounded-lg transition-colors",
                                  repostedPosts.has(post.uri)
                                    ? "text-emerald-500 bg-emerald-500/10"
                                    : "text-muted-foreground hover:text-emerald-500 hover:bg-emerald-500/10",
                                  engagingPost === post.uri + "-repost" && "opacity-50",
                                )}
                              >
                                <Repeat2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => { setReplyTarget({ uri: post.uri, cid: post.cid, text: post.text, author: post.author }); setReplyText(""); }}
                                title="Reply on Bluesky"
                                className="p-1.5 rounded-lg text-muted-foreground hover:text-blue-500 hover:bg-blue-500/10 transition-colors"
                              >
                                <MessageCircle className="w-3.5 h-3.5" />
                              </button>
                              <a
                                href={`https://bsky.app/profile/${post.author}/post/${postIdFromUri(post.uri)}`}
                                target="_blank"
                                rel="noreferrer"
                                className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-muted/60 transition-colors"
                              >
                                <ArrowUpRight className="w-3.5 h-3.5" />
                              </a>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* Footer: pagination for recent, summary for ranked */}
                  {postsPage.mode !== "ranked" ? (
                    <div className="px-4 md:px-5 py-3 border-t border-border flex items-center justify-between bg-muted/10">
                      <Button variant="outline" size="sm" className="gap-1 h-8 text-xs"
                        onClick={() => { const s = [...cursorStack]; const p = s.pop(); setCursorStack(s); setCursor(p === "" ? undefined : p); }}
                        disabled={cursorStack.length === 0}
                      ><ChevronLeft className="w-3.5 h-3.5" />Prev</Button>
                      <span className="text-xs text-muted-foreground">{postsPage.posts.length} of {postsPage.total.toLocaleString()}</span>
                      <Button variant="outline" size="sm" className="gap-1 h-8 text-xs"
                        onClick={() => { if (postsPage.cursor) { setCursorStack(s => [...s, cursor ?? ""]); setCursor(postsPage.cursor); } }}
                        disabled={!postsPage.cursor}
                      >Next<ChevronRight className="w-3.5 h-3.5" /></Button>
                    </div>
                  ) : (
                    <div className="px-4 md:px-5 py-3 border-t border-border flex items-center gap-2 bg-muted/10">
                      <Trophy className="w-3.5 h-3.5 text-primary" />
                      <span className="text-xs text-muted-foreground">
                        {postsPage.posts.length} ranked post{postsPage.posts.length !== 1 ? "s" : ""} — sorted by final score
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}

        {/* TEST */}
        {tab === "test" && (
          <motion.div key="test" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <LiveFeedTester recordName={feed.recordName} publishedAt={feed.publishedAt ?? null} />
          </motion.div>
        )}

        {/* ANALYTICS */}
        {tab === "analytics" && (
          <motion.div key="analytics" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-card border border-card-border rounded-xl p-5">
                <h3 className="text-sm font-semibold mb-4">Hourly Activity (24h)</h3>
                {hourlyChart.length === 0 ? (
                  <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">No activity yet in the last 24 hours.</div>
                ) : (
                  <ResponsiveContainer width="100%" height={160}>
                    <AreaChart data={hourlyChart} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="feedGrad2" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(199 89% 48%)" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="hsl(199 89% 48%)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 6% 90% / .5)" />
                      <XAxis dataKey="time" tick={{ fontSize: 10, fill: "hsl(240 4% 46%)" }} tickLine={false} axisLine={false} interval={3} />
                      <YAxis tick={{ fontSize: 10, fill: "hsl(240 4% 46%)" }} tickLine={false} axisLine={false} />
                      <Tooltip {...tooltipStyle()} />
                      <Area type="monotone" dataKey="posts" stroke="hsl(199 89% 48%)" strokeWidth={2} fill="url(#feedGrad2)" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div className="bg-card border border-card-border rounded-xl p-5">
                <h3 className="text-sm font-semibold mb-4">Keyword Distribution</h3>
                {pieData.length === 0 ? (
                  <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">Add keywords to see distribution.</div>
                ) : (
                  <div className="flex items-center gap-3">
                    <ResponsiveContainer width={120} height={120}>
                      <PieChart>
                        <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={30} outerRadius={54} paddingAngle={2}>
                          {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex-1 space-y-1.5">
                      {(keywordStats || []).slice(0, 7).map((k, i) => (
                        <div key={k.keyword} className="flex items-center gap-1.5 text-xs">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                          <span className="font-mono text-foreground truncate flex-1">{k.keyword}</span>
                          <span className="text-muted-foreground flex-shrink-0 tabular-nums">{k.postCount}</span>
                          <span className="text-muted-foreground/40 flex-shrink-0 w-8 text-right">{k.percentage}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="bg-card border border-card-border rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border bg-muted/10">
                <h3 className="text-sm font-semibold">Top Contributing Authors</h3>
              </div>
              {!topAuthors || topAuthors.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">No author data yet.</div>
              ) : (
                <div className="divide-y divide-border/50">
                  {topAuthors.slice(0, 10).map((author, i) => (
                    <div key={author.did} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/20 transition-colors">
                      <span className="text-[10px] text-muted-foreground/40 font-mono w-5 flex-shrink-0 text-right">{i + 1}</span>
                      <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/15 flex items-center justify-center flex-shrink-0">
                        <Users className="w-3 h-3 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-mono text-foreground truncate">{shortenDid(author.did)}</div>
                        <div className="text-[10px] text-muted-foreground">Last {formatDistanceToNow(new Date(author.latestPostAt), { addSuffix: true })}</div>
                      </div>
                      <span className="text-xs bg-muted text-muted-foreground border border-border px-2 py-0.5 rounded-full tabular-nums">{author.postCount} posts</span>
                      <a href={`https://bsky.app/profile/${author.did}`} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary transition-colors">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* KEYWORDS */}
        {tab === "keywords" && (
          <motion.div key="keywords" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div className="bg-card border border-card-border rounded-xl p-5 md:p-6">
              <p className="text-xs text-muted-foreground mb-4">
                Keywords are matched against Bluesky posts in real-time. Posts containing any keyword will be indexed into this feed. The Cloudflare Worker runs every 3 minutes to find new matches.
              </p>
              <form onSubmit={handleAddKeyword} className="flex gap-2 mb-4">
                <div className="relative flex-1">
                  <Hash className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    value={newKeyword}
                    onChange={e => setNewKeyword(e.target.value)}
                    placeholder="Add keyword (e.g. bluesky, ai, typescript…)"
                    className="pl-8 text-sm"
                    data-testid="input-new-keyword"
                  />
                </div>
                <Button type="submit" disabled={addKeyword.isPending || !newKeyword.trim()} data-testid="button-add-keyword" className="gap-1.5">
                  <Plus className="w-4 h-4" />Add
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSuggestKeywords}
                  disabled={loadingSuggestions}
                  className="gap-1.5 text-primary border-primary/30 hover:bg-primary/5"
                  title="Suggest keywords based on your indexed posts"
                >
                  {loadingSuggestions ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  <span className="hidden sm:inline">Suggest</span>
                </Button>
              </form>

              {/* Smart keyword suggestions panel */}
              <AnimatePresence>
                {showSuggestions && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="mb-4 p-3 rounded-xl bg-primary/3 border border-primary/15"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-primary" />
                        <span className="text-xs font-semibold text-primary">AI-powered suggestions</span>
                        <span className="text-[10px] text-muted-foreground">based on your indexed posts</span>
                      </div>
                      <button onClick={() => setShowSuggestions(false)} className="text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>
                    </div>
                    {loadingSuggestions ? (
                      <p className="text-xs text-muted-foreground">Analysing posts…</p>
                    ) : suggestions.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No suggestions yet — index more posts first.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {suggestions.map(s => (
                          <button
                            key={s.word}
                            onClick={() => { setNewKeyword(s.word); setShowSuggestions(false); }}
                            title={`${s.count} posts, avg engagement ${s.avgEngagement}`}
                            className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-card border border-primary/20 hover:bg-primary/8 hover:border-primary/40 text-foreground transition-colors font-mono"
                          >
                            {s.word}
                            {s.avgEngagement > 0 && (
                              <span className="text-[9px] text-primary/60">+{s.avgEngagement}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Quick-start suggestions when no keywords yet */}
              {(!keywords || keywords.length === 0) && !showSuggestions && (
                <div className="mb-4">
                  <p className="text-xs text-muted-foreground mb-2 font-medium">Suggestions to get started:</p>
                  <div className="flex flex-wrap gap-2">
                    {["bluesky", "atprotocol", "software", "programming", "AI", "typescript", "react", "opensource", "Kenya", "developer"].map(kw => (
                      <button
                        key={kw}
                        onClick={() => setNewKeyword(kw)}
                        className="text-xs px-2.5 py-1 rounded-full bg-muted border border-border hover:bg-muted/80 text-foreground transition-colors font-mono"
                      >
                        {kw}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {(!keywords || keywords.length === 0) ? (
                <div className="flex flex-col items-center justify-center h-36 gap-2 text-center">
                  <Hash className="w-10 h-10 text-muted-foreground/20" />
                  <p className="text-sm text-muted-foreground">No keywords yet. Add keywords above to start matching posts.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {keywords.map((kw, i) => {
                    const stat = keywordStats?.find(s => s.keyword === kw.keyword);
                    return (
                      <motion.div
                        key={kw.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.04 }}
                        className="flex items-center gap-3 py-2.5 px-4 rounded-xl bg-muted/40 border border-border/40 hover:bg-muted/60 transition-colors"
                      >
                        <span className="w-2 h-2 rounded-full bg-primary/60 flex-shrink-0" />
                        <code className="text-sm text-foreground flex-1 font-mono">{kw.keyword}</code>
                        {stat && (
                          <div className="hidden sm:flex items-center gap-3">
                            <span className="text-xs text-muted-foreground tabular-nums">{stat.postCount.toLocaleString()} posts</span>
                            <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div className="h-full bg-primary/60 rounded-full" style={{ width: `${stat.percentage}%` }} />
                            </div>
                            <span className="text-xs text-muted-foreground w-8 text-right tabular-nums">{stat.percentage}%</span>
                          </div>
                        )}
                        <span className="text-[10px] text-muted-foreground/50 hidden md:block">
                          {formatDistanceToNow(new Date(kw.createdAt), { addSuffix: true })}
                        </span>
                        <button
                          onClick={() => handleDeleteKeyword(kw)}
                          className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded"
                          data-testid={`button-delete-keyword-${kw.id}`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </motion.div>
                    );
                  })}
                </div>
              )}

              {/* ── Auto-repost section ─────────────────────────────────────── */}
              <div className="mt-6 pt-5 border-t border-border/50">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <Repeat2 className="w-4 h-4 text-primary" />
                      Auto-Repost
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Automatically repost top-ranked posts from this feed on your account.
                    </p>
                  </div>
                  <button
                    onClick={() => handleSaveAutoAmplify({ ...autoAmplify, enabled: !autoAmplify.enabled })}
                    disabled={savingAmplify}
                    className="flex-shrink-0"
                  >
                    {autoAmplify.enabled
                      ? <ToggleRight className="w-9 h-9 text-primary" />
                      : <ToggleLeft className="w-9 h-9 text-muted-foreground" />
                    }
                  </button>
                </div>
                {autoAmplify.enabled && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="grid grid-cols-3 gap-3 mt-3"
                  >
                    <div>
                      <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Min quality score</label>
                      <select
                        value={autoAmplify.minScore}
                        onChange={e => setAutoAmplify(s => ({ ...s, minScore: parseFloat(e.target.value) }))}
                        className="mt-1 w-full text-xs rounded-lg border border-border bg-background px-2 py-1.5 text-foreground"
                      >
                        <option value="0.1">Low (0.1)</option>
                        <option value="0.3">Medium (0.3)</option>
                        <option value="0.5">High (0.5)</option>
                        <option value="0.7">Very high (0.7)</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Max per day</label>
                      <select
                        value={autoAmplify.maxPerDay}
                        onChange={e => setAutoAmplify(s => ({ ...s, maxPerDay: parseInt(e.target.value) }))}
                        className="mt-1 w-full text-xs rounded-lg border border-border bg-background px-2 py-1.5 text-foreground"
                      >
                        {[1, 2, 3, 5, 10].map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Delay (minutes)</label>
                      <select
                        value={autoAmplify.delayMinutes}
                        onChange={e => setAutoAmplify(s => ({ ...s, delayMinutes: parseInt(e.target.value) }))}
                        className="mt-1 w-full text-xs rounded-lg border border-border bg-background px-2 py-1.5 text-foreground"
                      >
                        {[15, 30, 60, 120, 240].map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                    <div className="col-span-3">
                      <Button
                        size="sm"
                        onClick={() => handleSaveAutoAmplify(autoAmplify)}
                        disabled={savingAmplify}
                        className="gap-1.5 mt-1"
                      >
                        {savingAmplify ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                        Save settings
                      </Button>
                    </div>
                  </motion.div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <PublishDialog feedId={id} feedName={feed.displayName} open={publishOpen} onOpenChange={setPublishOpen} />

      {/* Reply Dialog */}
      <Dialog open={!!replyTarget || !!replySentUri} onOpenChange={open => { if (!open) { setReplyTarget(null); setReplyText(""); setReplySentUri(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{replySentUri ? "Reply sent!" : "Reply to post"}</DialogTitle>
          </DialogHeader>

          {/* Success state */}
          {replySentUri ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 bg-emerald-500/8 border border-emerald-500/20 rounded-xl">
                <CheckCircle className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Your reply was posted to Bluesky</p>
                  <p className="text-xs text-muted-foreground mt-0.5">It was sent from your publisher account. It may take a few seconds to appear.</p>
                </div>
              </div>
              <a
                href={atUriToBskyUrl(replySentUri)}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <ArrowUpRight className="w-4 h-4" />
                View your reply on Bluesky
              </a>
            </div>
          ) : replyTarget ? (
            <div className="space-y-4">
              {/* Original post preview */}
              <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm text-muted-foreground leading-relaxed">
                {(() => {
                  const profile = feedProfiles.get(replyTarget.author);
                  const handle = profile?.handle ?? shortenDid(replyTarget.author);
                  return (
                    <div className="flex items-start gap-2">
                      <PostAuthorAvatar profile={profile} did={replyTarget.author} />
                      <div>
                        <span className="font-medium text-foreground text-xs">
                          {profile?.displayName ?? `@${handle}`}
                        </span>
                        <p className="mt-0.5 text-xs line-clamp-3">{replyTarget.text}</p>
                      </div>
                    </div>
                  );
                })()}
              </div>
              <Textarea
                placeholder="Write your reply…"
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                rows={4}
                className="resize-none"
                autoFocus
                onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleReply(); }}
              />
              <div className="flex items-center justify-between">
                <span className={cn("text-xs tabular-nums", replyText.length > 280 ? "text-destructive font-semibold" : "text-muted-foreground")}>
                  {replyText.length}/300
                </span>
                <span className="text-[10px] text-muted-foreground">⌘↵ to send</span>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            {replySentUri ? (
              <Button onClick={() => { setReplySentUri(null); setReplyTarget(null); }}>Done</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => { setReplyTarget(null); setReplyText(""); }}>Cancel</Button>
                <Button
                  onClick={handleReply}
                  disabled={!replyText.trim() || replyText.length > 300 || sendingReply}
                  className="gap-2"
                >
                  {sendingReply ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  Send Reply
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
