import { useState } from "react";
import { useListPosts, getListPostsQueryKey } from "@workspace/api-client-react";
import type { ListPostsParams } from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { Search, ExternalLink, ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { useDebounce } from "@/hooks/use-debounce";

function shortenDid(did: string) {
  if (did.length <= 22) return did;
  return did.substring(0, 16) + "..." + did.substring(did.length - 6);
}

function truncate(text: string, max = 120) {
  return text.length > max ? text.substring(0, max) + "…" : text;
}

export default function Posts() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 400);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  const params: ListPostsParams = {
    limit: 50,
    cursor,
    search: debouncedSearch || undefined,
  };

  const { data: postsPage, isLoading } = useListPosts(params, {
    query: { queryKey: getListPostsQueryKey(params) },
  });

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

  function handleSearch(val: string) {
    setSearch(val);
    setCursor(undefined);
    setCursorStack([]);
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">All Posts</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {(postsPage?.total ?? 0).toLocaleString()} posts indexed across all feeds
          </p>
        </div>
      </motion.div>

      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search post content..."
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="pl-9"
          data-testid="input-search"
        />
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="bg-card border border-card-border rounded-xl shadow-sm overflow-hidden"
      >
        {isLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />
            ))}
          </div>
        ) : !postsPage || postsPage.posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center gap-2 px-4">
            <Search className="w-10 h-10 text-muted-foreground/30" />
            <p className="font-medium text-foreground">No posts found</p>
            <p className="text-sm text-muted-foreground">
              {search ? `No posts match "${search}"` : "No posts have been indexed yet. Make sure your feeds have keywords and the firehose is connected."}
            </p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-border">
              {postsPage.posts.map((post, i) => (
                <motion.div
                  key={post.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.02 }}
                  data-testid={`post-row-${post.id}`}
                  className="px-5 py-4 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          {shortenDid(post.author)}
                        </span>
                        {post.algoTags && post.algoTags.split(",").map((tag) => (
                          <Badge key={tag} variant="outline" className="text-xs px-1.5 py-0 h-5">{tag}</Badge>
                        ))}
                        <span className="text-xs text-muted-foreground/50 ml-auto">
                          {formatDistanceToNow(new Date(post.indexedAt), { addSuffix: true })}
                        </span>
                      </div>
                      <p className="text-sm text-foreground leading-relaxed">{truncate(post.text)}</p>
                    </div>
                    <a
                      href={`https://bsky.app/profile/${post.author}/post/${post.uri.split("/").pop()}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-shrink-0 text-muted-foreground hover:text-primary transition-colors mt-0.5"
                      data-testid={`link-post-${post.id}`}
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                </motion.div>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-border flex items-center justify-between bg-muted/20">
              <Button variant="outline" size="sm" onClick={prevPage} disabled={cursorStack.length === 0} data-testid="button-prev-page">
                <ChevronLeft className="w-4 h-4 mr-1" /> Previous
              </Button>
              <span className="text-xs text-muted-foreground">
                Showing {postsPage.posts.length} of {postsPage.total.toLocaleString()} posts
              </span>
              <Button variant="outline" size="sm" onClick={nextPage} disabled={!postsPage.cursor} data-testid="button-next-page">
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
