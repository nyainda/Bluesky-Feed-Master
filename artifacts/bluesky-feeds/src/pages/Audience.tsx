import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  useSyncEngagement, useBulkFollow, useBulkUnfollow,
  useGetBlueskyProfile, useListFeeds, useGetFeedTopAuthors,
  useGetFollowers, useGetFollowing, useGetFollowerGrowth, useSnapshotFollowers,
  customFetch,
} from "@workspace/api-client-react";
import type { AudienceUser } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Users, UserMinus, UserPlus, RefreshCw, ExternalLink,
  ChevronLeft, ChevronRight, Search, CheckSquare, Square,
  TrendingUp, Heart, AlertTriangle, Filter, X, ArrowUpRight, BarChart2, Camera,
  Clock, Shield, Settings2, ToggleLeft, ToggleRight, History,
  ListOrdered, Pause, Play, Ban, Loader2, Download, CheckCircle, Zap, Activity,
} from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Tab = "followers" | "following" | "not-following-back" | "top-authors" | "search" | "growth" | "auto-follow";

type SearchUser = {
  did: string;
  handle: string;
  displayName: string | null;
  avatar: string | null;
  description: string | null;
  followersCount: number;
  followsCount: number;
  postsCount: number;
  followerRatio: number;
};

function UserCard({
  user,
  selected,
  onToggle,
  actionLabel,
  actionIcon: ActionIcon,
  onAction,
  actionPending,
  rank,
  botWarning,
}: {
  user: AudienceUser & { postCount?: number };
  selected?: boolean;
  onToggle?: () => void;
  actionLabel?: string;
  actionIcon?: React.ElementType;
  onAction?: () => void;
  actionPending?: boolean;
  rank?: number;
  botWarning?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-3 border-b border-border/40 last:border-0 transition-colors",
        selected ? "bg-primary/4" : "hover:bg-muted/30",
        botWarning && "opacity-55",
      )}
    >
      {onToggle && (
        <button
          onClick={onToggle}
          className="flex-shrink-0 text-muted-foreground hover:text-primary transition-colors"
        >
          {selected
            ? <CheckSquare className="w-4 h-4 text-primary" />
            : <Square className="w-4 h-4" />
          }
        </button>
      )}
      {rank !== undefined && (
        <span className="text-[10px] text-muted-foreground/40 font-mono w-5 text-right flex-shrink-0 tabular-nums">{rank}</span>
      )}
      {user.avatar ? (
        <img
          src={user.avatar}
          alt={user.handle}
          className="w-9 h-9 rounded-full flex-shrink-0 ring-1 ring-border object-cover"
        />
      ) : (
        <div className="w-9 h-9 rounded-full bg-primary/10 border border-primary/15 flex items-center justify-center flex-shrink-0">
          <span className="text-xs font-bold text-primary">
            {(user.displayName || user.handle)[0].toUpperCase()}
          </span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm font-semibold text-foreground truncate leading-tight">
            {user.displayName || user.handle}
          </span>
          {user.displayName && (
            <span className="text-xs text-muted-foreground/60 truncate hidden sm:block flex-shrink-0">@{user.handle}</span>
          )}
          {botWarning && (
            <span className="text-[10px] text-amber-500 bg-amber-500/8 border border-amber-500/20 px-1.5 py-0.5 rounded-full flex-shrink-0 hidden sm:inline">
              bot?
            </span>
          )}
        </div>
        <div className="flex items-center gap-2.5 mt-0.5">
          <span className="text-[11px] text-muted-foreground tabular-nums">
            <strong className="text-foreground font-semibold">{user.followersCount.toLocaleString()}</strong> followers
          </span>
          <span className="text-muted-foreground/30 text-[11px]">·</span>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            <strong className="text-foreground font-semibold">{user.followsCount.toLocaleString()}</strong> following
          </span>
          {user.postCount !== undefined && user.postCount > 0 && (
            <>
              <span className="text-muted-foreground/30 text-[11px]">·</span>
              <span className="text-[11px] text-primary font-medium tabular-nums">{user.postCount} in feed</span>
            </>
          )}
        </div>
        {user.description && (
          <p className="text-[11px] text-muted-foreground/55 truncate mt-0.5 max-w-sm">{user.description}</p>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <a
          href={`https://bsky.app/profile/${user.handle}`}
          target="_blank"
          rel="noreferrer"
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        >
          <ArrowUpRight className="w-3.5 h-3.5" />
        </a>
        {actionLabel && ActionIcon && onAction && (
          <Button
            size="sm"
            variant="outline"
            onClick={onAction}
            disabled={actionPending}
            className="h-7 text-xs gap-1"
          >
            <ActionIcon className="w-3 h-3" />
            <span className="hidden sm:inline">{actionLabel}</span>
          </Button>
        )}
      </div>
    </div>
  );
}

function StatBadge({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div className={cn(
      "rounded-xl border px-4 py-3 text-center transition-colors",
      accent ? "border-primary/20 bg-primary/5" : "border-border bg-card",
    )}>
      <div className={cn("text-xl md:text-2xl font-bold tabular-nums tracking-tight", accent ? "text-primary" : "text-foreground")}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      <div className="text-[11px] text-muted-foreground mt-0.5 font-medium">{label}</div>
    </div>
  );
}

function SyncEngagementButton() {
  const { toast } = useToast();
  const sync = useSyncEngagement();

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => sync.mutate({ data: { limit: 100 } }, {
        onSuccess: (d) => toast({ title: `Engagement synced: ${d.updated} posts updated` }),
        onError: () => toast({ title: "Sync failed", variant: "destructive" }),
      })}
      disabled={sync.isPending}
      className="gap-1.5 text-xs"
    >
      <RefreshCw className={cn("w-3.5 h-3.5", sync.isPending && "animate-spin")} />
      {sync.isPending ? "Syncing…" : "Sync"}
    </Button>
  );
}

function Pagination({
  cursorStack,
  onPrev,
  onNext,
  hasNext,
  count,
}: {
  cursorStack: string[];
  onPrev: () => void;
  onNext: () => void;
  hasNext: boolean;
  count: number;
}) {
  return (
    <div className="px-4 py-3 border-t border-border/50 flex items-center justify-between bg-muted/20">
      <Button variant="outline" size="sm" disabled={cursorStack.length === 0} onClick={onPrev} className="gap-1 text-xs h-8">
        <ChevronLeft className="w-3.5 h-3.5" /> Prev
      </Button>
      <span className="text-xs text-muted-foreground tabular-nums">{count} shown</span>
      <Button variant="outline" size="sm" disabled={!hasNext} onClick={onNext} className="gap-1 text-xs h-8">
        Next <ChevronRight className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

function SkeletonList({ count = 8 }: { count?: number }) {
  return (
    <div className="p-4 space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-1">
          <div className="w-9 h-9 rounded-full bg-muted animate-pulse flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 w-32 bg-muted animate-pulse rounded" />
            <div className="h-2.5 w-20 bg-muted/60 animate-pulse rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Search & Follow Tab ────────────────────────────────────────────────────

function SearchFollowTab({ defaultUsers = [], defaultLoading = false }: { defaultUsers?: AudienceUser[]; defaultLoading?: boolean }) {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [cursor, setCursor] = useState<string | undefined>();
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [minFollowers, setMinFollowers] = useState(10);
  const [hidePossibleBots, setHidePossibleBots] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const { toast } = useToast();
  const bulkFollow = useBulkFollow();
  const inputRef = useRef<HTMLInputElement>(null);

  const enabled = submittedQuery.length > 0;
  const { data, isLoading, isFetching } = useQuery<{ users: SearchUser[]; cursor: string | null }>({
    queryKey: ["search-users", submittedQuery, cursor],
    queryFn: () => {
      const params = new URLSearchParams({ q: submittedQuery, limit: "25" });
      if (cursor) params.set("cursor", cursor);
      return customFetch(`/api/bluesky/search-users?${params}`);
    },
    enabled,
    staleTime: 60_000,
  });

  function isBotLike(u: SearchUser) {
    if (u.followersCount < 5 && u.followsCount > 200) return true;
    if (u.followerRatio < 0.05 && u.followsCount > 500) return true;
    if (!u.description && u.followsCount > 1000 && u.followersCount < 50) return true;
    return false;
  }

  const allUsers = data?.users ?? [];
  const filteredUsers = allUsers.filter(u => {
    if (u.followersCount < minFollowers) return false;
    if (hidePossibleBots && isBotLike(u)) return false;
    return true;
  });

  const toggleSelect = (did: string) => setSelected(prev => { const n = new Set(prev); n.has(did) ? n.delete(did) : n.add(did); return n; });
  const selectAll = () => setSelected(new Set(filteredUsers.map(u => u.did)));
  const clearSelection = () => setSelected(new Set());

  function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (!query.trim()) return;
    setSubmittedQuery(query.trim());
    setCursor(undefined);
    setCursorStack([]);
    setSelected(new Set());
  }

  function handleFollow() {
    bulkFollow.mutate({ data: { dids: Array.from(selected) } }, {
      onSuccess: (r) => { toast({ title: `Followed ${r.succeeded} accounts` }); clearSelection(); },
      onError: () => toast({ title: "Follow failed", variant: "destructive" }),
    });
  }

  const botCount = allUsers.filter(isBotLike).length;
  const filtered = allUsers.length - filteredUsers.length;

  return (
    <div className="bg-card border border-card-border rounded-xl overflow-hidden">
      {/* Search Bar */}
      <form onSubmit={handleSearch} className="px-4 py-3.5 border-b border-border bg-muted/15">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder='Search by keyword, bio, or name…'
              className="pl-8 h-9 text-sm"
            />
          </div>
          <Button type="submit" size="sm" disabled={!query.trim() || isFetching} className="h-9 px-4">
            {isFetching ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : "Search"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={cn("h-9 w-9 flex-shrink-0", showFilters && "bg-primary/8 border-primary/30 text-primary")}
            onClick={() => setShowFilters(f => !f)}
          >
            <Filter className="w-3.5 h-3.5" />
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1.5">
          Try "software engineering", "AI", "Kenya", "web developer" — then select and bulk follow.
        </p>
      </form>

      {/* Filters Panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-border"
          >
            <div className="px-4 py-3.5 flex items-center gap-6 flex-wrap bg-muted/10">
              <div>
                <label className="text-xs font-medium text-foreground block mb-1.5">Min. followers</label>
                <div className="flex items-center gap-2.5">
                  <input
                    type="range" min={0} max={500} step={5} value={minFollowers}
                    onChange={e => setMinFollowers(Number(e.target.value))}
                    className="w-28 accent-primary"
                  />
                  <span className="text-xs font-mono text-foreground w-8 tabular-nums">{minFollowers}</span>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-foreground block mb-1.5">Bot filter</label>
                <button
                  onClick={() => setHidePossibleBots(v => !v)}
                  className={cn(
                    "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors",
                    hidePossibleBots
                      ? "bg-emerald-500/8 border-emerald-500/25 text-emerald-600"
                      : "border-border text-muted-foreground hover:bg-muted/50",
                  )}
                >
                  {hidePossibleBots ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                  Hide possible bots
                </button>
              </div>
              {allUsers.length > 0 && (
                <div className="ml-auto text-xs text-muted-foreground text-right">
                  <span className="text-foreground font-medium">{filteredUsers.length}</span> / {allUsers.length} shown
                  {filtered > 0 && <><br /><span className="text-amber-500 text-[11px]">{filtered} filtered out</span></>}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bulk Action Bar */}
      {selected.size > 0 && (
        <div className="px-4 py-2.5 border-b border-border bg-primary/4 flex items-center gap-3">
          <span className="text-xs text-primary font-semibold">{selected.size} selected</span>
          <Button size="sm" className="h-7 text-xs gap-1" onClick={handleFollow} disabled={bulkFollow.isPending}>
            <UserPlus className="w-3 h-3" />
            {bulkFollow.isPending ? "Following…" : `Follow ${selected.size}`}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={clearSelection}>
            <X className="w-3 h-3 mr-1" />Clear
          </Button>
        </div>
      )}

      {/* Results */}
      {!submittedQuery ? (
        /* ── DEFAULT: show followers so user can instantly select & follow back ── */
        defaultLoading ? <SkeletonList /> : defaultUsers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-52 gap-3 text-center px-8">
            <div className="w-12 h-12 rounded-2xl bg-muted border border-border flex items-center justify-center">
              <Search className="w-5 h-5 text-muted-foreground/50" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Search to discover people</p>
              <p className="text-xs text-muted-foreground mt-1">Find accounts to follow by keyword, topic, or location.</p>
            </div>
          </div>
        ) : (
          <>
            {/* Sticky Select-All bar */}
            <div className="px-4 py-2.5 border-b border-border/40 bg-primary/4 flex items-center justify-between gap-3 sticky top-0 z-10">
              <div className="flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs font-semibold text-primary">
                  {defaultUsers.length} followers — select to follow back
                </span>
              </div>
              <div className="flex items-center gap-2">
                {selected.size > 0 ? (
                  <>
                    <Button size="sm" className="h-7 text-xs gap-1" onClick={handleFollow} disabled={bulkFollow.isPending}>
                      <UserPlus className="w-3 h-3" />
                      {bulkFollow.isPending ? "Following…" : `Follow Back ${selected.size}`}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={clearSelection}>
                      <X className="w-3 h-3 mr-1" />Clear
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setSelected(new Set(defaultUsers.map(u => u.did)))}>
                    <CheckSquare className="w-3 h-3" />
                    Select All {defaultUsers.length}
                  </Button>
                )}
              </div>
            </div>
            <div>
              {defaultUsers.map((u, i) => (
                <motion.div key={u.did} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.015 }}>
                  <UserCard
                    user={u}
                    selected={selected.has(u.did)}
                    onToggle={() => toggleSelect(u.did)}
                  />
                </motion.div>
              ))}
            </div>
          </>
        )
      ) : isLoading ? (
        <SkeletonList />
      ) : filteredUsers.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 gap-2">
          <Users className="w-9 h-9 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground">
            {allUsers.length > 0 ? "All results filtered — try loosening filters." : `No results for "${submittedQuery}".`}
          </p>
        </div>
      ) : (
        <>
          {/* Sticky Select-All bar for search results */}
          <div className="px-4 py-2.5 border-b border-border/40 bg-muted/10 flex items-center justify-between gap-3 sticky top-0 z-10">
            <div className="flex items-center gap-2">
              {hidePossibleBots && botCount > 0 && (
                <span className="text-[11px] text-amber-500 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />{botCount} hidden
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {selected.size > 0 ? (
                <>
                  <Button size="sm" className="h-7 text-xs gap-1" onClick={handleFollow} disabled={bulkFollow.isPending}>
                    <UserPlus className="w-3 h-3" />
                    {bulkFollow.isPending ? "Following…" : `Follow ${selected.size}`}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={clearSelection}>
                    <X className="w-3 h-3 mr-1" />Clear
                  </Button>
                </>
              ) : (
                <button onClick={selectAll} className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1.5 transition-colors">
                  <CheckSquare className="w-3.5 h-3.5" /> Select all {filteredUsers.length}
                </button>
              )}
            </div>
          </div>
          <div>
            {filteredUsers.map((u, i) => {
              const asAudienceUser: AudienceUser & { postCount?: number } = {
                did: u.did,
                handle: u.handle,
                displayName: u.displayName,
                avatar: u.avatar,
                description: u.description,
                followersCount: u.followersCount,
                followsCount: u.followsCount,
                followedAt: null,
              };
              return (
                <motion.div key={u.did} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}>
                  <UserCard
                    user={asAudienceUser}
                    selected={selected.has(u.did)}
                    onToggle={() => toggleSelect(u.did)}
                    botWarning={!hidePossibleBots && isBotLike(u)}
                  />
                </motion.div>
              );
            })}
          </div>
          <Pagination
            cursorStack={cursorStack}
            onPrev={() => {
              const s = [...cursorStack]; const p = s.pop();
              setCursorStack(s); setCursor(p === "" ? undefined : p); setSelected(new Set());
            }}
            onNext={() => {
              if (data?.cursor) {
                setCursorStack(s => [...s, cursor ?? ""]); setCursor(data.cursor!); setSelected(new Set());
              }
            }}
            hasNext={!!data?.cursor}
            count={filteredUsers.length}
          />
        </>
      )}
    </div>
  );
}

// ─── Follower Growth Tab ──────────────────────────────────────────────────────

function tooltipStyleGrowth() {
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

function FollowerGrowthTab() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: snapshots, isLoading } = useGetFollowerGrowth({
    query: { queryKey: ["follower-growth"], staleTime: 5 * 60_000 },
  });

  const { mutate: snapshot, isPending: snapshotting } = useSnapshotFollowers({
    mutation: {
      onSuccess: (data) => {
        qc.invalidateQueries({ queryKey: ["follower-growth"] });
        toast({
          title: "Snapshot recorded!",
          description: `${data.followersCount.toLocaleString()} followers captured.`,
        });
      },
      onError: () => toast({ title: "Snapshot failed", variant: "destructive" }),
    },
  });

  const list = snapshots ?? [];
  const chartData = list.map(s => ({
    date: format(new Date(s.recordedAt), "MMM d"),
    Followers: s.followersCount,
    Following: s.followsCount,
  }));

  const latest = list[list.length - 1];
  const first = list[0];
  const followerDelta = latest && first && list.length > 1
    ? latest.followersCount - first.followersCount
    : null;

  return (
    <div className="space-y-5 mt-4">
      <div className="flex items-center justify-between">
        <div>
          {latest && (
            <div className="flex items-center gap-4 flex-wrap">
              <div>
                <p className="text-2xl font-bold text-foreground tabular-nums">{latest.followersCount.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Current followers</p>
              </div>
              {followerDelta !== null && (
                <div className={cn("flex items-center gap-1 text-sm font-semibold", followerDelta >= 0 ? "text-emerald-500" : "text-destructive")}>
                  <TrendingUp className="w-4 h-4" />
                  {followerDelta >= 0 ? "+" : ""}{followerDelta.toLocaleString()} since first snapshot
                </div>
              )}
            </div>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="gap-2 text-xs flex-shrink-0"
          onClick={() => snapshot()}
          disabled={snapshotting}
        >
          {snapshotting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
          {snapshotting ? "Recording…" : "Record Snapshot"}
        </Button>
      </div>

      {isLoading ? (
        <div className="h-64 bg-card border border-card-border rounded-xl animate-pulse" />
      ) : list.length < 2 ? (
        <div className="flex flex-col items-center justify-center h-64 gap-4 bg-card border border-card-border rounded-xl text-center px-8">
          <div className="w-12 h-12 rounded-2xl bg-muted border border-border flex items-center justify-center">
            <BarChart2 className="w-6 h-6 text-muted-foreground/40" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Not enough data yet</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs">
              {list.length === 0
                ? "Record your first snapshot to start tracking follower growth over time."
                : "Record one more snapshot to see your growth chart."}
            </p>
          </div>
          <Button size="sm" className="gap-2 text-xs" onClick={() => snapshot()} disabled={snapshotting}>
            {snapshotting ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />}
            {list.length === 0 ? "Take First Snapshot" : "Take Another Snapshot"}
          </Button>
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card border border-card-border rounded-xl p-5 md:p-6"
        >
          <h3 className="text-sm font-semibold text-foreground mb-4">Follower Growth Over Time</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartData} margin={{ top: 4, right: 12, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 6% 90% / .5)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(240 4% 46%)" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(240 4% 46%)" }} tickLine={false} axisLine={false} />
              <Tooltip {...tooltipStyleGrowth()} />
              <Line
                type="monotone"
                dataKey="Followers"
                stroke="hsl(210 100% 58%)"
                strokeWidth={2}
                dot={{ fill: "hsl(210 100% 58%)", r: 3 }}
                activeDot={{ r: 5 }}
              />
              <Line
                type="monotone"
                dataKey="Following"
                stroke="hsl(168 84% 42%)"
                strokeWidth={2}
                dot={{ fill: "hsl(168 84% 42%)", r: 3 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
          <p className="text-xs text-muted-foreground text-center mt-3">
            <span className="inline-flex items-center gap-1.5 mr-4">
              <span className="w-2.5 h-1 rounded-full bg-primary inline-block" /> Followers
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-1 rounded-full bg-emerald-500 inline-block" /> Following
            </span>
          </p>
        </motion.div>
      )}

      {list.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-card border border-card-border rounded-xl p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">Snapshot History</h3>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {[...list].reverse().map((s, i) => (
              <div key={s.id} className="flex items-center justify-between py-2 border-b border-border/40 last:border-0">
                <span className="text-xs text-muted-foreground">{format(new Date(s.recordedAt), "MMM d, yyyy · h:mm a")}</span>
                <div className="flex items-center gap-4 text-xs font-medium tabular-nums">
                  <span className="text-foreground">{s.followersCount.toLocaleString()} followers</span>
                  {i < list.length - 1 && (() => {
                    const prev = [...list].reverse()[i + 1];
                    const delta = s.followersCount - prev.followersCount;
                    return delta !== 0 ? (
                      <span className={delta > 0 ? "text-emerald-500" : "text-destructive"}>
                        {delta > 0 ? "+" : ""}{delta}
                      </span>
                    ) : null;
                  })()}
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}

// ─── Auto-Unfollow Card ──────────────────────────────────────────────────────

type AutoUnfollowSettings = {
  enabled: boolean;
  intervalDays: number;
  cap: number;
  minFollowersToKeep: number;
  lastRun: string | null;
  scanInProgress: boolean;
  scanPagesDone: number;
};

const INTERVAL_OPTIONS = [
  { label: "Daily", days: 1 },
  { label: "Weekly", days: 7 },
  { label: "Bi-weekly", days: 14 },
  { label: "Monthly", days: 30 },
];

// 0 = queue all non-followers-back
const CAP_OPTIONS = [
  { label: "1k", value: 1_000 },
  { label: "5k", value: 5_000 },
  { label: "10k", value: 10_000 },
  { label: "20k", value: 20_000 },
  { label: "25k", value: 25_000 },
  { label: "40k", value: 40_000 },
  { label: "All", value: 0 },
];

// 0 = unfollow everyone regardless of their follower count
const MIN_FOLLOWERS_OPTIONS = [
  { label: "No exceptions", value: 0 },
  { label: "Skip 1k+", value: 1_000 },
  { label: "Skip 5k+", value: 5_000 },
  { label: "Skip 10k+", value: 10_000 },
  { label: "Skip 20k+", value: 20_000 },
  { label: "Skip 40k+", value: 40_000 },
];

function AutoUnfollowCard() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ ok: boolean; settings: AutoUnfollowSettings }>({
    queryKey: ["cron-settings"],
    queryFn: () => customFetch("/api/cron-settings"),
    staleTime: 30_000,
  });

  const [queuePending, setQueuePending] = useState(0);
  const { data: queueStatus, refetch: refetchQueue } = useQuery<{
    pending: number; done: number; failed: number; total: number; estimatedMinutesLeft: number;
  }>({
    queryKey: ["unfollow-queue-status"],
    queryFn: () => customFetch("/api/bluesky/unfollow-schedule/status"),
    refetchInterval: queuePending > 0 ? 15_000 : 30_000,
  });

  const { data: cronHealth } = useQuery<{
    ok: boolean;
    lastCronTick: string | null;
    isHealthy: boolean;
    scanInProgress: boolean;
    scanPagesDone: number;
    lastScanCompleted: string | null;
  }>({
    queryKey: ["cron-health"],
    queryFn: () => customFetch("/api/admin/cron-health"),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  useEffect(() => {
    setQueuePending(queueStatus?.pending ?? 0);
  }, [queueStatus?.pending]);

  const isRunningActive = (queueStatus?.pending ?? 0) > 0;

  const { data: recentLog } = useQuery<{ ok: boolean; entries: UnfollowLogEntry[] }>({
    queryKey: ["auto-unfollow-log-live"],
    queryFn: () => customFetch("/api/auto-unfollow/log?limit=5"),
    refetchInterval: isRunningActive ? 30_000 : false,
    enabled: isRunningActive,
    staleTime: 10_000,
  });

  const settings = data?.settings;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [intervalDays, setIntervalDays] = useState<number | null>(null);
  const [cap, setCap] = useState<number | null>(null);
  const [minFollowersToKeep, setMinFollowersToKeep] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [triggering, setTriggering] = useState(false);

  const displayEnabled = enabled ?? settings?.enabled ?? false;
  const displayInterval = intervalDays ?? settings?.intervalDays ?? 7;
  const displayCap = cap ?? settings?.cap ?? 0;
  const displayMinFollowers = minFollowersToKeep ?? settings?.minFollowersToKeep ?? 0;
  const isDirty = enabled !== null || intervalDays !== null || cap !== null || minFollowersToKeep !== null;

  const isRunning = (queueStatus?.pending ?? 0) > 0;
  const qTotal = queueStatus?.total ?? 0;
  const qDone = queueStatus?.done ?? 0;
  const qPending = queueStatus?.pending ?? 0;
  const qFailed = queueStatus?.failed ?? 0;
  const pct = qTotal > 0 ? Math.round((qDone / qTotal) * 100) : 0;
  const estimatedHours = queueStatus ? Math.ceil(queueStatus.estimatedMinutesLeft / 60) : 0;

  async function handleSave() {
    setSaving(true);
    try {
      await customFetch("/api/cron-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: displayEnabled,
          intervalDays: displayInterval,
          cap: displayCap,
          minFollowersToKeep: displayMinFollowers,
        }),
      });
      setEnabled(null);
      setIntervalDays(null);
      setCap(null);
      setMinFollowersToKeep(null);
      qc.invalidateQueries({ queryKey: ["cron-settings"] });
      toast({ title: "Auto-unfollow settings saved" });
    } catch {
      toast({ title: "Failed to save settings", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function triggerScan() {
    setTriggering(true);
    try {
      await customFetch("/api/admin/trigger-scan", { method: "POST" });
      toast({ title: "Scan started", description: "CF Worker is scanning your following list now" });
      setTimeout(() => refetchQueue(), 4_000);
      setTimeout(() => refetchQueue(), 10_000);
      setTimeout(() => refetchQueue(), 20_000);
    } catch {
      toast({ title: "Failed to start scan", variant: "destructive" });
    } finally {
      setTriggering(false);
    }
  }

  async function clearQueue() {
    try {
      await customFetch("/api/bluesky/unfollow-schedule", { method: "DELETE" });
      refetchQueue();
      toast({ title: "Queue cleared" });
    } catch {
      toast({ title: "Failed to clear queue", variant: "destructive" });
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="bg-card border border-card-border rounded-xl mb-5 overflow-hidden"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between bg-muted/10">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Auto-Unfollow</span>
          <span className={cn(
            "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
            displayEnabled ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground",
          )}>
            {displayEnabled ? "ON" : "OFF"}
          </span>
          {isRunning && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-emerald-500/10 text-emerald-600 flex items-center gap-1">
              <Activity className="w-2.5 h-2.5" />
              {qPending.toLocaleString()} queued in CF
            </span>
          )}
        </div>
        <button
          onClick={() => setEnabled(!displayEnabled)}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title={displayEnabled ? "Disable auto-unfollow" : "Enable auto-unfollow"}
        >
          {displayEnabled
            ? <ToggleRight className="w-5 h-5 text-emerald-500" />
            : <ToggleLeft className="w-5 h-5" />
          }
        </button>
      </div>

      {/* Live CF Progress Panel */}
      <div className={cn(
        "px-4 pt-4 pb-0 transition-all",
      )}>
        <div className={cn(
          "rounded-xl border p-3.5 space-y-2.5 transition-colors",
          isRunning
            ? "border-emerald-500/25 bg-emerald-500/5"
            : qTotal > 0
            ? "border-primary/15 bg-primary/4"
            : "border-border bg-muted/25",
        )}>
          {/* Cron stalled warning */}
          {cronHealth && !cronHealth.isHealthy && cronHealth.lastCronTick && (
            <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-amber-500/8 border border-amber-500/25 text-amber-600">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold">CF Cron may have stalled</p>
                <p className="text-[10px] text-amber-600/70">Last tick: {format(new Date(cronHealth.lastCronTick), "MMM d h:mm a")} · Expected every 3 min</p>
              </div>
              <button
                onClick={() => customFetch("/api/admin/trigger-scan", { method: "POST" }).then(() => refetchQueue())}
                className="text-[10px] font-medium bg-amber-500/15 hover:bg-amber-500/25 px-2 py-1 rounded transition-colors flex-shrink-0"
              >
                Retry
              </button>
            </div>
          )}
          {cronHealth && !cronHealth.isHealthy && !cronHealth.lastCronTick && (
            <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-muted/60 border border-border text-muted-foreground">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              <p className="text-[11px]">CF cron hasn&apos;t fired yet — it runs every 3 min after deployment. Redeploy if this persists.</p>
            </div>
          )}

          {/* Scan in progress (incremental) */}
          {(cronHealth?.scanInProgress || settings?.scanInProgress) && (
            <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-blue-500/8 border border-blue-500/20 text-blue-600">
              <Loader2 className="w-3.5 h-3.5 flex-shrink-0 animate-spin" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold">Scan in progress</p>
                <p className="text-[10px] text-blue-600/70">
                  {(() => {
                    const pagesDone = cronHealth?.scanPagesDone ?? settings?.scanPagesDone ?? 0;
                    const checked = pagesDone * 100;
                    const ticksLeft = Math.ceil(Math.max(0, (qPending - checked) / 500));
                    const etaMins = ticksLeft * 3;
                    const etaStr = etaMins > 60
                      ? `~${Math.round(etaMins / 60)}h remaining`
                      : etaMins > 0 ? `~${etaMins}m remaining` : "almost done";
                    return `${checked.toLocaleString()} following checked so far · 500 per tick · ${etaStr}`;
                  })()}
                </p>
              </div>
            </div>
          )}

          {/* Status row */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              {isRunning ? (
                <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Running in CF Worker
                </span>
              ) : qTotal > 0 ? (
                <span className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                  <span className="w-2 h-2 rounded-full bg-primary" />
                  Queue complete
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <span className="w-2 h-2 rounded-full bg-muted-foreground/30" />
                  Idle — no queue
                </span>
              )}
              {isRunning && (
                <span className="text-[10px] text-muted-foreground hidden sm:block">
                  Cron fires every 3 min · 10 unfollows per tick · ~200/hr
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {settings?.lastRun && (
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Last scan: {format(new Date(settings.lastRun), "MMM d, h:mm a")}
                </span>
              )}
              {qTotal > 0 && (
                <button onClick={clearQueue} className="text-[10px] text-destructive/70 hover:text-destructive hover:underline">
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Progress bar + stats when queue has items */}
          {qTotal > 0 && (
            <>
              <div className="w-full h-2 rounded-full bg-muted/60 overflow-hidden">
                <motion.div
                  className={cn("h-full rounded-full", isRunning ? "bg-emerald-500" : "bg-primary")}
                  animate={{ width: `${pct}%` }}
                  transition={{ ease: "easeOut", duration: 0.6 }}
                />
              </div>
              <div className="flex items-center gap-3 flex-wrap text-xs">
                <span className={cn("flex items-center gap-1 font-semibold", isRunning ? "text-amber-600" : "text-muted-foreground")}>
                  {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />}
                  {qPending.toLocaleString()} pending
                </span>
                <span className="flex items-center gap-1 text-emerald-600 font-semibold">
                  <CheckCircle className="w-3 h-3" />
                  {qDone.toLocaleString()} done
                </span>
                {qFailed > 0 && (
                  <span className="flex items-center gap-1.5">
                    <span className="text-destructive/70 font-medium">{qFailed.toLocaleString()} failed</span>
                    <button
                      onClick={async () => {
                        try {
                          await customFetch("/api/admin/retry-failed-unfollows", { method: "POST" });
                          setTimeout(() => refetchQueue(), 3_000);
                          toast({ title: `Retrying ${qFailed} failed unfollows` });
                        } catch {
                          toast({ title: "Retry failed", variant: "destructive" });
                        }
                      }}
                      className="text-[10px] font-medium text-destructive/80 hover:text-destructive bg-destructive/8 hover:bg-destructive/15 border border-destructive/20 px-1.5 py-0.5 rounded transition-colors"
                      title="Re-queue all failed unfollows as pending"
                    >
                      Retry
                    </button>
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground ml-auto tabular-nums">
                  {pct}%
                  {estimatedHours > 0 && ` · ~${estimatedHours}h left`}
                </span>
              </div>
            </>
          )}

          {/* Idle state: step-by-step guide */}
          {!isRunning && qTotal === 0 && !(cronHealth?.scanInProgress || settings?.scanInProgress) && (
            <div className="space-y-2 pt-0.5">
              <p className="text-[11px] text-muted-foreground/60 font-medium uppercase tracking-widest">How to trigger</p>
              <div className="space-y-1.5">
                {[
                  { step: "1", text: 'Click "Trigger Scan Now" below — CF Worker scans 500 following per cron tick (incremental, no timeouts). Each 3-min tick queues the next batch of non-followers-back.' },
                  { step: "2", text: "Cron drains 10 unfollows per tick in parallel with scanning (~200/hr). No action needed — it runs 24/7 automatically." },
                  { step: "3", text: "Watch this card: a blue 'Scan in progress' banner shows how many following have been checked. Queue bar appears once the first batch is queued." },
                ].map(({ step, text }) => (
                  <div key={step} className="flex items-start gap-2">
                    <span className="w-4 h-4 rounded-full bg-primary/15 text-primary text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{step}</span>
                    <p className="text-[11px] text-muted-foreground/80 leading-relaxed">{text}</p>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground/40 pt-0.5 border-t border-border/30">
                52k following → ~104 cron ticks to finish scanning · queue drains at ~200 unfollows/hr
              </p>
            </div>
          )}

          {/* Recent unfollows live ticker when running */}
          {isRunning && recentLog?.entries && recentLog.entries.length > 0 && (
            <div className="pt-1 border-t border-border/30">
              <p className="text-[10px] text-muted-foreground/50 uppercase tracking-widest mb-1.5 font-medium">Recently unfollowed</p>
              <div className="space-y-1">
                {recentLog.entries.slice(0, 4).map(entry => (
                  <div key={entry.id} className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full bg-destructive/8 border border-destructive/15 flex items-center justify-center flex-shrink-0">
                      <UserMinus className="w-2.5 h-2.5 text-destructive/50" />
                    </div>
                    <a
                      href={`https://bsky.app/profile/${entry.handle || entry.did}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-foreground/70 hover:text-primary transition-colors truncate"
                    >
                      @{entry.handle || entry.did}
                    </a>
                    <span className="text-[10px] text-muted-foreground/40 ml-auto flex-shrink-0 tabular-nums">
                      {format(new Date(entry.unfollowedAt), "h:mm a")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Settings body */}
      <div className="px-4 py-4 space-y-4">
        {isLoading ? (
          <div className="h-20 animate-pulse bg-muted rounded-lg" />
        ) : (
          <>
            {/* Row 1: Interval */}
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Scan every</label>
              <div className="flex gap-1.5 flex-wrap">
                {INTERVAL_OPTIONS.map(opt => (
                  <button key={opt.days} onClick={() => setIntervalDays(opt.days)}
                    className={cn("text-xs px-3 py-1.5 rounded-lg border transition-colors",
                      displayInterval === opt.days
                        ? "bg-primary/10 border-primary/30 text-primary font-medium"
                        : "border-border text-muted-foreground hover:bg-muted/50")}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Row 2: Queue size (cap) */}
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                Queue up to (per scan)
              </label>
              <div className="flex gap-1.5 flex-wrap">
                {CAP_OPTIONS.map(opt => (
                  <button key={opt.value} onClick={() => setCap(opt.value)}
                    className={cn("text-xs px-3 py-1.5 rounded-lg border transition-colors",
                      displayCap === opt.value
                        ? "bg-primary/10 border-primary/30 text-primary font-medium"
                        : "border-border text-muted-foreground hover:bg-muted/50")}>
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground/60 mt-1">
                Unfollows trickle out at ~200/hr (10 per cron). "All" queues every non-follower-back found.
              </p>
            </div>

            {/* Row 3: Follower filter */}
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                Skip accounts with
              </label>
              <div className="flex gap-1.5 flex-wrap">
                {MIN_FOLLOWERS_OPTIONS.map(opt => (
                  <button key={opt.value} onClick={() => setMinFollowersToKeep(opt.value)}
                    className={cn("text-xs px-3 py-1.5 rounded-lg border transition-colors",
                      displayMinFollowers === opt.value
                        ? "bg-primary/10 border-primary/30 text-primary font-medium"
                        : "border-border text-muted-foreground hover:bg-muted/50")}>
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground/60 mt-1">
                <strong>No exceptions</strong> = unfollow everyone who doesn't follow back. <strong>Skip 1k+</strong> etc. = protect big accounts from being unfollowed — useful if you follow brands or influencers.
              </p>
            </div>

            {/* Row 4: Actions */}
            <div className="flex items-center justify-between gap-3 pt-1 border-t border-border/40">
              <Button
                size="sm"
                variant="outline"
                onClick={triggerScan}
                disabled={triggering}
                className="h-8 text-xs gap-1.5"
              >
                {triggering
                  ? <><RefreshCw className="w-3 h-3 animate-spin" />Starting…</>
                  : <><Zap className="w-3 h-3" />Trigger Scan Now</>
                }
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving || (!isDirty && !settings)}
                className={cn("h-8 text-xs gap-1.5", isDirty && "ring-1 ring-primary/40")}>
                {saving ? <><RefreshCw className="w-3 h-3 animate-spin" />Saving…</> : <><Settings2 className="w-3 h-3" />Save Settings</>}
              </Button>
            </div>
          </>
        )}
      </div>

      <UnfollowLogPanel />
    </motion.div>
  );
}

type UnfollowLogEntry = {
  id: number;
  did: string;
  handle: string;
  unfollowedAt: string;
};

function UnfollowLogPanel() {
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery<{ ok: boolean; entries: UnfollowLogEntry[] }>({
    queryKey: ["auto-unfollow-log"],
    queryFn: () => customFetch("/api/auto-unfollow/log?limit=50"),
    enabled: open,
    staleTime: 30_000,
  });

  const entries = data?.entries ?? [];

  return (
    <div className="border-t border-border/50">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-colors"
      >
        <div className="flex items-center gap-1.5">
          <History className="w-3.5 h-3.5" />
          <span className="font-medium">Unfollow Log</span>
          {data && entries.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px] font-medium tabular-nums">
              {entries.length}
            </span>
          )}
        </div>
        <ChevronRight className={cn("w-3.5 h-3.5 transition-transform", open && "rotate-90")} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            {isLoading ? (
              <div className="px-4 pb-4 space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-8 bg-muted animate-pulse rounded-lg" />
                ))}
              </div>
            ) : entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-8 px-4 text-center">
                <History className="w-7 h-7 text-muted-foreground/25" />
                <p className="text-xs text-muted-foreground">No auto-unfollows recorded yet.</p>
                <p className="text-[11px] text-muted-foreground/60">
                  Once the cron runs and unfollows accounts, they'll appear here.
                </p>
              </div>
            ) : (
              <div className="px-4 pb-4">
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="max-h-72 overflow-y-auto divide-y divide-border/40">
                    {entries.map((entry) => (
                      <div key={entry.id} className="flex items-center justify-between px-3 py-2.5 hover:bg-muted/20 transition-colors">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-7 h-7 rounded-full bg-destructive/8 border border-destructive/15 flex items-center justify-center flex-shrink-0">
                            <UserMinus className="w-3 h-3 text-destructive/60" />
                          </div>
                          <div className="min-w-0">
                            <a
                              href={`https://bsky.app/profile/${entry.handle || entry.did}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs font-medium text-foreground hover:text-primary transition-colors truncate block"
                            >
                              {entry.handle ? `@${entry.handle}` : entry.did}
                            </a>
                            {entry.handle && (
                              <span className="text-[10px] text-muted-foreground/50 truncate block font-mono">
                                {entry.did}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 text-[11px] text-muted-foreground flex-shrink-0 ml-2">
                          <Clock className="w-3 h-3 flex-shrink-0" />
                          <span className="tabular-nums whitespace-nowrap">
                            {format(new Date(entry.unfollowedAt), "MMM d, h:mm a")}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground/50 mt-2 text-center">
                  Showing last {entries.length} auto-unfollowed account{entries.length !== 1 ? "s" : ""}
                </p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Unfollow Queue Banner ───────────────────────────────────────────────────

type UnfollowQueueDisplay = {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  running: boolean;
  paused: boolean;
  status: string;        // human-readable status line e.g. "Retrying (2/3)…" or "Rate limited — backing off 65s"
  startedAt: number;     // Date.now() when queue began, for ETA
};

function QueueProgressBanner({
  queue,
  onPause,
  onResume,
  onCancel,
}: {
  queue: UnfollowQueueDisplay;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}) {
  if (queue.total === 0) return null;
  const pct = queue.total > 0 ? Math.round((queue.processed / queue.total) * 100) : 0;
  const remaining = queue.total - queue.processed;
  const isDone = queue.processed >= queue.total;

  // ETA: based on elapsed time and progress rate
  let etaLabel = "";
  if (!isDone && queue.processed > 0 && queue.startedAt > 0) {
    const elapsed = (Date.now() - queue.startedAt) / 1000;
    const rate = queue.processed / elapsed; // accounts/second
    if (rate > 0) {
      const secsLeft = remaining / rate;
      if (secsLeft < 60) etaLabel = `~${Math.ceil(secsLeft)}s left`;
      else if (secsLeft < 3600) etaLabel = `~${Math.ceil(secsLeft / 60)}m left`;
      else etaLabel = `~${(secsLeft / 3600).toFixed(1)}h left`;
    }
  }

  const isRateLimited = queue.status.startsWith("Rate limited");
  const isRetrying = queue.status.startsWith("Retry");

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className={cn(
        "rounded-xl border px-4 py-3 mb-4 overflow-hidden",
        isDone
          ? "bg-emerald-500/8 border-emerald-500/25"
          : isRateLimited
          ? "bg-orange-500/8 border-orange-500/25"
          : queue.paused
          ? "bg-amber-500/8 border-amber-500/25"
          : "bg-primary/6 border-primary/20",
      )}
    >
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          {isDone ? (
            <div className="w-4 h-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            </div>
          ) : isRateLimited ? (
            <Loader2 className="w-4 h-4 text-orange-500 animate-spin flex-shrink-0" />
          ) : isRetrying ? (
            <Loader2 className="w-4 h-4 text-amber-500 animate-spin flex-shrink-0" />
          ) : queue.running ? (
            <Loader2 className="w-4 h-4 text-primary animate-spin flex-shrink-0" />
          ) : (
            <Pause className="w-4 h-4 text-amber-500 flex-shrink-0" />
          )}
          <span className="text-xs font-semibold text-foreground">
            {isDone
              ? `Done — unfollowed ${queue.succeeded.toLocaleString()} accounts`
              : queue.paused
              ? `Paused — ${remaining.toLocaleString()} remaining`
              : queue.status
              ? queue.status
              : `Unfollowing ${queue.total.toLocaleString()} accounts…`}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {queue.processed.toLocaleString()} / {queue.total.toLocaleString()} ({pct}%)
          </span>
          {etaLabel && (
            <span className="text-xs text-muted-foreground tabular-nums">{etaLabel}</span>
          )}
          {queue.failed > 0 && (
            <span className="text-xs text-destructive tabular-nums">{queue.failed.toLocaleString()} failed</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {!isDone && (
            queue.paused ? (
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={onResume}>
                <Play className="w-3 h-3" /> Resume
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={onPause}>
                <Pause className="w-3 h-3" /> Pause
              </Button>
            )
          )}
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground" onClick={onCancel}>
            <Ban className="w-3 h-3" /> {isDone ? "Clear" : "Cancel"}
          </Button>
        </div>
      </div>
      <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
        <motion.div
          className={cn(
            "h-full rounded-full",
            isDone ? "bg-emerald-500" : isRateLimited ? "bg-orange-500" : "bg-primary",
          )}
          animate={{ width: `${pct}%` }}
          transition={{ ease: "easeOut", duration: 0.4 }}
        />
      </div>
      {!isDone && (
        <p className="text-[10px] text-muted-foreground mt-1.5">
          {isRateLimited
            ? "Bluesky rate limit reached — auto-resuming after cooldown (no action needed)"
            : `50/batch · 8s between batches · auto-retry on failure · ~375 unfollows/min`}
        </p>
      )}
    </motion.div>
  );
}

// ─── Queue persistence helpers (localStorage) ────────────────────────────────

const QUEUE_STORAGE_KEY = "feedforge_unfollow_queue_v1";

type PersistedQueue = {
  items: Array<{ did: string; followUri?: string }>;
  processed: number;
  succeeded: number;
  failed: number;
  savedAt: number;
};

function saveQueueToStorage(
  items: Array<{ did: string; followUri?: string }>,
  processed: number,
  succeeded: number,
  failed: number,
) {
  try {
    const data: PersistedQueue = { items, processed, succeeded, failed, savedAt: Date.now() };
    localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(data));
  } catch { /* storage quota — ignore */ }
}

function loadQueueFromStorage(): PersistedQueue | null {
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedQueue;
    // Discard saves older than 48h (stale)
    if (Date.now() - parsed.savedAt > 48 * 60 * 60 * 1000) {
      localStorage.removeItem(QUEUE_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch { return null; }
}

function clearQueueFromStorage() {
  try { localStorage.removeItem(QUEUE_STORAGE_KEY); } catch {}
}

// ─── Auto-Follow Tab ────────────────────────────────────────────────────────

type AFSettings = {
  enabled: boolean;
  cap: number;
  markets: string[];
  minFollowers: number;
  maxFollowers: number;
  minPosts: number;
  followbackDays: number;
  totalFollowed: number;
};
type AFLogEntry = {
  did: string; handle: string; followers_count: number;
  market: string; followed_at: string; follow_back_status: string;
};

function AutoFollowTab() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: settingsData, isLoading: settingsLoading, isFetching: settingsFetching } =
    useQuery<{ ok: boolean; settings: AFSettings }>({
      queryKey: ["af-settings"],
      queryFn: () => customFetch("/api/follow-settings"),
      refetchInterval: 30_000,
    });

  const { data: logData, isLoading: logLoading } =
    useQuery<{ ok: boolean; entries: AFLogEntry[] }>({
      queryKey: ["af-log"],
      queryFn: () => customFetch("/api/auto-follow/log?limit=20"),
      refetchInterval: 30_000,
    });

  const settings = settingsData?.settings;
  const log = logData?.entries ?? [];

  // Local editable copy
  const [form, setForm] = useState<Partial<AFSettings>>({});
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);

  // Sync form when settings load (only on first load)
  useEffect(() => {
    if (settings && Object.keys(form).length === 0) {
      setForm({
        cap: settings.cap,
        minFollowers: settings.minFollowers,
        maxFollowers: settings.maxFollowers,
        minPosts: settings.minPosts,
        followbackDays: settings.followbackDays,
        markets: settings.markets,
      });
    }
  }, [settings]);

  async function saveSettings() {
    setSaving(true);
    try {
      await customFetch("/api/follow-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      await qc.invalidateQueries({ queryKey: ["af-settings"] });
      toast({ title: "Auto-follow settings saved" });
    } catch {
      toast({ title: "Failed to save settings", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled() {
    if (!settings) return;
    setToggling(true);
    try {
      await customFetch("/api/follow-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !settings.enabled }),
      });
      await qc.invalidateQueries({ queryKey: ["af-settings"] });
      toast({ title: settings.enabled ? "Auto-follow paused" : "Auto-follow enabled — cron runs every 3 min" });
    } catch {
      toast({ title: "Failed to update", variant: "destructive" });
    } finally {
      setToggling(false);
    }
  }

  const followedBack = log.filter(r => r.follow_back_status === "followed").length;
  const followBackRate = log.length > 0 ? Math.round((followedBack / log.length) * 100) : 0;

  const statusColor: Record<string, string> = {
    pending: "text-amber-500", followed: "text-emerald-500", unfollowed: "text-muted-foreground",
  };
  const statusLabel: Record<string, string> = {
    pending: "Awaiting check", followed: "Followed back ✓", unfollowed: "Unfollowed",
  };

  if (settingsLoading) {
    return (
      <div className="space-y-3 py-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <Activity className="w-8 h-8 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">Could not load auto-follow settings.</p>
        <p className="text-xs text-muted-foreground/60">Make sure the CF Worker is deployed with the latest changes.</p>
        <Button size="sm" variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["af-settings"] })}>Retry</Button>
      </div>
    );
  }

  const [triggering, setTriggering] = useState(false);

  async function triggerFollow() {
    setTriggering(true);
    try {
      await customFetch("/api/admin/trigger-follow", { method: "POST" });
      toast({ title: "Auto-follow triggered", description: "Discovery + first batch of follows starting now." });
      setTimeout(() => qc.invalidateQueries({ queryKey: ["af-settings"] }), 5_000);
      setTimeout(() => qc.invalidateQueries({ queryKey: ["af-log"] }), 10_000);
    } catch {
      toast({ title: "Failed to trigger", variant: "destructive" });
    } finally {
      setTriggering(false);
    }
  }

  return (
    <div className="space-y-4 py-2">

      {/* ── Enable / disable toggle ── */}
      <div className={cn(
        "flex items-center justify-between gap-3 px-4 py-3 rounded-xl border transition-colors",
        settings.enabled
          ? "bg-emerald-500/8 border-emerald-500/20"
          : "bg-muted/30 border-border",
      )}>
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-2.5 h-2.5 rounded-full flex-shrink-0",
            settings.enabled ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/30",
          )} />
          <div>
            <p className="text-sm font-semibold text-foreground">
              Auto-Follow {settings.enabled ? "Active" : "Paused"}
            </p>
            <p className="text-xs text-muted-foreground">
              {settings.enabled
                ? "Cron runs every 3 min · discovers & follows matching accounts"
                : "Toggle on to start auto-discovering and following accounts"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            onClick={triggerFollow}
            disabled={triggering || settingsFetching}
            title="Run auto-follow discovery + first follow batch immediately"
          >
            {triggering
              ? <RefreshCw className="w-3 h-3 animate-spin" />
              : <Zap className="w-3 h-3" />}
            {triggering ? "Running…" : "Trigger Now"}
          </Button>
          <button
            onClick={toggleEnabled}
            disabled={toggling}
            className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title={settings.enabled ? "Pause auto-follow" : "Enable auto-follow"}
          >
            {settings.enabled
              ? <ToggleRight className="w-6 h-6 text-emerald-500" />
              : <ToggleLeft className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: "Total Followed", value: settings.totalFollowed, color: "text-emerald-500" },
          { label: "Follow-back Rate", value: log.length > 0 ? `${followBackRate}%` : "—", color: "text-violet-500" },
          { label: "Log Entries", value: log.length, color: "text-primary" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-card border border-card-border rounded-xl px-4 py-3">
            <p className={cn("text-xs mb-1", color)}>{label}</p>
            <p className="text-xl font-bold text-foreground tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      {/* ── Editable settings ── */}
      <div className="bg-card border border-card-border rounded-xl px-4 py-4 space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Settings</p>

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Min followers</span>
            <input
              type="number" min={0}
              value={form.minFollowers ?? ""}
              onChange={e => setForm(f => ({ ...f, minFollowers: parseInt(e.target.value) || 0 }))}
              className="w-full text-sm bg-background border border-input rounded-lg px-3 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Max followers</span>
            <input
              type="number" min={0}
              value={form.maxFollowers ?? ""}
              onChange={e => setForm(f => ({ ...f, maxFollowers: parseInt(e.target.value) || 0 }))}
              className="w-full text-sm bg-background border border-input rounded-lg px-3 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Min posts</span>
            <input
              type="number" min={0}
              value={form.minPosts ?? ""}
              onChange={e => setForm(f => ({ ...f, minPosts: parseInt(e.target.value) || 0 }))}
              className="w-full text-sm bg-background border border-input rounded-lg px-3 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Follow-back window (days)</span>
            <input
              type="number" min={1}
              value={form.followbackDays ?? ""}
              onChange={e => setForm(f => ({ ...f, followbackDays: parseInt(e.target.value) || 7 }))}
              className="w-full text-sm bg-background border border-input rounded-lg px-3 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>
          <label className="space-y-1 col-span-2">
            <span className="text-xs text-muted-foreground">Follow cap (0 = unlimited)</span>
            <input
              type="number" min={0}
              value={form.cap ?? ""}
              onChange={e => setForm(f => ({ ...f, cap: parseInt(e.target.value) || 0 }))}
              className="w-full text-sm bg-background border border-input rounded-lg px-3 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>
        </div>

        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Markets (comma-separated)</span>
          <input
            type="text"
            value={(form.markets ?? []).join(", ")}
            onChange={e => setForm(f => ({
              ...f,
              markets: e.target.value.split(",").map(m => m.trim()).filter(Boolean),
            }))}
            placeholder="usa, europe, uk"
            className="w-full text-sm bg-background border border-input rounded-lg px-3 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>

        <Button size="sm" className="w-full gap-2" onClick={saveSettings} disabled={saving}>
          {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
          {saving ? "Saving…" : "Save Settings"}
        </Button>
      </div>

      {/* ── Recent follow log ── */}
      {logLoading ? (
        <div className="h-24 rounded-xl bg-muted animate-pulse" />
      ) : log.length > 0 ? (
        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Recent Follows ({log.length})
            </p>
          </div>
          <div className="divide-y divide-border/40">
            {log.map(row => (
              <div key={row.did} className="flex items-center gap-3 px-4 py-2.5">
                <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/15 flex items-center justify-center flex-shrink-0">
                  <span className="text-[10px] font-bold text-primary">{row.handle[0]?.toUpperCase() ?? "?"}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">@{row.handle}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {row.market} · {row.followers_count.toLocaleString()} followers
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={cn("text-[10px] font-medium", statusColor[row.follow_back_status] ?? "text-muted-foreground")}>
                    {statusLabel[row.follow_back_status] ?? row.follow_back_status}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{format(new Date(row.followed_at), "MMM d")}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-32 gap-2 text-center bg-card border border-card-border rounded-xl">
          <Activity className="w-7 h-7 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground">No follows logged yet.</p>
          <p className="text-xs text-muted-foreground/60">
            Cron runs every 3 min — first follows will appear shortly.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

// Bluesky rate limit: 3000 req/300s = 10/s. CF worker uses concurrency-20 for deleteFollow.
// Batch of 50 + 8s delay = ~375 unfollows/min (62% of limit) — safe with headroom.
const QUEUE_BATCH_SIZE = 50;
const QUEUE_BATCH_DELAY_MS = 8_000;      // 8s between successful batches
const RATE_LIMIT_BACKOFF_MS = 65_000;    // 65s backoff when we detect rate limiting (just over the 60s window reset)
const RETRY_DELAY_MS = 12_000;           // 12s before retrying a failed batch
const MAX_BATCH_RETRIES = 3;             // retry each batch up to 3 times before skipping

export default function Audience() {
  const [tab, setTab] = useState<Tab>("followers");
  const [followersCursor, setFollowersCursor] = useState<string | undefined>();
  const [followingCursor, setFollowingCursor] = useState<string | undefined>();
  const [followersCursorStack, setFollowersCursorStack] = useState<string[]>([]);
  const [followingCursorStack, setFollowingCursorStack] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedFeedId, setSelectedFeedId] = useState<string>("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: profile } = useGetBlueskyProfile({ query: { retry: false, queryKey: ["profile-audience"], refetchInterval: 30_000 } });
  const { data: feeds } = useListFeeds();

  const { data: followers, isLoading: loadingFollowers } = useGetFollowers(
    { limit: 50, cursor: followersCursor },
    { query: { queryKey: ["followers", followersCursor], enabled: tab === "followers" || tab === "search" } },
  );
  const { data: following, isLoading: loadingFollowing } = useGetFollowing(
    { limit: 50, cursor: followingCursor },
    { query: { queryKey: ["following", followingCursor], enabled: tab === "following" } },
  );

  const [nfbUsers, setNfbUsers] = useState<AudienceUser[]>([]);
  const [nfbCursor, setNfbCursor] = useState<string | null>(null);
  const [nfbHasMore, setNfbHasMore] = useState(true);
  const [nfbLoadingMore, setNfbLoadingMore] = useState(false);

  const { isLoading: loadingNFB } = useQuery({
    queryKey: ["not-following-back-init"],
    queryFn: async () => {
      const res = await customFetch<{ users: AudienceUser[]; cursor: string | null; hasMore: boolean }>(
        "/api/bluesky/not-following-back",
      );
      setNfbUsers(res.users);
      setNfbCursor(res.cursor);
      setNfbHasMore(res.hasMore);
      return res;
    },
    enabled: tab === "not-following-back" && nfbUsers.length === 0,
    staleTime: 120_000,
  });

  const loadMoreNFB = useCallback(async () => {
    if (!nfbCursor || nfbLoadingMore) return;
    setNfbLoadingMore(true);
    try {
      const res = await customFetch<{ users: AudienceUser[]; cursor: string | null; hasMore: boolean }>(
        `/api/bluesky/not-following-back?cursor=${encodeURIComponent(nfbCursor)}`,
      );
      setNfbUsers(prev => {
        const seen = new Set(prev.map(u => u.did));
        return [...prev, ...res.users.filter(u => !seen.has(u.did))];
      });
      setNfbCursor(res.cursor);
      setNfbHasMore(res.hasMore);
    } finally {
      setNfbLoadingMore(false);
    }
  }, [nfbCursor, nfbLoadingMore]);

  const numericFeedId = selectedFeedId ? parseInt(selectedFeedId) : null;
  const { data: topAuthors, isLoading: loadingTopAuthors } = useGetFeedTopAuthors(numericFeedId!, {
    query: { enabled: tab === "top-authors" && numericFeedId !== null, queryKey: ["top-authors-audience", numericFeedId] },
  });

  const bulkFollow = useBulkFollow();
  const bulkUnfollow = useBulkUnfollow();

  // ── CF Worker auto-unfollow queue status (page-level, for conflict detection) ──
  const { data: cfQueueStatus } = useQuery<{
    pending: number; done: number; failed: number; total: number; estimatedMinutesLeft: number;
  }>({
    queryKey: ["cf-queue-page-level"],
    queryFn: () => customFetch("/api/bluesky/unfollow-schedule/status"),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const cfQueueActive = (cfQueueStatus?.pending ?? 0) > 0;

  // ── Unfollow queue (client-side, batched, rate-limited) ──────────────────
  const queueItemsRef = useRef<Array<{ did: string; followUri?: string }>>([]);
  const queueProcessedRef = useRef(0);
  const isProcessingRef = useRef(false);
  const isPausedRef = useRef(false);
  const isCancelledRef = useRef(false);

  const [queueDisplay, setQueueDisplay] = useState<UnfollowQueueDisplay>({
    total: 0, processed: 0, succeeded: 0, failed: 0, running: false, paused: false,
    status: "", startedAt: 0,
  });

  // ── Restore persisted queue on mount + auto-resume ───────────────────────
  // We use a ref to hold runQueue since it isn't defined yet at this point;
  // runQueueRef is assigned right after runQueue is created below.
  const runQueueRef = useRef<() => void>(() => {});

  useEffect(() => {
    const saved = loadQueueFromStorage();
    if (!saved) return;
    const remaining = saved.items.length - saved.processed;
    if (remaining <= 0) { clearQueueFromStorage(); return; }
    // Restore refs
    queueItemsRef.current = saved.items;
    queueProcessedRef.current = saved.processed;
    // Restore display — auto-resume immediately
    setQueueDisplay({
      total: saved.items.length,
      processed: saved.processed,
      succeeded: saved.succeeded,
      failed: saved.failed,
      running: true,
      paused: false,
      status: `Resuming — ${remaining.toLocaleString()} accounts still to unfollow`,
      startedAt: Date.now(),
    });
    // Small delay so the banner renders before processing starts
    setTimeout(() => { runQueueRef.current(); }, 800);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Warn before closing when queue is running ────────────────────────────
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (isProcessingRef.current) {
        // Save latest state so we can resume after reopen
        saveQueueToStorage(
          queueItemsRef.current,
          queueProcessedRef.current,
          queueDisplay.succeeded,
          queueDisplay.failed,
        );
        e.preventDefault();
        e.returnValue = "Unfollow queue is running — progress is saved and will auto-resume when you reopen.";
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [queueDisplay.succeeded, queueDisplay.failed]);

  const runQueue = useCallback(async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    isPausedRef.current = false;
    isCancelledRef.current = false;
    const startedAt = Date.now();
    setQueueDisplay(p => ({ ...p, running: true, paused: false, startedAt, status: "" }));

    const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

    while (true) {
      if (isCancelledRef.current) break;
      if (isPausedRef.current) {
        setQueueDisplay(p => ({ ...p, running: false, paused: true, status: "" }));
        break;
      }

      const allItems = queueItemsRef.current;
      const idx = queueProcessedRef.current;
      if (idx >= allItems.length) {
        setQueueDisplay(p => ({ ...p, running: false, paused: false, status: "" }));
        break;
      }

      const batch = allItems.slice(idx, idx + QUEUE_BATCH_SIZE);
      const followUris = batch.map(x => x.followUri).filter(Boolean) as string[];
      const fallbackDids = batch.filter(x => !x.followUri).map(x => x.did);

      let batchSucceeded = 0;
      let batchFailed = 0;
      let retryCount = 0;

      // Retry loop — up to MAX_BATCH_RETRIES attempts per batch
      while (retryCount <= MAX_BATCH_RETRIES) {
        if (isCancelledRef.current || isPausedRef.current) break;

        try {
          const res = await customFetch<{ succeeded: number; failed: number }>(
            "/api/bluesky/bulk-unfollow",
            { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ followUris, dids: fallbackDids }) },
          );
          batchSucceeded = res.succeeded ?? 0;
          batchFailed = res.failed ?? 0;

          // Full failure (0 succeeded) strongly suggests rate limiting — back off
          if (batchSucceeded === 0 && batchFailed > 0 && retryCount < MAX_BATCH_RETRIES) {
            setQueueDisplay(p => ({
              ...p,
              status: `Rate limited — backing off ${Math.round(RATE_LIMIT_BACKOFF_MS / 1000)}s before retry…`,
            }));
            await sleep(RATE_LIMIT_BACKOFF_MS);
            retryCount++;
            continue;
          }

          // Partial failure (some succeeded, some didn't) — short retry delay
          if (batchFailed > 0 && batchSucceeded > 0 && retryCount < MAX_BATCH_RETRIES) {
            setQueueDisplay(p => ({
              ...p,
              status: `Retry ${retryCount + 1}/${MAX_BATCH_RETRIES} — ${batchFailed} accounts didn't go through…`,
            }));
            await sleep(RETRY_DELAY_MS);
            retryCount++;
            continue;
          }

          // Success (all or partial after retries) — break retry loop
          break;
        } catch {
          if (retryCount < MAX_BATCH_RETRIES) {
            const backoff = RETRY_DELAY_MS * (retryCount + 1);
            setQueueDisplay(p => ({
              ...p,
              status: `Network error — retry ${retryCount + 1}/${MAX_BATCH_RETRIES} in ${Math.round(backoff / 1000)}s…`,
            }));
            await sleep(backoff);
            retryCount++;
            continue;
          }
          batchFailed = batch.length;
          break;
        }
      }

      // Advance queue pointer and update display
      queueProcessedRef.current += batch.length;
      const newSucceeded = queueDisplay.succeeded + batchSucceeded;
      const newFailed = queueDisplay.failed + batchFailed;
      setQueueDisplay(p => {
        const ns = p.succeeded + batchSucceeded;
        const nf = p.failed + batchFailed;
        // Persist after every batch so a close/crash can resume from here
        saveQueueToStorage(queueItemsRef.current, queueProcessedRef.current, ns, nf);
        return { ...p, running: true, processed: queueProcessedRef.current, succeeded: ns, failed: nf, status: "" };
      });
      void newSucceeded; void newFailed; // suppress unused warning

      // Normal inter-batch delay (skip if cancelled/paused)
      if (!isCancelledRef.current && !isPausedRef.current && queueProcessedRef.current < allItems.length) {
        await sleep(QUEUE_BATCH_DELAY_MS);
      }
    }

    isProcessingRef.current = false;
    // Queue fully done — clear the persisted state
    if (!isPausedRef.current) clearQueueFromStorage();
    queryClient.invalidateQueries();
  }, [queryClient]); // queueDisplay.succeeded/failed intentionally excluded — stale closure OK here, setQueueDisplay(p=>) handles it

  // Assign ref so the mount effect can call runQueue without a stale closure
  runQueueRef.current = runQueue;

  function buildFollowUriMap() {
    const m = new Map<string, string>();
    for (const u of following?.users ?? []) { if (u.followUri) m.set(u.did, u.followUri); }
    for (const u of nfbUsers) { if (u.followUri) m.set(u.did, u.followUri); }
    return m;
  }

  function enqueueSelected() {
    const selectedDids = Array.from(selected);
    const uriMap = buildFollowUriMap();
    const newItems = selectedDids.map(did => ({ did, followUri: uriMap.get(did) }));
    // Deduplicate
    const existingDids = new Set(queueItemsRef.current.map(x => x.did));
    const toAdd = newItems.filter(x => !existingDids.has(x.did));
    queueItemsRef.current = [...queueItemsRef.current, ...toAdd];
    const total = queueItemsRef.current.length;
    setQueueDisplay(p => ({ ...p, total, running: true, paused: false }));
    clearSelection();
    toast({ title: `${toAdd.length.toLocaleString()} added to unfollow queue (${total.toLocaleString()} total)` });
    runQueue();
  }

  function pauseQueue() {
    isPausedRef.current = true;
    setQueueDisplay(p => {
      // Persist on pause so a close after pause can still resume
      saveQueueToStorage(queueItemsRef.current, queueProcessedRef.current, p.succeeded, p.failed);
      return { ...p, paused: true, running: false };
    });
  }

  function resumeQueue() {
    setQueueDisplay(p => ({ ...p, paused: false, running: true }));
    runQueue();
  }

  function cancelQueue() {
    isCancelledRef.current = true;
    isPausedRef.current = false;
    queueItemsRef.current = [];
    queueProcessedRef.current = 0;
    isProcessingRef.current = false;
    clearQueueFromStorage();
    setQueueDisplay({ total: 0, processed: 0, succeeded: 0, failed: 0, running: false, paused: false, status: "", startedAt: 0 });
  }

  // ── Load-all-pages-and-queue ──────────────────────────────────────────────
  const [loadAllState, setLoadAllState] = useState<{
    loading: boolean;
    found: number;
    source: "following" | "not-following-back" | null;
  }>({ loading: false, found: 0, source: null });
  const loadAllAbortRef = useRef(false);

  async function loadAllAndQueue(source: "following" | "not-following-back") {
    setLoadAllState({ loading: true, found: 0, source });
    loadAllAbortRef.current = false;

    const accumulated: Array<{ did: string; followUri?: string }> = [];
    let cursor: string | undefined;

    try {
      while (true) {
        if (loadAllAbortRef.current) break;
        const endpoint = source === "following"
          ? `/api/bluesky/following?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`
          : `/api/bluesky/not-following-back${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;

        const res = await customFetch<{ users: AudienceUser[]; cursor?: string | null }>(endpoint);
        for (const u of res.users) {
          accumulated.push({ did: u.did, followUri: u.followUri ?? undefined });
        }
        setLoadAllState(p => ({ ...p, found: accumulated.length }));

        if (!res.cursor) break;
        cursor = res.cursor;
        // Small delay to avoid hammering the API
        await new Promise(r => setTimeout(r, 200));
      }
    } catch (err) {
      toast({ title: "Failed to load all pages", variant: "destructive" });
    }

    setLoadAllState({ loading: false, found: 0, source: null });

    if (accumulated.length === 0 || loadAllAbortRef.current) return;

    // Deduplicate and add to queue
    const existingDids = new Set(queueItemsRef.current.map(x => x.did));
    const toAdd = accumulated.filter(x => !existingDids.has(x.did));
    queueItemsRef.current = [...queueItemsRef.current, ...toAdd];
    queueProcessedRef.current = Math.min(queueProcessedRef.current, queueItemsRef.current.length - toAdd.length);
    const total = queueItemsRef.current.length;
    setQueueDisplay(p => ({ ...p, total, running: true, paused: false }));
    toast({ title: `${toAdd.length.toLocaleString()} accounts queued for unfollow` });
    runQueue();
  }

  function cancelLoadAll() {
    loadAllAbortRef.current = true;
    setLoadAllState({ loading: false, found: 0, source: null });
  }
  // ────────────────────────────────────────────────────────────────────────

  const toggleSelect = (did: string) => setSelected(prev => { const n = new Set(prev); n.has(did) ? n.delete(did) : n.add(did); return n; });
  const selectAll = (users: AudienceUser[]) => setSelected(new Set(users.map(u => u.did)));
  const clearSelection = () => setSelected(new Set());

  function handleBulkFollow() {
    bulkFollow.mutate({ data: { dids: Array.from(selected) } }, {
      onSuccess: (r) => { toast({ title: `Followed ${r.succeeded} accounts` }); clearSelection(); queryClient.invalidateQueries(); },
      onError: () => toast({ title: "Bulk follow failed", variant: "destructive" }),
    });
  }
  function handleBulkUnfollow() {
    const selectedDids = Array.from(selected);
    const followUriMap = buildFollowUriMap();
    const followUris = selectedDids.map(did => followUriMap.get(did)).filter((uri): uri is string => !!uri);
    const fallbackDids = selectedDids.filter(did => !followUriMap.has(did));
    bulkUnfollow.mutate({ data: { dids: fallbackDids, followUris } }, {
      onSuccess: (r) => { toast({ title: `Unfollowed ${r.succeeded} accounts` }); clearSelection(); queryClient.invalidateQueries(); },
      onError: () => toast({ title: "Bulk unfollow failed", variant: "destructive" }),
    });
  }

  const tabs: { id: Tab; label: string; shortLabel: string; icon: React.ElementType; count?: number }[] = [
    { id: "followers", label: "Followers", shortLabel: "Followers", icon: Users, count: profile?.followersCount },
    { id: "following", label: "Following", shortLabel: "Following", icon: UserPlus, count: profile?.followsCount },
    { id: "not-following-back", label: "Not Following Back", shortLabel: "NFB", icon: UserMinus, count: nfbUsers.length || undefined },
    { id: "top-authors", label: "Top Authors", shortLabel: "Authors", icon: TrendingUp },
    { id: "growth", label: "Growth", shortLabel: "Growth", icon: BarChart2 },
    { id: "auto-follow", label: "Auto-Follow", shortLabel: "Auto", icon: Zap },
    { id: "search", label: "Search & Follow", shortLabel: "Search", icon: Search },
  ];

  function filterUsers(users: AudienceUser[]) {
    if (!search) return users;
    const q = search.toLowerCase();
    return users.filter(u =>
      u.handle.toLowerCase().includes(q) ||
      (u.displayName?.toLowerCase().includes(q)) ||
      (u.description?.toLowerCase().includes(q))
    );
  }

  const currentFollowers = filterUsers(followers?.users ?? []);
  const currentFollowing = filterUsers(following?.users ?? []);
  const currentNFB = filterUsers(nfbUsers);
  const currentTopAuthors = topAuthors ?? [];

  return (
    <div className="px-4 py-5 md:px-8 md:py-8 max-w-5xl mx-auto">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="mb-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">Audience</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Manage followers, following, and discover new accounts</p>
          </div>
          <SyncEngagementButton />
        </div>
      </motion.div>

      {/* Stats Row */}
      {profile && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="grid grid-cols-3 gap-3 mb-5"
        >
          <StatBadge label="Followers" value={profile.followersCount} accent />
          <StatBadge label="Following" value={profile.followsCount} />
          <StatBadge label="Not Following Back" value={nfbUsers.length > 0 ? nfbUsers.length : "—"} />
        </motion.div>
      )}

      {/* Auto-Unfollow Card */}
      <AutoUnfollowCard />

      {/* Mass Unfollow Queue Progress */}
      <AnimatePresence>
        {queueDisplay.total > 0 && (
          <QueueProgressBanner
            queue={queueDisplay}
            onPause={pauseQueue}
            onResume={resumeQueue}
            onCancel={cancelQueue}
          />
        )}
      </AnimatePresence>

      {/* Tabs */}
      <div className="flex border-b border-border mb-0 overflow-x-auto scrollbar-thin -mx-4 px-4 md:mx-0 md:px-0">
        {tabs.map(({ id, label, shortLabel, icon: Icon, count }) => (
          <button
            key={id}
            onClick={() => { setTab(id); setSearch(""); clearSelection(); }}
            className={cn(
              "flex items-center gap-1.5 px-3 md:px-4 py-2.5 text-xs md:text-sm font-medium border-b-2 -mb-px transition-all whitespace-nowrap flex-shrink-0",
              tab === id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
            )}
          >
            <Icon className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="sm:hidden">{shortLabel}</span>
            <span className="hidden sm:inline">{label}</span>
            {count !== undefined && (
              <span className={cn(
                "text-[10px] px-1.5 py-0.5 rounded-full tabular-nums font-medium",
                tab === id ? "bg-primary/12 text-primary" : "bg-muted text-muted-foreground",
              )}>
                {count.toLocaleString()}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Search Tab */}
      {tab === "search" ? (
        <motion.div key="search" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-4">
          <SearchFollowTab defaultUsers={followers?.users ?? []} defaultLoading={loadingFollowers} />
        </motion.div>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <div className="bg-card border border-card-border rounded-b-xl rounded-tr-xl overflow-hidden">
              {/* Toolbar */}
              <div className="px-4 py-3 border-b border-border/50 flex items-center gap-2 flex-wrap bg-muted/10">
                <div className="relative flex-1 min-w-40">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Filter by handle, name, bio…"
                    className="pl-8 h-8 text-xs"
                  />
                </div>

                {tab === "top-authors" && (
                  <Select value={selectedFeedId} onValueChange={setSelectedFeedId}>
                    <SelectTrigger className="w-44 h-8 text-xs">
                      <SelectValue placeholder="Select a feed…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(feeds || []).map(f => (
                        <SelectItem key={f.id} value={String(f.id)}>{f.displayName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {selected.size > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs text-muted-foreground font-medium">{selected.size} selected</span>
                    {tab === "followers" && (
                      <Button size="sm" className="h-7 text-xs gap-1" onClick={handleBulkFollow} disabled={bulkFollow.isPending}>
                        <UserPlus className="w-3 h-3" />
                        {bulkFollow.isPending ? "Following…" : `Follow Back ${selected.size}`}
                      </Button>
                    )}
                    {(tab === "not-following-back" || tab === "following") && (
                      <>
                        {cfQueueActive ? (
                          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/8 border border-amber-500/25 text-amber-600 text-[11px] font-medium">
                            <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                            CF auto-unfollow running — manual unfollows paused
                          </div>
                        ) : (
                          <>
                            <Button size="sm" variant="destructive" className="h-7 text-xs gap-1" onClick={handleBulkUnfollow} disabled={bulkUnfollow.isPending}>
                              <UserMinus className="w-3 h-3" />
                              {bulkUnfollow.isPending ? "Unfollowing…" : `Unfollow ${selected.size}`}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1 border-amber-500/40 text-amber-600 hover:bg-amber-500/8"
                              onClick={enqueueSelected}
                              title="Queue for gradual unfollow — 50 per batch, 8s between batches, auto-retry on rate limits (~375/min)"
                            >
                              <ListOrdered className="w-3 h-3" />
                              Queue {selected.size.toLocaleString()}
                            </Button>
                          </>
                        )}
                      </>
                    )}
                    {tab === "top-authors" && (
                      <Button size="sm" className="h-7 text-xs gap-1" onClick={handleBulkFollow} disabled={bulkFollow.isPending}>
                        <UserPlus className="w-3 h-3" />
                        {bulkFollow.isPending ? "Following…" : `Follow ${selected.size}`}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={clearSelection}>
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                )}

                {tab === "followers" && currentFollowers.length > 0 && selected.size === 0 && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => selectAll(currentFollowers)}>
                    <CheckSquare className="w-3 h-3" />
                    Select All ({currentFollowers.length})
                  </Button>
                )}
                {tab === "not-following-back" && currentNFB.length > 0 && selected.size === 0 && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => selectAll(currentNFB)}>
                    <CheckSquare className="w-3 h-3" />
                    All ({currentNFB.length})
                  </Button>
                )}

                {/* Queue All — loads every page automatically */}
                {tab === "following" && selected.size === 0 && !loadAllState.loading && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1 border-amber-500/40 text-amber-600 hover:bg-amber-500/8 ml-auto"
                    onClick={() => loadAllAndQueue("following")}
                    title="Automatically loads all following pages and queues them for unfollow"
                  >
                    <Download className="w-3 h-3" />
                    Queue All {profile?.followsCount ? `(${profile.followsCount.toLocaleString()})` : "Following"}
                  </Button>
                )}
                {tab === "not-following-back" && selected.size === 0 && !loadAllState.loading && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1 border-amber-500/40 text-amber-600 hover:bg-amber-500/8 ml-auto"
                    onClick={() => loadAllAndQueue("not-following-back")}
                    title="Automatically loads all NFB pages and queues them for unfollow"
                  >
                    <Download className="w-3 h-3" />
                    Queue All NFB
                  </Button>
                )}

                {/* Loading-all-pages indicator */}
                {loadAllState.loading && (loadAllState.source === tab || (tab === "not-following-back" && loadAllState.source === "not-following-back")) && (
                  <div className="flex items-center gap-2 ml-auto text-xs text-amber-600">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span className="font-medium">
                      Loading all pages… {loadAllState.found > 0 ? `${loadAllState.found.toLocaleString()} found` : ""}
                    </span>
                    <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground" onClick={cancelLoadAll}>
                      <X className="w-3 h-3" /> Cancel
                    </Button>
                  </div>
                )}
              </div>

              {/* FOLLOWERS */}
              {tab === "followers" && (
                loadingFollowers ? <SkeletonList /> :
                currentFollowers.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 gap-2">
                    <Users className="w-9 h-9 text-muted-foreground/20" />
                    <p className="text-sm text-muted-foreground">{search ? "No results." : "No followers found."}</p>
                  </div>
                ) : (
                  <>
                    <div>{currentFollowers.map((user, i) => (
                      <motion.div key={user.did} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}>
                        <UserCard
                          user={user}
                          selected={selected.has(user.did)}
                          onToggle={() => toggleSelect(user.did)}
                        />
                      </motion.div>
                    ))}</div>
                    <Pagination
                      cursorStack={followersCursorStack}
                      onPrev={() => { const s = [...followersCursorStack]; const p = s.pop(); setFollowersCursorStack(s); setFollowersCursor(p === "" ? undefined : p); }}
                      onNext={() => { if (followers?.cursor) { setFollowersCursorStack(s => [...s, followersCursor ?? ""]); setFollowersCursor(followers.cursor!); } }}
                      hasNext={!!followers?.cursor}
                      count={currentFollowers.length}
                    />
                  </>
                )
              )}

              {/* FOLLOWING */}
              {tab === "following" && (
                loadingFollowing ? <SkeletonList /> :
                currentFollowing.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 gap-2">
                    <UserPlus className="w-9 h-9 text-muted-foreground/20" />
                    <p className="text-sm text-muted-foreground">{search ? "No results." : "Not following anyone."}</p>
                  </div>
                ) : (
                  <>
                    <div>{currentFollowing.map((user, i) => (
                      <motion.div key={user.did} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}>
                        <UserCard
                          user={user}
                          selected={selected.has(user.did)}
                          onToggle={() => toggleSelect(user.did)}
                          actionLabel="Unfollow"
                          actionIcon={UserMinus}
                          onAction={() => {
                            const targetDid = user.did;
                            const followUri = user.followUri ?? undefined;
                            bulkUnfollow.mutate(
                              { data: { dids: followUri ? [] : [targetDid], followUris: followUri ? [followUri] : undefined } },
                              {
                                onSuccess: (r) => { toast({ title: `Unfollowed ${r.succeeded} account${r.succeeded !== 1 ? "s" : ""}` }); queryClient.invalidateQueries(); },
                                onError: () => toast({ title: "Unfollow failed", variant: "destructive" }),
                              },
                            );
                          }}
                          actionPending={bulkUnfollow.isPending}
                        />
                      </motion.div>
                    ))}</div>
                    <Pagination
                      cursorStack={followingCursorStack}
                      onPrev={() => { const s = [...followingCursorStack]; const p = s.pop(); setFollowingCursorStack(s); setFollowingCursor(p === "" ? undefined : p); }}
                      onNext={() => { if (following?.cursor) { setFollowingCursorStack(s => [...s, followingCursor ?? ""]); setFollowingCursor(following.cursor!); } }}
                      hasNext={!!following?.cursor}
                      count={currentFollowing.length}
                    />
                  </>
                )
              )}

              {/* NOT FOLLOWING BACK */}
              {tab === "not-following-back" && (
                loadingNFB ? (
                  <div className="flex flex-col items-center justify-center h-52 gap-3">
                    <div className="w-10 h-10 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
                    <p className="text-sm text-muted-foreground">Checking your first 100 following…</p>
                  </div>
                ) : currentNFB.length === 0 && !nfbHasMore ? (
                  <div className="flex flex-col items-center justify-center h-52 gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-500/8 border border-emerald-500/20 flex items-center justify-center">
                      <Heart className="w-6 h-6 text-emerald-500" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-semibold text-foreground">Everyone follows you back!</p>
                      <p className="text-xs text-muted-foreground mt-0.5">All your following accounts follow you back.</p>
                    </div>
                  </div>
                ) : (
                  <div>
                    {currentNFB.map((user, i) => (
                      <motion.div key={user.did} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.015 }}>
                        <UserCard
                          user={user}
                          selected={selected.has(user.did)}
                          onToggle={() => toggleSelect(user.did)}
                          rank={i + 1}
                        />
                      </motion.div>
                    ))}
                    {nfbHasMore && (
                      <div className="px-4 py-4 border-t border-border/50 bg-muted/15 flex flex-col items-center gap-2.5">
                        <p className="text-xs text-muted-foreground">
                          {nfbUsers.length > 0
                            ? <><strong className="text-foreground font-semibold">{nfbUsers.length}</strong> found so far — more pages available</>
                            : "No accounts found yet in this page — keep loading to check more"
                          }
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={loadMoreNFB}
                          disabled={nfbLoadingMore}
                          className="w-52 gap-2"
                        >
                          {nfbLoadingMore ? (
                            <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Checking next 100…</>
                          ) : (
                            <><ChevronRight className="w-3.5 h-3.5" />Load next 100 following</>
                          )}
                        </Button>
                      </div>
                    )}
                    {!nfbHasMore && nfbUsers.length > 0 && (
                      <div className="px-4 py-3 border-t border-border/50 bg-muted/15 flex items-center justify-center gap-2">
                        <div className="w-4 h-4 rounded-full bg-emerald-500/15 flex items-center justify-center">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          All following checked — <strong className="text-foreground font-semibold">{nfbUsers.length}</strong> not following back
                        </p>
                      </div>
                    )}
                  </div>
                )
              )}

              {/* TOP AUTHORS */}
              {tab === "top-authors" && (
                !selectedFeedId ? (
                  <div className="flex flex-col items-center justify-center h-52 gap-3 text-center px-8">
                    <div className="w-12 h-12 rounded-2xl bg-muted border border-border flex items-center justify-center">
                      <TrendingUp className="w-5 h-5 text-muted-foreground/50" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">Select a feed</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Choose a feed above to see its top contributing authors</p>
                    </div>
                  </div>
                ) : loadingTopAuthors ? <SkeletonList /> :
                currentTopAuthors.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 gap-2">
                    <TrendingUp className="w-9 h-9 text-muted-foreground/20" />
                    <p className="text-sm text-muted-foreground">No authors yet. Posts will appear as they're indexed.</p>
                  </div>
                ) : (
                  <div>
                    {currentTopAuthors.map((author, i) => {
                      const u: AudienceUser & { postCount?: number } = {
                        did: author.did,
                        handle: author.did,
                        displayName: null,
                        avatar: null,
                        description: null,
                        followersCount: 0,
                        followsCount: 0,
                        followedAt: null,
                        postCount: author.postCount,
                      };
                      return (
                        <motion.div key={author.did} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}>
                          <UserCard
                            user={u}
                            selected={selected.has(author.did)}
                            onToggle={() => toggleSelect(author.did)}
                            rank={i + 1}
                          />
                        </motion.div>
                      );
                    })}
                  </div>
                )
              )}

              {/* GROWTH */}
              {tab === "growth" && <FollowerGrowthTab />}

              {tab === "auto-follow" && <AutoFollowTab />}
            </div>
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}
