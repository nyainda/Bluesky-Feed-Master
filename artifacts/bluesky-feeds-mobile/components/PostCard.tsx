import React from "react";
import { StyleSheet, Text, View, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

interface PostCardProps {
  uri: string;
  text: string;
  author?: string;
  indexedAt?: string;
  likes?: number;
  reposts?: number;
}

export function PostCard({ uri, text, author, indexedAt, likes, reposts }: PostCardProps) {
  const colors = useColors();

  const handle = author || uri.split("/")[2] || "unknown";
  const shortHandle = handle.startsWith("did:") ? handle.slice(0, 16) + "…" : handle;

  const dateStr = indexedAt
    ? new Date(indexedAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "";

  return (
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
      <View style={styles.header}>
        <View
          style={[
            styles.avatar,
            { backgroundColor: colors.primary + "20", borderRadius: 99 },
          ]}
        >
          <Ionicons name="person" size={14} color={colors.primary} />
        </View>
        <Text
          style={[
            styles.author,
            { color: colors.foreground, fontFamily: "Inter_600SemiBold" },
          ]}
          numberOfLines={1}
        >
          @{shortHandle}
        </Text>
        {dateStr ? (
          <Text
            style={[
              styles.date,
              { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
            ]}
          >
            {dateStr}
          </Text>
        ) : null}
      </View>

      <Text
        style={[
          styles.text,
          { color: colors.foreground, fontFamily: "Inter_400Regular" },
        ]}
        numberOfLines={4}
      >
        {text}
      </Text>

      {(likes !== undefined || reposts !== undefined) && (
        <View style={styles.stats}>
          {likes !== undefined && (
            <View style={styles.statItem}>
              <Ionicons name="heart-outline" size={13} color={colors.mutedForeground} />
              <Text
                style={[
                  styles.statText,
                  { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
                ]}
              >
                {likes}
              </Text>
            </View>
          )}
          {reposts !== undefined && (
            <View style={styles.statItem}>
              <Ionicons name="repeat-outline" size={13} color={colors.mutedForeground} />
              <Text
                style={[
                  styles.statText,
                  { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
                ]}
              >
                {reposts}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    borderWidth: 1,
    gap: 10,
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  avatar: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  author: {
    fontSize: 13,
    flex: 1,
  },
  date: {
    fontSize: 12,
  },
  text: {
    fontSize: 14,
    lineHeight: 20,
  },
  stats: {
    flexDirection: "row",
    gap: 14,
    marginTop: 2,
  },
  statItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  statText: {
    fontSize: 12,
  },
});
