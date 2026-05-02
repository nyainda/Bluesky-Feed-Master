import { useState } from "react";
import { useParams, Link } from "wouter";
import {
  useGetFeed, useGetFeedKeywords, useGetFeedPosts,
  useAddFeedKeyword, useDeleteFeedKeyword,
  getGetFeedQueryKey, getGetFeedKeywordsQueryKey, getGetFeedPostsQueryKey,
} from "@workspace/api-client-react";
import type { Keyword } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Tag, X, Plus, ArrowLeft, ExternalLink, ChevronRight, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

function shortenDid(did: string) {
  if (did.length <= 20) return did;
  return did.substring(0, 14) + "..." + did.substring(did.length - 6);
}

export default function FeedDetail() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id, 10);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: feed, isLoading: loadingFeed } = useGetFeed(id);
  const { data: keywords } = useGetFeedKeywords(id);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  const { data: postsPage, isLoading: loadingPosts } = useGetFeedPosts(id, { limit: 20, cursor }, {
    query: { queryKey: getGetFeedPostsQueryKey(id, { limit: 20, cursor }), enabled: !isNaN(id) },
  });

  const [newKeyword, setNewKeyword] = useState("");
  const addKeyword = useAddFeedKeyword();
  const deleteKeyword = useDeleteFeedKeyword();

  function handleAddKeyword(e: React.FormEvent) {
    e.preventDefault();
    if (!newKeyword.trim()) return;
    addKeyword.mutate(
      { id, data: { keyword: newKeyword.trim() } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetFeedKeywordsQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getGetFeedQueryKey(id) });
          setNewKeyword("");
          toast({ title: "Keyword added" });
        },
        onError: () => toast({ title: "Failed to add keyword", variant: "destructive" }),
      },
    );
  }

  function handleDeleteKeyword(kw: Keyword) {
    deleteKeyword.mutate(
      { id, keywordId: kw.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetFeedKeywordsQueryKey(id) });
          toast({ title: "Keyword removed" });
        },
        onError: () => toast({ title: "Failed to remove keyword", variant: "destructive" }),
      },
    );
  }

  function nextPage() {
    if (postsPage?.cursor) {
      setCursorStack((s) => [...s, cursor ?? ""]);
      setCursor(postsPage.cursor);
    }
  }

  function prevPage() {
    const stack = [...cursorStack];
    const prev = stack.pop();
    setCursorStack(stack);
    setCursor(prev === "" ? undefined : prev);
  }

  if (loadingFeed) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <div className="h-8 w-48 bg-muted rounded animate-pulse mb-4" />
        <div className="h-32 bg-card border border-card-border rounded-xl animate-pulse" />
      </div>
    );
  }

  if (!feed) {
    return (
      <div className="p-8 max-w-5xl mx-auto text-center py-20">
        <p className="text-muted-foreground">Feed not found</p>
        <Link href="/feeds"><Button variant="outline" className="mt-4">Back to Feeds</Button></Link>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <Link href="/feeds">
          <span className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground cursor-pointer mb-4 w-fit">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Feeds
          </span>
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">{feed.displayName}</h1>
              <Badge variant={feed.isActive ? "default" : "secondary"} className="text-xs">
                {feed.isActive ? "Active" : "Inactive"}
              </Badge>
            </div>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-sm font-mono text-muted-foreground">{feed.recordName}</span>
              <span className="text-muted-foreground/40">•</span>
              <span className="text-sm text-muted-foreground">{feed.postCount.toLocaleString()} posts indexed</span>
            </div>
            {feed.description && <p className="text-sm text-muted-foreground mt-2 max-w-xl">{feed.description}</p>}
          </div>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="bg-card border border-card-border rounded-xl p-5 shadow-sm"
        >
          <div className="flex items-center gap-2 mb-4">
            <Tag className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Keywords</h2>
            <span className="text-xs text-muted-foreground ml-auto">{(keywords || []).length} total</span>
          </div>

          <form onSubmit={handleAddKeyword} className="flex gap-2 mb-4">
            <Input
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              placeholder="Add keyword..."
              className="text-sm"
              data-testid="input-new-keyword"
            />
            <Button type="submit" size="icon" disabled={addKeyword.isPending} data-testid="button-add-keyword">
              <Plus className="w-4 h-4" />
            </Button>
          </form>

          <div className="flex flex-wrap gap-2">
            <AnimatePresence>
              {(!keywords || keywords.length === 0) ? (
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-xs text-muted-foreground py-2">
                  No keywords yet. Add some to start indexing posts.
                </motion.p>
              ) : (
                keywords.map((kw) => (
                  <motion.div
                    key={kw.id}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    data-testid={`keyword-${kw.id}`}
                    className="flex items-center gap-1 bg-muted px-2.5 py-1 rounded-full text-xs font-medium group"
                  >
                    <span className="font-mono text-foreground">{kw.keyword}</span>
                    <button
                      onClick={() => handleDeleteKeyword(kw)}
                      className="text-muted-foreground hover:text-destructive transition-colors ml-0.5"
                      data-testid={`button-delete-keyword-${kw.id}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="lg:col-span-2 bg-card border border-card-border rounded-xl shadow-sm overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-card-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Indexed Posts</h2>
            <span className="text-xs text-muted-foreground">{(postsPage?.total ?? 0).toLocaleString()} total</span>
          </div>

          {loadingPosts ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-14 bg-muted rounded-lg animate-pulse" />
              ))}
            </div>
          ) : !postsPage || postsPage.posts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center gap-2 px-4">
              <p className="text-sm text-muted-foreground">No posts indexed yet for this feed.</p>
              <p className="text-xs text-muted-foreground">Add keywords above to start matching posts from the firehose.</p>
            </div>
          ) : (
            <>
              <div className="divide-y divide-border">
                {postsPage.posts.map((post) => (
                  <div key={post.id} data-testid={`post-${post.id}`} className="px-5 py-3 hover:bg-muted/30 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-mono text-muted-foreground">{shortenDid(post.author)}</span>
                          <span className="text-xs text-muted-foreground/50">•</span>
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(post.indexedAt), { addSuffix: true })}
                          </span>
                        </div>
                        <p className="text-sm text-foreground leading-relaxed line-clamp-2">{post.text}</p>
                      </div>
                      <a
                        href={`https://bsky.app/profile/${post.author}/post/${post.uri.split("/").pop()}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-shrink-0 text-muted-foreground hover:text-primary transition-colors mt-0.5"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-5 py-3 border-t border-border flex items-center justify-between">
                <Button variant="outline" size="sm" onClick={prevPage} disabled={cursorStack.length === 0}>
                  <ChevronLeft className="w-4 h-4 mr-1" /> Previous
                </Button>
                <Button variant="outline" size="sm" onClick={nextPage} disabled={!postsPage.cursor}>
                  Next <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </>
          )}
        </motion.div>
      </div>
    </div>
  );
}
