import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { customFetch } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bell, Heart, Repeat2, MessageCircle, UserPlus, AtSign, Quote,
  RefreshCw, Check, ExternalLink, Filter, AlertCircle,
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

const REASON_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  like: { label: "liked your post", icon: Heart, color: "text-rose-500" },
  repost: { label: "reposted your post", icon: Repeat2, color: "text-emerald-500" },
  follow: { label: "followed you", icon: UserPlus, color: "text-blue-500" },
  mention: { label: "mentioned you", icon: AtSign, color: "text-violet-500" },
  reply: { label: "replied to your post", icon: MessageCircle, color: "text-amber-500" },
  quote: { label: "quoted your post", icon: Quote, color: "text-cyan-500" },
};

const FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "like", label: "Likes" },
  { value: "repost", label: "Reposts" },
  { value: "follow", label: "Follows" },
  { value: "mention", label: "Mentions" },
  { value: "reply", label: "Replies" },
  { value: "quote", label: "Quotes" },
];

function NotificationCard({ notif }: { notif: Notification }) {
  const meta = REASON_META[notif.reason] ?? {
    label: notif.reason,
    icon: Bell,
    color: "text-muted-foreground",
  };
  const Icon = meta.icon;

  const recordText =
    (notif.record as { text?: string }).text ??
    (notif.record as { $type?: string }).$type ?? null;

  const postUri = notif.uri;
  const atUriToUrl = (uri: string) => {
    const [, , did, , rkey] = uri.split("/");
    return `https://bsky.app/profile/${did}/post/${rkey}`;
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      className={cn(
        "flex items-start gap-3 px-4 py-3.5 border-b border-border/60 hover:bg-muted/30 transition-colors",
        !notif.isRead && "bg-primary/3",
      )}
    >
      {/* Unread dot */}
      <div className="flex-shrink-0 mt-1 w-2">
        {!notif.isRead && (
          <div className="w-1.5 h-1.5 rounded-full bg-primary" />
        )}
      </div>

      {/* Avatar */}
      <div className="relative flex-shrink-0">
        {notif.author.avatar ? (
          <img
            src={notif.author.avatar}
            alt={notif.author.handle}
            className="w-9 h-9 rounded-full"
          />
        ) : (
          <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
            {(notif.author.displayName || notif.author.handle)[0].toUpperCase()}
          </div>
        )}
        <div className={cn("absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-background flex items-center justify-center border border-border", meta.color)}>
          <Icon className="w-2.5 h-2.5" />
        </div>
      </div>

      {/* Content */}
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
          <span className="text-sm text-muted-foreground">{meta.label}</span>
        </div>

        {notif.author.handle && (
          <p className="text-xs text-muted-foreground/60 mt-0.5">@{notif.author.handle}</p>
        )}

        {recordText && typeof recordText === "string" && notif.reason !== "follow" && (
          <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2 bg-muted/40 rounded-md px-2.5 py-1.5">
            {recordText}
          </p>
        )}

        <div className="flex items-center gap-3 mt-1.5">
          <span className="text-[11px] text-muted-foreground/50">
            {formatDistanceToNow(new Date(notif.indexedAt), { addSuffix: true })}
          </span>
          {notif.reason !== "follow" && (
            <a
              href={atUriToUrl(postUri)}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-muted-foreground/50 hover:text-primary flex items-center gap-0.5 transition-colors"
            >
              <ExternalLink className="w-2.5 h-2.5" />
              View post
            </a>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default function Notifications() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<string>("all");
  const [cursor, setCursor] = useState<string | null>(null);
  const [allNotifications, setAllNotifications] = useState<Notification[]>([]);

  const { data, isLoading, isFetching, refetch } = useQuery<NotificationsResponse>({
    queryKey: ["notifications", filter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "50" });
      if (filter !== "all") params.set("reasons", filter);
      const res = await customFetch<NotificationsResponse>(`/api/bluesky/notifications?${params}`);
      setAllNotifications(res.notifications);
      setCursor(res.cursor);
      return res;
    },
    staleTime: 30_000,
  });

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    const params = new URLSearchParams({ limit: "50", cursor });
    if (filter !== "all") params.set("reasons", filter);
    const res = await customFetch<NotificationsResponse>(`/api/bluesky/notifications?${params}`);
    setAllNotifications((prev) => [...prev, ...res.notifications]);
    setCursor(res.cursor);
  }, [cursor, filter]);

  const markSeen = useMutation({
    mutationFn: () => customFetch("/api/bluesky/notifications/seen", { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Marked all as read" });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
    },
  });

  const displayed = allNotifications;
  const unread = displayed.filter((n) => !n.isRead).length;

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
            {unread > 0 && (
              <span className="text-xs font-bold bg-primary text-primary-foreground rounded-full px-2 py-0.5 tabular-nums">
                {unread}
              </span>
            )}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">Likes, mentions, follows, and replies</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-1.5"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          {unread > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => markSeen.mutate()}
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
          <div className="space-y-0 divide-y divide-border">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-3.5">
                <div className="w-2 flex-shrink-0" />
                <div className="w-9 h-9 rounded-full bg-muted animate-pulse flex-shrink-0" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="h-3 bg-muted animate-pulse rounded w-2/3" />
                  <div className="h-2.5 bg-muted animate-pulse rounded w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center px-4">
            <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center">
              <Bell className="w-6 h-6 text-muted-foreground/40" />
            </div>
            <div>
              <p className="font-semibold text-foreground">No notifications</p>
              <p className="text-sm text-muted-foreground mt-1">
                {filter !== "all" ? `No ${filter} notifications yet` : "You're all caught up!"}
              </p>
            </div>
          </div>
        ) : (
          <AnimatePresence>
            {displayed.map((notif, i) => (
              <NotificationCard key={`${notif.uri}-${i}`} notif={notif} />
            ))}
          </AnimatePresence>
        )}

        {cursor && !isLoading && (
          <div className="flex justify-center p-4 border-t border-border">
            <Button variant="outline" size="sm" onClick={loadMore} disabled={isFetching}>
              {isFetching ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </div>

      {/* What's possible note */}
      {!isLoading && displayed.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mt-4 px-4 sm:px-0"
        >
          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/40 rounded-lg p-3">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>Notifications are fetched live from Bluesky. Marking as read syncs back to your account.</span>
          </div>
        </motion.div>
      )}
    </div>
  );
}
