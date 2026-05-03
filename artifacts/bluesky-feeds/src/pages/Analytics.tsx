import { useState } from "react";
import {
  useListFeeds, useGetRecentActivity, useGet7DayActivity, useGetTopFeeds,
  useGetFeedKeywordStats, useGetFeedTopAuthors, useGetFeedHourly, useGetBlueskyFeedInfo,
  useGetMyPosts, useGetTopPosts, useGetEngagementOverview, useSyncEngagement,
} from "@workspace/api-client-react";
import type { MyPost, Feed, TopPost } from "@workspace/api-client-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import { format, formatDistanceToNow } from "date-fns";
import {
  TrendingUp, Users, ExternalLink, Heart, Repeat2, MessageCircle, Quote,
  ArrowUpRight, Image, RefreshCw, ChevronLeft, ChevronRight, Zap,
  BarChart2, Activity,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const CHART_COLORS = [
  "hsl(210 100% 58%)",
  "hsl(168 84% 42%)",
  "hsl(43 96% 52%)",
  "hsl(338 80% 58%)",
  "hsl(199 89% 48%)",
  "hsl(262 83% 60%)",
  "hsl(20 90% 55%)",
];

function tooltipStyle() {
  return {
    contentStyle: {
      background: "hsl(240 8% 6%)",
      border: "1px solid hsl(240 4% 14%)",
      borderRadius: "10px",
      fontSize: "11px",
      color: "hsl(0 0% 97%)",
      boxShadow: "0 16px 40px hsl(240 10% 2% / .8)",
      padding: "8px 12px",
    },
    cursor: { stroke: "hsl(210 100% 62% / .2)", strokeWidth: 1 },
  };
}

function formatDay(iso: string) {
  try { return format(new Date(iso), "MMM d"); } catch { return iso; }
}
function formatHour(iso: string) {
  try { return format(new Date(iso), "HH:mm"); } catch { return iso; }
}
function postIdFromUri(uri: string) {
  return uri.split("/").pop() ?? "";
}

// ─── My Posts Tab ────────────────────────────────────────────────────────────

function EngagementBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="h-1 bg-muted rounded-full overflow-hidden flex-1">
      <motion.div
        className="h-full rounded-full"
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        style={{ background: color }}
      />
    </div>
  );
}

function PostCard({ post, rank, maxLikes, maxReposts, maxReplies }: {
  post: MyPost; rank: number; maxLikes: number; maxReposts: number; maxReplies: number;
}) {
  const totalEngagement = post.likes + post.reposts + post.replies + post.quotes;
  const authorDid = post.uri.split("/")[2];
  const postId = postIdFromUri(post.uri);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: rank * 0.03 }}
      className="group bg-card border border-card-border rounded-xl p-4 md:p-5 hover:shadow-sm hover:border-border transition-all duration-150"
    >
      <div className="flex items-start gap-3 md:gap-4">
        {/* Rank */}
        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-muted border border-border flex items-center justify-center mt-0.5">
          <span className="text-[10px] font-bold text-muted-foreground tabular-nums">{rank}</span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-2.5">
            <p className="text-sm text-foreground leading-relaxed line-clamp-3">{post.text}</p>
            <div className="flex items-center gap-1 flex-shrink-0">
              {post.hasImages && <Image className="w-3.5 h-3.5 text-muted-foreground/50" />}
              <a
                href={`https://bsky.app/profile/${authorDid}/post/${postId}`}
                target="_blank"
                rel="noreferrer"
                className="p-1 rounded text-muted-foreground hover:text-primary transition-colors"
              >
                <ArrowUpRight className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>

          {/* Stat bars */}
          <div className="space-y-1.5 mb-3">
            {[
              { label: "Likes", value: post.likes, max: maxLikes, color: "hsl(338 80% 58%)" },
              { label: "Reposts", value: post.reposts, max: maxReposts, color: "hsl(168 84% 42%)" },
              { label: "Replies", value: post.replies, max: maxReplies, color: "hsl(210 100% 58%)" },
            ].map(({ label, value, max, color }) => (
              <div key={label} className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground w-11 flex-shrink-0">{label}</span>
                <EngagementBar value={value} max={max} color={color} />
                <span className="text-[10px] font-semibold text-foreground tabular-nums w-7 text-right flex-shrink-0">{value.toLocaleString()}</span>
              </div>
            ))}
          </div>

          {/* Footer row */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              <span className="flex items-center gap-1 text-[11px] text-rose-500 font-medium">
                <Heart className="w-3 h-3" />{post.likes}
              </span>
              <span className="flex items-center gap-1 text-[11px] text-emerald-600 font-medium">
                <Repeat2 className="w-3 h-3" />{post.reposts}
              </span>
              <span className="flex items-center gap-1 text-[11px] text-blue-500 font-medium">
                <MessageCircle className="w-3 h-3" />{post.replies}
              </span>
              {post.quotes > 0 && (
                <span className="flex items-center gap-1 text-[11px] text-purple-500 font-medium">
                  <Quote className="w-3 h-3" />{post.quotes}
                </span>
              )}
            </div>
            <span className="text-[10px] text-muted-foreground/50 ml-auto">
              {formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}
            </span>
            {totalEngagement > 0 && (
              <span className="text-[10px] bg-primary/8 text-primary border border-primary/15 px-2 py-0.5 rounded-full font-medium">
                {totalEngagement} engagements
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function MyPostsTab() {
  const [cursor, setCursor] = useState<string | undefined>();
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  const { data, isLoading, isFetching, refetch } = useGetMyPosts(
    { limit: 20, cursor },
    { query: { queryKey: ["my-posts", cursor], staleTime: 60_000 } },
  );

  const posts = data?.posts ?? [];
  const stats = data?.stats;

  const maxLikes = Math.max(...posts.map(p => p.likes), 1);
  const maxReposts = Math.max(...posts.map(p => p.reposts), 1);
  const maxReplies = Math.max(...posts.map(p => p.replies), 1);

  // Engagement chart: posts by date with their engagement
  const engagementChart = posts
    .slice()
    .reverse()
    .map(p => ({
      date: formatDay(p.createdAt),
      likes: p.likes,
      reposts: p.reposts,
      replies: p.replies,
    }));

  const topPost = posts.reduce((best, p) => {
    const score = p.likes + p.reposts * 2 + p.replies + p.quotes;
    const bestScore = best.likes + best.reposts * 2 + best.replies + best.quotes;
    return score > bestScore ? p : best;
  }, posts[0]);

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Top Stats */}
      {stats && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-2 sm:grid-cols-4 gap-3"
        >
          {[
            { label: "Total Likes", value: stats.totalLikes, icon: Heart, color: "text-rose-500", bg: "bg-rose-500/8 border-rose-500/20" },
            { label: "Total Reposts", value: stats.totalReposts, icon: Repeat2, color: "text-emerald-600", bg: "bg-emerald-500/8 border-emerald-500/20" },
            { label: "Total Replies", value: stats.totalReplies, icon: MessageCircle, color: "text-blue-500", bg: "bg-blue-500/8 border-blue-500/20" },
            { label: "Total Quotes", value: stats.totalQuotes, icon: Quote, color: "text-purple-500", bg: "bg-purple-500/8 border-purple-500/20" },
          ].map(({ label, value, icon: Icon, color, bg }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className={cn("rounded-xl border p-4 text-center", bg)}
            >
              <Icon className={cn("w-4 h-4 mx-auto mb-2", color)} />
              <div className={cn("text-xl md:text-2xl font-bold tabular-nums", color)}>{value.toLocaleString()}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{label}</div>
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Top post highlight */}
      {topPost && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-gradient-to-r from-primary/5 via-primary/3 to-transparent border border-primary/20 rounded-xl p-4 md:p-5"
        >
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Zap className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-primary mb-1">Top Performing Post</div>
              <p className="text-sm text-foreground line-clamp-2 leading-relaxed">{topPost.text}</p>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                <span className="flex items-center gap-1 text-xs text-rose-500 font-medium"><Heart className="w-3 h-3" />{topPost.likes}</span>
                <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium"><Repeat2 className="w-3 h-3" />{topPost.reposts}</span>
                <span className="flex items-center gap-1 text-xs text-blue-500 font-medium"><MessageCircle className="w-3 h-3" />{topPost.replies}</span>
                <span className="text-[11px] text-muted-foreground ml-auto">{formatDistanceToNow(new Date(topPost.createdAt), { addSuffix: true })}</span>
              </div>
            </div>
            <a
              href={`https://bsky.app/profile/${topPost.uri.split("/")[2]}/post/${postIdFromUri(topPost.uri)}`}
              target="_blank"
              rel="noreferrer"
              className="flex-shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/8 transition-colors"
            >
              <ArrowUpRight className="w-4 h-4" />
            </a>
          </div>
        </motion.div>
      )}

      {/* Engagement chart */}
      {engagementChart.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="bg-card border border-card-border rounded-xl p-5 md:p-6"
        >
          <h3 className="text-sm font-semibold text-foreground mb-4">Engagement Across Recent Posts</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={engagementChart} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 6% 90% / .5)" />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: "hsl(240 4% 46%)" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(240 4% 46%)" }} tickLine={false} axisLine={false} />
              <Tooltip {...tooltipStyle()} />
              <Bar dataKey="likes" name="Likes" fill="hsl(338 80% 58%)" radius={[3, 3, 0, 0]} stackId="a" />
              <Bar dataKey="reposts" name="Reposts" fill="hsl(168 84% 42%)" radius={[0, 0, 0, 0]} stackId="a" />
              <Bar dataKey="replies" name="Replies" fill="hsl(210 100% 58%)" radius={[3, 3, 0, 0]} stackId="a" />
            </BarChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-4 mt-3 justify-center">
            {[
              { label: "Likes", color: "hsl(338 80% 58%)" },
              { label: "Reposts", color: "hsl(168 84% 42%)" },
              { label: "Replies", color: "hsl(210 100% 58%)" },
            ].map(({ label, color }) => (
              <div key={label} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: color }} />
                <span className="text-[11px] text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Posts list header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">All Posts</h3>
        <div className="flex items-center gap-2">
          {isFetching && <RefreshCw className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={() => refetch()}
          >
            <RefreshCw className="w-3 h-3" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Posts */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-36 bg-card border border-card-border rounded-xl animate-pulse" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
          <div className="w-12 h-12 rounded-2xl bg-muted border border-border flex items-center justify-center">
            <BarChart2 className="w-6 h-6 text-muted-foreground/40" />
          </div>
          <p className="text-sm text-muted-foreground">No posts found. Make sure <code className="text-xs bg-muted px-1 rounded font-mono">FEEDGEN_PUBLISHER_DID</code> is set.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((post, i) => (
            <PostCard
              key={post.uri}
              post={post}
              rank={i + 1 + cursorStack.length * 20}
              maxLikes={maxLikes}
              maxReposts={maxReposts}
              maxReplies={maxReplies}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {(cursorStack.length > 0 || data?.cursor) && (
        <div className="flex items-center justify-between pt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={cursorStack.length === 0}
            onClick={() => {
              const s = [...cursorStack];
              const p = s.pop();
              setCursorStack(s);
              setCursor(p === "" ? undefined : p);
            }}
            className="gap-1 text-xs h-8"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Newer
          </Button>
          <span className="text-xs text-muted-foreground">Page {cursorStack.length + 1}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={!data?.cursor}
            onClick={() => {
              if (data?.cursor) {
                setCursorStack(s => [...s, cursor ?? ""]);
                setCursor(data.cursor!);
              }
            }}
            className="gap-1 text-xs h-8"
          >
            Older <ChevronRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Feed Analytics Tab ───────────────────────────────────────────────────────

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-40 gap-3">
      <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
        <TrendingUp className="w-5 h-5 text-muted-foreground/30" />
      </div>
      <p className="text-xs text-muted-foreground text-center max-w-[200px]">{message}</p>
    </div>
  );
}

function SectionCard({ title, subtitle, children, className }: {
  title: string; subtitle?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("bg-card border border-card-border rounded-xl overflow-hidden", className)}
    >
      <div className="px-5 md:px-6 py-4 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      <div className="p-5 md:p-6">{children}</div>
    </motion.div>
  );
}

function FeedAnalyticsTab({ feeds }: { feeds: Feed[] | undefined }) {
  const [selectedFeedId, setSelectedFeedId] = useState<string>("all");

  const { data: activity24h } = useGetRecentActivity();
  const { data: activity7d } = useGet7DayActivity();
  const { data: topFeeds } = useGetTopFeeds();

  const numericFeedId = selectedFeedId !== "all" ? parseInt(selectedFeedId) : null;
  const selectedFeed = feeds?.find(f => f.id === numericFeedId);

  const { data: keywordStats } = useGetFeedKeywordStats(numericFeedId!, {
    query: { enabled: numericFeedId !== null, queryKey: ["keyword-stats", numericFeedId] },
  });
  const { data: topAuthors } = useGetFeedTopAuthors(numericFeedId!, {
    query: { enabled: numericFeedId !== null, queryKey: ["top-authors", numericFeedId] },
  });
  const { data: feedHourly } = useGetFeedHourly(numericFeedId!, {
    query: { enabled: numericFeedId !== null, queryKey: ["feed-hourly", numericFeedId] },
  });
  const { data: bskyFeedInfo } = useGetBlueskyFeedInfo(selectedFeed?.recordName ?? "", {
    query: { enabled: !!selectedFeed?.publishedAt && !!selectedFeed?.recordName, retry: false, queryKey: ["bsky-feed-info", selectedFeed?.recordName] },
  });

  const chart24h = (activity24h || []).map(b => ({ time: formatHour(b.hour), posts: b.count }));
  const chart7d = (activity7d || []).map(b => ({ day: formatDay(b.day), posts: b.count }));
  const feedHourlyChart = (feedHourly || []).map(b => ({ time: formatHour(b.hour), posts: b.count }));
  const pieData = (keywordStats || []).slice(0, 7).map((k, i) => ({
    name: k.keyword, value: k.postCount, color: CHART_COLORS[i % CHART_COLORS.length],
  }));
  const totalForAllFeeds = (topFeeds || []).reduce((s, f) => s + f.postCount, 0);

  return (
    <div className="space-y-4">
      {/* Feed selector */}
      <div className="flex items-center gap-3">
        <Select value={selectedFeedId} onValueChange={setSelectedFeedId}>
          <SelectTrigger className="w-full sm:w-52 text-sm" data-testid="select-feed">
            <SelectValue placeholder="All Feeds" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Feeds</SelectItem>
            {(feeds || []).map(f => (
              <SelectItem key={f.id} value={String(f.id)}>{f.displayName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedFeed && bskyFeedInfo && (
        <motion.div
          initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
          className="bg-card border border-card-border rounded-xl p-4 md:p-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center flex-shrink-0">
              <TrendingUp className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-foreground">{bskyFeedInfo.displayName}</div>
              <div className="text-xs text-muted-foreground">Published on Bluesky</div>
            </div>
            <div className="flex items-center gap-4">
              <div>
                <div className="text-xl md:text-2xl font-bold text-primary tabular-nums">{bskyFeedInfo.likeCount.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">People Saved</div>
              </div>
              <a
                href={`https://bsky.app/profile/did:plc:oobxeg4vljlqpp62k7fd6flp/feed/${selectedFeed.recordName}`}
                target="_blank"
                rel="noreferrer"
                className="p-2 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/8 transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </div>
        </motion.div>
      )}

      {selectedFeedId === "all" ? (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SectionCard title="24-Hour Activity" subtitle="Posts indexed per hour across all feeds">
              {chart24h.length === 0 ? (
                <EmptyChart message="No activity in the last 24 hours." />
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={chart24h} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="grad1" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(210 100% 62%)" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="hsl(210 100% 62%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 6% 90% / .5)" />
                    <XAxis dataKey="time" tick={{ fontSize: 10, fill: "hsl(240 4% 46%)" }} tickLine={false} axisLine={false} interval={3} />
                    <YAxis tick={{ fontSize: 10, fill: "hsl(240 4% 46%)" }} tickLine={false} axisLine={false} />
                    <Tooltip {...tooltipStyle()} />
                    <Area type="monotone" dataKey="posts" stroke="hsl(210 100% 58%)" strokeWidth={2} fill="url(#grad1)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </SectionCard>

            <SectionCard title="7-Day Trend" subtitle="Daily post volume over the past week">
              {chart7d.length === 0 ? (
                <EmptyChart message="No data for the past 7 days yet." />
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={chart7d} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 6% 90% / .5)" />
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(240 4% 46%)" }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "hsl(240 4% 46%)" }} tickLine={false} axisLine={false} />
                    <Tooltip {...tooltipStyle()} />
                    <Bar dataKey="posts" fill="hsl(168 84% 42%)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </SectionCard>
          </div>

          <SectionCard title="Feed Performance Breakdown" subtitle="Posts indexed per feed">
            {!topFeeds || topFeeds.length === 0 ? (
              <EmptyChart message="No feeds yet. Create feeds to see performance data." />
            ) : (
              <div className="space-y-4">
                {topFeeds.map((feed, i) => {
                  const pct = totalForAllFeeds > 0 ? (feed.postCount / totalForAllFeeds) * 100 : 0;
                  return (
                    <div key={feed.feedId} className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground/50 font-mono w-4 text-right flex-shrink-0">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-sm font-medium text-foreground truncate">{feed.displayName}</span>
                          <span className="text-xs text-muted-foreground ml-2 flex-shrink-0 tabular-nums">{feed.postCount.toLocaleString()}</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ delay: i * 0.05, duration: 0.6, ease: "easeOut" }}
                            className="h-full rounded-full"
                            style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                          />
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground w-10 text-right flex-shrink-0">{pct.toFixed(1)}%</span>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SectionCard title="Feed Activity (24h)" subtitle={`Hourly posts for ${selectedFeed?.displayName ?? "this feed"}`}>
              {!feedHourly || feedHourlyChart.length === 0 ? (
                <EmptyChart message="No activity in the last 24 hours for this feed." />
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={feedHourlyChart} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="feedGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(168 84% 42%)" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="hsl(168 84% 42%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 6% 90% / .5)" />
                    <XAxis dataKey="time" tick={{ fontSize: 10, fill: "hsl(240 4% 46%)" }} tickLine={false} axisLine={false} interval={3} />
                    <YAxis tick={{ fontSize: 10, fill: "hsl(240 4% 46%)" }} tickLine={false} axisLine={false} />
                    <Tooltip {...tooltipStyle()} />
                    <Area type="monotone" dataKey="posts" stroke="hsl(168 84% 42%)" strokeWidth={2} fill="url(#feedGrad)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </SectionCard>

            <SectionCard title="Keyword Distribution" subtitle="Which keywords drive the most posts">
              {!keywordStats || keywordStats.length === 0 ? (
                <EmptyChart message="No keyword data yet. Add keywords to this feed." />
              ) : (
                <div className="flex items-center gap-4">
                  <div className="flex-shrink-0">
                    <ResponsiveContainer width={130} height={130}>
                      <PieChart>
                        <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={32} outerRadius={56} paddingAngle={3}>
                          {pieData.map((entry, i) => (
                            <Cell key={i} fill={entry.color} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex-1 space-y-1.5 min-w-0">
                    {(keywordStats || []).slice(0, 7).map((k, i) => (
                      <div key={k.keyword} className="flex items-center gap-2 text-xs">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                        <span className="font-mono text-foreground truncate flex-1">{k.keyword}</span>
                        <span className="text-muted-foreground flex-shrink-0 tabular-nums">{k.postCount.toLocaleString()}</span>
                        <span className="text-muted-foreground/40 flex-shrink-0 w-8 text-right">{k.percentage}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </SectionCard>
          </div>

          <SectionCard title="Top Contributing Authors" subtitle="Accounts whose posts appear most in this feed">
            {!topAuthors || topAuthors.length === 0 ? (
              <EmptyChart message="No author data yet. Posts will appear here as they're indexed." />
            ) : (
              <div className="space-y-1">
                {topAuthors.slice(0, 15).map((author, i) => (
                  <motion.div
                    key={author.did}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.025 }}
                    className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-muted/40 transition-colors group"
                  >
                    <span className="text-[10px] text-muted-foreground/40 font-mono w-4 text-right flex-shrink-0">{i + 1}</span>
                    <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/15 flex items-center justify-center flex-shrink-0">
                      <Users className="w-3 h-3 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-mono text-foreground truncate">{author.did.substring(0, 24)}…</div>
                      <div className="text-[10px] text-muted-foreground">
                        Last {formatDistanceToNow(new Date(author.latestPostAt), { addSuffix: true })}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs bg-secondary text-secondary-foreground border border-border px-2 py-0.5 rounded-full tabular-nums">{author.postCount} posts</span>
                      <a
                        href={`https://bsky.app/profile/${author.did}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted-foreground hover:text-primary transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}

// ─── Feed Posts Tab ───────────────────────────────────────────────────────────

function TopPostCard({ post, rank, maxEngagement }: {
  post: TopPost; rank: number; maxEngagement: number;
}) {
  const authorHandle = post.author.includes(".") ? `@${post.author}` : post.author.replace("did:plc:", "@");
  const authorDid = post.uri.split("/")[2];
  const postId = post.uri.split("/").pop() ?? "";
  const pctLikes = maxEngagement > 0 ? Math.min((post.likes / maxEngagement) * 100, 100) : 0;
  const pctReposts = maxEngagement > 0 ? Math.min((post.reposts / maxEngagement) * 100, 100) : 0;
  const pctReplies = maxEngagement > 0 ? Math.min((post.replies / maxEngagement) * 100, 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: rank * 0.03 }}
      className="group bg-card border border-card-border rounded-xl p-4 md:p-5 hover:shadow-sm hover:border-border transition-all duration-150"
    >
      <div className="flex items-start gap-3 md:gap-4">
        {/* Rank badge */}
        <div className={cn(
          "flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5 text-[10px] font-bold tabular-nums",
          rank === 1 ? "bg-yellow-500/15 border border-yellow-500/30 text-yellow-600" :
          rank === 2 ? "bg-zinc-400/15 border border-zinc-400/30 text-zinc-500" :
          rank === 3 ? "bg-amber-600/15 border border-amber-600/30 text-amber-700" :
          "bg-muted border border-border text-muted-foreground"
        )}>
          {rank}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Author row */}
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <a
              href={`https://bsky.app/profile/${authorDid}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-semibold text-primary/80 hover:text-primary truncate transition-colors"
            >
              {authorHandle}
            </a>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="text-[10px] text-muted-foreground/60">
                {formatDistanceToNow(new Date(post.indexedAt), { addSuffix: true })}
              </span>
              <a
                href={`https://bsky.app/profile/${authorDid}/post/${postId}`}
                target="_blank"
                rel="noreferrer"
                className="p-1 rounded text-muted-foreground hover:text-primary transition-colors"
              >
                <ArrowUpRight className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>

          {/* Post text */}
          <p className="text-sm text-foreground leading-relaxed line-clamp-2 mb-3">{post.text}</p>

          {/* Engagement bars */}
          <div className="space-y-1.5 mb-3">
            {[
              { label: "Likes", value: post.likes, pct: pctLikes, color: "hsl(338 80% 58%)" },
              { label: "Reposts", value: post.reposts, pct: pctReposts, color: "hsl(168 84% 42%)" },
              { label: "Replies", value: post.replies, pct: pctReplies, color: "hsl(210 100% 58%)" },
            ].map(({ label, value, pct, color }) => (
              <div key={label} className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground w-11 flex-shrink-0">{label}</span>
                <div className="h-1 bg-muted rounded-full overflow-hidden flex-1">
                  <motion.div
                    className="h-full rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                    style={{ background: color }}
                  />
                </div>
                <span className="text-[10px] font-semibold text-foreground tabular-nums w-7 text-right flex-shrink-0">
                  {value.toLocaleString()}
                </span>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="flex items-center gap-1 text-[11px] text-rose-500 font-medium">
              <Heart className="w-3 h-3" />{post.likes.toLocaleString()}
            </span>
            <span className="flex items-center gap-1 text-[11px] text-emerald-600 font-medium">
              <Repeat2 className="w-3 h-3" />{post.reposts.toLocaleString()}
            </span>
            <span className="flex items-center gap-1 text-[11px] text-blue-500 font-medium">
              <MessageCircle className="w-3 h-3" />{post.replies.toLocaleString()}
            </span>
            {post.quotes > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-purple-500 font-medium">
                <Quote className="w-3 h-3" />{post.quotes.toLocaleString()}
              </span>
            )}
            {post.totalEngagement > 0 && (
              <span className="ml-auto text-[10px] bg-primary/8 text-primary border border-primary/15 px-2 py-0.5 rounded-full font-medium">
                {post.totalEngagement.toLocaleString()} total
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function FeedPostsTab({ feeds }: { feeds: Feed[] | undefined }) {
  const [selectedFeedId, setSelectedFeedId] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"total" | "likes" | "reposts" | "replies">("total");
  const { toast } = useToast();

  const numericFeedId = selectedFeedId !== "all" ? parseInt(selectedFeedId) : undefined;

  const params = {
    ...(numericFeedId ? { feedId: numericFeedId } : {}),
    limit: 20,
    sortBy,
  };

  const { data: topPosts, isLoading: loadingPosts, refetch: refetchPosts } = useGetTopPosts(params, {
    query: { queryKey: ["top-posts", selectedFeedId, sortBy], staleTime: 30_000 },
  });

  const { data: overview, isLoading: loadingOverview, refetch: refetchOverview } = useGetEngagementOverview(
    numericFeedId ? { feedId: numericFeedId } : {},
    { query: { queryKey: ["engagement-overview", selectedFeedId], staleTime: 30_000 } },
  );

  const { mutate: syncEngagement, isPending: isSyncing } = useSyncEngagement({
    mutation: {
      onSuccess: (data) => {
        toast({
          title: "Engagement synced",
          description: `Updated ${data.updated} posts${data.errors > 0 ? `, ${data.errors} errors` : ""}.`,
        });
        refetchPosts();
        refetchOverview();
      },
      onError: () => toast({ title: "Sync failed", description: "Could not sync engagement data.", variant: "destructive" }),
    },
  });

  const posts = topPosts ?? [];
  const maxEngagement = Math.max(...posts.map(p => p.likes + p.reposts + p.replies), 1);
  const hasSyncedData = (overview?.syncedPosts ?? 0) > 0;

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Controls row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <Select value={selectedFeedId} onValueChange={setSelectedFeedId}>
          <SelectTrigger className="w-full sm:w-52 text-sm">
            <SelectValue placeholder="All Feeds" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Feeds</SelectItem>
            {(feeds || []).map(f => (
              <SelectItem key={f.id} value={String(f.id)}>{f.displayName}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={sortBy} onValueChange={v => setSortBy(v as typeof sortBy)}>
          <SelectTrigger className="w-full sm:w-40 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="total">Total Engagement</SelectItem>
            <SelectItem value="likes">Most Liked</SelectItem>
            <SelectItem value="reposts">Most Reposted</SelectItem>
            <SelectItem value="replies">Most Replied</SelectItem>
          </SelectContent>
        </Select>

        <div className="sm:ml-auto">
          <Button
            size="sm"
            variant="outline"
            onClick={() => syncEngagement({ data: { feedId: numericFeedId ?? null } })}
            disabled={isSyncing}
            className="text-xs gap-1.5"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", isSyncing && "animate-spin")} />
            {isSyncing ? "Syncing…" : "Sync Engagement"}
          </Button>
        </div>
      </div>

      {/* Aggregate overview */}
      {overview && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Likes", value: overview.totalLikes, icon: Heart, color: "text-rose-500", bg: "bg-rose-500/8 border-rose-500/20" },
            { label: "Total Reposts", value: overview.totalReposts, icon: Repeat2, color: "text-emerald-600", bg: "bg-emerald-500/8 border-emerald-500/20" },
            { label: "Total Replies", value: overview.totalReplies, icon: MessageCircle, color: "text-blue-500", bg: "bg-blue-500/8 border-blue-500/20" },
            { label: "Total Quotes", value: overview.totalQuotes, icon: Quote, color: "text-purple-500", bg: "bg-purple-500/8 border-purple-500/20" },
          ].map(({ label, value, icon: Icon, color, bg }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className={cn("rounded-xl border p-4 flex flex-col gap-2", bg)}
            >
              <div className="flex items-center gap-2">
                <Icon className={cn("w-3.5 h-3.5", color)} />
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
              <div className="text-2xl font-bold text-foreground tabular-nums">{value.toLocaleString()}</div>
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Summary banner */}
      {overview && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="bg-card border border-card-border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3"
        >
          <div className="flex items-center gap-3 flex-1">
            <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center flex-shrink-0">
              <Zap className="w-4 h-4 text-primary" />
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground">
                {overview.totalEngagement.toLocaleString()} total engagements
              </div>
              <div className="text-xs text-muted-foreground">
                across {overview.totalPosts.toLocaleString()} indexed posts
                {overview.syncedPosts > 0 && ` · ${overview.syncedPosts.toLocaleString()} with live data`}
                {overview.avgLikesPerPost > 0 && ` · ${overview.avgLikesPerPost.toFixed(1)} avg likes`}
              </div>
            </div>
          </div>
          {!hasSyncedData && (
            <div className="text-xs text-amber-600 bg-amber-500/8 border border-amber-500/20 rounded-lg px-3 py-2">
              No engagement data yet — click "Sync Engagement" to fetch live stats from Bluesky.
            </div>
          )}
        </motion.div>
      )}

      {/* Top posts list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">
            Top Posts by {sortBy === "total" ? "Total Engagement" : sortBy === "likes" ? "Likes" : sortBy === "reposts" ? "Reposts" : "Replies"}
          </h3>
          {posts.length > 0 && (
            <span className="text-xs text-muted-foreground">{posts.length} posts</span>
          )}
        </div>

        {loadingPosts ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-32 bg-card border border-card-border rounded-xl animate-pulse" />
            ))}
          </div>
        ) : posts.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <BarChart2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium">No posts indexed yet</p>
            <p className="text-xs mt-1">Create a feed and let it index posts to see analytics here.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {posts.map((post, i) => (
              <TopPostCard
                key={post.uri}
                post={post}
                rank={i + 1}
                maxEngagement={maxEngagement}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

type AnalyticsTab = "my-posts" | "feed-posts" | "feeds";

export default function Analytics() {
  const [tab, setTab] = useState<AnalyticsTab>("my-posts");
  const { data: feeds } = useListFeeds();

  return (
    <div className="px-4 py-5 md:px-8 md:py-8 max-w-7xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="mb-6 md:mb-8">
        <h1 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">Analytics</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Post performance and feed audience insights</p>
      </motion.div>

      {/* Tab Switch */}
      <div className="flex gap-1 border-b border-border mb-6 overflow-x-auto scrollbar-thin -mx-4 px-4 md:mx-0 md:px-0">
        {[
          { id: "my-posts" as AnalyticsTab, label: "My Posts", icon: Activity },
          { id: "feed-posts" as AnalyticsTab, label: "Feed Posts", icon: TrendingUp },
          { id: "feeds" as AnalyticsTab, label: "Feed Stats", icon: BarChart2 },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-2 px-4 md:px-5 py-3 text-sm font-medium border-b-2 -mb-px transition-all whitespace-nowrap flex-shrink-0",
              tab === id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
            )}
          >
            <Icon className="w-3.5 h-3.5 flex-shrink-0" />
            {label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {tab === "my-posts" && (
          <motion.div key="my-posts" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <MyPostsTab />
          </motion.div>
        )}
        {tab === "feed-posts" && (
          <motion.div key="feed-posts" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <FeedPostsTab feeds={feeds} />
          </motion.div>
        )}
        {tab === "feeds" && (
          <motion.div key="feeds" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <FeedAnalyticsTab feeds={feeds} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
