import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import {
  useGetFeed,
  useDeleteFeed,
  useGetFeedPosts,
  useGetFeedKeywords,
  usePublishFeed,
} from "@workspace/api-client-react";
import type { PostsPage } from "@workspace/api-client-react";

import { useColors } from "@/hooks/useColors";
import { StatCard } from "@/components/StatCard";
import { PostCard } from "@/components/PostCard";
import { EmptyState } from "@/components/EmptyState";

type Post = NonNullable<PostsPage["posts"]>[number];

export default function FeedDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const feedId = Number(id);
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";

  const [tab, setTab] = useState<"overview" | "posts" | "keywords">("overview");

  const feed = useGetFeed(feedId);
  const feedPosts = useGetFeedPosts(feedId, { limit: 20 });
  const keywords = useGetFeedKeywords(feedId);
  const deleteFeed = useDeleteFeed();
  const publishFeed = usePublishFeed();

  const f = feed.data;
  const posts: Post[] = feedPosts.data?.posts ?? [];
  const kwds = keywords.data ?? [];

  function handleDelete() {
    Alert.alert(
      "Delete Feed",
      `Delete "${f?.displayName}"? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            deleteFeed.mutate(feedId, {
              onSuccess: () => {
                Haptics.notificationAsync(
                  Haptics.NotificationFeedbackType.Success
                );
                router.back();
              },
              onError: () => {
                Alert.alert("Error", "Could not delete feed.");
              },
            });
          },
        },
      ]
    );
  }

  function handlePublish() {
    Alert.alert(
      "Publish Feed",
      "Publish this feed to Bluesky? This will create or update the generator record.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Publish",
          onPress: () => {
            publishFeed.mutate(feedId, {
              onSuccess: () => {
                Haptics.notificationAsync(
                  Haptics.NotificationFeedbackType.Success
                );
                Alert.alert("Published", "Feed published to Bluesky successfully.");
                feed.refetch();
              },
              onError: () => {
                Alert.alert("Error", "Could not publish feed.");
              },
            });
          },
        },
      ]
    );
  }

  if (feed.isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!f) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <EmptyState
          icon="alert-circle-outline"
          title="Feed not found"
          description="This feed may have been deleted."
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: isWeb ? 34 + 20 : insets.bottom + 20,
          },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={feed.isFetching || feedPosts.isFetching}
            onRefresh={() => {
              feed.refetch();
              feedPosts.refetch();
              keywords.refetch();
            }}
            tintColor={colors.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.headerCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.cardBorder,
              borderRadius: colors.radius,
            },
          ]}
        >
          <View style={styles.headerTop}>
            <View style={styles.headerInfo}>
              <Text
                style={[
                  styles.feedName,
                  { color: colors.foreground, fontFamily: "Inter_700Bold" },
                ]}
              >
                {f.displayName}
              </Text>
              <Text
                style={[
                  styles.feedRecord,
                  {
                    color: colors.mutedForeground,
                    fontFamily: "Inter_400Regular",
                  },
                ]}
              >
                @{f.recordName}
              </Text>
            </View>
            <View
              style={[
                styles.statusBadge,
                {
                  backgroundColor: f.isActive
                    ? (colors.success as string) + "20"
                    : colors.muted,
                  borderRadius: 99,
                },
              ]}
            >
              <Text
                style={[
                  styles.statusText,
                  {
                    color: f.isActive ? colors.success : colors.mutedForeground,
                    fontFamily: "Inter_600SemiBold",
                  },
                ]}
              >
                {f.isActive ? "Active" : "Inactive"}
              </Text>
            </View>
          </View>

          {f.description ? (
            <Text
              style={[
                styles.description,
                {
                  color: colors.mutedForeground,
                  fontFamily: "Inter_400Regular",
                },
              ]}
            >
              {f.description}
            </Text>
          ) : null}

          <View style={styles.statsRow}>
            <StatCard
              label="Total Posts"
              value={f.postCount.toLocaleString()}
              accent
            />
          </View>

          {f.publishedAt && (
            <Text
              style={[
                styles.publishedAt,
                {
                  color: colors.mutedForeground,
                  fontFamily: "Inter_400Regular",
                },
              ]}
            >
              Published{" "}
              {new Date(f.publishedAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </Text>
          )}
        </View>

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[
              styles.actionBtn,
              {
                backgroundColor: colors.primary,
                borderRadius: colors.radius,
                opacity: publishFeed.isPending ? 0.6 : 1,
              },
            ]}
            onPress={handlePublish}
            disabled={publishFeed.isPending}
            activeOpacity={0.85}
          >
            {publishFeed.isPending ? (
              <ActivityIndicator color={colors.primaryForeground} size="small" />
            ) : (
              <Ionicons name="cloud-upload-outline" size={18} color={colors.primaryForeground} />
            )}
            <Text
              style={[
                styles.actionBtnText,
                {
                  color: colors.primaryForeground,
                  fontFamily: "Inter_600SemiBold",
                },
              ]}
            >
              Publish to Bluesky
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.actionBtnSecondary,
              {
                borderColor: colors.destructive,
                borderRadius: colors.radius,
              },
            ]}
            onPress={handleDelete}
            activeOpacity={0.85}
          >
            <Ionicons name="trash-outline" size={18} color={colors.destructive} />
          </TouchableOpacity>
        </View>

        <View
          style={[
            styles.tabBar,
            { borderBottomColor: colors.border },
          ]}
        >
          {(["overview", "posts", "keywords"] as const).map((t) => (
            <TouchableOpacity
              key={t}
              onPress={() => setTab(t)}
              style={[
                styles.tabItem,
                tab === t && {
                  borderBottomColor: colors.primary,
                  borderBottomWidth: 2,
                },
              ]}
            >
              <Text
                style={[
                  styles.tabLabel,
                  {
                    color:
                      tab === t ? colors.primary : colors.mutedForeground,
                    fontFamily:
                      tab === t ? "Inter_600SemiBold" : "Inter_400Regular",
                  },
                ]}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {tab === "overview" && (
          <View style={styles.tabContent}>
            <View
              style={[
                styles.infoCard,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.cardBorder,
                  borderRadius: colors.radius,
                },
              ]}
            >
              <InfoRow label="Record Name" value={f.recordName} colors={colors} />
              <InfoRow
                label="Created"
                value={new Date(f.createdAt).toLocaleDateString()}
                colors={colors}
              />
              <InfoRow
                label="Updated"
                value={new Date(f.updatedAt).toLocaleDateString()}
                colors={colors}
              />
              <InfoRow
                label="Published"
                value={f.publishedAt ? new Date(f.publishedAt).toLocaleDateString() : "Not published"}
                colors={colors}
              />
            </View>
          </View>
        )}

        {tab === "posts" && (
          <View style={styles.tabContent}>
            {feedPosts.isLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
            ) : posts.length === 0 ? (
              <EmptyState
                icon="chatbubble-outline"
                title="No posts indexed"
                description="Posts will appear here when the firehose matches keywords for this feed."
              />
            ) : (
              <View style={{ gap: 10 }}>
                {posts.map((p) => (
                  <PostCard
                    key={p.uri}
                    uri={p.uri}
                    text={p.text ?? ""}
                    author={p.authorDid}
                    indexedAt={p.indexedAt}
                    likes={p.likes ?? undefined}
                    reposts={p.reposts ?? undefined}
                  />
                ))}
              </View>
            )}
          </View>
        )}

        {tab === "keywords" && (
          <View style={styles.tabContent}>
            {keywords.isLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
            ) : kwds.length === 0 ? (
              <EmptyState
                icon="pricetag-outline"
                title="No keywords"
                description="Add keywords to this feed using the web dashboard."
              />
            ) : (
              <View style={styles.keywords}>
                {kwds.map((kw) => (
                  <View
                    key={kw.id}
                    style={[
                      styles.kwTag,
                      {
                        backgroundColor: colors.primary + "18",
                        borderRadius: 99,
                        borderColor: colors.primary + "40",
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.kwText,
                        { color: colors.primary, fontFamily: "Inter_500Medium" },
                      ]}
                    >
                      {kw.keyword}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function InfoRow({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View
      style={[
        styles.infoRow,
        { borderBottomColor: colors.border },
      ]}
    >
      <Text
        style={[
          styles.infoLabel,
          { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
        ]}
      >
        {label}
      </Text>
      <Text
        style={[
          styles.infoValue,
          { color: colors.foreground, fontFamily: "Inter_500Medium" },
        ]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 14,
  },
  headerCard: {
    padding: 16,
    borderWidth: 1,
    gap: 10,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  headerInfo: {
    flex: 1,
  },
  feedName: {
    fontSize: 20,
  },
  feedRecord: {
    fontSize: 13,
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 2,
  },
  statusText: {
    fontSize: 12,
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
  },
  statsRow: {
    flexDirection: "row",
  },
  publishedAt: {
    fontSize: 12,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 13,
    gap: 8,
  },
  actionBtnText: {
    fontSize: 15,
  },
  actionBtnSecondary: {
    width: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
  },
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: 1,
    marginTop: 4,
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabLabel: {
    fontSize: 14,
  },
  tabContent: {
    paddingTop: 4,
  },
  infoCard: {
    borderWidth: 1,
    overflow: "hidden",
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  infoLabel: {
    fontSize: 14,
  },
  infoValue: {
    fontSize: 14,
    flex: 1,
    textAlign: "right",
  },
  keywords: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingTop: 8,
  },
  kwTag: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
  },
  kwText: {
    fontSize: 14,
  },
});
