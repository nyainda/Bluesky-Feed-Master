import { useState, useEffect, useRef } from "react";
import { useListPosts, getListPostsQueryKey } from "@workspace/api-client-react";
import type { ListPostsParams } from "@workspace/api-client-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, ExternalLink, ChevronLeft, ChevronRight,
  Heart, Repeat2, MessageCircle, User, Send, Loader2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { useDebounce } from "@/hooks/use-debounce";
import { cn } from "@/lib/utils";

type BskyProfile = {
  handle: string;
  displayName?: string;
  avatar?: string;
};

const profileCache = new Map<string, BskyProfile>();

async function batchResolveProfiles(dids: string[]): Promise<Map<string, BskyProfile>> {
  const unresolved = dids.filter(d => !profileCache.has(d));
  if (unresolved.length > 0) {
    for (let i = 0; i < unresolved.length; i += 25) {
      const chunk = unresolved.slice(i, i + 25);
      // Note: use `actors=` (no brackets) — Bluesky public API uses repeated params
      const qs = chunk.map(d => `actors=${encodeURIComponent(d)}`).join("&");
      try {
        const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfiles?${qs}`);
        if (res.ok) {
          const data = await res.json() as { profiles: Array<{ did: string; handle: string; displayName?: string; avatar?: string }> };
          for (const p of data.profiles ?? []) {
            profileCache.set(p.did, { handle: p.handle, displayName: p.displayName, avatar: p.avatar });
          }
        }
      } catch { /* ignore */ }
    }
  }
  const result = new Map<string, BskyProfile>();
  for (const did of dids) {
    const cached = profileCache.get(did);
    if (cached) result.set(did, cached);
  }
  return result;
}

function AvatarCircle({ profile, did }: { profile?: BskyProfile; did: string }) {
  const initials = (profile?.displayName ?? profile?.handle ?? did)?.[0]?.toUpperCase() ?? "?";
  if (profile?.avatar) {
    return (
      <img
        src={profile.avatar}
        alt={profile.handle}
        className="w-10 h-10 rounded-full flex-shrink-0 object-cover ring-1 ring-border"
      />
    );
  }
  return (
    <div className="w-10 h-10 rounded-full flex-shrink-0 bg-primary/10 border border-primary/20 flex items-center justify-center">
      <span className="text-xs font-bold text-primary uppercase">{initials}</span>
    </div>
  );
}

type PostData = {
  id: number; uri: string; cid: string; author: string; text: string;
  algoTags: string; indexedAt: string;
  likes: number; reposts: number; replies: number;
};

function PostCard({
  post, profile, index, onReply,
}: {
  post: PostData;
  profile?: BskyProfile;
  index: number;
  onReply: (post: PostData) => void;
}) {
  const postId = post.uri.split("/").pop() ?? "";
  const handle = profile?.handle;
  const displayName = profile?.displayName;
  const bskyUrl = `https://bsky.app/profile/${handle ?? post.author}/post/${postId}`;
  const tags = post.algoTags ? post.algoTags.split(",").filter(Boolean) : [];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: index * 0.015 }}
      className="px-4 py-4 border-b border-border/60 last:border-0 hover:bg-muted/20 transition-colors group"
    >
      <div className="flex gap-3">
        <a href={`https://bsky.app/profile/${handle ?? post.author}`} target="_blank" rel="noreferrer" className="flex-shrink-0 mt-0.5">
          <AvatarCircle profile={profile} did={post.author} />
        </a>
        <div className="flex-1 min-w-0">
          {/* Author line */}
          <div className="flex items-baseline gap-1.5 flex-wrap mb-1">
            {displayName ? (
              <a
                href={`https://bsky.app/profile/${handle}`}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-semibold text-foreground hover:text-primary transition-colors leading-tight"
              >
                {displayName}
              </a>
            ) : null}
            {handle ? (
              <span className={cn("text-xs text-muted-foreground", !displayName && "font-medium text-foreground text-sm")}>
                @{handle}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground/50 font-mono animate-pulse">resolving…</span>
            )}
            <span className="text-muted-foreground/30 text-xs">·</span>
            <span className="text-xs text-muted-foreground/60 ml-auto flex-shrink-0">
              {formatDistanceToNow(new Date(post.indexedAt), { addSuffix: true })}
            </span>
          </div>

          {/* Post text */}
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-line line-clamp-4 mb-2">{post.text}</p>

          {/* Footer: tags + engagement + actions */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              {tags.map(tag => (
                <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-normal">
                  {tag}
                </Badge>
              ))}
            </div>
            <div className="flex items-center gap-1 ml-auto flex-shrink-0">
              {post.likes > 0 && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground/60 mr-1">
                  <Heart className="w-3 h-3" />{post.likes.toLocaleString()}
                </span>
              )}
              {post.reposts > 0 && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground/60 mr-1">
                  <Repeat2 className="w-3 h-3" />{post.reposts.toLocaleString()}
                </span>
              )}
              {post.replies > 0 && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground/60 mr-1">
                  <MessageCircle className="w-3 h-3" />{post.replies.toLocaleString()}
                </span>
              )}
              <button
                onClick={() => onReply(post)}
                title="Reply on Bluesky"
                className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-blue-500 hover:bg-blue-500/10 transition-colors opacity-0 group-hover:opacity-100"
              >
                <MessageCircle className="w-3.5 h-3.5" />
              </button>
              <a
                href={bskyUrl}
                target="_blank"
                rel="noreferrer"
                className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-primary hover:bg-muted/60 transition-colors opacity-0 group-hover:opacity-100"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export default function Posts() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 400);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [profiles, setProfiles] = useState<Map<string, BskyProfile>>(new Map());
  const resolving = useRef(false);
  const { toast } = useToast();

  // Reply dialog state
  const [replyTarget, setReplyTarget] = useState<PostData | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);

  const params: ListPostsParams = {
    limit: 50,
    cursor,
    search: debouncedSearch || undefined,
  };

  const { data: postsPage, isLoading } = useListPosts(params, {
    query: { queryKey: getListPostsQueryKey(params) },
  });

  useEffect(() => {
    if (!postsPage?.posts) return;
    const dids = [...new Set(postsPage.posts.map(p => p.author))];
    const allCached = dids.every(d => profileCache.has(d));
    if (allCached) {
      setProfiles(new Map(dids.flatMap(d => {
        const p = profileCache.get(d);
        return p ? [[d, p]] : [];
      })));
      return;
    }
    if (resolving.current) return;
    resolving.current = true;
    batchResolveProfiles(dids).then(resolved => {
      setProfiles(new Map([...resolved]));
      resolving.current = false;
    });
  }, [postsPage?.posts]);

  async function handleReply() {
    if (!replyText.trim() || !replyTarget || sendingReply) return;
    setSendingReply(true);
    try {
      const res = await fetch("/api/bluesky/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: replyText.trim(), replyTo: { uri: replyTarget.uri, cid: replyTarget.cid } }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string; message?: string };
        throw new Error(err.message ?? err.error ?? "Failed");
      }
      toast({ title: "Reply sent!" });
      setReplyTarget(null);
      setReplyText("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast({ title: "Couldn't send reply", description: msg, variant: "destructive" });
    } finally {
      setSendingReply(false);
    }
  }

  function nextPage() {
    if (postsPage?.cursor) {
      setCursorStack(s => [...s, cursor ?? ""]);
      setCursor(postsPage.cursor);
    }
  }

  function prevPage() {
    const stack = [...cursorStack];
    const prev = stack.pop();
    setCursorStack(stack);
    setCursor(prev === "" ? undefined : prev);
  }

  function handleSearch(val: string) {
    setSearch(val);
    setCursor(undefined);
    setCursorStack([]);
  }

  return (
    <div className="p-5 md:p-8 max-w-4xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Indexed Posts</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          {(postsPage?.total ?? 0).toLocaleString()} posts across all feeds
        </p>
      </motion.div>

      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search post content…"
          value={search}
          onChange={e => handleSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-card border border-card-border rounded-xl shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="divide-y divide-border/60">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="px-4 py-4 flex gap-3">
                <div className="w-10 h-10 rounded-full bg-muted animate-pulse flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-36 bg-muted rounded animate-pulse" />
                  <div className="h-3 w-full bg-muted/60 rounded animate-pulse" />
                  <div className="h-3 w-3/4 bg-muted/40 rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : !postsPage || postsPage.posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center gap-3 px-4">
            <div className="w-14 h-14 rounded-2xl bg-muted border border-border flex items-center justify-center">
              <User className="w-6 h-6 text-muted-foreground/30" />
            </div>
            <div>
              <p className="font-semibold text-foreground">No posts found</p>
              <p className="text-sm text-muted-foreground mt-1">
                {search
                  ? `No posts match "${search}"`
                  : "No posts indexed yet — make sure your feeds have keywords and the firehose is running."}
              </p>
            </div>
          </div>
        ) : (
          <>
            <div>
              {postsPage.posts.map((post, i) => (
                <PostCard
                  key={post.id}
                  post={post as PostData}
                  profile={profiles.get(post.author)}
                  index={i}
                  onReply={p => { setReplyTarget(p); setReplyText(""); }}
                />
              ))}
            </div>
            <div className="px-4 py-3 border-t border-border flex items-center justify-between bg-muted/10">
              <Button variant="outline" size="sm" onClick={prevPage} disabled={cursorStack.length === 0}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Previous
              </Button>
              <span className="text-xs text-muted-foreground">
                {postsPage.posts.length.toLocaleString()} of {postsPage.total.toLocaleString()} posts
              </span>
              <Button variant="outline" size="sm" onClick={nextPage} disabled={!postsPage.cursor}>
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </>
        )}
      </motion.div>

      {/* Reply Dialog */}
      <Dialog open={!!replyTarget} onOpenChange={open => { if (!open) { setReplyTarget(null); setReplyText(""); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Reply to post</DialogTitle>
          </DialogHeader>
          {replyTarget && (
            <div className="space-y-4">
              {/* Original post preview */}
              <div className="rounded-xl border border-border bg-muted/30 p-3">
                <div className="flex items-start gap-2.5">
                  <AvatarCircle profile={profiles.get(replyTarget.author)} did={replyTarget.author} />
                  <div className="flex-1 min-w-0">
                    {(() => {
                      const p = profiles.get(replyTarget.author);
                      return (
                        <div className="text-xs font-semibold text-foreground mb-0.5">
                          {p?.displayName ?? (p?.handle ? `@${p.handle}` : replyTarget.author.slice(0, 20) + "…")}
                        </div>
                      );
                    })()}
                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">{replyTarget.text}</p>
                  </div>
                </div>
              </div>
              <Textarea
                placeholder="Write your reply…"
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                rows={4}
                className="resize-none"
                autoFocus
                onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleReply(); }}
              />
              <div className="flex items-center justify-between">
                <span className={cn("text-xs tabular-nums", replyText.length > 280 ? "text-destructive font-semibold" : "text-muted-foreground")}>
                  {replyText.length}/300
                </span>
                <span className="text-[10px] text-muted-foreground">⌘↵ to send</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReplyTarget(null); setReplyText(""); }}>Cancel</Button>
            <Button
              onClick={handleReply}
              disabled={!replyText.trim() || replyText.length > 300 || sendingReply}
              className="gap-2"
            >
              {sendingReply ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Send Reply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
