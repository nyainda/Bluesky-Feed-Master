import React from "react";
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useGetStatsOverview,
  useGetFirehoseStatus,
  useGetTopFeeds,
  useGet7DayActivity,
  useGetBlueskyProfile,
} from "@workspace/api-client-react";

import { useColors } from "@/hooks/useColors";
import { StatCard } from "@/components/StatCard";
import { MiniBarChart } from "@/components/MiniBarChart";
import { EmptyState } from "@/components/EmptyState";

function SectionHeader({ title }: { title: string }) {
  const colors = useColors();
  return (
    <Text
      style={[
        styles.sectionHeader,
        { color: colors.foreground, fontFamily: "Inter_600SemiBold" },
      ]}
    >
      {title}
    </Text>
  );
}

export default function DashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";

  const overview = useGetStatsOverview();
  const firehose = useGetFirehoseStatus();
  const topFeeds = useGetTopFeeds();
  const activity = useGet7DayActivity();
  const profile = useGetBlueskyProfile();

  const isLoading =
    overview.isLoading &&
    firehose.isLoading &&
    topFeeds.isLoading &&
    activity.isLoading;

  function handleRefresh() {
    overview.refetch();
    firehose.refetch();
    topFeeds.refetch();
    activity.refetch();
    profile.refetch();
  }

  const isRefreshing =
    overview.isFetching ||
    firehose.isFetching ||
    topFeeds.isFetching ||
    activity.isFetching;

  const stats = overview.data;
  const fire = firehose.data;
  const feeds = topFeeds.data ?? [];
  const days = (activity.data ?? []).slice(-7);
  const prof = profile.data;

  const chartData = days.map((d) => ({
    label: new Date(d.day).toLocaleDateString(undefined, { weekday: "narrow" }),
    value: d.count,
  }));

  if (isLoading) {
    return (
      <View
        style={[
          styles.center,
          {
            backgroundColor: colors.background,
            paddingTop: isWeb ? 67 : insets.top,
          },
        ]}
      >
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.container,
        {
          paddingTop: isWeb ? 67 + 16 : 16,
          paddingBottom: isWeb ? 34 + 80 : insets.bottom + 80,
        },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
          tintColor={colors.primary}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      {prof && (
        <View
          style={[
            styles.profileBanner,
            {
              backgroundColor: colors.card,
              borderColor: colors.cardBorder,
              borderRadius: colors.radius,
            },
          ]}
        >
          <View
            style={[
              styles.profileAvatar,
              { backgroundColor: colors.primary + "20", borderRadius: 99 },
            ]}
          >
            <Text
              style={[
                styles.profileInitial,
                { color: colors.primary, fontFamily: "Inter_700Bold" },
              ]}
            >
              {(prof.handle ?? "?")[0].toUpperCase()}
            </Text>
          </View>
          <View style={styles.profileInfo}>
            <Text
              style={[
                styles.profileHandle,
                { color: colors.foreground, fontFamily: "Inter_600SemiBold" },
              ]}
            >
              @{prof.handle}
            </Text>
            {prof.displayName ? (
              <Text
                style={[
                  styles.profileName,
                  {
                    color: colors.mutedForeground,
                    fontFamily: "Inter_400Regular",
                  },
                ]}
              >
                {prof.displayName}
              </Text>
            ) : null}
          </View>
          <View style={styles.profileStats}>
            <Text
              style={[
                styles.profileStatVal,
                { color: colors.foreground, fontFamily: "Inter_700Bold" },
              ]}
            >
              {(prof.followersCount ?? 0).toLocaleString()}
            </Text>
            <Text
              style={[
                styles.profileStatLabel,
                {
                  color: colors.mutedForeground,
                  fontFamily: "Inter_400Regular",
                },
              ]}
            >
              followers
            </Text>
          </View>
        </View>
      )}

      <SectionHeader title="Overview" />
      <View style={styles.statsGrid}>
        <StatCard
          label="Total Posts"
          value={(stats?.totalPosts ?? 0).toLocaleString()}
          sub="indexed"
          accent
        />
        <StatCard
          label="Active Feeds"
          value={stats?.activeFeeds ?? 0}
          sub={`of ${stats?.totalFeeds ?? 0} total`}
        />
      </View>
      <View style={[styles.statsGrid, { marginTop: 10 }]}>
        <StatCard
          label="Firehose"
          value={fire?.connected ? "Online" : "Offline"}
          sub={fire ? `${(fire.eventsPerSecond ?? 0).toFixed(1)} ev/s` : undefined}
          dot={fire?.connected ? "green" : "red"}
        />
        <StatCard
          label="Posts / Hour"
          value={(stats?.postsPerHour ?? 0).toLocaleString()}
          sub="avg last 24h"
        />
      </View>

      {chartData.length > 0 && (
        <>
          <SectionHeader title="7-Day Activity" />
          <View
            style={[
              styles.chartCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.cardBorder,
                borderRadius: colors.radius,
              },
            ]}
          >
            <MiniBarChart data={chartData} height={100} color={colors.primary} />
          </View>
        </>
      )}

      {feeds.length > 0 && (
        <>
          <SectionHeader title="Top Feeds" />
          <View
            style={[
              styles.topFeedsCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.cardBorder,
                borderRadius: colors.radius,
              },
            ]}
          >
            {feeds.map((f, i) => (
              <View
                key={f.feedId ?? i}
                style={[
                  styles.feedRow,
                  i < feeds.length - 1 && {
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                  },
                ]}
              >
                <View
                  style={[
                    styles.rankBadge,
                    { backgroundColor: colors.muted, borderRadius: 99 },
                  ]}
                >
                  <Text
                    style={[
                      styles.rankText,
                      {
                        color: colors.mutedForeground,
                        fontFamily: "Inter_600SemiBold",
                      },
                    ]}
                  >
                    {i + 1}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.feedName,
                    {
                      color: colors.foreground,
                      fontFamily: "Inter_500Medium",
                    },
                  ]}
                  numberOfLines={1}
                >
                  {f.displayName}
                </Text>
                <Text
                  style={[
                    styles.feedPosts,
                    {
                      color: colors.primary,
                      fontFamily: "Inter_600SemiBold",
                    },
                  ]}
                >
                  {f.postCount.toLocaleString()}
                </Text>
              </View>
            ))}
          </View>
        </>
      )}

      {!stats && !overview.isLoading && (
        <EmptyState
          icon="bar-chart-outline"
          title="No data yet"
          description="Stats will appear once the API server is connected and data is indexed."
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  container: {
    paddingHorizontal: 16,
    gap: 12,
  },
  profileBanner: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderWidth: 1,
    gap: 12,
    marginBottom: 4,
  },
  profileAvatar: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  profileInitial: {
    fontSize: 18,
  },
  profileInfo: {
    flex: 1,
  },
  profileHandle: {
    fontSize: 14,
  },
  profileName: {
    fontSize: 12,
    marginTop: 1,
  },
  profileStats: {
    alignItems: "flex-end",
  },
  profileStatVal: {
    fontSize: 18,
  },
  profileStatLabel: {
    fontSize: 11,
  },
  sectionHeader: {
    fontSize: 13,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginTop: 8,
    marginBottom: 2,
  },
  statsGrid: {
    flexDirection: "row",
    gap: 10,
  },
  chartCard: {
    padding: 16,
    borderWidth: 1,
  },
  topFeedsCard: {
    borderWidth: 1,
    overflow: "hidden",
  },
  feedRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 10,
  },
  rankBadge: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  rankText: {
    fontSize: 12,
  },
  feedName: {
    flex: 1,
    fontSize: 14,
  },
  feedPosts: {
    fontSize: 14,
  },
});
