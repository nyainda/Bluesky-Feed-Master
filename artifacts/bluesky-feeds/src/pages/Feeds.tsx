import { useState } from "react";
import { useListFeeds, useCreateFeed, useUpdateFeed, useDeleteFeed, getListFeedsQueryKey } from "@workspace/api-client-react";
import type { Feed } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Pencil, Trash2, CheckCircle, XCircle, ChevronRight } from "lucide-react";
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

const feedFormSchema = z.object({
  recordName: z.string().min(1, "Record name is required").regex(/^[a-z0-9-]+$/, "Only lowercase letters, numbers, hyphens"),
  displayName: z.string().min(1, "Display name is required"),
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
          toast({ title: "Feed created successfully" });
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
          <DialogTitle>Create New Feed</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="recordName" render={({ field }) => (
              <FormItem>
                <FormLabel>Record Name</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="my-feed" data-testid="input-record-name" className="font-mono" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="displayName" render={({ field }) => (
              <FormItem>
                <FormLabel>Display Name</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="My Amazing Feed" data-testid="input-display-name" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Textarea {...field} placeholder="What is this feed about?" data-testid="input-description" rows={3} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" data-testid="button-create-feed" disabled={createFeed.isPending}>
                {createFeed.isPending ? "Creating..." : "Create Feed"}
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
          <DialogTitle>Delete Feed</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Are you sure you want to delete <span className="font-semibold text-foreground">{feed.displayName}</span>? This will permanently remove the feed and all associated data.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" onClick={handleDelete} data-testid="button-confirm-delete" disabled={deleteFeed.isPending}>
            {deleteFeed.isPending ? "Deleting..." : "Delete Feed"}
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
            onError: () => toast({ title: "Failed to update feed", variant: "destructive" }),
          },
        );
      }}
      className="flex items-center gap-1.5 text-xs font-medium transition-colors"
    >
      {feed.isActive ? (
        <><CheckCircle className="w-4 h-4 text-green-500" /><span className="text-green-600">Active</span></>
      ) : (
        <><XCircle className="w-4 h-4 text-muted-foreground" /><span className="text-muted-foreground">Inactive</span></>
      )}
    </button>
  );
}

export default function Feeds() {
  const { data: feeds, isLoading } = useListFeeds();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Feed | null>(null);

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Feeds</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your Bluesky custom feed algorithms</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="button-new-feed">
          <Plus className="w-4 h-4 mr-2" />
          New Feed
        </Button>
      </motion.div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 bg-card border border-card-border rounded-xl animate-pulse" />
          ))}
        </div>
      ) : !feeds || feeds.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center h-64 text-center gap-3">
          <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
            <Plus className="w-7 h-7 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold text-foreground">No feeds yet</p>
            <p className="text-sm text-muted-foreground mt-1">Create your first feed to start indexing Bluesky posts</p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="mt-2">Create First Feed</Button>
        </motion.div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence>
            {feeds.map((feed, i) => (
              <motion.div
                key={feed.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ delay: i * 0.05 }}
                data-testid={`card-feed-${feed.id}`}
                className="bg-card border border-card-border rounded-xl p-5 hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <Link href={`/feeds/${feed.id}`}>
                        <span className="font-semibold text-foreground hover:text-primary cursor-pointer">{feed.displayName}</span>
                      </Link>
                      <span className="text-xs font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">{feed.recordName}</span>
                      <ToggleActiveButton feed={feed} />
                    </div>
                    {feed.description && (
                      <p className="text-sm text-muted-foreground truncate">{feed.description}</p>
                    )}
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      <span>{feed.postCount.toLocaleString()} posts indexed</span>
                      <span>Created {formatDistanceToNow(new Date(feed.createdAt), { addSuffix: true })}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteTarget(feed)}
                      data-testid={`button-delete-${feed.id}`}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                    <Link href={`/feeds/${feed.id}`}>
                      <Button variant="ghost" size="icon" data-testid={`button-view-${feed.id}`}>
                        <ChevronRight className="w-4 h-4" />
                      </Button>
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
