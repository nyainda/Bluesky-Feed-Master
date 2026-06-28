import React from "react";
import {
  StyleSheet,
  Text,
  View,
  Platform,
} from "react-native";
import { useColors } from "@/hooks/useColors";

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
  dot?: "green" | "yellow" | "red";
}

export function StatCard({ label, value, sub, accent, dot }: StatCardProps) {
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
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.cardBorder,
          borderRadius: colors.radius,
        },
        accent && { borderColor: colors.primary, borderWidth: 1.5 },
      ]}
    >
      <View style={styles.top}>
        <Text
          style={[
            styles.label,
            { color: colors.mutedForeground, fontFamily: "Inter_500Medium" },
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
        {dot && (
          <View style={[styles.dot, { backgroundColor: dotColor }]} />
        )}
      </View>
      <Text
        style={[
          styles.value,
          {
            color: accent ? colors.primary : colors.foreground,
            fontFamily: "Inter_700Bold",
          },
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      {sub && (
        <Text
          style={[
            styles.sub,
            { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
          ]}
          numberOfLines={1}
        >
          {sub}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 140,
    padding: 16,
    borderWidth: 1,
    gap: 4,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
      },
      android: { elevation: 2 },
    }),
  },
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  label: {
    fontSize: 12,
    flex: 1,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 6,
  },
  value: {
    fontSize: 28,
    letterSpacing: -0.5,
  },
  sub: {
    fontSize: 12,
  },
});
