import { useState, useMemo } from "react";
import { useListFeeds, useCreateFeed, useUpdateFeed, useDeleteFeed, getListFeedsQueryKey, customFetch } from "@workspace/api-client-react";
import type { Feed } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Trash2, ChevronRight, CheckCircle, XCircle, Rss,
  Sparkles, Tag, Check, Search, Edit2, X, RotateCcw, RefreshCw, AlertTriangle,
  Globe, Zap, TrendingUp, Clock,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

type FeedTemplate = {
  emoji: string;
  name: string;
  recordName: string;
  description: string;
  keywords: string[];
};

const FEED_TEMPLATES: FeedTemplate[] = [
  {
    emoji: "🛠️",
    name: "Bluesky Dev",
    recordName: "bluesky-dev",
    description: "Posts about building on AT Protocol, Bluesky APIs, and custom feed generators",
    keywords: ["atproto", "feedgenerator", "at protocol", "bluesky api", "lexicon", "bsky developer", "indiedev bluesky", "atprotocol"],
  },
  {
    emoji: "🤖",
    name: "AI & Tech",
    recordName: "ai-tech",
    description: "The latest in artificial intelligence, machine learning, and software development",
    keywords: ["ai", "machinelearning", "llm", "openai", "claude", "gemini", "chatgpt", "deeplearning"],
  },
  {
    emoji: "🌐",
    name: "Web Dev",
    recordName: "web-dev",
    description: "JavaScript, TypeScript, React, and modern web development discussions",
    keywords: ["webdev", "javascript", "typescript", "reactjs", "nodejs", "frontend", "css", "nextjs"],
  },
  {
    emoji: "🎮",
    name: "Game Dev",
    recordName: "game-dev",
    description: "Indie game development, game design, and gamedev progress posts",
    keywords: ["indiedev", "gamedev", "unity", "godot", "indiegame", "gamedevelopment", "pixelart"],
  },
  {
    emoji: "🎨",
    name: "Digital Art",
    recordName: "digital-art",
    description: "Illustrations, digital art, design work, and creative process posts",
    keywords: ["art", "illustration", "digitalart", "design", "mastoart", "artistsonbluesky", "drawing"],
  },
  {
    emoji: "🔬",
    name: "Science",
    recordName: "science",
    description: "Research, discoveries, papers, and scientific discussions across all disciplines",
    keywords: ["science", "research", "physics", "biology", "chemistry", "scicomm", "arxiv", "climate"],
  },
  {
    emoji: "🚀",
    name: "Startups & Indie",
    recordName: "startups-indie",
    description: "Startup founders, indie hackers, product launches, and entrepreneurship",
    keywords: ["startup", "indiehacker", "buildinpublic", "saas", "founder", "entrepreneur", "productlaunch", "sideproject"],
  },
  {
    emoji: "🎵",
    name: "Music",
    recordName: "music",
    description: "Music releases, production, recommendations, and music news",
    keywords: ["music", "newmusic", "musicproduction", "musician", "album", "nowplaying", "hiphop", "indiemusic"],
  },
  {
    emoji: "📸",
    name: "Photography",
    recordName: "photography",
    description: "Photography, photo editing, camera gear, and visual storytelling",
    keywords: ["photography", "photo", "photographer", "shotoniphone", "streetphotography", "landscape", "portrait", "fujifilm"],
  },
  {
    emoji: "💰",
    name: "Crypto & Web3",
    recordName: "crypto-web3",
    description: "Cryptocurrency, DeFi, NFTs, blockchain, and Web3 developments",
    keywords: ["crypto", "bitcoin", "ethereum", "defi", "web3", "blockchain", "nft", "solana"],
  },
];

const templateFormSchema = z.object({
  recordName: z.string().min(1, "Required").regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers, hyphens only"),
  displayName: z.string().min(1, "Required"),
  description: z.string().optional(),
  keywordsText: z.string().min(1, "At least one keyword required"),
});
type TemplateFormValues = z.infer<typeof templateFormSchema>;

function TemplatesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createFeed = useCreateFeed();
  const [, navigate] = useLocation();
  const [loading, setLoading] = useState<string | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<FeedTemplate | null>(null);

  const form = useForm<TemplateFormValues>({
    resolver: zodResolver(templateFormSchema),
    defaultValues: { recordName: "", displayName: "", description: "", keywordsText: "" },
  });

  function openEditor(template: FeedTemplate) {
    form.reset({
      recordName: template.recordName,
      displayName: `${template.emoji} ${template.name}`,
      description: template.description,
      keywordsText: template.keywords.join(", "),
    });
    setEditingTemplate(template);
  }

  async function applyRaw(recordName: string, displayName: string, description: string, keywords: string[]) {
    setLoading(recordName);
    try {
      const feed = await createFeed.mutateAsync({
        data: { recordName, displayName, description: description || null },
      });
      for (const keyword of keywords) {
        await customFetch(`/api/feeds/${feed.id}/keywords`, {
          method: "POST",
          body: JSON.stringify({ keyword }),
        });
      }
      await queryClient.invalidateQueries({ queryKey: getListFeedsQueryKey() });
      toast({ title: `${displayName} created with ${keywords.length} keywords!` });
      setEditingTemplate(null);
      onOpenChange(false);
      navigate(`/feeds/${feed.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({
        title: "Failed to create feed from template",
        description: msg.toLowerCase().includes("unique") ? "A feed with that record name already exists." : msg,
        variant: "destructive",
      });
    } finally {
      setLoading(null);
    }
  }

  async function onSubmitEditor(values: TemplateFormValues) {
    const keywords = values.keywordsText.split(",").map((k) => k.trim()).filter(Boolean);
    await applyRaw(values.recordName, values.displayName, values.description ?? "", keywords);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setEditingTemplate(null); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            {editingTemplate ? (
              <>
                <button
                  onClick={() => setEditingTemplate(null)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
                Customize Template
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 text-primary" />
                Feed Templates
              </>
            )}
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            {editingTemplate
              ? "Edit the name, description, and keywords before creating."
              : "Pre-configured feeds with curated keywords — ready to index posts instantly."}
          </p>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {editingTemplate ? (
            <motion.div
              key="editor"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
            >
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmitEditor)} className="space-y-3.5">
                  <FormField control={form.control} name="displayName" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium">Display Name</FormLabel>
                      <FormControl><Input {...field} className="text-sm" /></FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="recordName" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium">Record Name</FormLabel>
                      <FormControl><Input {...field} className="text-sm font-mono" /></FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="description" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium">Description <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                      <FormControl><Textarea {...field} rows={2} className="text-sm resize-none" /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="keywordsText" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium">Keywords <span className="text-muted-foreground font-normal">(comma-separated)</span></FormLabel>
                      <FormControl>
                        <Textarea {...field} rows={3} className="text-sm resize-none font-mono" placeholder="keyword1, keyword2, keyword3" />
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )} />
                  <DialogFooter className="gap-2 pt-1">
                    <Button type="button" variant="outline" size="sm" onClick={() => setEditingTemplate(null)}>Back</Button>
                    <Button type="submit" size="sm" disabled={loading !== null} className="gap-1.5">
                      {loading ? (
                        <><div className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />Creating…</>
                      ) : (
                        <><Check className="w-3 h-3" />Create Feed</>
                      )}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </motion.div>
          ) : (
            <motion.div
              key="list"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
              className="space-y-2 max-h-[420px] overflow-y-auto pr-1"
            >
              {FEED_TEMPLATES.map((t) => (
                <div
                  key={t.recordName}
                  className="flex items-start gap-3 p-3.5 rounded-xl border border-border hover:border-primary/30 hover:bg-primary/[0.02] transition-all"
                >
                  <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center text-lg flex-shrink-0">
                    {t.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-foreground">{t.name}</div>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{t.description}</p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {t.keywords.slice(0, 3).map((kw) => (
                        <span key={kw} className="inline-flex items-center gap-0.5 text-[10px] bg-muted px-1.5 py-0.5 rounded-full text-muted-foreground">
                          <Tag className="w-2 h-2" />{kw}
                        </span>
                      ))}
                      {t.keywords.length > 3 && (
                        <span className="text-[10px] text-muted-foreground/50 self-center">+{t.keywords.length - 3} more</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1 px-2.5"
                      onClick={() => openEditor(t)}
                    >
                      <Edit2 className="w-3 h-3" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 text-xs gap-1 px-2.5"
                      onClick={() => applyRaw(t.recordName, `${t.emoji} ${t.name}`, t.description, t.keywords)}
                      disabled={loading !== null}
                    >
                      {loading === t.recordName ? (
                        <div className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                      ) : (
                        <><Check className="w-3 h-3" />Use</>
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
        {!editingTemplate && (
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

const feedFormSchema = z.object({
  recordName: z.string().min(1, "Required").regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers, hyphens only"),
  displayName: z.string().min(1, "Required"),
  description: z.string().optional(),
});
type FeedFormValues = z.infer<typeof feedFormSchema>;

const FEED_EMOJIS = [
  "🚀","✨","🌟","💡","🔥","⚡","🎯","💻","📱","🤖",
  "🧠","💎","🌈","🎨","📸","🎵","📰","🏆","🌍","🌱",
  "💬","📊","🔍","🛠️","👾","🦋","🎪","🔮","🎭","🌙",
];

function CreateFeedDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createFeed = useCreateFeed();
  const [selectedEmoji, setSelectedEmoji] = useState<string | null>(null);
  const form = useForm<FeedFormValues>({
    resolver: zodResolver(feedFormSchema),
    defaultValues: { recordName: "", displayName: "", description: "" },
  });

  function onSubmit(values: FeedFormValues) {
    createFeed.mutate(
      { data: { recordName: values.recordName, displayName: values.displayName, description: values.description || null } },
      {
        onSuccess: async (created) => {
          if (selectedEmoji && (created as unknown as { id?: number }).id) {
            const id = (created as unknown as { id: number }).id;
            await customFetch(`/api/feeds/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ avatarUrl: selectedEmoji }),
            }).catch(() => null);
          }
          queryClient.invalidateQueries({ queryKey: getListFeedsQueryKey() });
          toast({ title: "Feed created" });
          onOpenChange(false);
          form.reset();
          setSelectedEmoji(null);
        },
        onError: () => toast({ title: "Failed to create feed", variant: "destructive" }),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { form.reset(); setSelectedEmoji(null); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">New Feed</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-1">
            <div>
              <p className="text-xs font-medium mb-2">Icon <span className="text-muted-foreground font-normal">(optional)</span></p>
              <div className="grid grid-cols-10 gap-1">
                {FEED_EMOJIS.map(emoji => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => setSelectedEmoji(emoji === selectedEmoji ? null : emoji)}
                    className={cn(
                      "w-8 h-8 flex items-center justify-center text-base rounded transition-colors",
                      selectedEmoji === emoji
                        ? "bg-primary/15 ring-1 ring-primary"
                        : "hover:bg-muted"
                    )}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
            <FormField control={form.control} name="recordName" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs font-medium">Record Name</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="my-feed" data-testid="input-record-name" className="font-mono text-sm" />
                </FormControl>
                <FormMessage className="text-xs" />
              </FormItem>
            )} />
            <FormField control={form.control} name="displayName" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs font-medium">Display Name</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="My Amazing Feed" data-testid="input-display-name" className="text-sm" />
                </FormControl>
                <FormMessage className="text-xs" />
              </FormItem>
            )} />
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs font-medium">Description <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                <FormControl>
                  <Textarea {...field} placeholder="What is this feed about?" data-testid="input-description" rows={3} className="text-sm resize-none" />
                </FormControl>
                <FormMessage className="text-xs" />
              </FormItem>
            )} />
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" size="sm" data-testid="button-create-feed" disabled={createFeed.isPending}>
                {createFeed.isPending ? "Creating…" : "Create Feed"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteFeedDialog({ feed, open, onOpenChange }: { feed: Feed; open: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const deleteFeed = useDeleteFeed();

  function handleDelete() {
    deleteFeed.mutate(
      { id: feed.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListFeedsQueryKey() });
          toast({ title: "Feed deleted" });
          onOpenChange(false);
        },
        onError: () => toast({ title: "Failed to delete feed", variant: "destructive" }),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">Delete Feed</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Delete <span className="font-semibold text-foreground">{feed.displayName}</span>? This permanently removes the feed and all associated data.
        </p>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" size="sm" onClick={handleDelete} data-testid="button-confirm-delete" disabled={deleteFeed.isPending}>
            {deleteFeed.isPending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ToggleActiveButton({ feed }: { feed: Feed }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const updateFeed = useUpdateFeed();

  return (
    <button
      data-testid={`button-toggle-${feed.id}`}
      onClick={(e) => {
        e.preventDefault();
        updateFeed.mutate(
          { id: feed.id, data: { isActive: !feed.isActive } },
          {
            onSuccess: () => queryClient.invalidateQueries({ queryKey: getListFeedsQueryKey() }),
            onError: () => toast({ title: "Failed to update", variant: "destructive" }),
          },
        );
      }}
      className={cn(
        "flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors",
        feed.isActive
          ? "text-emerald-600 bg-emerald-500/8 border-emerald-500/20 hover:bg-emerald-500/15"
          : "text-muted-foreground bg-muted border-border hover:bg-muted/80",
      )}
    >
      {feed.isActive ? (
        <><CheckCircle className="w-3 h-3" />Active</>
      ) : (
        <><XCircle className="w-3 h-3" />Inactive</>
      )}
    </button>
  );
}

type FeedIndexResult = {
  feed: string;
  keywords: number;
  indexed: number;
  skipped: number;
  errors: string[];
};

type IndexResponse = {
  ok: boolean;
  message?: string;
  error?: string;
  elapsed?: number;
  feeds?: FeedIndexResult[];
};

export default function Feeds() {
  const { data: feeds, isLoading } = useListFeeds();
  const [createOpen, setCreateOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Feed | null>(null);
  const [search, setSearch] = useState("");
  const [indexing, setIndexing] = useState(false);
  const [indexResults, setIndexResults] = useState<IndexResponse | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: geoData } = useQuery<{
    country: string; continent: string; colo: string;
    city: string; region: string; timezone: string;
  }>({
    queryKey: ["geo"],
    queryFn: async () => {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ""}/api/geo`);
      return res.json();
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  type FeedFreshness = {
    feedId: number; recordName: string; displayName: string; isActive: boolean;
    postCount: number; postsLast1h: number; postsLast24h: number; lastIndexedAt: string | null;
  };
  const { data: freshnessData } = useQuery<FeedFreshness[]>({
    queryKey: ["feeds-freshness"],
    queryFn: async () => {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ""}/api/stats/feeds-freshness`);
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const freshnessMap = useMemo(() => {
    const map: Record<number, FeedFreshness> = {};
    if (freshnessData) freshnessData.forEach((f) => { map[f.feedId] = f; });
    return map;
  }, [freshnessData]);

  async function triggerIndex() {
    setIndexing(true);
    setIndexResults(null);
    try {
      const res = await customFetch<IndexResponse>(
        "/api/admin/trigger-index",
        { method: "POST" },
      );
      if (res.ok) {
        // Indexer runs in the background (waitUntil). Poll counts after 30s.
        toast({ title: "Indexing in progress", description: "Feed counts will update in ~30 seconds…" });
        setTimeout(() => {
          queryClient.invalidateQueries();
          setIndexing(false);
          toast({ title: "Feed counts refreshed", description: "Check your feeds for new posts." });
        }, 30000);
      } else {
        toast({ title: "Could not start indexer", description: res.error ?? "Unknown error", variant: "destructive" });
        setIndexing(false);
      }
    } catch {
      toast({ title: "Could not reach indexer", description: "Check your connection and try again.", variant: "destructive" });
      setIndexing(false);
    }
  }

  const filtered = useMemo(() => {
    if (!feeds) return [];
    if (!search.trim()) return feeds;
    const q = search.toLowerCase();
    return feeds.filter(
      (f) =>
        f.displayName.toLowerCase().includes(q) ||
        f.recordName.toLowerCase().includes(q) ||
        (f.description ?? "").toLowerCase().includes(q),
    );
  }, [feeds, search]);

  return (
    <div className="px-4 py-5 md:px-8 md:py-8 max-w-5xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between mb-5 md:mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">Feeds</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Manage your Bluesky custom feed algorithms</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={triggerIndex}
            disabled={indexing}
            variant="outline"
            size="sm"
            className="gap-1.5"
            title="Manually run the indexer to pick up new posts for all feeds"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", indexing && "animate-spin")} />
            <span className="hidden sm:inline">{indexing ? "Indexing…" : "Index Now"}</span>
          </Button>
          <Button onClick={() => setTemplatesOpen(true)} variant="outline" size="sm" className="gap-1.5">
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Templates</span>
          </Button>
          <Button onClick={() => setCreateOpen(true)} data-testid="button-new-feed" size="sm" className="gap-1.5">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New Feed</span>
            <span className="sm:hidden">New</span>
          </Button>
        </div>
      </motion.div>

      {/* PoP + Freshness info bar */}
      <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="mb-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {/* Serving PoP */}
        <div className="flex items-center gap-3 bg-card border border-card-border rounded-xl px-4 py-3">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
            <Globe className="w-4 h-4 text-blue-500" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide leading-none mb-0.5">Global Edge Network</p>
            {geoData ? (
              <p className="text-sm font-semibold text-foreground truncate">
                Feeds served from <span className="text-blue-500">300+</span> locations
              </p>
            ) : (
              <div className="h-4 w-36 bg-muted rounded animate-pulse" />
            )}
            {geoData && (
              <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                Your connection → <span className="font-mono">{geoData.colo}</span> · {geoData.city}, {geoData.country}
              </p>
            )}
          </div>
          {geoData && (
            <span className="ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-green-500/10 border border-green-500/20 text-green-600 dark:text-green-400 flex-shrink-0 whitespace-nowrap">
              Live · {geoData.continent}
            </span>
          )}
        </div>

        {/* Global freshness summary */}
        <div className="flex items-center gap-3 bg-card border border-card-border rounded-xl px-4 py-3">
          <div className="w-8 h-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center flex-shrink-0">
            <Zap className="w-4 h-4 text-violet-500" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide leading-none mb-0.5">Posts Indexed</p>
            {freshnessData ? (
              <p className="text-sm font-semibold text-foreground">
                <span className="text-violet-500">{freshnessData.reduce((s, f) => s + f.postsLast1h, 0).toLocaleString()}</span>
                <span className="text-muted-foreground font-normal"> /hr · </span>
                <span className="text-foreground">{freshnessData.reduce((s, f) => s + f.postsLast24h, 0).toLocaleString()}</span>
                <span className="text-muted-foreground font-normal"> /24h</span>
              </p>
            ) : (
              <div className="h-4 w-40 bg-muted rounded animate-pulse" />
            )}
          </div>
          {freshnessData && (
            <span className="ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-600 dark:text-violet-400 flex-shrink-0">
              {freshnessData.length} feeds
            </span>
          )}
        </div>
      </motion.div>

      {/* Search bar — only visible when there are feeds */}
      {!isLoading && feeds && feeds.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search feeds…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </motion.div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 bg-card border border-card-border rounded-xl animate-pulse" />
          ))}
        </div>
      ) : !feeds || feeds.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center h-64 text-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-muted border border-border flex items-center justify-center">
            <Rss className="w-7 h-7 text-muted-foreground/50" />
          </div>
          <div>
            <p className="font-semibold text-foreground">No feeds yet</p>
            <p className="text-sm text-muted-foreground mt-1">Create your first feed to start indexing Bluesky posts</p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => setTemplatesOpen(true)} variant="outline" size="sm" className="gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> Browse Templates
            </Button>
            <Button onClick={() => setCreateOpen(true)} size="sm">
              <Plus className="w-4 h-4 mr-1.5" /> Create Feed
            </Button>
          </div>
        </motion.div>
      ) : filtered.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center h-48 gap-3 text-center">
          <Search className="w-8 h-8 text-muted-foreground/30" />
          <div>
            <p className="font-medium text-foreground">No feeds match "{search}"</p>
            <p className="text-sm text-muted-foreground mt-0.5">Try a different search term</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setSearch("")} className="gap-1.5">
            <RotateCcw className="w-3.5 h-3.5" /> Clear search
          </Button>
        </motion.div>
      ) : (
        <div className="space-y-2.5">
          <AnimatePresence>
            {filtered.map((feed, i) => (
              <motion.div
                key={feed.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ delay: i * 0.04 }}
                data-testid={`card-feed-${feed.id}`}
                className="group bg-card border border-card-border rounded-xl p-4 md:p-5 hover:shadow-sm transition-all duration-150 hover:border-border"
              >
                <div className="flex items-center gap-3 md:gap-4">
                  <div className="w-9 h-9 md:w-10 md:h-10 rounded-xl bg-primary/8 border border-primary/15 flex items-center justify-center flex-shrink-0">
                    <Rss className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <Link href={`/feeds/${feed.id}`}>
                        <span className="font-semibold text-foreground hover:text-primary cursor-pointer text-sm">{feed.displayName}</span>
                      </Link>
                      <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded hidden sm:inline">{feed.recordName}</span>
                      <ToggleActiveButton feed={feed} />
                      {feed.postCount === 0 && (
                        <span className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border border-amber-500/25 bg-amber-500/8 text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="w-2.5 h-2.5" /> No posts
                        </span>
                      )}
                      {feed.postCount > 0 && feed.postCount < 5 && (
                        <span className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border border-amber-500/25 bg-amber-500/8 text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="w-2.5 h-2.5" /> Low content
                        </span>
                      )}
                    </div>
                    {feed.description && (
                      <p className="text-xs text-muted-foreground truncate">{feed.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
                      <span className="font-medium text-foreground tabular-nums">{feed.postCount.toLocaleString()}</span>
                      <span className="text-muted-foreground/60">posts indexed</span>
                      {freshnessMap[feed.id] && (
                        <>
                          <span className="text-muted-foreground/40">·</span>
                          <span className="flex items-center gap-1">
                            <TrendingUp className="w-3 h-3 text-violet-500" />
                            <span className="font-medium text-foreground tabular-nums">{freshnessMap[feed.id].postsLast1h.toLocaleString()}</span>
                            <span className="text-muted-foreground/60">/hr</span>
                          </span>
                          {freshnessMap[feed.id].lastIndexedAt && (
                            <>
                              <span className="hidden sm:inline text-muted-foreground/40">·</span>
                              <span className="hidden sm:flex items-center gap-1">
                                <Clock className="w-3 h-3 text-muted-foreground/60" />
                                {formatDistanceToNow(new Date(freshnessMap[feed.id].lastIndexedAt!), { addSuffix: true })}
                              </span>
                            </>
                          )}
                        </>
                      )}
                      {!freshnessMap[feed.id] && (
                        <>
                          <span className="hidden sm:inline text-muted-foreground/40">·</span>
                          {(feed as unknown as Record<string, unknown>).lastIndexedAt ? (
                            <span className="hidden sm:inline">
                              Last post {formatDistanceToNow(new Date((feed as unknown as Record<string, unknown>).lastIndexedAt as string), { addSuffix: true })}
                            </span>
                          ) : (
                            <span className="hidden sm:inline">Created {formatDistanceToNow(new Date(feed.createdAt), { addSuffix: true })}</span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => setDeleteTarget(feed)}
                      data-testid={`button-delete-${feed.id}`}
                      className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/8 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <Link href={`/feeds/${feed.id}`}>
                      <button
                        data-testid={`button-view-${feed.id}`}
                        className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </Link>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {search && (
            <p className="text-center text-xs text-muted-foreground/50 pt-1">
              Showing {filtered.length} of {feeds.length} feeds
            </p>
          )}
        </div>
      )}

      <CreateFeedDialog open={createOpen} onOpenChange={setCreateOpen} />
      <TemplatesDialog open={templatesOpen} onOpenChange={setTemplatesOpen} />
      {deleteTarget && (
        <DeleteFeedDialog feed={deleteTarget} open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)} />
      )}

      {/* Indexer diagnostic results dialog */}
      <Dialog open={!!indexResults} onOpenChange={(v) => !v && setIndexResults(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-500" />
              Indexer Results
            </DialogTitle>
          </DialogHeader>
          {indexResults && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">{indexResults.message}</p>
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {(indexResults.feeds ?? []).map((r) => (
                  <div key={r.feed} className={cn(
                    "rounded-lg border px-3 py-2.5 text-sm",
                    r.indexed > 0 ? "border-green-500/30 bg-green-500/5" : r.errors.length > 0 ? "border-destructive/30 bg-destructive/5" : "border-border bg-muted/30"
                  )}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-medium text-xs">{r.feed}</span>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{r.keywords} kw</span>
                        <span className={r.indexed > 0 ? "text-green-600 font-semibold" : ""}>+{r.indexed} posts</span>
                        {r.errors.length > 0 && (
                          <span className="text-destructive font-semibold flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />{r.errors.length} err
                          </span>
                        )}
                      </div>
                    </div>
                    {r.errors.length > 0 && (
                      <div className="mt-1.5 space-y-0.5">
                        {r.errors.slice(0, 3).map((e, i) => (
                          <p key={i} className="text-xs text-destructive/80 truncate font-mono">{e}</p>
                        ))}
                        {r.errors.length > 3 && (
                          <p className="text-xs text-muted-foreground">+{r.errors.length - 3} more errors</p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {(indexResults.feeds ?? []).some(r => r.indexed === 0 && r.keywords > 0 && r.errors.some(e => e.includes("Rate") || e.includes("rate") || e.includes("429"))) && (
                <p className="text-xs text-amber-600 bg-amber-500/10 border border-amber-500/30 rounded px-3 py-2">
                  ⚠️ Some feeds were rate-limited. The new indexer adds delays between feeds — this will improve on the next run.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button size="sm" onClick={() => setIndexResults(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
