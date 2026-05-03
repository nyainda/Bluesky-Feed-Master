import { useState } from "react";
import { useParams, Link } from "wouter";
import {
  useGetFeed, useGetFeedKeywords, useGetFeedPosts,
  useAddFeedKeyword, useDeleteFeedKeyword, usePublishFeed,
  useGetFeedKeywordStats, useGetFeedTopAuthors, useGetFeedHourly, useGetBlueskyFeedInfo,
  getGetFeedQueryKey, getGetFeedKeywordsQueryKey, getGetFeedPostsQueryKey, getListFeedsQueryKey,
  customFetch,
} from "@workspace/api-client-react";
import type { Keyword } from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Tag, X, Plus, ArrowLeft, ExternalLink, ChevronRight, ChevronLeft,
  Upload, CheckCircle, AlertTriangle, BarChart3, FileText, Hash,
  Users, Heart, TrendingUp, Play, RefreshCw, Rss, ArrowUpRight,
  Repeat2, MessageCircle, Image, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
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

  const { data: feed, isLoading: loadingFeed } = useGetFeed(id);
  const { data: keywords } = useGetFeedKeywords(id);
  const { data: postsPage, isLoading: loadingPosts } = useGetFeedPosts(id, { limit: 25, cursor }, {
    query: { queryKey: getGetFeedPostsQueryKey(id, { limit: 25, cursor }), enabled: !isNaN(id) },
  });
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

  function handleDeleteKeyword(kw: Keyword) {
    deleteKeyword.mutate({ id, keywordId: kw.id }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetFeedKeywordsQueryKey(id) }); toast({ title: "Keyword removed" }); },
      onError: () => toast({ title: "Failed to remove keyword", variant: "destructive" }),
    });
  }

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
        <div className="flex items-start justify-between gap-4">
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
            <div className="bg-card border border-card-border rounded-xl overflow-hidden">
              <div className="px-4 md:px-5 py-3.5 border-b border-border flex items-center justify-between bg-muted/10">
                <span className="text-sm font-semibold text-foreground">Indexed Posts</span>
                <span className="text-xs text-muted-foreground tabular-nums">{(postsPage?.total ?? 0).toLocaleString()} total</span>
              </div>
              {loadingPosts ? (
                <div className="p-4 space-y-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-14 bg-muted rounded-lg animate-pulse" />)}</div>
              ) : !postsPage || postsPage.posts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-52 text-center gap-3 px-6">
                  <div className="w-12 h-12 rounded-2xl bg-muted border border-border flex items-center justify-center">
                    <FileText className="w-5 h-5 text-muted-foreground/40" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">No posts yet</p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-xs">Add keywords in the Keywords tab to start matching posts from the Bluesky firehose.</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setTab("keywords")} className="gap-1.5">
                    <Hash className="w-3.5 h-3.5" /> Add Keywords
                  </Button>
                </div>
              ) : (
                <>
                  <div className="divide-y divide-border/50">
                    {postsPage.posts.map((post) => (
                      <div key={post.id} className="px-4 md:px-5 py-3.5 hover:bg-muted/20 transition-colors">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <a href={`https://bsky.app/profile/${post.author}`} target="_blank" rel="noreferrer" className="text-xs font-mono text-muted-foreground hover:text-primary transition-colors">{shortenDid(post.author)}</a>
                              <span className="text-muted-foreground/30 text-xs">·</span>
                              <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(post.indexedAt), { addSuffix: true })}</span>
                              {post.likes > 0 && (
                                <span className="flex items-center gap-0.5 text-[11px] text-rose-500">
                                  <Heart className="w-2.5 h-2.5" />{post.likes}
                                </span>
                              )}
                              {post.reposts > 0 && (
                                <span className="flex items-center gap-0.5 text-[11px] text-emerald-600">
                                  <Repeat2 className="w-2.5 h-2.5" />{post.reposts}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-foreground leading-relaxed line-clamp-2">{post.text}</p>
                          </div>
                          <a
                            href={`https://bsky.app/profile/${post.author}/post/${postIdFromUri(post.uri)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="flex-shrink-0 text-muted-foreground hover:text-primary transition-colors mt-0.5"
                          >
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
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
              <form onSubmit={handleAddKeyword} className="flex gap-2 mb-5">
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
              </form>

              {/* Keyword suggestions */}
              {(!keywords || keywords.length === 0) && (
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
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <PublishDialog feedId={id} feedName={feed.displayName} open={publishOpen} onOpenChange={setPublishOpen} />
    </div>
  );
}
