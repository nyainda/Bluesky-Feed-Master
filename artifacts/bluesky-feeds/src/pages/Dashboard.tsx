import { useState, useRef, useEffect } from "react";
import {
  useGetStatsOverview, useGetRecentActivity, useGetTopFeeds,
  useGetFirehoseStatus, useGetBlueskyProfile, useGet7DayActivity,
} from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Wifi, WifiOff, Activity, Rss, FileText, Clock, TrendingUp, TrendingDown, Users, Zap, ExternalLink, ArrowUpRight } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

function formatUptime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatHour(iso: string) {
  try { return format(new Date(iso), "HH:mm"); } catch { return iso; }
}
function formatDay(iso: string) {
  try { return format(new Date(iso), "MMM d"); } catch { return iso; }
}

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
    cursor: { stroke: "hsl(210 100% 62% / .25)", strokeWidth: 1 },
  };
}

function StatCard({ label, value, icon: Icon, sub, trend, accent = false, delay = 0 }: {
  label: string; value: string | number; icon: React.ElementType;
  sub?: string; trend?: "up" | "down" | null; accent?: boolean; delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      className={cn(
        "relative bg-card border border-card-border rounded-xl p-5 overflow-hidden group",
        "hover:shadow-md transition-all duration-200 hover:-translate-y-px",
      )}
    >
      <div className={cn(
        "absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-xl",
        accent ? "bg-gradient-to-br from-primary/4 to-transparent" : "bg-gradient-to-br from-muted/60 to-transparent",
      )} />
      <div className="relative">
        <div className="flex items-start justify-between mb-4">
          <div className={cn(
            "w-9 h-9 rounded-lg flex items-center justify-center",
            accent ? "bg-primary/10 ring-1 ring-primary/15" : "bg-muted ring-1 ring-border",
          )}>
            <Icon className={cn("w-4 h-4", accent ? "text-primary" : "text-muted-foreground")} />
          </div>
          {trend && (
            <div className={cn(
              "flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full",
              trend === "up" ? "text-emerald-600 bg-emerald-500/10" : "text-red-500 bg-red-500/10",
            )}>
              {trend === "up" ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            </div>
          )}
        </div>
        <div className="text-2xl font-bold text-foreground tabular-nums tracking-tight">{value}</div>
        <div className="text-xs text-muted-foreground mt-1 font-medium">{label}</div>
        {sub && <div className="text-xs text-muted-foreground/50 mt-0.5">{sub}</div>}
      </div>
    </motion.div>
  );
}

function ProfileBanner() {
  const { data: profile } = useGetBlueskyProfile({
    query: { retry: false, queryKey: ["profile-dashboard"] },
  });
  if (!profile) return (
    <div className="mb-6 h-24 bg-card border border-card-border rounded-xl animate-pulse" />
  );
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6 bg-card border border-card-border rounded-xl p-4 md:p-5"
    >
      <div className="flex items-center gap-3 md:gap-5">
        {profile.avatar ? (
          <img src={profile.avatar} alt={profile.handle} className="w-12 h-12 md:w-14 md:h-14 rounded-full ring-2 ring-border flex-shrink-0 object-cover" />
        ) : (
          <div className="w-12 h-12 md:w-14 md:h-14 rounded-full bg-primary/15 border border-primary/20 flex items-center justify-center text-primary text-xl font-bold flex-shrink-0">
            {(profile.displayName || profile.handle)[0].toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-base font-bold text-foreground leading-tight">{profile.displayName || profile.handle}</div>
          <div className="text-sm text-muted-foreground">@{profile.handle}</div>
          {profile.description && (
            <div className="text-xs text-muted-foreground/60 mt-0.5 truncate max-w-xs hidden sm:block">{profile.description}</div>
          )}
        </div>
        <div className="hidden sm:flex gap-5 md:gap-8 flex-shrink-0">
          {[
            { label: "Followers", value: profile.followersCount },
            { label: "Following", value: profile.followsCount },
            { label: "Posts", value: profile.postsCount },
          ].map(({ label, value }) => (
            <div key={label} className="text-center">
              <div className="text-lg md:text-xl font-bold text-foreground tabular-nums">{value.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
        <a
          href={`https://bsky.app/profile/${profile.handle}`}
          target="_blank"
          rel="noreferrer"
          className="flex-shrink-0 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        >
          <ArrowUpRight className="w-4 h-4" />
        </a>
      </div>
      {/* Mobile stats */}
      <div className="flex gap-4 mt-3 pt-3 border-t border-border sm:hidden">
        {[
          { label: "Followers", value: profile.followersCount },
          { label: "Following", value: profile.followsCount },
          { label: "Posts", value: profile.postsCount },
        ].map(({ label, value }) => (
          <div key={label} className="text-center flex-1">
            <div className="text-base font-bold text-foreground tabular-nums">{value.toLocaleString()}</div>
            <div className="text-[10px] text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

const SPARKLINE_MAX = 20;

function usePostsPerMin(postsIndexedTotal: number | undefined) {
  const prevRef = useRef<{ total: number; ts: number } | null>(null);
  const [rate, setRate] = useState(0);
  const [sparkline, setSparkline] = useState<{ t: number; v: number }[]>([]);

  useEffect(() => {
    if (postsIndexedTotal == null) return;
    const now = Date.now();
    if (prevRef.current) {
      const deltaPosts = postsIndexedTotal - prevRef.current.total;
      const deltaMinutes = (now - prevRef.current.ts) / 60_000;
      const ppm = deltaMinutes > 0 ? Math.round(deltaPosts / deltaMinutes) : 0;
      setRate(ppm);
      setSparkline(prev => {
        const next = [...prev, { t: now, v: ppm }];
        return next.slice(-SPARKLINE_MAX);
      });
    }
    prevRef.current = { total: postsIndexedTotal, ts: now };
  }, [postsIndexedTotal]);

  return { rate, sparkline };
}

export default function Dashboard() {
  const { data: overview, isLoading } = useGetStatsOverview();
  const { data: activity } = useGetRecentActivity();
  const { data: activity7d } = useGet7DayActivity();
  const { data: topFeeds } = useGetTopFeeds();
  const { data: firehose } = useGetFirehoseStatus({ query: { refetchInterval: 5000, queryKey: ["firehose-dash"] } });

  const { rate: postsPerMin, sparkline } = usePostsPerMin(firehose?.postsIndexedTotal);

  const chart24h = (activity || []).map(b => ({ time: formatHour(b.hour), posts: b.count }));
  const chart7d = (activity7d || []).map(b => ({ day: formatDay(b.day), posts: b.count }));
  const totalForFeeds = (topFeeds || []).reduce((s, f) => s + f.postCount, 0);

  return (
    <div className="px-4 py-5 md:px-8 md:py-8 max-w-7xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="mb-5">
        <h1 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Real-time overview of your Bluesky feed generator</p>
      </motion.div>

      <ProfileBanner />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-5 md:mb-6">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-card border border-card-border rounded-xl p-5 h-28 animate-pulse" />
          ))
        ) : (
          <>
            <StatCard label="Total Feeds" value={overview?.totalFeeds ?? 0} icon={Rss}
              sub={`${overview?.activeFeeds ?? 0} active`} accent delay={0} />
            <StatCard label="Posts Indexed" value={(overview?.totalPosts ?? 0).toLocaleString()} icon={FileText}
              sub={`${overview?.postsLast1h ?? 0} last hour`} delay={0.05} />
            <StatCard label="Posts 24h" value={(overview?.postsLast24h ?? 0).toLocaleString()} icon={Activity}
              trend={overview && overview.postsLast24h > 0 ? "up" : null} delay={0.1} />
            <StatCard label="Uptime" value={formatUptime(overview?.uptime ?? 0)} icon={Clock}
              sub="continuously running" delay={0.15} />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6 mb-4 md:mb-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="lg:col-span-2 bg-card border border-card-border rounded-xl p-5 md:p-6"
        >
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Post Activity</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Posts indexed in the last 24 hours</p>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-500 bg-emerald-500/10 border border-emerald-500/15 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live
            </div>
          </div>
          {chart24h.length === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center text-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
                <Activity className="w-6 h-6 text-muted-foreground/40" />
              </div>
              <p className="text-sm text-muted-foreground max-w-xs">No activity yet. Add keywords to your feeds to start indexing posts.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={chart24h} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="grad24h" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(210 100% 62%)" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="hsl(210 100% 62%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 6% 90% / .5)" />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: "hsl(240 4% 46%)" }} tickLine={false} axisLine={false} interval={3} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(240 4% 46%)" }} tickLine={false} axisLine={false} />
                <Tooltip {...tooltipStyle()} />
                <Area type="monotone" dataKey="posts" stroke="hsl(210 100% 58%)" strokeWidth={2} fill="url(#grad24h)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="bg-card border border-card-border rounded-xl p-5 md:p-6"
        >
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-semibold text-foreground">Top Feeds</h2>
            <Link href="/feeds">
              <span className="text-xs text-muted-foreground hover:text-primary transition-colors cursor-pointer flex items-center gap-0.5">
                View all <ArrowUpRight className="w-3 h-3" />
              </span>
            </Link>
          </div>
          {!topFeeds || topFeeds.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                <Rss className="w-5 h-5 text-muted-foreground/40" />
              </div>
              <p className="text-sm text-muted-foreground">No feeds yet</p>
              <Link href="/feeds">
                <span className="text-xs text-primary hover:underline cursor-pointer font-medium">Create your first feed →</span>
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {topFeeds.slice(0, 6).map((f, i) => {
                const pct = totalForFeeds > 0 ? (f.postCount / totalForFeeds) * 100 : 0;
                return (
                  <div key={f.feedId}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[10px] text-muted-foreground/50 font-mono w-3.5 flex-shrink-0 tabular-nums">{i + 1}</span>
                      <Link href={`/feeds/${f.feedId}`}>
                        <span className="text-xs font-medium text-foreground hover:text-primary cursor-pointer truncate flex-1">{f.displayName}</span>
                      </Link>
                      <span className="text-xs text-primary font-semibold tabular-nums flex-shrink-0">{f.postCount.toLocaleString()}</span>
                    </div>
                    <div className="ml-5 h-1 bg-muted rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ delay: 0.25 + i * 0.06, duration: 0.5, ease: "easeOut" }}
                        className="h-full bg-primary/50 rounded-full"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </motion.div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="bg-card border border-card-border rounded-xl p-5 md:p-6"
        >
          <div className="mb-5">
            <h2 className="text-sm font-semibold text-foreground">7-Day Volume</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Daily post count over the past week</p>
          </div>
          {chart7d.length === 0 ? (
            <div className="h-36 flex items-center justify-center text-sm text-muted-foreground">No data for this period yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={chart7d} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 6% 90% / .5)" />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(240 4% 46%)" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(240 4% 46%)" }} tickLine={false} axisLine={false} />
                <Tooltip {...tooltipStyle()} />
                <Bar dataKey="posts" fill="hsl(168 84% 39%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
          className="bg-card border border-card-border rounded-xl p-5 md:p-6"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">Firehose Status</h2>
            <div className="flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-xs font-bold tabular-nums text-foreground">{postsPerMin}</span>
              <span className="text-[10px] text-muted-foreground">posts/min</span>
            </div>
          </div>
          <div className="space-y-3">
            <div className={cn(
              "flex items-center gap-3 p-3.5 rounded-xl border",
              firehose?.connected
                ? "bg-emerald-500/5 border-emerald-500/20"
                : "bg-red-500/5 border-red-500/20",
            )}>
              <div className={cn(
                "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0",
                firehose?.connected ? "bg-emerald-500/12" : "bg-red-500/12",
              )}>
                {firehose?.connected
                  ? <Wifi className="w-4 h-4 text-emerald-500" />
                  : <WifiOff className="w-4 h-4 text-red-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className={cn("text-sm font-semibold", firehose?.connected ? "text-emerald-600" : "text-red-400")}>
                  {firehose?.connected ? "Connected" : (firehose as { mode?: string } | undefined)?.mode === "cron" ? "Cron Indexing" : "Disconnected"}
                </div>
                <div className="text-xs text-muted-foreground truncate">{firehose?.endpoint ?? "—"}</div>
              </div>
              {firehose?.connected && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
              )}
            </div>

            {/* Posts/min sparkline */}
            <div className="bg-muted/40 rounded-xl border border-border/50 px-3 pt-2.5 pb-1">
              <div className="flex items-end justify-between mb-1">
                <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest">Indexing rate</span>
                <span className="text-[10px] text-muted-foreground tabular-nums">last {sparkline.length} samples</span>
              </div>
              {sparkline.length < 2 ? (
                <div className="h-12 flex items-center justify-center text-[11px] text-muted-foreground/50">
                  Collecting data… refreshes every 5s
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={52}>
                  <LineChart data={sparkline} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                    <defs>
                      <linearGradient id="sparkGrad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="hsl(210 100% 62%)" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="hsl(210 100% 62%)" stopOpacity={1} />
                      </linearGradient>
                    </defs>
                    <Line
                      type="monotone"
                      dataKey="v"
                      stroke="url(#sparkGrad)"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Tooltip
                      content={({ active, payload }) =>
                        active && payload?.length ? (
                          <div className="text-[10px] bg-popover border border-border rounded-md px-2 py-1 shadow-lg text-foreground tabular-nums">
                            {payload[0].value} posts/min
                          </div>
                        ) : null
                      }
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Indexed", value: (firehose?.postsIndexedTotal ?? 0).toLocaleString() },
                { label: "Reconnects", value: firehose?.reconnectCount ?? 0 },
                { label: "Last Event", value: firehose?.lastEventAt ? formatDistanceToNow(new Date(firehose.lastEventAt), { addSuffix: true }) : "—" },
              ].map(({ label, value }) => (
                <div key={label} className="bg-muted/60 rounded-lg px-3 py-2.5 border border-border/50">
                  <div className="text-[10px] text-muted-foreground mb-0.5 font-medium">{label}</div>
                  <div className="text-xs font-semibold text-foreground tabular-nums truncate">{value}</div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
