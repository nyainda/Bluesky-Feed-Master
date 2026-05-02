import { useState } from "react";
import { useParams, Link } from "wouter";
import {
  useGetFeed, useGetFeedKeywords, useGetFeedPosts,
  useAddFeedKeyword, useDeleteFeedKeyword, usePublishFeed,
  useGetFeedKeywordStats, useGetFeedTopAuthors, useGetFeedHourly, useGetBlueskyFeedInfo,
  getGetFeedQueryKey, getGetFeedKeywordsQueryKey, getGetFeedPostsQueryKey, getListFeedsQueryKey,
} from "@workspace/api-client-react";
import type { Keyword } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Tag, X, Plus, ArrowLeft, ExternalLink, ChevronRight, ChevronLeft,
  Upload, CheckCircle, AlertTriangle, BarChart3, FileText, Hash,
  Users, Heart, TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow, format } from "date-fns";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import { cn } from "@/lib/utils";

const COLORS = ["hsl(217 91% 60%)", "hsl(199 89% 48%)", "hsl(173 80% 40%)", "hsl(262 83% 58%)", "hsl(338 75% 55%)", "hsl(43 96% 56%)", "hsl(20 90% 55%)"];

function shortenDid(did: string) {
  if (did.length <= 20) return did;
  return did.substring(0, 14) + "..." + did.substring(did.length - 6);
}
function formatHour(iso: string) {
  try { return format(new Date(iso), "HH:mm"); } catch { return iso; }
}

function tooltipStyle() {
  return {
    contentStyle: { background: "hsl(222 40% 10%)", border: "1px solid hsl(222 30% 18%)", borderRadius: "8px", fontSize: "12px", color: "hsl(215 28% 93%)" },
    cursor: { stroke: "hsl(217 91% 60% / 0.3)", strokeWidth: 1 },
  };
}

type TabType = "posts" | "analytics" | "keywords";

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
        <DialogHeader><DialogTitle>Publish "{feedName}" to Bluesky</DialogTitle></DialogHeader>
        {!result && !apiError && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">This will create or update the <code className="font-mono bg-muted px-1 rounded text-xs">app.bsky.feed.generator</code> record, making this feed discoverable in the Bluesky app.</p>
            <div className="bg-muted/50 rounded-lg p-4 space-y-2.5 text-sm">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Required environment variables</p>
              {[
                { name: "FEEDGEN_HOSTNAME", desc: "Your deployed domain (e.g. my-app.replit.app)" },
                { name: "FEEDGEN_PUBLISHER_DID", desc: "Your Bluesky DID — find at bsky.app/settings", link: "https://bsky.app/settings" },
                { name: "BLUESKY_HANDLE", desc: "Your handle, e.g. yourname.bsky.social" },
                { name: "BLUESKY_APP_PASSWORD", desc: "Generate at bsky.app/settings/app-passwords", link: "https://bsky.app/settings/app-passwords" },
              ].map(({ name, desc, link }) => (
                <div key={name} className="flex items-start gap-2">
                  <code className="font-mono text-xs bg-background border border-border px-1.5 py-0.5 rounded flex-shrink-0">{name}</code>
                  <span className="text-xs text-muted-foreground">{desc} {link && <a href={link} target="_blank" rel="noreferrer" className="text-primary hover:underline ml-1"><ExternalLink className="w-2.5 h-2.5 inline" /></a>}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {apiError && (
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
              <div><p className="text-sm font-medium text-destructive">Publish failed</p><p className="text-xs text-muted-foreground mt-1">{apiError.message}</p></div>
            </div>
            {apiError.missing && <div className="space-y-1">{apiError.missing.map(v => <div key={v} className="text-xs font-mono bg-muted px-2 py-1 rounded">{v}</div>)}</div>}
          </div>
        )}
        {result && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-emerald-500"><CheckCircle className="w-5 h-5" /><span className="font-medium">Published successfully!</span></div>
            <code className="text-xs font-mono bg-muted px-2 py-1.5 rounded block break-all">{result.feedUri}</code>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{result ? "Close" : "Cancel"}</Button>
          {!result && <Button onClick={handlePublish} disabled={publishFeed.isPending}><Upload className="w-4 h-4 mr-2" />{publishFeed.isPending ? "Publishing..." : "Publish"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetFeedKeywordsQueryKey(id) }); queryClient.invalidateQueries({ queryKey: getGetFeedQueryKey(id) }); setNewKeyword(""); toast({ title: "Keyword added" }); },
      onError: () => toast({ title: "Failed to add keyword", variant: "destructive" }),
    });
  }

  function handleDeleteKeyword(kw: Keyword) {
    deleteKeyword.mutate({ id, keywordId: kw.id }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetFeedKeywordsQueryKey(id) }); toast({ title: "Keyword removed" }); },
      onError: () => toast({ title: "Failed to remove keyword", variant: "destructive" }),
    });
  }

  if (loadingFeed) return <div className="p-8"><div className="h-8 w-48 bg-muted rounded animate-pulse mb-4" /><div className="h-32 bg-card border border-card-border rounded-xl animate-pulse" /></div>;
  if (!feed) return <div className="p-8 text-center py-20"><p className="text-muted-foreground">Feed not found</p><Link href="/feeds"><Button variant="outline" className="mt-4">Back to Feeds</Button></Link></div>;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <Link href="/feeds">
          <span className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer mb-4 w-fit"><ArrowLeft className="w-3 h-3" /> Back to Feeds</span>
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-foreground">{feed.displayName}</h1>
              <Badge variant={feed.isActive ? "default" : "secondary"}>{feed.isActive ? "Active" : "Inactive"}</Badge>
              {feed.publishedAt && <Badge variant="outline" className="text-emerald-600 border-emerald-200 dark:border-emerald-800">Published</Badge>}
            </div>
            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground flex-wrap">
              <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">{feed.recordName}</span>
              <span>{feed.postCount.toLocaleString()} posts indexed</span>
              {feed.publishedAt && <span>Published {formatDistanceToNow(new Date(feed.publishedAt), { addSuffix: true })}</span>}
            </div>
            {feed.description && <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">{feed.description}</p>}
          </div>
          <Button onClick={() => setPublishOpen(true)} variant={feed.publishedAt ? "outline" : "default"} className="flex-shrink-0">
            <Upload className="w-4 h-4 mr-2" />{feed.publishedAt ? "Re-publish" : "Publish to Bluesky"}
          </Button>
        </div>
      </motion.div>

      {bskyInfo && (
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="mb-6 bg-gradient-to-r from-primary/10 via-blue-500/5 to-transparent border border-primary/20 rounded-xl p-4">
          <div className="flex items-center gap-4">
            <Heart className="w-5 h-5 text-primary flex-shrink-0" />
            <div>
              <div className="text-sm font-semibold text-foreground">{bskyInfo.likeCount.toLocaleString()} people saved this feed on Bluesky</div>
              {bskyInfo.description && <div className="text-xs text-muted-foreground mt-0.5">{bskyInfo.description}</div>}
            </div>
            <a href={`https://bsky.app/profile/feed/${feed.recordName}`} target="_blank" rel="noreferrer" className="ml-auto text-muted-foreground hover:text-primary transition-colors">
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </motion.div>
      )}

      <div className="flex gap-1 mb-6 border-b border-border">
        {([
          { id: "posts" as TabType, label: "Posts", icon: FileText, count: feed.postCount },
          { id: "analytics" as TabType, label: "Analytics", icon: BarChart3, count: null },
          { id: "keywords" as TabType, label: "Keywords", icon: Hash, count: keywords?.length ?? 0 },
        ]).map(({ id: tabId, label, icon: Icon, count }) => (
          <button
            key={tabId}
            onClick={() => setTab(tabId)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === tabId ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
            {count !== null && <span className={cn("text-xs px-1.5 py-0.5 rounded-full", tab === tabId ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>{count.toLocaleString()}</span>}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {tab === "posts" && (
          <motion.div key="posts" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <div className="bg-card border border-card-border rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">Indexed Posts</span>
                <span className="text-xs text-muted-foreground">{(postsPage?.total ?? 0).toLocaleString()} total</span>
              </div>
              {loadingPosts ? (
                <div className="p-4 space-y-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-14 bg-muted rounded-lg animate-pulse" />)}</div>
              ) : !postsPage || postsPage.posts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-center gap-2 px-4">
                  <FileText className="w-10 h-10 text-muted-foreground/20" />
                  <p className="text-sm text-muted-foreground">No posts indexed yet.</p>
                  <p className="text-xs text-muted-foreground">Add keywords in the Keywords tab to start matching posts from the firehose.</p>
                </div>
              ) : (
                <>
                  <div className="divide-y divide-border">
                    {postsPage.posts.map((post) => (
                      <div key={post.id} className="px-5 py-3.5 hover:bg-muted/20 transition-colors">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <a href={`https://bsky.app/profile/${post.author}`} target="_blank" rel="noreferrer" className="text-xs font-mono text-muted-foreground hover:text-primary transition-colors">{shortenDid(post.author)}</a>
                              <span className="text-muted-foreground/30 text-xs">·</span>
                              <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(post.indexedAt), { addSuffix: true })}</span>
                              {post.likes > 0 && <span className="flex items-center gap-0.5 text-xs text-rose-400"><Heart className="w-2.5 h-2.5" />{post.likes}</span>}
                            </div>
                            <p className="text-sm text-foreground leading-relaxed line-clamp-2">{post.text}</p>
                          </div>
                          <a href={`https://bsky.app/profile/${post.author}/post/${post.uri.split("/").pop()}`} target="_blank" rel="noreferrer" className="flex-shrink-0 text-muted-foreground hover:text-primary transition-colors mt-0.5">
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="px-5 py-3 border-t border-border flex items-center justify-between bg-muted/10">
                    <Button variant="outline" size="sm" onClick={() => { const s=[...cursorStack]; const p=s.pop(); setCursorStack(s); setCursor(p===""?undefined:p); }} disabled={cursorStack.length===0}><ChevronLeft className="w-4 h-4 mr-1"/>Previous</Button>
                    <span className="text-xs text-muted-foreground">{postsPage.posts.length} of {postsPage.total.toLocaleString()}</span>
                    <Button variant="outline" size="sm" onClick={() => { if(postsPage.cursor){setCursorStack(s=>[...s,cursor??""]); setCursor(postsPage.cursor);} }} disabled={!postsPage.cursor}>Next<ChevronRight className="w-4 h-4 ml-1"/></Button>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}

        {tab === "analytics" && (
          <motion.div key="analytics" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-card border border-card-border rounded-xl p-5 shadow-sm">
                <h3 className="text-sm font-semibold mb-3">Hourly Activity (24h)</h3>
                {hourlyChart.length === 0 ? (
                  <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">No activity yet in the last 24 hours.</div>
                ) : (
                  <ResponsiveContainer width="100%" height={160}>
                    <AreaChart data={hourlyChart} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="feedGrad2" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(199 89% 48%)" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="hsl(199 89% 48%)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 13% 88% / 0.3)" />
                      <XAxis dataKey="time" tick={{ fontSize: 10, fill: "hsl(220 9% 45%)" }} tickLine={false} axisLine={false} interval={3} />
                      <YAxis tick={{ fontSize: 10, fill: "hsl(220 9% 45%)" }} tickLine={false} axisLine={false} />
                      <Tooltip {...tooltipStyle()} />
                      <Area type="monotone" dataKey="posts" stroke="hsl(199 89% 48%)" strokeWidth={2} fill="url(#feedGrad2)" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="bg-card border border-card-border rounded-xl p-5 shadow-sm">
                <h3 className="text-sm font-semibold mb-3">Keyword Distribution</h3>
                {pieData.length === 0 ? (
                  <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">Add keywords to see distribution.</div>
                ) : (
                  <div className="flex items-center gap-3">
                    <ResponsiveContainer width={130} height={130}>
                      <PieChart>
                        <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={32} outerRadius={58} paddingAngle={2}>
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
                          <span className="text-muted-foreground/50 flex-shrink-0 w-8 text-right">{k.percentage}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-card border border-card-border rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border"><h3 className="text-sm font-semibold">Top Contributing Authors</h3></div>
              {!topAuthors || topAuthors.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">No author data yet.</div>
              ) : (
                <div className="divide-y divide-border">
                  {topAuthors.slice(0, 10).map((author, i) => (
                    <div key={author.did} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/20 transition-colors">
                      <span className="text-xs text-muted-foreground font-mono w-5 flex-shrink-0 text-right">{i + 1}</span>
                      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Users className="w-3 h-3 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-mono text-foreground truncate">{shortenDid(author.did)}</div>
                        <div className="text-[10px] text-muted-foreground">Last {formatDistanceToNow(new Date(author.latestPostAt), { addSuffix: true })}</div>
                      </div>
                      <Badge variant="secondary" className="text-xs">{author.postCount} posts</Badge>
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

        {tab === "keywords" && (
          <motion.div key="keywords" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <div className="bg-card border border-card-border rounded-xl p-6 shadow-sm">
              <form onSubmit={handleAddKeyword} className="flex gap-2 mb-6">
                <Input value={newKeyword} onChange={e => setNewKeyword(e.target.value)} placeholder="Add a keyword (e.g. bluesky, ai, typescript)..." className="text-sm" data-testid="input-new-keyword" />
                <Button type="submit" disabled={addKeyword.isPending} data-testid="button-add-keyword"><Plus className="w-4 h-4 mr-1.5" />Add</Button>
              </form>

              {(!keywords || keywords.length === 0) ? (
                <div className="flex flex-col items-center justify-center h-40 gap-2 text-center">
                  <Hash className="w-10 h-10 text-muted-foreground/20" />
                  <p className="text-sm text-muted-foreground">No keywords yet. Add keywords to start matching Bluesky posts.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {keywords.map((kw, i) => {
                    const stat = keywordStats?.find(s => s.keyword === kw.keyword);
                    return (
                      <motion.div
                        key={kw.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.04 }}
                        className="flex items-center gap-3 py-2.5 px-4 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                      >
                        <span className="w-2 h-2 rounded-full bg-primary/60 flex-shrink-0" />
                        <span className="font-mono text-sm text-foreground flex-1">{kw.keyword}</span>
                        {stat && (
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-muted-foreground tabular-nums">{stat.postCount.toLocaleString()} posts</span>
                            <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div className="h-full bg-primary/60 rounded-full" style={{ width: `${stat.percentage}%` }} />
                            </div>
                            <span className="text-xs text-muted-foreground w-8 text-right">{stat.percentage}%</span>
                          </div>
                        )}
                        <span className="text-xs text-muted-foreground/50">{formatDistanceToNow(new Date(kw.createdAt), { addSuffix: true })}</span>
                        <button onClick={() => handleDeleteKeyword(kw)} className="text-muted-foreground hover:text-destructive transition-colors" data-testid={`button-delete-keyword-${kw.id}`}>
                          <X className="w-4 h-4" />
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
