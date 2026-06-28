import React from "react";
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  useHealthCheck,
  useGetFirehoseStatus,
  useGetBlueskyProfile,
  useGetStatsOverview,
} from "@workspace/api-client-react";

import { useColors } from "@/hooks/useColors";

function SettingRow({
  icon,
  label,
  value,
  dot,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  dot?: "green" | "yellow" | "red";
}) {
  const colors = useColors();

  const dotColor =
    dot === "green"
      ? colors.success
      : dot === "yellow"
      ? colors.warning
      : dot === "red"
      ? colors.destructive
      : undefined;

  return (
    <View
      style={[
        styles.row,
        { borderBottomColor: colors.border },
      ]}
    >
      <View
        style={[
          styles.rowIcon,
          {
            backgroundColor: colors.muted,
            borderRadius: colors.radius - 2,
          },
        ]}
      >
        <Ionicons name={icon} size={18} color={colors.mutedForeground} />
      </View>
      <Text
        style={[
          styles.rowLabel,
          { color: colors.foreground, fontFamily: "Inter_500Medium" },
        ]}
      >
        {label}
      </Text>
      <View style={styles.rowRight}>
        {dot && (
          <View style={[styles.dot, { backgroundColor: dotColor }]} />
        )}
        {value ? (
          <Text
            style={[
              styles.rowValue,
              { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
            ]}
            numberOfLines={1}
          >
            {value}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={styles.section}>
      <Text
        style={[
          styles.sectionTitle,
          { color: colors.mutedForeground, fontFamily: "Inter_500Medium" },
        ]}
      >
        {title.toUpperCase()}
      </Text>
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.cardBorder,
            borderRadius: colors.radius,
          },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";

  const health = useHealthCheck();
  const firehose = useGetFirehoseStatus();
  const profile = useGetBlueskyProfile();
  const overview = useGetStatsOverview();

  function handleRefresh() {
    health.refetch();
    firehose.refetch();
    profile.refetch();
    overview.refetch();
  }

  const isRefreshing =
    health.isFetching ||
    firehose.isFetching ||
    profile.isFetching ||
    overview.isFetching;

  const fire = firehose.data;
  const prof = profile.data;
  const stats = overview.data;
  const isHealthy = health.data?.status === "ok";

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.container,
        {
          paddingTop: isWeb ? 67 + 16 : 16,
          paddingBottom: isWeb ? 34 + 90 : insets.bottom + 90,
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
      <SectionCard title="System Status">
        <SettingRow
          icon="pulse-outline"
          label="API Server"
          value={health.isLoading ? "checking…" : isHealthy ? "Healthy" : "Unreachable"}
          dot={health.isLoading ? "yellow" : isHealthy ? "green" : "red"}
        />
        <SettingRow
          icon="wifi-outline"
          label="Firehose"
          value={
            firehose.isLoading
              ? "checking…"
              : fire?.connected
              ? `Online · ${(fire.eventsPerSecond ?? 0).toFixed(1)} ev/s`
              : "Offline"
          }
          dot={
            firehose.isLoading ? "yellow" : fire?.connected ? "green" : "red"
          }
        />
        <SettingRow
          icon="document-text-outline"
          label="Indexed Posts"
          value={(stats?.totalPosts ?? 0).toLocaleString()}
        />
        <SettingRow
          icon="layers-outline"
          label="Total Feeds"
          value={String(stats?.totalFeeds ?? 0)}
        />
      </SectionCard>

      {prof && (
        <SectionCard title="Bluesky Profile">
          <SettingRow
            icon="person-outline"
            label="Handle"
            value={`@${prof.handle}`}
          />
          {prof.displayName ? (
            <SettingRow
              icon="text-outline"
              label="Display Name"
              value={prof.displayName}
            />
          ) : null}
          <SettingRow
            icon="people-outline"
            label="Followers"
            value={(prof.followersCount ?? 0).toLocaleString()}
          />
          <SettingRow
            icon="person-add-outline"
            label="Following"
            value={(prof.followsCount ?? 0).toLocaleString()}
          />
          {prof.postsCount != null && (
            <SettingRow
              icon="chatbubble-outline"
              label="Posts"
              value={(prof.postsCount ?? 0).toLocaleString()}
            />
          )}
        </SectionCard>
      )}

      {!prof && !profile.isLoading && (
        <SectionCard title="Bluesky Profile">
          <View style={styles.noProfile}>
            <Ionicons
              name="person-circle-outline"
              size={40}
              color={colors.mutedForeground}
            />
            <Text
              style={[
                styles.noProfileText,
                {
                  color: colors.mutedForeground,
                  fontFamily: "Inter_400Regular",
                },
              ]}
            >
              No Bluesky profile configured. Set the publisher DID in your API
              server environment variables.
            </Text>
          </View>
        </SectionCard>
      )}

      <SectionCard title="About">
        <SettingRow
          icon="phone-portrait-outline"
          label="Platform"
          value={Platform.OS}
        />
        <SettingRow icon="code-slash-outline" label="App" value="FeedForge Mobile" />
      </SectionCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    gap: 4,
  },
  section: {
    gap: 6,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 12,
    letterSpacing: 0.6,
    marginLeft: 4,
    marginBottom: 4,
  },
  card: {
    borderWidth: 1,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowIcon: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
  },
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: 160,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  rowValue: {
    fontSize: 14,
    textAlign: "right",
  },
  noProfile: {
    padding: 24,
    alignItems: "center",
    gap: 10,
  },
  noProfileText: {
    fontSize: 13,
    textAlign: "center",
    lineHeight: 19,
  },
});
