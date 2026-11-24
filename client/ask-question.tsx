import {
  type PluginClientContext,
  type PluginTimelineItemProps,
  useAgent,
  usePaseo,
  useWorkspace,
} from "@getpaseo/plugin/client";
import { Icon, Markdown, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  ASK_QUESTION_TIMELINE_KIND,
  ASK_QUESTION_TIMELINE_VERSION,
  type AskQuestionItem,
  type AskQuestionTimelineData,
  type QuestionAnswerDraft,
  askQuestionTimelineDataSchema,
  formatAskQuestionReply,
  parseAskQuestionText,
} from "../shared/ask-question";
import { readFanframePrefs, subscribeFanframePrefs } from "./web";

function hasAnswer(draft: QuestionAnswerDraft | undefined): boolean {
  if (!draft) return false;
  return draft.selectedIndices.length > 0 || draft.customText.trim().length > 0;
}

function findNextUnanswered(
  count: number,
  currentIndex: number,
  drafts: readonly QuestionAnswerDraft[],
): number | null {
  for (let offset = 1; offset < count; offset++) {
    const idx = (currentIndex + offset) % count;
    if (!hasAnswer(drafts[idx])) return idx;
  }
  return null;
}

function AskQuestionCard({
  agentId,
  item,
  timestamp,
  theme,
  layout,
}: PluginTimelineItemProps<AskQuestionTimelineData>) {
  const c = theme.colors;
  const compact = layout.compact;
  const paseo = usePaseo();
  const toast = useToast();
  const { questions, rawText } = item.data;

  const [enabled, setEnabled] = useState<boolean>(() => readFanframePrefs().askQuestionPanel);
  useEffect(() => {
    return subscribeFanframePrefs(() => {
      setEnabled(readFanframePrefs().askQuestionPanel);
    });
  }, []);

  const agentMeta = useAgent(agentId, (agent) => ({
    workspaceId: agent.workspaceId,
    lastActivityAt: agent.lastActivityAt,
  }));
  const lastPromptAt = useWorkspace(agentMeta?.workspaceId ?? "", (ws) => ws.lastPromptAt);
  const autoAnswered = useMemo(() => {
    if (!lastPromptAt || !agentMeta?.lastActivityAt) return false;
    const promptMs = Date.parse(lastPromptAt);
    const activityMs = Date.parse(agentMeta.lastActivityAt);
    const itemMs = timestamp instanceof Date ? timestamp.getTime() : Date.parse(String(timestamp));
    return (
      Number.isFinite(promptMs) &&
      Number.isFinite(activityMs) &&
      Number.isFinite(itemMs) &&
      promptMs > itemMs + 2000 &&
      activityMs > itemMs + 2000
    );
  }, [lastPromptAt, agentMeta?.lastActivityAt, timestamp]);

  const [activeIndex, setActiveIndex] = useState(0);
  const [drafts, setDrafts] = useState<QuestionAnswerDraft[]>(() =>
    questions.map(() => ({ selectedIndices: [], customText: "" })),
  );
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [reopened, setReopened] = useState(false);
  const [hoveredOpt, setHoveredOpt] = useState<string | null>(null);
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync draft array length if streaming updates add more questions.
  useEffect(() => {
    setDrafts((prev) => {
      if (prev.length === questions.length) return prev;
      return questions.map((_, idx) => prev[idx] ?? { selectedIndices: [], customText: "" });
    });
    setActiveIndex((prev) => (prev < questions.length ? prev : Math.max(0, questions.length - 1)));
  }, [questions.length]);

  useEffect(() => {
    return () => {
      if (advanceTimerRef.current !== null) clearTimeout(advanceTimerRef.current);
    };
  }, []);

  if (!enabled) {
    return <Markdown>{rawText}</Markdown>;
  }

  const isAnsweredCard = (submitted || autoAnswered) && !reopened;
  const answeredCount = drafts.filter(hasAnswer).length;
  const allRecommendedAvailable =
    questions.length > 1 && questions.every((q) => q.options.some((opt) => opt.recommended));

  const currentQuestion: AskQuestionItem | undefined = questions[activeIndex] ?? questions[0];
  const currentDraft: QuestionAnswerDraft = drafts[activeIndex] ?? {
    selectedIndices: [],
    customText: "",
  };

  const handleToggleOption = (qIndex: number, optIndex: number, multiSelect: boolean) => {
    if (sending) return;
    if (advanceTimerRef.current !== null) {
      clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }

    const nextDrafts = drafts.map((entry, idx) => {
      if (idx !== qIndex) return entry;
      if (multiSelect) {
        const exists = entry.selectedIndices.includes(optIndex);
        return {
          ...entry,
          selectedIndices: exists
            ? entry.selectedIndices.filter((v) => v !== optIndex)
            : [...entry.selectedIndices, optIndex],
        };
      }
      const same = entry.selectedIndices.length === 1 && entry.selectedIndices[0] === optIndex;
      return {
        ...entry,
        selectedIndices: same ? [] : [optIndex],
      };
    });
    setDrafts(nextDrafts);

    // Auto-advance to the next unanswered question on single-select.
    if (!multiSelect && questions.length > 1) {
      const nowSelected = nextDrafts[qIndex]?.selectedIndices.includes(optIndex) ?? false;
      if (nowSelected) {
        const nextIdx = findNextUnanswered(questions.length, qIndex, nextDrafts);
        if (nextIdx !== null) {
          advanceTimerRef.current = setTimeout(() => {
            advanceTimerRef.current = null;
            setActiveIndex(nextIdx);
          }, 150);
        }
      }
    }
  };

  const handleSelectAllRecommended = () => {
    if (sending) return;
    setDrafts((prev) =>
      questions.map((q, idx) => {
        const rec = q.options.find((opt) => opt.recommended);
        const existing = prev[idx] ?? { selectedIndices: [], customText: "" };
        return rec ? { ...existing, selectedIndices: [rec.index] } : existing;
      }),
    );
  };

  const handleCustomChange = (qIndex: number, text: string) => {
    setDrafts((prev) =>
      prev.map((entry, idx) => (idx === qIndex ? { ...entry, customText: text } : entry)),
    );
  };

  const handleSubmit = async () => {
    if (sending) return;
    const replyText = formatAskQuestionReply(questions, drafts);
    if (!replyText.trim()) return;
    setSending(true);
    try {
      await paseo.agents.ref(agentId).send(replyText);
      setSubmitted(true);
      setReopened(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "发送回答失败");
    } finally {
      setSending(false);
    }
  };

  // Collapsed quiet summary once answered (unless user chooses to reopen).
  if (isAnsweredCard) {
    return (
      <View
        testID="fanframe-ask-question-answered"
        style={{
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.surface1,
          padding: compact ? 10 : 12,
          gap: 8,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
            <Icon name="CircleCheck" size={14} color={c.foregroundMuted} />
            <Text style={{ color: c.foregroundMuted, fontSize: 12, fontWeight: "600" }}>
              AI 提问（{questions.length} 题 · 已回复）
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="展开提问卡片"
            onPress={() => setReopened(true)}
            onHoverIn={() => setHoveredBtn("reopen")}
            onHoverOut={() => setHoveredBtn(null)}
            style={{
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderWidth: 1,
              borderColor: hoveredBtn === "reopen" ? c.accent : c.border,
              backgroundColor: c.surface0,
            }}
          >
            <Text
              style={{
                color: hoveredBtn === "reopen" ? c.foreground : c.foregroundMuted,
                fontSize: 11,
              }}
            >
              展开选项
            </Text>
          </Pressable>
        </View>
        <View style={{ gap: 4 }}>
          {questions.map((q, idx) => (
            <Text
              key={`summary-${idx}`}
              style={{ color: c.foreground, fontSize: 13, lineHeight: 19 }}
            >
              {questions.length > 1 ? `${idx + 1}. ` : ""}
              {q.question}
            </Text>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View
      testID="fanframe-ask-question-card"
      style={{
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface1,
        padding: compact ? 12 : 14,
        gap: compact ? 10 : 12,
      }}
    >
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
          <Icon name="HelpCircle" size={14} color={c.accent} />
          <Text style={{ color: c.foreground, fontSize: 13, fontWeight: "600" }}>
            AI 提问
          </Text>
          {questions.length > 1 ? (
            <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>
              {answeredCount}/{questions.length}
            </Text>
          ) : null}
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {allRecommendedAvailable ? (
            <Pressable
              testID="fanframe-ask-question-recommend-all"
              accessibilityRole="button"
              accessibilityLabel="全选推荐项"
              onPress={handleSelectAllRecommended}
              onHoverIn={() => setHoveredBtn("rec-all")}
              onHoverOut={() => setHoveredBtn(null)}
              disabled={sending}
              style={{
                paddingHorizontal: 8,
                paddingVertical: 4,
                borderWidth: 1,
                borderColor: hoveredBtn === "rec-all" ? c.accent : c.border,
                backgroundColor: c.surface0,
              }}
            >
              <Text
                style={{
                  color: hoveredBtn === "rec-all" ? c.foreground : c.foregroundMuted,
                  fontSize: 11,
                  fontWeight: "500",
                }}
              >
                全选推荐
              </Text>
            </Pressable>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showRaw ? "切回点选面板" : "查看原始文本"}
            onPress={() => setShowRaw((v) => !v)}
            onHoverIn={() => setHoveredBtn("raw")}
            onHoverOut={() => setHoveredBtn(null)}
            style={{
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderWidth: 1,
              borderColor: hoveredBtn === "raw" ? c.accent : c.border,
              backgroundColor: c.surface0,
            }}
          >
            <Text
              style={{
                color: hoveredBtn === "raw" ? c.foreground : c.foregroundMuted,
                fontSize: 11,
              }}
            >
              {showRaw ? "点选" : "原文"}
            </Text>
          </Pressable>
        </View>
      </View>

      {showRaw ? (
        <View style={{ paddingTop: 2 }}>
          <Markdown>{rawText}</Markdown>
        </View>
      ) : (
        <>
          {/* Multi-question step tabs */}
          {questions.length > 1 ? (
            <View
              testID="fanframe-ask-question-tabs"
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 6,
              }}
            >
              {questions.map((_, idx) => {
                const active = idx === activeIndex;
                const done = hasAnswer(drafts[idx]);
                const tabKey = `tab-${idx}`;
                return (
                  <Pressable
                    key={tabKey}
                    testID={`fanframe-ask-question-tab-${idx}`}
                    accessibilityRole="button"
                    accessibilityLabel={`问题 ${idx + 1}`}
                    onPress={() => setActiveIndex(idx)}
                    onHoverIn={() => setHoveredBtn(tabKey)}
                    onHoverOut={() => setHoveredBtn(null)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 5,
                      paddingHorizontal: 9,
                      paddingVertical: 4,
                      borderWidth: 1,
                      borderColor: active
                        ? c.accent
                        : hoveredBtn === tabKey
                          ? c.foregroundMuted
                          : c.border,
                      backgroundColor: active ? c.surface2 : c.surface0,
                    }}
                  >
                    <Text
                      style={{
                        color: active ? c.foreground : c.foregroundMuted,
                        fontSize: 12,
                        fontWeight: active ? "600" : "400",
                      }}
                    >
                      问题 {idx + 1}
                    </Text>
                    {done ? <Icon name="Check" size={12} color={c.accent} /> : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {/* Active question & options */}
          {currentQuestion ? (
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                <Text
                  testID="fanframe-ask-question-prompt"
                  style={{
                    color: c.foreground,
                    fontSize: 14,
                    fontWeight: "600",
                    lineHeight: 20,
                  }}
                >
                  {currentQuestion.question}
                </Text>
                {currentQuestion.multiSelect ? (
                  <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>可多选</Text>
                ) : null}
              </View>

              <View style={{ gap: 6 }}>
                {currentQuestion.options.map((opt) => {
                  const selected = currentDraft.selectedIndices.includes(opt.index);
                  const optKey = `${activeIndex}-${opt.index}`;
                  const isHovered = hoveredOpt === optKey;
                  return (
                    <Pressable
                      key={optKey}
                      testID={`fanframe-ask-question-opt-${activeIndex}-${opt.index}`}
                      accessibilityRole="button"
                      accessibilityLabel={`选项 ${opt.index}: ${opt.label}`}
                      accessibilityState={{ selected }}
                      disabled={sending}
                      onPress={() =>
                        handleToggleOption(activeIndex, opt.index, currentQuestion.multiSelect)
                      }
                      onHoverIn={() => setHoveredOpt(optKey)}
                      onHoverOut={() => setHoveredOpt(null)}
                      style={{
                        flexDirection: "row",
                        alignItems: "flex-start",
                        gap: 10,
                        paddingHorizontal: compact ? 10 : 12,
                        paddingVertical: compact ? 9 : 10,
                        borderWidth: 1,
                        borderColor: selected
                          ? c.accent
                          : isHovered
                            ? c.foregroundMuted
                            : c.border,
                        backgroundColor: selected
                          ? c.surface2
                          : isHovered
                            ? c.surface2
                            : c.surface0,
                      }}
                    >
                      <View
                        style={{
                          minWidth: 22,
                          height: 22,
                          paddingHorizontal: 5,
                          alignItems: "center",
                          justifyContent: "center",
                          borderWidth: 1,
                          borderColor: selected ? c.accent : c.border,
                          backgroundColor: selected ? c.accent : c.surface1,
                          marginTop: 1,
                        }}
                      >
                        <Text
                          style={{
                            color: selected ? c.accentForeground : c.foregroundMuted,
                            fontSize: 11,
                            fontWeight: "600",
                          }}
                        >
                          {opt.index}
                        </Text>
                      </View>

                      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: 6,
                          }}
                        >
                          <Text
                            style={{
                              color: c.foreground,
                              fontSize: 13.5,
                              fontWeight: selected ? "600" : "500",
                              lineHeight: 19,
                              flexShrink: 1,
                            }}
                          >
                            {opt.label}
                          </Text>
                          {opt.recommended ? (
                            <View
                              style={{
                                paddingHorizontal: 5,
                                paddingVertical: 1,
                                borderWidth: 1,
                                borderColor: c.border,
                                backgroundColor: c.surface1,
                              }}
                            >
                              <Text
                                style={{
                                  color: c.accent,
                                  fontSize: 10,
                                  fontWeight: "600",
                                }}
                              >
                                推荐
                              </Text>
                            </View>
                          ) : null}
                        </View>
                        {opt.description ? (
                          <Text
                            style={{
                              color: c.foregroundMuted,
                              fontSize: 12.5,
                              lineHeight: 18,
                            }}
                          >
                            {opt.description}
                          </Text>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>

              {/* Optional custom text / supplement input */}
              <TextInput
                testID="fanframe-ask-question-custom-input"
                value={currentDraft.customText}
                onChangeText={(text) => handleCustomChange(activeIndex, text)}
                placeholder="其他回答或补充说明（可选）..."
                placeholderTextColor={c.foregroundMuted}
                editable={!sending}
                style={{
                  borderWidth: 1,
                  borderColor: c.border,
                  backgroundColor: c.surface0,
                  color: c.foreground,
                  fontSize: 13,
                  paddingHorizontal: 10,
                  paddingVertical: compact ? 7 : 8,
                }}
              />
            </View>
          ) : null}

          {/* Footer actions */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              paddingTop: 2,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              {questions.length > 1 ? (
                <>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="上一题"
                    disabled={activeIndex <= 0 || sending}
                    onPress={() => setActiveIndex((i) => Math.max(0, i - 1))}
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 5,
                      borderWidth: 1,
                      borderColor: c.border,
                      backgroundColor: c.surface0,
                      opacity: activeIndex <= 0 ? 0.4 : 1,
                    }}
                  >
                    <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>上一题</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="下一题"
                    disabled={activeIndex >= questions.length - 1 || sending}
                    onPress={() => setActiveIndex((i) => Math.min(questions.length - 1, i + 1))}
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 5,
                      borderWidth: 1,
                      borderColor: c.border,
                      backgroundColor: c.surface0,
                      opacity: activeIndex >= questions.length - 1 ? 0.4 : 1,
                    }}
                  >
                    <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>下一题</Text>
                  </Pressable>
                </>
              ) : null}
              {reopened ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="收起面板"
                  onPress={() => setReopened(false)}
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 5,
                    borderWidth: 1,
                    borderColor: c.border,
                    backgroundColor: c.surface0,
                  }}
                >
                  <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>收起</Text>
                </Pressable>
              ) : null}
            </View>

            <Pressable
              testID="fanframe-ask-question-submit"
              accessibilityRole="button"
              accessibilityLabel="发送回答"
              disabled={sending || answeredCount === 0}
              onPress={() => {
                void handleSubmit();
              }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 14,
                paddingVertical: 7,
                backgroundColor: answeredCount > 0 ? c.accent : c.surface2,
                borderWidth: 1,
                borderColor: answeredCount > 0 ? c.accent : c.border,
                opacity: sending ? 0.65 : 1,
              }}
            >
              <Icon
                name="Send"
                size={13}
                color={answeredCount > 0 ? c.accentForeground : c.foregroundMuted}
              />
              <Text
                style={{
                  color: answeredCount > 0 ? c.accentForeground : c.foregroundMuted,
                  fontSize: 12.5,
                  fontWeight: "600",
                }}
              >
                {sending
                  ? "发送中..."
                  : questions.length > 1 && answeredCount > 0 && answeredCount < questions.length
                    ? `发送回答 (${answeredCount}/${questions.length})`
                    : "发送回答"}
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

export function contributeAskQuestion(client: PluginClientContext): () => void {
  const removeTransformer = client.addTimelineTransformer({
    id: "fanframe-ask-question",
    query: { itemType: "assistant_message" },
    transform: ({ item }) => {
      const parsed = parseAskQuestionText(item.text);
      if (!parsed) return undefined;
      return {
        items: [
          {
            type: "plugin",
            kind: ASK_QUESTION_TIMELINE_KIND,
            version: ASK_QUESTION_TIMELINE_VERSION,
            data: parsed,
          },
        ],
      };
    },
  });

  const removeRenderer = client.addTimelineRenderer({
    kind: ASK_QUESTION_TIMELINE_KIND,
    version: ASK_QUESTION_TIMELINE_VERSION,
    schema: askQuestionTimelineDataSchema,
    Component: AskQuestionCard,
  });

  return () => {
    removeRenderer();
    removeTransformer();
  };
}
