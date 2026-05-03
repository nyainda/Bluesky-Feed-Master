import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  useGetFollowers, useGetFollowing, useGetNotFollowingBack,
  useSyncEngagement, useBulkFollow, useBulkUnfollow,
  useGetBlueskyProfile, useListFeeds, useGetFeedTopAuthors,
  customFetch,
} from "@workspace/api-client-react";
import type { AudienceUser } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Users, UserMinus, UserPlus, RefreshCw, ExternalLink,
  ChevronLeft, ChevronRight, Search, CheckSquare, Square,
  Zap, TrendingUp, Heart, AlertTriangle, Filter, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Tab = "followers" | "following" | "not-following-back" | "top-authors" | "search";

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

function shortenDid(did: string) {
  if (did.length <= 22) return did;
  return did.slice(0, 14) + "…" + did.slice(-6);
}

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
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors border-b border-border/50 last:border-0",
        selected && "bg-primary/5",
        botWarning && "opacity-60",
      )}
    >
      {onToggle && (
        <button onClick={onToggle} className="flex-shrink-0 text-muted-foreground hover:text-primary transition-colors">
          {selected ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4" />}
        </button>
      )}
      {rank && (
        <span className="text-xs text-muted-foreground font-mono w-5 text-right flex-shrink-0">{rank}</span>
      )}
      {user.avatar ? (
        <img src={user.avatar} alt={user.handle} className="w-9 h-9 rounded-full flex-shrink-0 ring-1 ring-border" />
      ) : (
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary/20 to-blue-500/20 flex items-center justify-center flex-shrink-0">
          <Users className="w-4 h-4 text-primary" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate">
            {user.displayName || user.handle}
          </span>
          {user.displayName && (
            <span className="text-xs text-muted-foreground truncate hidden sm:block">@{user.handle}</span>
          )}
          {botWarning && (
            <span className="text-[10px] text-amber-500 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full flex-shrink-0">
              possible bot
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="text-xs text-muted-foreground tabular-nums">
            <strong className="text-foreground">{user.followersCount.toLocaleString()}</strong> followers
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            <strong className="text-foreground">{user.followsCount.toLocaleString()}</strong> following
          </span>
          {user.postCount && (
            <span className="text-xs text-primary font-medium tabular-nums">{user.postCount} posts in feed</span>
          )}
        </div>
        {user.description && (
          <p className="text-xs text-muted-foreground/70 truncate mt-0.5 max-w-sm">{user.description}</p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <a
          href={`https://bsky.app/profile/${user.handle}`}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground hover:text-primary transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
        {actionLabel && ActionIcon && onAction && (
          <Button size="sm" variant="outline" onClick={onAction} disabled={actionPending} className="h-7 text-xs">
            <ActionIcon className="w-3 h-3 mr-1" />
            {actionLabel}
          </Button>
        )}
      </div>
    </motion.div>
  );
}

function StatBadge({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div className={cn("rounded-xl border px-5 py-3 text-center", accent ? "border-primary/30 bg-primary/5" : "border-border bg-card")}>
      <div className={cn("text-2xl font-bold tabular-nums", accent ? "text-primary" : "text-foreground")}>{typeof value === "number" ? value.toLocaleString() : value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}

function SyncEngagementButton() {
  const { toast } = useToast();
  const sync = useSyncEngagement();

  function handleSync() {
    sync.mutate({ data: { limit: 100 } }, {
      onSuccess: (data) => toast({ title: `Engagement synced: ${data.updated} posts updated` }),
      onError: () => toast({ title: "Sync failed", variant: "destructive" }),
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={handleSync} disabled={sync.isPending}>
      <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", sync.isPending && "animate-spin")} />
      {sync.isPending ? "Syncing…" : "Sync Engagement"}
    </Button>
  );
}

// ─── Search & Follow Tab ───────────────────────────────────────────────────────

function SearchFollowTab() {
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

  function toggleSelect(did: string) {
    setSelected(prev => { const n = new Set(prev); n.has(did) ? n.delete(did) : n.add(did); return n; });
  }
  function selectAll() { setSelected(new Set(filteredUsers.map(u => u.did))); }
  function clearSelection() { setSelected(new Set()); }

  function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (!query.trim()) return;
    setSubmittedQuery(query.trim());
    setCursor(undefined);
    setCursorStack([]);
    setSelected(new Set());
  }

  function handleFollow() {
    const dids = Array.from(selected);
    bulkFollow.mutate({ data: { dids } }, {
      onSuccess: (r) => { toast({ title: `Followed ${r.succeeded} accounts` }); clearSelection(); },
      onError: () => toast({ title: "Follow failed", variant: "destructive" }),
    });
  }

  const botCount = allUsers.filter(isBotLike).length;
  const filtered = allUsers.length - filteredUsers.length;

  return (
    <div className="bg-card border border-card-border rounded-xl shadow-sm overflow-hidden">
      {/* Search bar */}
      <form onSubmit={handleSearch} className="px-4 py-4 border-b border-border bg-muted/20">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder='Search Bluesky users, e.g. "software engineering", "Kenya tech"…'
              className="pl-9 h-9"
            />
          </div>
          <Button type="submit" disabled={!query.trim() || isFetching} className="h-9 px-5">
            {isFetching ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Search"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={cn("h-9 w-9 flex-shrink-0", showFilters && "bg-primary/10 border-primary/40 text-primary")}
            onClick={() => setShowFilters(f => !f)}
          >
            <Filter className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Searches Bluesky by user bio/name keywords. Use filters below to reduce bots before bulk following.
        </p>
      </form>

      {/* Filters panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-border"
          >
            <div className="px-4 py-4 flex items-center gap-6 flex-wrap bg-muted/10">
              <div>
                <label className="text-xs font-medium text-foreground block mb-1.5">Min. followers</label>
                <div className="flex items-center gap-2">
                  <input
                    type="range" min={0} max={500} step={5} value={minFollowers}
                    onChange={e => setMinFollowers(Number(e.target.value))}
                    className="w-28 accent-primary"
                  />
                  <span className="text-xs font-mono text-foreground w-8">{minFollowers}</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">Filter out very new accounts</p>
              </div>
              <div>
                <label className="text-xs font-medium text-foreground block mb-1.5">Bot filter</label>
                <button
                  onClick={() => setHidePossibleBots(v => !v)}
                  className={cn(
                    "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors",
                    hidePossibleBots
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {hidePossibleBots ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                  Hide possible bots
                </button>
                <p className="text-[11px] text-muted-foreground mt-1">Hides accounts with very low follower/following ratio</p>
              </div>
              {allUsers.length > 0 && (
                <div className="ml-auto text-xs text-muted-foreground text-right">
                  <span className="text-foreground font-medium">{filteredUsers.length}</span> / {allUsers.length} shown
                  {filtered > 0 && <><br /><span className="text-amber-500">{filtered} filtered out</span></>}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bulk action toolbar */}
      {selected.size > 0 && (
        <div className="px-4 py-2.5 border-b border-border bg-primary/5 flex items-center gap-3">
          <span className="text-xs text-primary font-medium">{selected.size} selected</span>
          <Button size="sm" className="h-7 text-xs" onClick={handleFollow} disabled={bulkFollow.isPending}>
            <UserPlus className="w-3 h-3 mr-1" />
            {bulkFollow.isPending ? "Following…" : `Follow ${selected.size}`}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={clearSelection}>
            <X className="w-3 h-3 mr-1" /> Clear
          </Button>
        </div>
      )}

      {/* Results */}
      {!submittedQuery ? (
        <div className="flex flex-col items-center justify-center h-52 gap-3 text-center px-8">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Search className="w-6 h-6 text-primary/60" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Search to discover people to follow</p>
            <p className="text-xs text-muted-foreground mt-1">Try "software engineering", "AI", "Kenya", "web developer" — then select and bulk follow real accounts.</p>
          </div>
        </div>
      ) : isLoading ? (
        <div className="p-4 space-y-3">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />)}
        </div>
      ) : filteredUsers.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 gap-2">
          <Users className="w-10 h-10 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground">
            {allUsers.length > 0 ? "All results filtered out — try loosening the filters." : `No results for "${submittedQuery}".`}
          </p>
        </div>
      ) : (
        <>
          {/* Select all row */}
          <div className="px-4 py-2 border-b border-border/50 flex items-center justify-between bg-muted/10">
            <button onClick={selectAll} className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1.5 transition-colors">
              <CheckSquare className="w-3.5 h-3.5" /> Select all {filteredUsers.length}
            </button>
            {hidePossibleBots && botCount > 0 && (
              <span className="text-[11px] text-amber-500 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {botCount} possible bot{botCount > 1 ? "s" : ""} hidden
              </span>
            )}
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

          {/* Pagination */}
          <div className="px-4 py-3 border-t border-border flex items-center justify-between bg-muted/10">
            <Button variant="outline" size="sm" disabled={cursorStack.length === 0} onClick={() => {
              const s = [...cursorStack]; const p = s.pop();
              setCursorStack(s); setCursor(p === "" ? undefined : p);
              setSelected(new Set());
            }}>
              <ChevronLeft className="w-4 h-4 mr-1" /> Previous
            </Button>
            <span className="text-xs text-muted-foreground">{filteredUsers.length} shown</span>
            <Button variant="outline" size="sm" disabled={!data?.cursor} onClick={() => {
              if (data?.cursor) {
                setCursorStack(s => [...s, cursor ?? ""]);
                setCursor(data.cursor!);
                setSelected(new Set());
              }
            }}>
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

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

  const { data: profile } = useGetBlueskyProfile({ query: { retry: false, queryKey: ["profile-audience"] } });
  const { data: feeds } = useListFeeds();
  const { data: followers, isLoading: loadingFollowers } = useGetFollowers(
    { limit: 50, cursor: followersCursor },
    { query: { queryKey: ["followers", followersCursor], enabled: tab === "followers" } },
  );
  const { data: following, isLoading: loadingFollowing } = useGetFollowing(
    { limit: 50, cursor: followingCursor },
    { query: { queryKey: ["following", followingCursor], enabled: tab === "following" } },
  );
  const { data: notFollowingBack, isLoading: loadingNFB } = useGetNotFollowingBack({
    query: { enabled: tab === "not-following-back", staleTime: 120_000, queryKey: ["not-following-back"] },
  });

  const numericFeedId = selectedFeedId ? parseInt(selectedFeedId) : null;
  const { data: topAuthors, isLoading: loadingTopAuthors } = useGetFeedTopAuthors(numericFeedId!, {
    query: { enabled: tab === "top-authors" && numericFeedId !== null, queryKey: ["top-authors-audience", numericFeedId] },
  });

  const bulkFollow = useBulkFollow();
  const bulkUnfollow = useBulkUnfollow();

  function toggleSelect(did: string) {
    setSelected(prev => { const n = new Set(prev); n.has(did) ? n.delete(did) : n.add(did); return n; });
  }
  function selectAll(users: AudienceUser[]) { setSelected(new Set(users.map(u => u.did))); }
  function clearSelection() { setSelected(new Set()); }

  function handleBulkFollow() {
    const dids = Array.from(selected);
    bulkFollow.mutate({ data: { dids } }, {
      onSuccess: (r) => { toast({ title: `Followed ${r.succeeded} accounts` }); clearSelection(); queryClient.invalidateQueries(); },
      onError: () => toast({ title: "Bulk follow failed", variant: "destructive" }),
    });
  }
  function handleBulkUnfollow() {
    const dids = Array.from(selected);
    bulkUnfollow.mutate({ data: { dids } }, {
      onSuccess: (r) => { toast({ title: `Unfollowed ${r.succeeded} accounts` }); clearSelection(); queryClient.invalidateQueries(); },
      onError: () => toast({ title: "Bulk unfollow failed", variant: "destructive" }),
    });
  }

  const tabs = [
    { id: "followers" as Tab, label: "Followers", icon: Users, count: profile?.followersCount },
    { id: "following" as Tab, label: "Following", icon: UserPlus, count: profile?.followsCount },
    { id: "not-following-back" as Tab, label: "Not Following Back", icon: UserMinus, count: notFollowingBack?.length },
    { id: "top-authors" as Tab, label: "Top Authors", icon: TrendingUp, count: null },
    { id: "search" as Tab, label: "Search & Follow", icon: Search, count: null },
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
  const currentNFB = filterUsers(notFollowingBack ?? []);
  const currentTopAuthors = topAuthors ?? [];

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Audience</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Manage your Bluesky followers, following, and discover new accounts</p>
          </div>
          <SyncEngagementButton />
        </div>
      </motion.div>

      {/* Stats row */}
      {profile && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="grid grid-cols-3 gap-4 mb-6">
          <StatBadge label="Followers" value={profile.followersCount} accent />
          <StatBadge label="Following" value={profile.followsCount} />
          <StatBadge label="Not Following Back" value={notFollowingBack?.length ?? "—"} />
        </motion.div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border mb-0 overflow-x-auto">
        {tabs.map(({ id, label, icon: Icon, count }) => (
          <button
            key={id}
            onClick={() => { setTab(id); setSearch(""); clearSelection(); }}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
              id === "search" && "text-primary border-primary/0",
              tab === id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
            {id === "search" && tab !== "search" && (
              <span className="text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full font-medium">New</span>
            )}
            {count !== undefined && count !== null && (
              <span className={cn("text-xs px-1.5 py-0.5 rounded-full", tab === id ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
                {typeof count === "number" ? count.toLocaleString() : count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Search & Follow tab renders outside the shared panel */}
      {tab === "search" ? (
        <motion.div key="search" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-0">
          <SearchFollowTab />
        </motion.div>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <div className="bg-card border border-card-border rounded-b-xl rounded-tr-xl shadow-sm overflow-hidden">
              {/* Toolbar */}
              <div className="px-4 py-3 border-b border-border flex items-center gap-3 flex-wrap">
                <div className="relative flex-1 min-w-48">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search by handle, name, or bio…"
                    className="pl-8 h-8 text-xs"
                  />
                </div>

                {tab === "top-authors" && (
                  <Select value={selectedFeedId} onValueChange={setSelectedFeedId}>
                    <SelectTrigger className="w-48 h-8 text-xs">
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
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{selected.size} selected</span>
                    {(tab === "not-following-back" || tab === "following") && (
                      <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={handleBulkUnfollow} disabled={bulkUnfollow.isPending}>
                        <UserMinus className="w-3 h-3 mr-1" />
                        {bulkUnfollow.isPending ? "Unfollowing…" : `Unfollow ${selected.size}`}
                      </Button>
                    )}
                    {tab === "top-authors" && (
                      <Button size="sm" className="h-7 text-xs" onClick={handleBulkFollow} disabled={bulkFollow.isPending}>
                        <UserPlus className="w-3 h-3 mr-1" />
                        {bulkFollow.isPending ? "Following…" : `Follow ${selected.size}`}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={clearSelection}>Clear</Button>
                  </div>
                )}

                {tab === "not-following-back" && currentNFB.length > 0 && selected.size === 0 && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => selectAll(currentNFB)}>
                    <CheckSquare className="w-3 h-3 mr-1" />
                    Select All ({currentNFB.length})
                  </Button>
                )}
              </div>

              {/* FOLLOWERS */}
              {tab === "followers" && (
                loadingFollowers ? (
                  <div className="p-4 space-y-3">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />)}</div>
                ) : currentFollowers.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 gap-2">
                    <Users className="w-10 h-10 text-muted-foreground/20" />
                    <p className="text-sm text-muted-foreground">{search ? "No results for your search." : "No followers found."}</p>
                  </div>
                ) : (
                  <>
                    <div>
                      {currentFollowers.map((user, i) => (
                        <motion.div key={user.did} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}>
                          <UserCard user={user} />
                        </motion.div>
                      ))}
                    </div>
                    <div className="px-4 py-3 border-t border-border flex items-center justify-between bg-muted/10">
                      <Button variant="outline" size="sm" disabled={followersCursorStack.length === 0} onClick={() => { const s = [...followersCursorStack]; const p = s.pop(); setFollowersCursorStack(s); setFollowersCursor(p === "" ? undefined : p); }}>
                        <ChevronLeft className="w-4 h-4 mr-1" /> Previous
                      </Button>
                      <span className="text-xs text-muted-foreground">{currentFollowers.length} shown</span>
                      <Button variant="outline" size="sm" disabled={!followers?.cursor} onClick={() => { if (followers?.cursor) { setFollowersCursorStack(s => [...s, followersCursor ?? ""]); setFollowersCursor(followers.cursor!); } }}>
                        Next <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    </div>
                  </>
                )
              )}

              {/* FOLLOWING */}
              {tab === "following" && (
                loadingFollowing ? (
                  <div className="p-4 space-y-3">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />)}</div>
                ) : currentFollowing.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 gap-2">
                    <UserPlus className="w-10 h-10 text-muted-foreground/20" />
                    <p className="text-sm text-muted-foreground">{search ? "No results." : "Not following anyone yet."}</p>
                  </div>
                ) : (
                  <>
                    <div>
                      {currentFollowing.map((user, i) => (
                        <motion.div key={user.did} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}>
                          <UserCard
                            user={user}
                            selected={selected.has(user.did)}
                            onToggle={() => toggleSelect(user.did)}
                            actionLabel="Unfollow"
                            actionIcon={UserMinus}
                            onAction={() => { setSelected(new Set([user.did])); handleBulkUnfollow(); }}
                            actionPending={bulkUnfollow.isPending}
                          />
                        </motion.div>
                      ))}
                    </div>
                    <div className="px-4 py-3 border-t border-border flex items-center justify-between bg-muted/10">
                      <Button variant="outline" size="sm" disabled={followingCursorStack.length === 0} onClick={() => { const s = [...followingCursorStack]; const p = s.pop(); setFollowingCursorStack(s); setFollowingCursor(p === "" ? undefined : p); }}>
                        <ChevronLeft className="w-4 h-4 mr-1" /> Previous
                      </Button>
                      <span className="text-xs text-muted-foreground">{currentFollowing.length} shown</span>
                      <Button variant="outline" size="sm" disabled={!following?.cursor} onClick={() => { if (following?.cursor) { setFollowingCursorStack(s => [...s, followingCursor ?? ""]); setFollowingCursor(following.cursor!); } }}>
                        Next <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    </div>
                  </>
                )
              )}

              {/* NOT FOLLOWING BACK */}
              {tab === "not-following-back" && (
                loadingNFB ? (
                  <div className="flex flex-col items-center justify-center h-48 gap-3">
                    <RefreshCw className="w-8 h-8 text-muted-foreground/30 animate-spin" />
                    <p className="text-sm text-muted-foreground">Analysing your followers and following lists…</p>
                  </div>
                ) : currentNFB.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 gap-2">
                    <Heart className="w-10 h-10 text-emerald-400/40" />
                    <p className="text-sm text-muted-foreground">Everyone you follow is following you back!</p>
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
                  </div>
                )
              )}

              {/* TOP AUTHORS */}
              {tab === "top-authors" && (
                !selectedFeedId ? (
                  <div className="flex flex-col items-center justify-center h-48 gap-2">
                    <TrendingUp className="w-10 h-10 text-muted-foreground/20" />
                    <p className="text-sm text-muted-foreground">Select a feed above to see its top contributing authors</p>
                  </div>
                ) : loadingTopAuthors ? (
                  <div className="p-4 space-y-3">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />)}</div>
                ) : currentTopAuthors.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 gap-2">
                    <TrendingUp className="w-10 h-10 text-muted-foreground/20" />
                    <p className="text-sm text-muted-foreground">No posts indexed for this feed yet.</p>
                  </div>
                ) : (
                  <div>
                    {currentTopAuthors.map((author, i) => {
                      const user: AudienceUser & { postCount: number } = {
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
                            user={user}
                            selected={selected.has(author.did)}
                            onToggle={() => toggleSelect(author.did)}
                            rank={i + 1}
                            actionLabel="Follow"
                            actionIcon={UserPlus}
                            onAction={() => setSelected(new Set([author.did]))}
                          />
                        </motion.div>
                      );
                    })}
                    {selected.size > 0 && (
                      <div className="px-4 py-3 border-t border-border bg-muted/10 flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">{selected.size} selected</span>
                        <Button size="sm" onClick={handleBulkFollow} disabled={bulkFollow.isPending}>
                          <UserPlus className="w-3.5 h-3.5 mr-1.5" />
                          {bulkFollow.isPending ? "Following…" : `Follow ${selected.size} accounts`}
                        </Button>
                      </div>
                    )}
                  </div>
                )
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      )}

      {/* Info note */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="mt-4 p-3 bg-muted/40 rounded-lg border border-border/50 flex items-start gap-2">
        <Zap className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground">
          <strong className="text-foreground">Tip:</strong> Use <strong>Search & Follow</strong> to find real accounts by topic (e.g. "software engineering", "AI researcher"). The bot filter hides accounts with a suspiciously high follow/follower ratio. Bluesky does not expose view counts — use <strong>Sync Engagement</strong> to pull live likes, reposts, and replies.
        </p>
      </motion.div>
    </div>
  );
}
