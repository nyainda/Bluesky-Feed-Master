import { useGetStatsOverview, useGetRecentActivity, useGetTopFeeds, useGetFirehoseStatus } from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Wifi, WifiOff, Activity, Rss, FileText, Clock } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { Link } from "wouter";

function StatCard({ label, value, icon: Icon, sub, accent }: {
  label: string; value: string | number; icon: React.ElementType; sub?: string; accent?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-card-border rounded-xl p-5 shadow-sm"
    >
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2 rounded-lg ${accent ? "bg-primary/10" : "bg-muted"}`}>
          <Icon className={`w-4 h-4 ${accent ? "text-primary" : "text-muted-foreground"}`} />
        </div>
      </div>
      <div className="text-2xl font-bold text-foreground tabular-nums">{value}</div>
      <div className="text-sm text-muted-foreground mt-0.5">{label}</div>
      {sub && <div className="text-xs text-muted-foreground/60 mt-1">{sub}</div>}
    </motion.div>
  );
}

function formatUptime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatHour(isoString: string) {
  try {
    return format(new Date(isoString), "HH:mm");
  } catch {
    return isoString;
  }
}

export default function Dashboard() {
  const { data: overview, isLoading: loadingOverview } = useGetStatsOverview();
  const { data: activity } = useGetRecentActivity();
  const { data: topFeeds } = useGetTopFeeds();
  const { data: firehose } = useGetFirehoseStatus({ query: { refetchInterval: 5000, queryKey: ["firehose-dash"] } });

  const chartData = (activity || []).map((b) => ({
    time: formatHour(b.hour),
    posts: b.count,
  }));

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Real-time overview of your feed generator</p>
      </motion.div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {loadingOverview ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-card border border-card-border rounded-xl p-5 h-28 animate-pulse" />
          ))
        ) : (
          <>
            <StatCard label="Total Feeds" value={overview?.totalFeeds ?? 0} icon={Rss} sub={`${overview?.activeFeeds ?? 0} active`} accent />
            <StatCard label="Total Posts Indexed" value={(overview?.totalPosts ?? 0).toLocaleString()} icon={FileText} />
            <StatCard label="Posts Last 24h" value={(overview?.postsLast24h ?? 0).toLocaleString()} icon={Activity} sub={`${overview?.postsLast1h ?? 0} in last hour`} accent />
            <StatCard label="Uptime" value={formatUptime(overview?.uptime ?? 0)} icon={Clock} />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="lg:col-span-2 bg-card border border-card-border rounded-xl p-6 shadow-sm"
        >
          <h2 className="text-sm font-semibold text-foreground mb-4">Post Activity — Last 24 Hours</h2>
          {chartData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
              No activity data yet. Posts will appear here as the firehose indexes them.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="postsGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(217 91% 60%)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(217 91% 60%)" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 13% 88% / 0.5)" />
                <XAxis dataKey="time" tick={{ fontSize: 11, fill: "hsl(220 9% 45%)" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(220 9% 45%)" }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(222 40% 10%)",
                    border: "1px solid hsl(222 30% 18%)",
                    borderRadius: "8px",
                    fontSize: "12px",
                    color: "hsl(215 28% 93%)",
                  }}
                  cursor={{ stroke: "hsl(217 91% 60%)", strokeWidth: 1 }}
                />
                <Area
                  type="monotone"
                  dataKey="posts"
                  stroke="hsl(217 91% 60%)"
                  strokeWidth={2}
                  fill="url(#postsGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="bg-card border border-card-border rounded-xl p-6 shadow-sm"
        >
          <h2 className="text-sm font-semibold text-foreground mb-4">Top Feeds by Posts</h2>
          {!topFeeds || topFeeds.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-center gap-2">
              <Rss className="w-8 h-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No feeds yet</p>
              <Link href="/feeds">
                <span className="text-xs text-primary hover:underline cursor-pointer">Create your first feed</span>
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {topFeeds.slice(0, 6).map((f, i) => (
                <div key={f.feedId} className="flex items-center gap-3">
                  <span className="text-xs font-mono text-muted-foreground w-4">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <Link href={`/feeds/${f.feedId}`}>
                      <span className="text-sm font-medium text-foreground hover:text-primary truncate block cursor-pointer">
                        {f.displayName}
                      </span>
                    </Link>
                    <div className="text-xs text-muted-foreground">{f.recordName}</div>
                  </div>
                  <span className="text-sm font-semibold text-primary tabular-nums">{f.postCount.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-card border border-card-border rounded-xl p-6 shadow-sm"
      >
        <h2 className="text-sm font-semibold text-foreground mb-4">Firehose Status</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Connection</div>
            <div className="flex items-center gap-2">
              {firehose?.connected ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  <Wifi className="w-4 h-4 text-green-400" />
                  <span className="text-sm font-medium text-green-400">Connected</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-red-400" />
                  <WifiOff className="w-4 h-4 text-red-400" />
                  <span className="text-sm font-medium text-red-400">Disconnected</span>
                </>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Total Indexed</div>
            <div className="text-sm font-semibold">{(firehose?.postsIndexedTotal ?? 0).toLocaleString()}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Reconnects</div>
            <div className="text-sm font-semibold">{firehose?.reconnectCount ?? 0}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Last Event</div>
            <div className="text-sm font-semibold">
              {firehose?.lastEventAt
                ? formatDistanceToNow(new Date(firehose.lastEventAt), { addSuffix: true })
                : "No events yet"}
            </div>
          </div>
        </div>
        {firehose?.endpoint && (
          <div className="mt-4 text-xs text-muted-foreground font-mono bg-muted/40 px-3 py-2 rounded-md truncate">
            {firehose.endpoint}
          </div>
        )}
      </motion.div>
    </div>
  );
}
