import React, { useState, useCallback } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useListPosts } from "@workspace/api-client-react";
import type { PostsPage } from "@workspace/api-client-react";

import { useColors } from "@/hooks/useColors";
import { PostCard } from "@/components/PostCard";
import { EmptyState } from "@/components/EmptyState";

type Post = NonNullable<PostsPage["posts"]>[number];

export default function PostsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleSearchChange(text: string) {
    setSearch(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(text);
    }, 400);
  }

  const { data, isLoading, isFetching, refetch } = useListPosts({
    limit: 30,
    search: debouncedSearch || null,
  });

  const posts: Post[] = data?.posts ?? [];

  const renderPost = useCallback(
    ({ item }: { item: Post }) => (
      <PostCard
        uri={item.uri}
        text={item.text ?? ""}
        author={item.authorDid}
        indexedAt={item.indexedAt}
        likes={item.likes ?? undefined}
        reposts={item.reposts ?? undefined}
      />
    ),
    []
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.searchBar,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: colors.radius,
            marginTop: isWeb ? 67 + 12 : 12,
          },
        ]}
      >
        <Ionicons name="search-outline" size={18} color={colors.mutedForeground} />
        <TextInput
          style={[
            styles.searchInput,
            { color: colors.foreground, fontFamily: "Inter_400Regular" },
          ]}
          value={search}
          onChangeText={handleSearchChange}
          placeholder="Search posts..."
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        {search.length > 0 && Platform.OS !== "ios" && (
          <TouchableOpacity
            onPress={() => {
              setSearch("");
              setDebouncedSearch("");
            }}
          >
            <Ionicons
              name="close-circle"
              size={18}
              color={colors.mutedForeground}
            />
          </TouchableOpacity>
        )}
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList<Post>
          data={posts}
          keyExtractor={(p) => p.uri}
          renderItem={renderPost}
          contentContainerStyle={[
            styles.list,
            {
              paddingBottom: isWeb ? 34 + 90 : insets.bottom + 90,
            },
          ]}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListEmptyComponent={
            <EmptyState
              icon="chatbubble-outline"
              title={debouncedSearch ? "No posts found" : "No posts yet"}
              description={
                debouncedSearch
                  ? `No posts match "${debouncedSearch}"`
                  : "Posts will appear here once the firehose is connected and feeds are active."
              }
            />
          }
          ListHeaderComponent={
            posts.length > 0 ? (
              <Text
                style={[
                  styles.countLabel,
                  {
                    color: colors.mutedForeground,
                    fontFamily: "Inter_400Regular",
                  },
                ]}
              >
                {data?.total != null
                  ? `${data.total.toLocaleString()} posts`
                  : `${posts.length} posts`}
              </Text>
            ) : null
          }
          refreshControl={
            <RefreshControl
              refreshing={isFetching && !isLoading}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          scrollEnabled={!!posts.length}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    padding: 0,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  list: {
    paddingHorizontal: 16,
  },
  countLabel: {
    fontSize: 13,
    marginBottom: 12,
  },
});
