import React from "react";
import { StyleSheet, View, Text } from "react-native";
import { useColors } from "@/hooks/useColors";

interface BarData {
  label?: string;
  value: number;
}

interface MiniBarChartProps {
  data: BarData[];
  height?: number;
  color?: string;
}

export function MiniBarChart({ data, height = 80, color }: MiniBarChartProps) {
  const colors = useColors();
  const barColor = color ?? colors.primary;

  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <View style={[styles.container, { height }]}>
      <View style={styles.bars}>
        {data.map((item, i) => {
          const ratio = max > 0 ? item.value / max : 0;
          const barH = Math.max(ratio * (height - 20), ratio > 0 ? 3 : 1);

          return (
            <View key={i} style={styles.barWrapper}>
              <View
                style={[
                  styles.bar,
                  {
                    height: barH,
                    backgroundColor: barColor,
                    opacity: 0.3 + ratio * 0.7,
                    borderRadius: 3,
                  },
                ]}
              />
              {item.label && data.length <= 7 && (
                <Text
                  style={[
                    styles.label,
                    {
                      color: colors.mutedForeground,
                      fontFamily: "Inter_400Regular",
                    },
                  ]}
                  numberOfLines={1}
                >
                  {item.label}
                </Text>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
  },
  bars: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 3,
    paddingBottom: 18,
  },
  barWrapper: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 3,
  },
  bar: {
    width: "100%",
    minHeight: 1,
  },
  label: {
    fontSize: 10,
    position: "absolute",
    bottom: 0,
    textAlign: "center",
  },
});
