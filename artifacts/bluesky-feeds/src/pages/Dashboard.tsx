import {
  useGetStatsOverview, useGetRecentActivity, useGetTopFeeds,
  useGetFirehoseStatus, useGetBlueskyProfile, useGet7DayActivity,
} from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Wifi, WifiOff, Activity, Rss, FileText, Clock, TrendingUp, TrendingDown, Users, Zap, ExternalLink } from "lucide-react";
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
      background: "hsl(222 40% 10%)",
      border: "1px solid hsl(222 30% 18%)",
      borderRadius: "8px",
      fontSize: "12px",
      color: "hsl(215 28% 93%)",
      boxShadow: "0 8px 32px hsl(222 47% 7% / 0.8)",
    },
    cursor: { stroke: "hsl(217 91% 60% / 0.3)", strokeWidth: 1 },
  };
}

function StatCard({ label, value, icon: Icon, sub, trend, accent, delay = 0 }: {
  label: string; value: string | number; icon: React.ElementType;
  sub?: string; trend?: "up" | "down" | null; accent?: boolean; delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="relative bg-card border border-card-border rounded-xl p-5 shadow-sm overflow-hidden group"
    >
      <div className={cn("absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500", accent ? "bg-gradient-to-br from-primary/5 to-transparent" : "bg-gradient-to-br from-muted/50 to-transparent")} />
      <div className="relative">
        <div className="flex items-start justify-between mb-3">
          <div className={cn("p-2 rounded-lg", accent ? "bg-primary/10" : "bg-muted/80")}>
            <Icon className={cn("w-4 h-4", accent ? "text-primary" : "text-muted-foreground")} />
          </div>
          {trend && (
            <div className={cn("flex items-center gap-1 text-xs font-medium", trend === "up" ? "text-emerald-500" : "text-red-400")}>
              {trend === "up" ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            </div>
          )}
        </div>
        <div className="text-2xl font-bold text-foreground tabular-nums tracking-tight">{value}</div>
        <div className="text-xs text-muted-foreground mt-0.5 font-medium">{label}</div>
        {sub && <div className="text-xs text-muted-foreground/60 mt-1">{sub}</div>}
      </div>
    </motion.div>
  );
}

function ProfileBanner() {
  const { data: profile } = useGetBlueskyProfile({
    query: { retry: false, queryKey: ["profile-dashboard"] },
  });
  if (!profile) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6 bg-gradient-to-r from-card to-card/80 border border-card-border rounded-xl p-5 flex items-center gap-5"
    >
      {profile.avatar ? (
        <img src={profile.avatar} alt={profile.handle} className="w-14 h-14 rounded-full ring-2 ring-primary/20 flex-shrink-0" />
      ) : (
        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary to-blue-400 flex items-center justify-center text-white text-xl font-bold flex-shrink-0">
          {(profile.displayName || profile.handle)[0].toUpperCase()}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-base font-bold text-foreground">{profile.displayName || profile.handle}</div>
        <div className="text-sm text-muted-foreground">@{profile.handle}</div>
        {profile.description && <div className="text-xs text-muted-foreground/70 mt-1 truncate max-w-md">{profile.description}</div>}
      </div>
      <div className="flex gap-6 flex-shrink-0">
        {[
          { label: "Followers", value: profile.followersCount },
          { label: "Following", value: profile.followsCount },
          { label: "Posts", value: profile.postsCount },
        ].map(({ label, value }) => (
          <div key={label} className="text-center">
            <div className="text-xl font-bold text-foreground tabular-nums">{value.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>
      <a href={`https://bsky.app/profile/${profile.handle}`} target="_blank" rel="noreferrer" className="flex-shrink-0 text-muted-foreground hover:text-primary transition-colors">
        <ExternalLink className="w-4 h-4" />
      </a>
    </motion.div>
  );
}

export default function Dashboard() {
  const { data: overview, isLoading } = useGetStatsOverview();
  const { data: activity } = useGetRecentActivity();
  const { data: activity7d } = useGet7DayActivity();
  const { data: topFeeds } = useGetTopFeeds();
  const { data: firehose } = useGetFirehoseStatus({ query: { refetchInterval: 5000, queryKey: ["firehose-dash"] } });

  const chart24h = (activity || []).map(b => ({ time: formatHour(b.hour), posts: b.count }));
  const chart7d = (activity7d || []).map(b => ({ day: formatDay(b.day), posts: b.count }));

  const totalForFeeds = (topFeeds || []).reduce((s, f) => s + f.postCount, 0);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Real-time overview of your Bluesky feed generator</p>
      </motion.div>

      <ProfileBanner />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-card border border-card-border rounded-xl p-5 h-28 animate-pulse" />
          ))
        ) : (
          <>
            <StatCard label="Total Feeds" value={overview?.totalFeeds ?? 0} icon={Rss}
              sub={`${overview?.activeFeeds ?? 0} active`} accent delay={0} />
            <StatCard label="Posts Indexed" value={(overview?.totalPosts ?? 0).toLocaleString()} icon={FileText}
              sub={`${overview?.postsLast1h ?? 0} in last hour`} delay={0.05} />
            <StatCard label="Posts Last 24h" value={(overview?.postsLast24h ?? 0).toLocaleString()} icon={Activity}
              trend={overview && overview.postsLast24h > 0 ? "up" : null} delay={0.1} />
            <StatCard label="Server Uptime" value={formatUptime(overview?.uptime ?? 0)} icon={Clock}
              sub="continuously running" delay={0.15} />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="lg:col-span-2 bg-card border border-card-border rounded-xl p-6 shadow-sm"
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Post Activity</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Posts indexed in the last 24 hours</p>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-emerald-500 font-medium bg-emerald-500/10 px-2 py-1 rounded-full">
              <Zap className="w-3 h-3" />
              Live
            </div>
          </div>
          {chart24h.length === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center text-center gap-2">
              <Activity className="w-8 h-8 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground">No activity yet. Add keywords to your feeds to start indexing posts.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={chart24h} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="grad24h" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(217 91% 60%)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(217 91% 60%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 13% 88% / 0.3)" />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: "hsl(220 9% 45%)" }} tickLine={false} axisLine={false} interval={3} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(220 9% 45%)" }} tickLine={false} axisLine={false} />
                <Tooltip {...tooltipStyle()} />
                <Area type="monotone" dataKey="posts" stroke="hsl(217 91% 60%)" strokeWidth={2} fill="url(#grad24h)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="bg-card border border-card-border rounded-xl p-6 shadow-sm"
        >
          <h2 className="text-sm font-semibold text-foreground mb-4">Top Feeds</h2>
          {!topFeeds || topFeeds.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-center gap-2">
              <Rss className="w-8 h-8 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground">No feeds yet</p>
              <Link href="/feeds"><span className="text-xs text-primary hover:underline cursor-pointer">Create your first feed</span></Link>
            </div>
          ) : (
            <div className="space-y-3">
              {topFeeds.slice(0, 6).map((f, i) => {
                const pct = totalForFeeds > 0 ? (f.postCount / totalForFeeds) * 100 : 0;
                return (
                  <div key={f.feedId} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground font-mono w-4 flex-shrink-0">{i + 1}</span>
                      <Link href={`/feeds/${f.feedId}`}>
                        <span className="text-xs font-medium text-foreground hover:text-primary cursor-pointer truncate flex-1">{f.displayName}</span>
                      </Link>
                      <span className="text-xs text-primary font-semibold tabular-nums flex-shrink-0">{f.postCount.toLocaleString()}</span>
                    </div>
                    <div className="ml-6 h-1 bg-muted rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ delay: 0.2 + i * 0.05, duration: 0.5, ease: "easeOut" }}
                        className="h-full bg-primary/60 rounded-full"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </motion.div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="bg-card border border-card-border rounded-xl p-6 shadow-sm"
        >
          <h2 className="text-sm font-semibold text-foreground mb-1">7-Day Volume</h2>
          <p className="text-xs text-muted-foreground mb-4">Daily post count over the past week</p>
          {chart7d.length === 0 ? (
            <div className="h-36 flex items-center justify-center text-sm text-muted-foreground">No data for this period yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={chart7d} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 13% 88% / 0.3)" />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(220 9% 45%)" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(220 9% 45%)" }} tickLine={false} axisLine={false} />
                <Tooltip {...tooltipStyle()} />
                <Bar dataKey="posts" fill="hsl(199 89% 48%)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
          className="bg-card border border-card-border rounded-xl p-6 shadow-sm"
        >
          <h2 className="text-sm font-semibold text-foreground mb-4">Firehose Status</h2>
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40">
              <div className={cn("w-8 h-8 rounded-full flex items-center justify-center", firehose?.connected ? "bg-emerald-500/15" : "bg-red-500/15")}>
                {firehose?.connected
                  ? <><Wifi className="w-4 h-4 text-emerald-400" /></>
                  : <WifiOff className="w-4 h-4 text-red-400" />}
              </div>
              <div>
                <div className={cn("text-sm font-semibold", firehose?.connected ? "text-emerald-400" : "text-red-400")}>
                  {firehose?.connected ? "Connected" : "Disconnected"}
                </div>
                <div className="text-xs text-muted-foreground">{firehose?.endpoint}</div>
              </div>
              {firehose?.connected && <span className="ml-auto w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Session Indexed", value: (firehose?.postsIndexedTotal ?? 0).toLocaleString() },
                { label: "Reconnects", value: firehose?.reconnectCount ?? 0 },
                { label: "Last Event", value: firehose?.lastEventAt ? formatDistanceToNow(new Date(firehose.lastEventAt), { addSuffix: true }) : "—" },
              ].map(({ label, value }) => (
                <div key={label} className="bg-muted/40 rounded-lg px-3 py-2.5">
                  <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
                  <div className="text-sm font-semibold text-foreground tabular-nums truncate">{value}</div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
