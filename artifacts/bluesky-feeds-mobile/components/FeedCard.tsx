import React from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Feed } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";

interface FeedCardProps {
  feed: Feed;
  onPress?: () => void;
}

export function FeedCard({ feed, onPress }: FeedCardProps) {
  const colors = useColors();

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.cardBorder,
          borderRadius: colors.radius,
        },
      ]}
    >
      <View style={styles.left}>
        <View
          style={[
            styles.iconWrap,
            {
              backgroundColor: feed.isActive
                ? colors.primary + "18"
                : colors.muted,
              borderRadius: colors.radius - 2,
            },
          ]}
        >
          <Ionicons
            name="layers"
            size={20}
            color={feed.isActive ? colors.primary : colors.mutedForeground}
          />
        </View>
        <View style={styles.info}>
          <Text
            style={[
              styles.name,
              {
                color: colors.foreground,
                fontFamily: "Inter_600SemiBold",
              },
            ]}
            numberOfLines={1}
          >
            {feed.displayName}
          </Text>
          <Text
            style={[
              styles.record,
              {
                color: colors.mutedForeground,
                fontFamily: "Inter_400Regular",
              },
            ]}
            numberOfLines={1}
          >
            @{feed.recordName}
          </Text>
        </View>
      </View>

      <View style={styles.right}>
        <View style={styles.meta}>
          <Text
            style={[
              styles.count,
              { color: colors.foreground, fontFamily: "Inter_600SemiBold" },
            ]}
          >
            {feed.postCount.toLocaleString()}
          </Text>
          <Text
            style={[
              styles.countLabel,
              { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
            ]}
          >
            posts
          </Text>
        </View>
        <View
          style={[
            styles.badge,
            {
              backgroundColor: feed.isActive
                ? colors.success + "20"
                : colors.muted,
              borderRadius: 99,
            },
          ]}
        >
          <Text
            style={[
              styles.badgeText,
              {
                color: feed.isActive ? colors.success : colors.mutedForeground,
                fontFamily: "Inter_500Medium",
              },
            ]}
          >
            {feed.isActive ? "Active" : "Inactive"}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderWidth: 1,
    gap: 12,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04,
        shadowRadius: 3,
      },
      android: { elevation: 1 },
    }),
  },
  left: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minWidth: 0,
  },
  iconWrap: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: 15,
  },
  record: {
    fontSize: 12,
    marginTop: 2,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  meta: {
    alignItems: "flex-end",
  },
  count: {
    fontSize: 14,
  },
  countLabel: {
    fontSize: 11,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 11,
  },
});
