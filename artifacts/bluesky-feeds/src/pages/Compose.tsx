import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  useComposePost, useListScheduledPosts, useCreateScheduledPost, useDeleteScheduledPost,
} from "@workspace/api-client-react";
import type { ScheduledPost } from "@workspace/api-client-react";
import {
  PenLine, Send, Clock, Plus, Trash2, CheckCircle2, AlertCircle,
  ArrowUpRight, Layers, RefreshCw, Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { getListScheduledPostsQueryKey } from "@workspace/api-client-react";

const CHAR_LIMIT = 300;

function CharCounter({ text }: { text: string }) {
  const remaining = CHAR_LIMIT - text.length;
  return (
    <span className={cn("text-xs tabular-nums font-medium", remaining < 0 ? "text-destructive" : remaining < 30 ? "text-amber-500" : "text-muted-foreground")}>
      {remaining}
    </span>
  );
}

// ─── Post Now Tab ─────────────────────────────────────────────────────────────
function PostNowTab() {
  const [text, setText] = useState("");
  const [posted, setPosted] = useState<{ uri: string } | null>(null);
  const { toast } = useToast();

  const { mutate: compose, isPending } = useComposePost({
    mutation: {
      onSuccess: (data) => {
        setPosted({ uri: data.uri });
        setText("");
        toast({ title: "Posted!", description: "Your post is live on Bluesky." });
      },
      onError: (err) => {
        toast({ title: "Post failed", description: String(err), variant: "destructive" });
      },
    },
  });

  const handlePost = () => {
    if (!text.trim() || text.length > CHAR_LIMIT) return;
    compose({ data: { text } });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handlePost();
  };

  return (
    <div className="space-y-4">
      {posted && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 bg-emerald-500/8 border border-emerald-500/20 rounded-xl px-4 py-3"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
          <span className="text-sm text-emerald-700 dark:text-emerald-400 font-medium">Post published successfully!</span>
          <a
            href={`https://bsky.app/profile/${posted.uri.split("/")[2]}/post/${posted.uri.split("/").pop()}`}
            target="_blank"
            rel="noreferrer"
            className="ml-auto flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-700 transition-colors"
          >
            View on Bluesky <ArrowUpRight className="w-3 h-3" />
          </a>
        </motion.div>
      )}

      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <textarea
          value={text}
          onChange={e => { setText(e.target.value); setPosted(null); }}
          onKeyDown={handleKeyDown}
          placeholder="What's on your mind?"
          rows={6}
          className="w-full px-5 py-4 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none leading-relaxed"
        />
        <div className="flex items-center justify-between px-4 py-3 border-t border-card-border bg-muted/20">
          <div className="flex items-center gap-3">
            <CharCounter text={text} />
            <span className="text-muted-foreground/30 text-xs">•</span>
            <span className="text-xs text-muted-foreground/50">⌘ + Enter to post</span>
          </div>
          <Button
            size="sm"
            className="gap-2"
            onClick={handlePost}
            disabled={!text.trim() || text.length > CHAR_LIMIT || isPending}
          >
            {isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {isPending ? "Posting…" : "Post to Bluesky"}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground/60">Links and mentions will be auto-detected as rich text.</p>
    </div>
  );
}

// ─── Thread Builder Tab ────────────────────────────────────────────────────────
function ThreadBuilderTab() {
  const [parts, setParts] = useState<string[]>(["", ""]);
  const [posted, setPosted] = useState<string[]>([]);
  const { toast } = useToast();
  const lastRef = useRef<HTMLTextAreaElement>(null);

  const { mutate: compose, isPending } = useComposePost({
    mutation: {
      onSuccess: (data) => {
        setPosted(data.uris);
        setParts(["", ""]);
        toast({ title: "Thread posted!", description: `${data.uris.length} posts published.` });
      },
      onError: (err) => {
        toast({ title: "Thread failed", description: String(err), variant: "destructive" });
      },
    },
  });

  const addPart = () => {
    setParts(p => [...p, ""]);
    setTimeout(() => lastRef.current?.focus(), 50);
  };

  const removePart = (i: number) => setParts(p => p.filter((_, idx) => idx !== i));

  const updatePart = (i: number, val: string) => setParts(p => p.map((t, idx) => idx === i ? val : t));

  const validParts = parts.filter(t => t.trim());
  const canPost = validParts.length >= 1 && parts.every(t => t.length <= CHAR_LIMIT);

  const handlePost = () => {
    if (!canPost) return;
    const [first, ...rest] = validParts;
    compose({ data: { text: first, threadParts: rest, isThread: true } });
  };

  return (
    <div className="space-y-3">
      {posted.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 bg-emerald-500/8 border border-emerald-500/20 rounded-xl px-4 py-3"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
          <span className="text-sm text-emerald-700 dark:text-emerald-400 font-medium">{posted.length} posts published as a thread!</span>
          <a
            href={`https://bsky.app/profile/${posted[0]?.split("/")[2]}/post/${posted[0]?.split("/").pop()}`}
            target="_blank"
            rel="noreferrer"
            className="ml-auto flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-700"
          >
            View thread <ArrowUpRight className="w-3 h-3" />
          </a>
        </motion.div>
      )}

      <div className="space-y-2">
        {parts.map((text, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card border border-card-border rounded-xl overflow-hidden"
          >
            <div className="flex items-center gap-2 px-4 pt-3 pb-1">
              <div className="w-5 h-5 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                <span className="text-[9px] font-bold text-primary">{i + 1}</span>
              </div>
              <span className="text-xs text-muted-foreground font-medium">Part {i + 1}</span>
              {parts.length > 1 && (
                <button
                  onClick={() => removePart(i)}
                  className="ml-auto p-1 rounded text-muted-foreground/40 hover:text-destructive transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <textarea
              ref={i === parts.length - 1 ? lastRef : undefined}
              value={text}
              onChange={e => { updatePart(i, e.target.value); setPosted([]); }}
              placeholder={i === 0 ? "Start your thread here…" : "Continue the thread…"}
              rows={3}
              className="w-full px-4 py-2 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 resize-none focus:outline-none leading-relaxed"
            />
            <div className="flex items-center justify-end px-4 py-2 border-t border-card-border bg-muted/10">
              <CharCounter text={text} />
            </div>
          </motion.div>
        ))}
      </div>

      <div className="flex items-center justify-between pt-1">
        <Button variant="outline" size="sm" className="gap-2 text-xs" onClick={addPart} disabled={parts.length >= 10}>
          <Plus className="w-3.5 h-3.5" /> Add Part
        </Button>
        <Button size="sm" className="gap-2" onClick={handlePost} disabled={!canPost || isPending}>
          {isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Layers className="w-3.5 h-3.5" />}
          {isPending ? "Posting thread…" : `Post Thread (${validParts.length} parts)`}
        </Button>
      </div>
    </div>
  );
}

// ─── Scheduled Tab ─────────────────────────────────────────────────────────────
function ScheduledTab() {
  const [showForm, setShowForm] = useState(false);
  const [formText, setFormText] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: posts, isLoading } = useListScheduledPosts({
    query: { queryKey: getListScheduledPostsQueryKey(), refetchInterval: 30_000 },
  });

  const { mutate: createPost, isPending: creating } = useCreateScheduledPost({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListScheduledPostsQueryKey() });
        setShowForm(false);
        setFormText("");
        setScheduledAt("");
        toast({ title: "Scheduled!", description: "Your post has been queued." });
      },
      onError: (err) => toast({ title: "Failed to schedule", description: String(err), variant: "destructive" }),
    },
  });

  const { mutate: deletePost } = useDeleteScheduledPost({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListScheduledPostsQueryKey() }),
      onError: () => toast({ title: "Failed to cancel", variant: "destructive" }),
    },
  });

  const pending = posts?.filter(p => p.status === "pending") ?? [];
  const sent = posts?.filter(p => p.status === "sent") ?? [];
  const failed = posts?.filter(p => p.status === "failed") ?? [];

  const handleCreate = () => {
    if (!formText.trim() || !scheduledAt) return;
    createPost({ data: { text: formText.trim(), scheduledAt: new Date(scheduledAt).toISOString() } });
  };

  const minDateTime = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 5);
    return d.toISOString().slice(0, 16);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            {pending.length > 0 ? `${pending.length} post${pending.length > 1 ? "s" : ""} waiting to be sent` : "No posts scheduled"}
          </p>
        </div>
        <Button size="sm" className="gap-2" onClick={() => setShowForm(v => !v)}>
          <Calendar className="w-3.5 h-3.5" />
          Schedule Post
        </Button>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-card border border-card-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-card-border bg-muted/20">
                <h3 className="text-sm font-semibold text-foreground">New Scheduled Post</h3>
              </div>
              <textarea
                value={formText}
                onChange={e => setFormText(e.target.value)}
                placeholder="What do you want to say?"
                rows={4}
                className="w-full px-4 py-3 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none leading-relaxed"
              />
              <div className="flex items-center gap-3 px-4 py-3 border-t border-card-border bg-muted/10 flex-wrap">
                <CharCounter text={formText} />
                <label className="text-xs text-muted-foreground font-medium ml-auto">Send at:</label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  min={minDateTime()}
                  onChange={e => setScheduledAt(e.target.value)}
                  className="text-xs bg-background border border-input rounded-lg px-3 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="text-xs" onClick={() => setShowForm(false)}>Cancel</Button>
                  <Button size="sm" className="gap-1.5 text-xs" onClick={handleCreate} disabled={!formText.trim() || !scheduledAt || formText.length > CHAR_LIMIT || creating}>
                    {creating ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Clock className="w-3 h-3" />}
                    {creating ? "Scheduling…" : "Schedule"}
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 bg-card border border-card-border rounded-xl animate-pulse" />
          ))}
        </div>
      ) : posts?.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
          <div className="w-12 h-12 rounded-2xl bg-muted border border-border flex items-center justify-center">
            <Clock className="w-6 h-6 text-muted-foreground/40" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">No scheduled posts</p>
            <p className="text-xs text-muted-foreground mt-1">Schedule a post and it'll appear here.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {pending.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Pending ({pending.length})</h3>
              <div className="space-y-2">
                {pending.map(p => <ScheduledPostRow key={p.id} post={p} onDelete={() => deletePost({ id: p.id })} />)}
              </div>
            </section>
          )}
          {sent.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Sent ({sent.length})</h3>
              <div className="space-y-2">
                {sent.slice(0, 5).map(p => <ScheduledPostRow key={p.id} post={p} />)}
              </div>
            </section>
          )}
          {failed.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Failed ({failed.length})</h3>
              <div className="space-y-2">
                {failed.map(p => <ScheduledPostRow key={p.id} post={p} onDelete={() => deletePost({ id: p.id })} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function ScheduledPostRow({ post, onDelete }: { post: ScheduledPost; onDelete?: () => void }) {
  return (
    <div className="flex items-start gap-3 bg-card border border-card-border rounded-xl px-4 py-3">
      <div className={cn("w-2 h-2 rounded-full mt-1.5 flex-shrink-0",
        post.status === "pending" ? "bg-amber-500" :
        post.status === "sent" ? "bg-emerald-500" : "bg-destructive"
      )} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground line-clamp-2 leading-relaxed">{post.text}</p>
        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          {post.status === "pending" && (
            <span className="text-xs text-muted-foreground">
              Sends {formatDistanceToNow(new Date(post.scheduledAt), { addSuffix: true })}
              {" · "}{format(new Date(post.scheduledAt), "MMM d, h:mm a")}
            </span>
          )}
          {post.status === "sent" && post.sentAt && (
            <span className="text-xs text-emerald-600 font-medium">
              Sent {formatDistanceToNow(new Date(post.sentAt), { addSuffix: true })}
            </span>
          )}
          {post.status === "failed" && (
            <span className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {post.errorMessage ?? "Failed to send"}
            </span>
          )}
        </div>
      </div>
      {onDelete && (
        <button
          onClick={onDelete}
          className="flex-shrink-0 p-1.5 rounded-lg text-muted-foreground/40 hover:text-destructive hover:bg-destructive/8 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
type ComposeTab = "post" | "thread" | "scheduled";

export default function Compose() {
  const [tab, setTab] = useState<ComposeTab>("post");

  const tabs: { id: ComposeTab; label: string; icon: React.ElementType }[] = [
    { id: "post", label: "Post Now", icon: PenLine },
    { id: "thread", label: "Thread Builder", icon: Layers },
    { id: "scheduled", label: "Scheduled", icon: Clock },
  ];

  return (
    <div className="px-4 py-5 md:px-8 md:py-8 max-w-2xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="mb-6 md:mb-8">
        <h1 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">Compose</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Draft and publish posts to Bluesky</p>
      </motion.div>

      <div className="flex gap-1 border-b border-border mb-6 overflow-x-auto scrollbar-thin -mx-4 px-4 md:mx-0 md:px-0">
        {tabs.map(({ id, label, icon: Icon }) => (
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
        {tab === "post" && (
          <motion.div key="post" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <PostNowTab />
          </motion.div>
        )}
        {tab === "thread" && (
          <motion.div key="thread" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <ThreadBuilderTab />
          </motion.div>
        )}
        {tab === "scheduled" && (
          <motion.div key="scheduled" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <ScheduledTab />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
