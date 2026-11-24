import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useRef, useState } from "react";
import { Platform, Text, View } from "react-native";
import { getVisualizeCardRpc, type VisualizeTimelineData } from "../shared/visualize";
import { mountVisualizeCard } from "./web";

function isDarkHex(color: string): boolean {
  const hex = color.trim().replace(/^#/, "");
  if (hex.length !== 6) return true;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
}

export function FanframeVisualizeCard({
  item,
  theme,
}: PluginTimelineItemProps<VisualizeTimelineData>) {
  const data = item.data;
  const isDark = isDarkHex(theme.colors.surface0);
  const fetchCard = useRpc(getVisualizeCardRpc);
  const [resolvedHtml, setResolvedHtml] = useState<string | null>(data.html ?? null);
  const [height, setHeight] = useState<number>(180);
  const hostRef = useRef<unknown>(null);

  useEffect(() => {
    if (data.html) {
      setResolvedHtml(data.html);
      return;
    }
    let cancelled = false;
    void fetchCard({ cardId: data.cardId }).then((res) => {
      if (!cancelled && res?.html) {
        setResolvedHtml(res.html);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [data.cardId, data.html, fetchCard]);

  useEffect(() => {
    if (Platform.OS !== "web" || !resolvedHtml) return;
    return mountVisualizeCard({
      host: hostRef.current,
      channel: data.cardId,
      html: resolvedHtml,
      isDark,
      colors: {
        background: theme.colors.surface0,
        foreground: theme.colors.foreground,
        muted: theme.colors.foregroundMuted,
        border: theme.colors.border,
        accent: theme.colors.accent,
      },
      onHeight: (nextHeight) => {
        if (nextHeight > 24 && nextHeight < 2400) {
          setHeight(Math.ceil(nextHeight));
        }
      },
    });
  }, [data.cardId, isDark, resolvedHtml, theme.colors]);

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        marginVertical: 8,
      }}
    >
      <View
        style={{
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
          backgroundColor: theme.colors.surface2,
        }}
      >
        <Text
          style={{
            color: theme.colors.foreground,
            fontSize: 13,
            fontWeight: "600",
          }}
        >
          {data.title}
        </Text>
      </View>

      {Platform.OS === "web" ? (
        <View
          ref={hostRef as never}
          style={{
            width: "100%",
            height,
            overflow: "hidden",
          }}
        />
      ) : (
        <View style={{ padding: 12 }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
            Interactive FanFrame visualization is available on Desktop / Web.
          </Text>
        </View>
      )}
    </View>
  );
}
