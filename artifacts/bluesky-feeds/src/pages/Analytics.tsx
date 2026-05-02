import { useState } from "react";
import { useListFeeds, useGetRecentActivity, useGet7DayActivity, useGetTopFeeds, useGetFeedKeywordStats, useGetFeedTopAuthors, useGetFeedHourly, useGetBlueskyFeedInfo } from "@workspace/api-client-react";
import { motion } from "framer-motion";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import { format, formatDistanceToNow } from "date-fns";
import { TrendingUp, Users, Hash, Clock, ExternalLink, ChevronDown } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const CHART_COLORS = ["hsl(217 91% 60%)", "hsl(199 89% 48%)", "hsl(173 80% 40%)", "hsl(262 83% 58%)", "hsl(338 75% 55%)", "hsl(43 96% 56%)", "hsl(20 90% 55%)"];

function SectionCard({ title, subtitle, children, className }: { title: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("bg-card border border-card-border rounded-xl shadow-sm overflow-hidden", className)}
    >
      <div className="px-6 py-4 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      <div className="p-6">{children}</div>
    </motion.div>
  );
}

function tooltipStyle() {
  return {
    contentStyle: {
      background: "hsl(222 40% 10%)",
      border: "1px solid hsl(222 30% 18%)",
      borderRadius: "8px",
      fontSize: "12px",
      color: "hsl(215 28% 93%)",
    },
    cursor: { stroke: "hsl(217 91% 60% / 0.3)", strokeWidth: 1 },
  };
}

function formatDay(iso: string) {
  try { return format(new Date(iso), "MMM d"); } catch { return iso; }
}
function formatHour(iso: string) {
  try { return format(new Date(iso), "HH:mm"); } catch { return iso; }
}
function shortenDid(did: string) {
  if (did.length <= 20) return did;
  return did.substring(0, 12) + "..." + did.substring(did.length - 6);
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-40 gap-2">
      <TrendingUp className="w-8 h-8 text-muted-foreground/20" />
      <p className="text-xs text-muted-foreground text-center">{message}</p>
    </div>
  );
}

export default function Analytics() {
  const { data: feeds } = useListFeeds();
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
  const pieData = (keywordStats || []).slice(0, 7).map((k, i) => ({ name: k.keyword, value: k.postCount, color: CHART_COLORS[i % CHART_COLORS.length] }));

  const totalForAllFeeds = (topFeeds || []).reduce((s, f) => s + f.postCount, 0);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
          <p className="text-muted-foreground text-sm mt-1">Deep insights into your feed performance and audience</p>
        </div>
        <Select value={selectedFeedId} onValueChange={setSelectedFeedId}>
          <SelectTrigger className="w-52" data-testid="select-feed">
            <SelectValue placeholder="All Feeds" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Feeds (Global)</SelectItem>
            {(feeds || []).map(f => (
              <SelectItem key={f.id} value={String(f.id)}>{f.displayName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </motion.div>

      {selectedFeed && bskyFeedInfo && (
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="mb-6 bg-gradient-to-r from-primary/10 via-blue-500/5 to-transparent border border-primary/20 rounded-xl p-5">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-primary" />
            </div>
            <div>
              <div className="font-semibold text-foreground">{bskyFeedInfo.displayName}</div>
              <div className="text-sm text-muted-foreground">Published on Bluesky</div>
            </div>
            <div className="ml-auto flex items-center gap-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-primary tabular-nums">{bskyFeedInfo.likeCount.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">People Saved</div>
              </div>
              <a href={`https://bsky.app/profile/${process.env.FEEDGEN_PUBLISHER_DID}/feed/${selectedFeed.recordName}`} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary transition-colors">
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </div>
        </motion.div>
      )}

      {selectedFeedId === "all" ? (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <SectionCard title="24-Hour Activity" subtitle="Posts indexed per hour across all feeds">
              {chart24h.length === 0 ? (
                <EmptyChart message="No activity in the last 24 hours. Add keywords to start indexing." />
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={chart24h} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="grad1" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(217 91% 60%)" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="hsl(217 91% 60%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 13% 88% / 0.3)" />
                    <XAxis dataKey="time" tick={{ fontSize: 10, fill: "hsl(220 9% 45%)" }} tickLine={false} axisLine={false} interval={3} />
                    <YAxis tick={{ fontSize: 10, fill: "hsl(220 9% 45%)" }} tickLine={false} axisLine={false} />
                    <Tooltip {...tooltipStyle()} />
                    <Area type="monotone" dataKey="posts" stroke="hsl(217 91% 60%)" strokeWidth={2} fill="url(#grad1)" />
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
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 13% 88% / 0.3)" />
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(220 9% 45%)" }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "hsl(220 9% 45%)" }} tickLine={false} axisLine={false} />
                    <Tooltip {...tooltipStyle()} />
                    <Bar dataKey="posts" fill="hsl(217 91% 60%)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </SectionCard>
          </div>

          <SectionCard title="Feed Performance Breakdown" subtitle="Posts indexed per feed">
            {!topFeeds || topFeeds.length === 0 ? (
              <EmptyChart message="No feeds yet. Create feeds to see performance data." />
            ) : (
              <div className="space-y-3">
                {topFeeds.map((feed, i) => {
                  const pct = totalForAllFeeds > 0 ? (feed.postCount / totalForAllFeeds) * 100 : 0;
                  return (
                    <div key={feed.feedId} className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground font-mono w-5 text-right flex-shrink-0">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-foreground truncate">{feed.displayName}</span>
                          <span className="text-xs text-muted-foreground ml-2 flex-shrink-0 tabular-nums">{feed.postCount.toLocaleString()} posts</span>
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <SectionCard title="Feed Activity (24h)" subtitle={`Hourly posts for ${selectedFeed?.displayName}`}>
              {!feedHourly || feedHourlyChart.length === 0 ? (
                <EmptyChart message="No activity in the last 24 hours for this feed." />
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={feedHourlyChart} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="feedGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(199 89% 48%)" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="hsl(199 89% 48%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 13% 88% / 0.3)" />
                    <XAxis dataKey="time" tick={{ fontSize: 10, fill: "hsl(220 9% 45%)" }} tickLine={false} axisLine={false} interval={3} />
                    <YAxis tick={{ fontSize: 10, fill: "hsl(220 9% 45%)" }} tickLine={false} axisLine={false} />
                    <Tooltip {...tooltipStyle()} />
                    <Area type="monotone" dataKey="posts" stroke="hsl(199 89% 48%)" strokeWidth={2} fill="url(#feedGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </SectionCard>

            <SectionCard title="Keyword Distribution" subtitle="Which keywords drive the most posts">
              {!keywordStats || keywordStats.length === 0 ? (
                <EmptyChart message="No keyword data yet. Add keywords to this feed." />
              ) : (
                <div className="flex items-center gap-4">
                  <ResponsiveContainer width={140} height={140}>
                    <PieChart>
                      <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={35} outerRadius={60} paddingAngle={2}>
                        {pieData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-1.5 min-w-0">
                    {(keywordStats || []).slice(0, 7).map((k, i) => (
                      <div key={k.keyword} className="flex items-center gap-2 text-xs">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                        <span className="font-mono text-foreground truncate flex-1">{k.keyword}</span>
                        <span className="text-muted-foreground flex-shrink-0">{k.postCount.toLocaleString()}</span>
                        <span className="text-muted-foreground/50 flex-shrink-0 w-8 text-right">{k.percentage}%</span>
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
              <div className="space-y-2">
                {topAuthors.slice(0, 15).map((author, i) => (
                  <motion.div
                    key={author.did}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-muted/40 transition-colors"
                  >
                    <span className="text-xs text-muted-foreground font-mono w-5 text-right flex-shrink-0">{i + 1}</span>
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary/20 to-blue-500/20 flex items-center justify-center flex-shrink-0">
                      <Users className="w-3 h-3 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-mono text-foreground truncate">{shortenDid(author.did)}</div>
                      <div className="text-[10px] text-muted-foreground">
                        Last post {formatDistanceToNow(new Date(author.latestPostAt), { addSuffix: true })}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Badge variant="secondary" className="text-xs tabular-nums">{author.postCount} posts</Badge>
                      <a
                        href={`https://bsky.app/profile/${author.did}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted-foreground hover:text-primary transition-colors"
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
