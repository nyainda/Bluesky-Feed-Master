import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import {
  useListFeeds,
  useCreateFeed,
  type Feed,
} from "@workspace/api-client-react";

import { useColors } from "@/hooks/useColors";
import { FeedCard } from "@/components/FeedCard";
import { EmptyState } from "@/components/EmptyState";

interface CreateFeedForm {
  displayName: string;
  recordName: string;
  description: string;
}

export default function FeedsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isWeb = Platform.OS === "web";

  const { data: feeds = [], isLoading, isFetching, refetch } = useListFeeds();
  const createFeed = useCreateFeed();

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateFeedForm>({
    displayName: "",
    recordName: "",
    description: "",
  });

  function handleCreate() {
    if (!form.displayName.trim() || !form.recordName.trim()) {
      Alert.alert("Missing fields", "Display name and record name are required.");
      return;
    }
    createFeed.mutate(
      {
        displayName: form.displayName.trim(),
        recordName: form.recordName.trim(),
        description: form.description.trim() || null,
      },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setShowCreate(false);
          setForm({ displayName: "", recordName: "", description: "" });
          refetch();
        },
        onError: (e) => {
          Alert.alert("Error", "Could not create feed. Please try again.");
        },
      }
    );
  }

  function openFeed(feed: Feed) {
    router.push(`/feed/${feed.id}`);
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList<Feed>
        data={feeds}
        keyExtractor={(f) => String(f.id)}
        renderItem={({ item }) => (
          <FeedCard feed={item} onPress={() => openFeed(item)} />
        )}
        contentContainerStyle={[
          styles.list,
          {
            paddingTop: isWeb ? 67 + 16 : 16,
            paddingBottom: isWeb ? 34 + 90 : insets.bottom + 90,
          },
        ]}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <EmptyState
              icon="layers-outline"
              title="No feeds yet"
              description="Create your first feed to start indexing Bluesky posts."
            />
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={isFetching && !isLoading}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
        scrollEnabled={!!feeds.length}
        showsVerticalScrollIndicator={false}
      />

      <TouchableOpacity
        style={[
          styles.fab,
          {
            backgroundColor: colors.primary,
            borderRadius: 99,
            bottom: isWeb ? 34 + 84 + 16 : insets.bottom + 84 + 16,
          },
        ]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setShowCreate(true);
        }}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={28} color={colors.primaryForeground} />
      </TouchableOpacity>

      <Modal
        visible={showCreate}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setShowCreate(false)}
      >
        <View
          style={[
            styles.modalContainer,
            { backgroundColor: colors.background },
          ]}
        >
          <View style={styles.modalHeader}>
            <Text
              style={[
                styles.modalTitle,
                { color: colors.foreground, fontFamily: "Inter_700Bold" },
              ]}
            >
              New Feed
            </Text>
            <TouchableOpacity onPress={() => setShowCreate(false)}>
              <Ionicons name="close" size={24} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          <View style={styles.form}>
            <View>
              <Text
                style={[
                  styles.fieldLabel,
                  {
                    color: colors.mutedForeground,
                    fontFamily: "Inter_500Medium",
                  },
                ]}
              >
                Display Name *
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    color: colors.foreground,
                    borderRadius: colors.radius,
                    fontFamily: "Inter_400Regular",
                  },
                ]}
                value={form.displayName}
                onChangeText={(v) => setForm((f) => ({ ...f, displayName: v }))}
                placeholder="My Tech Feed"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="words"
              />
            </View>

            <View>
              <Text
                style={[
                  styles.fieldLabel,
                  {
                    color: colors.mutedForeground,
                    fontFamily: "Inter_500Medium",
                  },
                ]}
              >
                Record Name *
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    color: colors.foreground,
                    borderRadius: colors.radius,
                    fontFamily: "Inter_400Regular",
                  },
                ]}
                value={form.recordName}
                onChangeText={(v) =>
                  setForm((f) => ({
                    ...f,
                    recordName: v.toLowerCase().replace(/\s+/g, "-"),
                  }))
                }
                placeholder="my-tech-feed"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text
                style={[
                  styles.fieldHint,
                  {
                    color: colors.mutedForeground,
                    fontFamily: "Inter_400Regular",
                  },
                ]}
              >
                Used in the Bluesky URI. Letters, numbers, hyphens only.
              </Text>
            </View>

            <View>
              <Text
                style={[
                  styles.fieldLabel,
                  {
                    color: colors.mutedForeground,
                    fontFamily: "Inter_500Medium",
                  },
                ]}
              >
                Description
              </Text>
              <TextInput
                style={[
                  styles.input,
                  styles.textarea,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    color: colors.foreground,
                    borderRadius: colors.radius,
                    fontFamily: "Inter_400Regular",
                  },
                ]}
                value={form.description}
                onChangeText={(v) =>
                  setForm((f) => ({ ...f, description: v }))
                }
                placeholder="A feed about..."
                placeholderTextColor={colors.mutedForeground}
                multiline
                numberOfLines={3}
              />
            </View>

            <TouchableOpacity
              style={[
                styles.createBtn,
                {
                  backgroundColor: colors.primary,
                  borderRadius: colors.radius,
                  opacity: createFeed.isPending ? 0.6 : 1,
                },
              ]}
              onPress={handleCreate}
              disabled={createFeed.isPending}
              activeOpacity={0.85}
            >
              {createFeed.isPending ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text
                  style={[
                    styles.createBtnText,
                    {
                      color: colors.primaryForeground,
                      fontFamily: "Inter_600SemiBold",
                    },
                  ]}
                >
                  Create Feed
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  list: {
    paddingHorizontal: 16,
    gap: 0,
  },
  loadingWrap: {
    paddingTop: 60,
    alignItems: "center",
  },
  fab: {
    position: "absolute",
    right: 20,
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
      },
      android: { elevation: 6 },
    }),
  },
  modalContainer: {
    flex: 1,
    padding: 24,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 22,
  },
  form: {
    gap: 20,
  },
  fieldLabel: {
    fontSize: 13,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  textarea: {
    height: 80,
    textAlignVertical: "top",
    paddingTop: 12,
  },
  fieldHint: {
    fontSize: 12,
    marginTop: 5,
  },
  createBtn: {
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 8,
  },
  createBtnText: {
    fontSize: 16,
  },
});
