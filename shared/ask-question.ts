import { z } from "zod";

export const ASK_QUESTION_TIMELINE_KIND = "fanframe-ask-question";
export const ASK_QUESTION_TIMELINE_VERSION = 1;

export const askQuestionOptionSchema = z.object({
  index: z.number().int().positive(),
  label: z.string(),
  description: z.string().optional(),
  rawText: z.string(),
  recommended: z.boolean(),
});

export const askQuestionItemSchema = z.object({
  question: z.string(),
  multiSelect: z.boolean(),
  options: z.array(askQuestionOptionSchema).min(2),
});

export const askQuestionTimelineDataSchema = z.object({
  questions: z.array(askQuestionItemSchema).min(1),
  rawText: z.string(),
});

export type AskQuestionOption = z.infer<typeof askQuestionOptionSchema>;
export type AskQuestionItem = z.infer<typeof askQuestionItemSchema>;
export type AskQuestionTimelineData = z.infer<typeof askQuestionTimelineDataSchema>;

const OPTION_LINE_RE = /^(?:[-*•]\s+)?\[(\d+)\]\s+(.+)$/;
const RECOMMENDED_PREFIX_RE = /^\s*(?:\(\s*recommended\s*\)|（\s*推荐\s*）|\(\s*推荐\s*\)|【\s*推荐\s*】)\s*/i;
const RECOMMENDED_SUFFIX_RE = /\s*(?:\(\s*recommended\s*\)|（\s*推荐\s*）|\(\s*推荐\s*\)|【\s*推荐\s*】)\s*$/i;
const MULTI_SELECT_HINT_RE = /(?:select all|multi[- ]?select|multiple choice|多选|可多选)/i;
const TRAILING_HINT_RE = /^(?:回复|请回复|可直接|输入|其他|other|reply|enter|type)\b/i;

function splitLabelAndDescription(text: string): { label: string; description?: string } {
  // Prefer splitting on full-width or ASCII colon outside parentheses.
  let parenDepth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "(" || ch === "（" || ch === "[" || ch === "【") {
      parenDepth += 1;
      continue;
    }
    if (ch === ")" || ch === "）" || ch === "]" || ch === "】") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (parenDepth === 0) {
      const isFullColon = ch === "：";
      const isAsciiColon = ch === ":" && text[i + 1] === " ";
      if (isFullColon || isAsciiColon) {
        const left = text.slice(0, i).trim();
        const right = text.slice(i + (isAsciiColon ? 2 : 1)).trim();
        if (left.length >= 2 && left.length <= 44 && right.length >= 2) {
          return { label: left, description: right };
        }
        break;
      }
    }
  }

  // Fallback: split a concise lead label followed by a trailing parenthetical explanation.
  const parenMatch = /^([^()（）]{2,36}?)\s*[（(]([^()（）]{4,})[）)]$/.exec(text);
  if (parenMatch) {
    return {
      label: parenMatch[1]!.trim(),
      description: parenMatch[2]!.trim(),
    };
  }

  return { label: text };
}

function parseOption(index: number, rawBody: string): AskQuestionOption {
  const trimmed = rawBody.trim();
  let recommended = false;
  let cleaned = trimmed;
  if (RECOMMENDED_PREFIX_RE.test(cleaned)) {
    recommended = true;
    cleaned = cleaned.replace(RECOMMENDED_PREFIX_RE, "").trim();
  } else if (RECOMMENDED_SUFFIX_RE.test(cleaned)) {
    recommended = true;
    cleaned = cleaned.replace(RECOMMENDED_SUFFIX_RE, "").trim();
  }
  const { label, description } = splitLabelAndDescription(cleaned || trimmed);
  return {
    index,
    label,
    ...(description ? { description } : {}),
    rawText: trimmed,
    recommended,
  };
}

function isDisallowedQuestionLine(line: string): boolean {
  return (
    line.startsWith("#") ||
    line.startsWith(">") ||
    line.startsWith("```") ||
    line.startsWith("---") ||
    line.startsWith("***") ||
    /^[-*•]\s+/.test(line)
  );
}

/**
 * Parse Antigravity ACP degraded `ask_question` Markdown blocks:
 *   Question text?
 *   - [1] (Recommended) Option A
 *   - [2] Option B
 *
 * Returns null if the message does not strictly match a structured question prompt,
 * avoiding false positives on regular assistant replies.
 */
export function parseAskQuestionText(rawText: string): AskQuestionTimelineData | null {
  const normalized = rawText.replace(/\r\n/g, "\n").trim();
  if (!normalized || normalized.includes("```")) return null;

  const lines = normalized.split("\n");
  const questions: AskQuestionItem[] = [];

  let i = 0;
  while (i < lines.length) {
    while (i < lines.length && lines[i]!.trim() === "") i += 1;
    if (i >= lines.length) break;

    const firstLine = lines[i]!.trim();

    // Allow a single short trailing reply instruction line after at least one parsed question.
    if (
      questions.length > 0 &&
      i === lines.length - 1 &&
      firstLine.length <= 80 &&
      TRAILING_HINT_RE.test(firstLine)
    ) {
      i += 1;
      break;
    }

    if (isDisallowedQuestionLine(firstLine) || OPTION_LINE_RE.test(firstLine)) {
      return null;
    }

    // Collect 1-2 consecutive question lines before the [1] option list.
    const questionLines: string[] = [firstLine];
    i += 1;
    while (i < lines.length) {
      const peek = lines[i]!.trim();
      if (peek === "") {
        i += 1;
        break;
      }
      if (OPTION_LINE_RE.test(peek)) break;
      if (isDisallowedQuestionLine(peek) || questionLines.length >= 2) {
        return null;
      }
      questionLines.push(peek);
      i += 1;
    }

    while (i < lines.length && lines[i]!.trim() === "") i += 1;

    const options: AskQuestionOption[] = [];
    let expectedIndex = 1;
    while (i < lines.length) {
      const optLine = lines[i]!.trim();
      if (optLine === "") {
        i += 1;
        break;
      }
      const match = OPTION_LINE_RE.exec(optLine);
      if (!match) break;
      const num = Number(match[1]);
      if (num !== expectedIndex) return null;
      options.push(parseOption(num, match[2]!));
      expectedIndex += 1;
      i += 1;
    }

    if (options.length < 2) return null;

    const questionText = questionLines.join(" ").trim();
    questions.push({
      question: questionText,
      multiSelect: MULTI_SELECT_HINT_RE.test(questionText),
      options,
    });
  }

  if (questions.length === 0) return null;
  return { questions, rawText: normalized };
}

export interface QuestionAnswerDraft {
  selectedIndices: number[];
  customText: string;
}

export function formatAskQuestionReply(
  questions: readonly AskQuestionItem[],
  drafts: readonly QuestionAnswerDraft[],
): string {
  const formatSingle = (q: AskQuestionItem, draft: QuestionAnswerDraft | undefined): string => {
    const selected = (draft?.selectedIndices ?? [])
      .slice()
      .sort((a, b) => a - b)
      .map((idx) => q.options.find((opt) => opt.index === idx))
      .filter((opt): opt is AskQuestionOption => Boolean(opt));
    const custom = (draft?.customText ?? "").trim();

    if (selected.length === 0 && !custom) return "";
    if (selected.length === 0) return custom;

    const picked = selected.map((opt) => `[${opt.index}] ${opt.label}`).join("；");
    return custom ? `${picked}（补充：${custom}）` : picked;
  };

  if (questions.length === 1) {
    return formatSingle(questions[0]!, drafts[0]);
  }

  const lines: string[] = [];
  for (let i = 0; i < questions.length; i++) {
    const ans = formatSingle(questions[i]!, drafts[i]);
    if (ans) {
      lines.push(`${i + 1}. ${ans}`);
    }
  }
  return lines.join("\n");
}
