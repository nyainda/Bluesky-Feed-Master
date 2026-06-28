import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { customFetch } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bell, Heart, Repeat2, MessageCircle, UserPlus, AtSign, Quote,
  RefreshCw, Check, ExternalLink, Filter, AlertCircle, WifiOff, Loader2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Notification = {
  uri: string;
  cid: string;
  reason: string;
  isRead: boolean;
  indexedAt: string;
  author: { did: string; handle: string; displayName: string | null; avatar: string | null };
  record: Record<string, unknown>;
};

type NotificationsResponse = {
  notifications: Notification[];
  cursor: string | null;
  seenAt: string | null;
};

const REASON_META: Record<string, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  like:    { label: "liked your post",    icon: Heart,         color: "text-rose-500",    bg: "bg-rose-500/10" },
  repost:  { label: "reposted your post", icon: Repeat2,       color: "text-emerald-500", bg: "bg-emerald-500/10" },
  follow:  { label: "followed you",       icon: UserPlus,      color: "text-blue-500",    bg: "bg-blue-500/10" },
  mention: { label: "mentioned you",      icon: AtSign,        color: "text-violet-500",  bg: "bg-violet-500/10" },
  reply:   { label: "replied to you",     icon: MessageCircle, color: "text-amber-500",   bg: "bg-amber-500/10" },
  quote:   { label: "quoted your post",   icon: Quote,         color: "text-cyan-500",    bg: "bg-cyan-500/10" },
};

const FILTER_OPTIONS = [
  { value: "all",     label: "All" },
  { value: "like",    label: "Likes" },
  { value: "repost",  label: "Reposts" },
  { value: "follow",  label: "Follows" },
  { value: "mention", label: "Mentions" },
  { value: "reply",   label: "Replies" },
  { value: "quote",   label: "Quotes" },
];

function atUriToUrl(uri: string) {
  const parts = uri.split("/");
  const did  = parts[2];
  const rkey = parts[4];
  return `https://bsky.app/profile/${did}/post/${rkey}`;
}

function NotificationCard({
  notif,
  onMarkRead,
  optimisticRead,
}: {
  notif: Notification;
  onMarkRead: (notif: Notification) => void;
  optimisticRead: boolean;
}) {
  const meta = REASON_META[notif.reason] ?? {
    label: notif.reason,
    icon: Bell,
    color: "text-muted-foreground",
    bg: "bg-muted",
  };
  const Icon = meta.icon;
  const isRead = notif.isRead || optimisticRead;

  const recordText = (notif.record as { text?: string }).text ?? null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      className={cn(
        "group flex items-start gap-3 px-4 py-3.5 border-b border-border/50 hover:bg-muted/25 transition-colors",
        !isRead && "bg-primary/[0.03]",
      )}
    >
      {/* Unread indicator */}
      <div className="flex-shrink-0 mt-2 w-2 flex justify-center">
        {!isRead && (
          <motion.div
            layoutId={`dot-${notif.uri}`}
            className="w-1.5 h-1.5 rounded-full bg-primary"
          />
        )}
      </div>

      {/* Avatar + reason icon */}
      <div className="relative flex-shrink-0">
        {notif.author.avatar ? (
          <img
            src={notif.author.avatar}
            alt={notif.author.handle}
            className="w-9 h-9 rounded-full object-cover ring-1 ring-border"
          />
        ) : (
          <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
            {(notif.author.displayName || notif.author.handle)[0]?.toUpperCase() ?? "?"}
          </div>
        )}
        <div className={cn(
          "absolute -bottom-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center border border-background",
          meta.bg,
          meta.color,
        )}>
          <Icon className="w-2.5 h-2.5" />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <a
                href={`https://bsky.app/profile/${notif.author.handle}`}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-sm text-foreground hover:text-primary transition-colors"
              >
                {notif.author.displayName || notif.author.handle}
              </a>
              <span className={cn("text-sm", isRead ? "text-muted-foreground/60" : "text-muted-foreground")}>{meta.label}</span>
            </div>
            {notif.author.displayName && (
              <p className="text-[11px] text-muted-foreground/50 mt-0.5">@{notif.author.handle}</p>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            {!isRead && (
              <button
                onClick={() => onMarkRead(notif)}
                title="Mark as read"
                className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/8 transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
            )}
            {notif.reason !== "follow" && (
              <a
                href={atUriToUrl(notif.uri)}
                target="_blank"
                rel="noreferrer"
                className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/8 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        </div>

        {recordText && notif.reason !== "follow" && (
          <p className="text-xs text-muted-foreground/70 mt-1.5 line-clamp-2 bg-muted/40 rounded-md px-2.5 py-1.5 leading-relaxed">
            {recordText}
          </p>
        )}

        <p className="text-[11px] text-muted-foreground/40 mt-1.5">
          {formatDistanceToNow(new Date(notif.indexedAt), { addSuffix: true })}
        </p>
      </div>
    </motion.div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 text-center px-6">
      <div className="w-14 h-14 rounded-2xl bg-destructive/8 border border-destructive/20 flex items-center justify-center">
        <WifiOff className="w-6 h-6 text-destructive/60" />
      </div>
      <div>
        <p className="font-semibold text-foreground">Couldn't load notifications</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-xs">
          Make sure <code className="bg-muted px-1 rounded text-xs">BLUESKY_APP_PASSWORD</code> is set on the server.
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={onRetry} className="gap-1.5">
        <RefreshCw className="w-3.5 h-3.5" />
        Retry
      </Button>
    </div>
  );
}

export default function Notifications() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<string>("all");
  const [cursor, setCursor] = useState<string | null>(null);
  const [allNotifications, setAllNotifications] = useState<Notification[]>([]);
  const [optimisticReadUris, setOptimisticReadUris] = useState<Set<string>>(new Set());
  const autoMarkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data, isLoading, isFetching, isError, refetch } = useQuery<NotificationsResponse>({
    queryKey: ["notifications", filter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "50" });
      if (filter !== "all") params.set("reasons", filter);
      const res = await customFetch<NotificationsResponse>(`/api/bluesky/notifications?${params}`);
      setAllNotifications(res.notifications);
      setOptimisticReadUris(new Set());
      setCursor(res.cursor);
      return res;
    },
    staleTime: 30_000,
    retry: 1,
  });

  const markSeen = useMutation({
    mutationFn: () => customFetch<unknown>("/api/bluesky/notifications/seen", { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
    },
  });

  const loadMore = useCallback(async () => {
    if (!cursor || isFetching) return;
    const params = new URLSearchParams({ limit: "50", cursor });
    if (filter !== "all") params.set("reasons", filter);
    const res = await customFetch<NotificationsResponse>(`/api/bluesky/notifications?${params}`);
    setAllNotifications((prev) => [...prev, ...res.notifications]);
    setCursor(res.cursor);
  }, [cursor, filter, isFetching]);

  function handleMarkOneRead(notif: Notification) {
    setOptimisticReadUris((prev) => new Set([...prev, notif.uri]));
    markSeen.mutate();
    queryClient.setQueryData(["notifications-unread"], (old: { count: number } | undefined) =>
      old ? { count: Math.max(0, old.count - 1) } : { count: 0 },
    );
  }

  function handleMarkAllRead() {
    const unreadUris = allNotifications.filter((n) => !n.isRead).map((n) => n.uri);
    setOptimisticReadUris(new Set(unreadUris));
    markSeen.mutate(undefined, {
      onSuccess: () => toast({ title: "Marked all as read" }),
    });
    queryClient.setQueryData(["notifications-unread"], { count: 0 });
  }

  // Auto-mark-seen after 8 seconds on page
  useEffect(() => {
    if (!isLoading && allNotifications.some((n) => !n.isRead)) {
      autoMarkTimer.current = setTimeout(() => {
        markSeen.mutate();
        queryClient.setQueryData(["notifications-unread"], { count: 0 });
      }, 8000);
    }
    return () => {
      if (autoMarkTimer.current) clearTimeout(autoMarkTimer.current);
    };
  }, [isLoading, allNotifications.length]);

  const displayed = allNotifications;
  const unread = displayed.filter((n) => !n.isRead && !optimisticReadUris.has(n.uri)).length;

  return (
    <div className="max-w-2xl mx-auto px-0 sm:px-4 py-5 md:py-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between mb-4 px-4 sm:px-0"
      >
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            Notifications
            <AnimatePresence>
              {unread > 0 && (
                <motion.span
                  key="badge"
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.6, opacity: 0 }}
                  className="text-xs font-bold bg-primary text-primary-foreground rounded-full px-2 py-0.5 tabular-nums"
                >
                  {unread}
                </motion.span>
              )}
            </AnimatePresence>
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">Likes, mentions, follows, and replies</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setAllNotifications([]);
              refetch();
            }}
            disabled={isFetching}
            className="gap-1.5"
          >
            {isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          {unread > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleMarkAllRead}
              disabled={markSeen.isPending}
              className="gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Mark all read</span>
            </Button>
          )}
        </div>
      </motion.div>

      {/* Filter bar */}
      <div className="flex items-center gap-1.5 overflow-x-auto px-4 sm:px-0 pb-3 scrollbar-none">
        <Filter className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => {
              setFilter(opt.value);
              setAllNotifications([]);
              setOptimisticReadUris(new Set());
              setCursor(null);
            }}
            className={cn(
              "flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium border transition-colors",
              filter === opt.value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:border-foreground/30 hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="bg-card border border-card-border rounded-xl overflow-hidden sm:shadow-sm">
        {isLoading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-3.5">
                <div className="w-2 flex-shrink-0" />
                <div className="w-9 h-9 rounded-full bg-muted animate-pulse flex-shrink-0" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="h-3 bg-muted animate-pulse rounded w-3/5" />
                  <div className="h-2.5 bg-muted animate-pulse rounded w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center px-4">
            <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center">
              <Bell className="w-6 h-6 text-muted-foreground/40" />
            </div>
            <div>
              <p className="font-semibold text-foreground">No notifications</p>
              <p className="text-sm text-muted-foreground mt-1">
                {filter !== "all" ? `No ${filter}s yet` : "You're all caught up!"}
              </p>
            </div>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {displayed.map((notif, i) => (
              <NotificationCard
                key={`${notif.uri}-${i}`}
                notif={notif}
                onMarkRead={handleMarkOneRead}
                optimisticRead={optimisticReadUris.has(notif.uri)}
              />
            ))}
          </AnimatePresence>
        )}

        {cursor && !isLoading && !isError && (
          <div className="flex justify-center p-4 border-t border-border">
            <Button variant="outline" size="sm" onClick={loadMore} disabled={isFetching} className="gap-1.5">
              {isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {isFetching ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </div>

      {/* Footer note */}
      {!isLoading && !isError && displayed.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="mt-4 px-4 sm:px-0"
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground/50 bg-muted/30 rounded-lg p-2.5">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            <span>Notifications sync from Bluesky. Auto-marks read after 8 seconds.</span>
          </div>
        </motion.div>
      )}
    </div>
  );
}
