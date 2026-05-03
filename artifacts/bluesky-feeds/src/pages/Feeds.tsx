import { useState } from "react";
import { useListFeeds, useCreateFeed, useUpdateFeed, useDeleteFeed, getListFeedsQueryKey } from "@workspace/api-client-react";
import type { Feed } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Trash2, ChevronRight, CheckCircle, XCircle, Rss, MoreHorizontal } from "lucide-react";
import { Link } from "wouter";
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

const feedFormSchema = z.object({
  recordName: z.string().min(1, "Required").regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers, hyphens only"),
  displayName: z.string().min(1, "Required"),
  description: z.string().optional(),
});
type FeedFormValues = z.infer<typeof feedFormSchema>;

function CreateFeedDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createFeed = useCreateFeed();
  const form = useForm<FeedFormValues>({
    resolver: zodResolver(feedFormSchema),
    defaultValues: { recordName: "", displayName: "", description: "" },
  });

  function onSubmit(values: FeedFormValues) {
    createFeed.mutate(
      { data: { recordName: values.recordName, displayName: values.displayName, description: values.description || null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListFeedsQueryKey() });
          toast({ title: "Feed created" });
          onOpenChange(false);
          form.reset();
        },
        onError: () => toast({ title: "Failed to create feed", variant: "destructive" }),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">New Feed</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-1">
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

export default function Feeds() {
  const { data: feeds, isLoading } = useListFeeds();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Feed | null>(null);

  return (
    <div className="px-4 py-5 md:px-8 md:py-8 max-w-5xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between mb-6 md:mb-8">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">Feeds</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Manage your Bluesky custom feed algorithms</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="button-new-feed" size="sm" className="md:size-default gap-1.5">
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">New Feed</span>
          <span className="sm:hidden">New</span>
        </Button>
      </motion.div>

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
          <Button onClick={() => setCreateOpen(true)} className="mt-1" size="sm">
            <Plus className="w-4 h-4 mr-1.5" />
            Create First Feed
          </Button>
        </motion.div>
      ) : (
        <div className="space-y-2.5">
          <AnimatePresence>
            {feeds.map((feed, i) => (
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
                    </div>
                    {feed.description && (
                      <p className="text-xs text-muted-foreground truncate">{feed.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground tabular-nums">{feed.postCount.toLocaleString()}</span>
                      <span className="text-muted-foreground/60">posts indexed</span>
                      <span className="hidden sm:inline text-muted-foreground/40">·</span>
                      <span className="hidden sm:inline">Created {formatDistanceToNow(new Date(feed.createdAt), { addSuffix: true })}</span>
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
        </div>
      )}

      <CreateFeedDialog open={createOpen} onOpenChange={setCreateOpen} />
      {deleteTarget && (
        <DeleteFeedDialog feed={deleteTarget} open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)} />
      )}
    </div>
  );
}
