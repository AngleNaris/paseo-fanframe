import { Platform } from "react-native";

export interface FanframePrefs {
  sharpCorners: boolean;
  markdownPalette: boolean;
  proseLayering: boolean;
  smoothMotion: boolean;
  crossImagePill: boolean;
  sidebarNavGrid: boolean;
  askQuestionPanel: boolean;
}

const DEFAULT_PREFS: FanframePrefs = {
  sharpCorners: true,
  markdownPalette: true,
  proseLayering: true,
  smoothMotion: true,
  crossImagePill: true,
  sidebarNavGrid: true,
  askQuestionPanel: true,
};

const STORAGE_KEY = "paseo-fanframe:prefs:v1";
const STYLE_ATTR = "data-paseo-fanframe";
const MODE_ATTR = "data-fanframe-mode";

// Minimal DOM declarations so the plugin typechecks without adding "DOM" to tsconfig.json.
interface DomNode {
  readonly nodeType: number;
  readonly firstChild: DomNode | null;
  readonly nextSibling: DomNode | null;
  readonly previousSibling?: DomNode | null;
  readonly parentElement: DomElement | null;
}
interface DomText extends DomNode {
  readonly data: string;
}
interface DomElement extends DomNode {
  readonly isConnected: boolean;
  textContent: string | null;
  readonly dataset: Record<string, string | undefined>;
  readonly style: {
    setProperty(name: string, value: string): void;
    removeProperty(name: string): void;
  };
  readonly children?: Iterable<DomElement>;
  matches(selector: string): boolean;
  closest(selector: string): DomElement | null;
  contains?(other: DomNode | null): boolean;
  querySelector(selector: string): DomElement | null;
  querySelectorAll(selector: string): Iterable<DomElement>;
  getBoundingClientRect(): { left: number; right: number; top: number; bottom: number; width: number; height: number };
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  cloneNode?(deep?: boolean): DomElement;
  insertBefore?(newNode: DomElement, referenceNode: DomNode | null): DomElement;
  animate?(
    keyframes: Array<Record<string, string | number>>,
    options: { duration: number; easing?: string; fill?: string },
  ): { cancel(): void; onfinish?: (() => void) | null; oncancel?: (() => void) | null };
  remove(): void;
  appendChild(child: DomElement): DomElement;
}
interface DomMutationRecord {
  readonly type: string;
  readonly target: DomNode;
  readonly addedNodes: Iterable<DomNode>;
  readonly removedNodes: Iterable<DomNode>;
  readonly nextSibling: DomNode | null;
}
interface DomMutationObserver {
  observe(target: DomNode, options: Record<string, boolean | string[]>): void;
  disconnect(): void;
}
interface DomIntersectionEntry {
  readonly target: DomElement;
  readonly isIntersecting: boolean;
}
interface DomIntersectionObserver {
  observe(target: DomElement): void;
  unobserve(target: DomElement): void;
  disconnect(): void;
}
interface DomStaticRange {}
interface DomHighlight {
  add(range: DomStaticRange): void;
  delete(range: DomStaticRange): void;
}

declare const document: {
  readonly head: DomElement;
  readonly body: DomElement;
  readonly documentElement: DomElement;
  createElement(tag: string): DomElement;
  querySelector(selector: string): DomElement | null;
};
declare const window: {
  readonly localStorage?: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
  };
  readonly CSS?: {
    readonly highlights?: Map<string, DomHighlight>;
  };
  getComputedStyle?(el: DomElement): {
    display?: string;
    backgroundColor?: string;
    colorScheme?: string;
    position?: string;
    borderTopColor?: string;
    borderRightColor?: string;
    borderBottomColor?: string;
    borderLeftColor?: string;
    borderTopWidth?: string;
  };
  matchMedia?(query: string): { matches: boolean };
  requestAnimationFrame(cb: () => void): number;
  cancelAnimationFrame(id: number): void;
  addEventListener(type: string, listener: (event: unknown) => void, capture?: boolean): void;
  removeEventListener(type: string, listener: (event: unknown) => void, capture?: boolean): void;
};
declare const performance: { now(): number };
declare const URL: {
  createObjectURL(blob: unknown): string;
  revokeObjectURL(url: string): void;
};
declare const Blob: new (parts: Uint8Array[], options?: { type?: string }) => { readonly size: number; readonly type: string };
declare const TextDecoder: new (encoding?: string) => { decode(input: Uint8Array): string };
declare const TextEncoder: new () => { encode(input: string): Uint8Array };
interface DomWebFile {
  readonly name?: string;
  readonly type?: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}
interface DomImageElement {
  onload: (() => void) | null;
  onerror: (() => void) | null;
  src: string;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
}
interface DomCanvasContext {
  drawImage(img: DomImageElement, dx: number, dy: number, dw: number, dh: number): void;
  getImageData(sx: number, sy: number, sw: number, sh: number): { readonly data: Uint8ClampedArray };
}
interface DomCanvasElement {
  width: number;
  height: number;
  getContext(type: "2d"): DomCanvasContext | null;
  toBlob(cb: (blob: { readonly type: string; arrayBuffer(): Promise<ArrayBuffer> } | null) => void, mime?: string, quality?: number): void;
}
interface DomInputElement extends DomElement {
  type: string;
  accept: string;
  multiple: boolean;
  readonly files: ArrayLike<DomWebFile> | null;
  click(): void;
  addEventListener(type: string, listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: string, listener: () => void): void;
}
declare const Image: new () => DomImageElement;
declare const MutationObserver: new (cb: (records: DomMutationRecord[]) => void) => DomMutationObserver;
declare const IntersectionObserver: new (
  cb: (entries: DomIntersectionEntry[]) => void,
) => DomIntersectionObserver;
declare const StaticRange: new (init: {
  startContainer: DomText;
  startOffset: number;
  endContainer: DomText;
  endOffset: number;
}) => DomStaticRange;
declare const Highlight: new () => DomHighlight;

const PROSE_BLOCKS = "p,li,td,th,dt,dd";
const PROSE_EXCLUDED =
  'pre,code,kbd,samp,a,button,input,textarea,select,math,svg,[role="math"],.katex,.katex-display,[contenteditable],summary';
const PROSE_HIDDEN = '[hidden],[aria-hidden="true"]';
const PROSE_SEMANTIC = "strong,b,em,i,mark,del,s,strike,q,blockquote";
const PROSE_CJK_BREAK = /[，。！？；、：…]/;
const PROSE_ASCII_BREAK = /[.,;:!?]/;
const PROSE_ANY_BREAK = /[，。！？；、：….,;:!?]/;
const PROSE_SPACE = /\s/;
const PROSE_STOPS = "（(［[【〔〖〘〚｛{〈《「『＜";
const PROSE_ENDS = "）)］]】〕〗〙〛｝}〉》」』＞";
const PROSE_NAMES: ReadonlyArray<string | null> = [
  null,
  "paseo-fanframe-bracket",
  "paseo-fanframe-number",
  "paseo-fanframe-bright",
  "paseo-fanframe-soft",
  "paseo-fanframe-mid",
];
const PROSE_BUDGET = 16000;

let activePrefs: FanframePrefs = { ...DEFAULT_PREFS };
let activeTeardown: (() => void) | null = null;
const prefListeners = new Set<() => void>();

export function readFanframePrefs(): FanframePrefs {
  if (Platform.OS !== "web") return { ...DEFAULT_PREFS };
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<FanframePrefs>;
    return {
      sharpCorners:
        typeof parsed.sharpCorners === "boolean" ? parsed.sharpCorners : DEFAULT_PREFS.sharpCorners,
      markdownPalette:
        typeof parsed.markdownPalette === "boolean"
          ? parsed.markdownPalette
          : DEFAULT_PREFS.markdownPalette,
      proseLayering:
        typeof parsed.proseLayering === "boolean"
          ? parsed.proseLayering
          : DEFAULT_PREFS.proseLayering,
      smoothMotion:
        typeof parsed.smoothMotion === "boolean"
          ? parsed.smoothMotion
          : DEFAULT_PREFS.smoothMotion,
      crossImagePill:
        typeof parsed.crossImagePill === "boolean"
          ? parsed.crossImagePill
          : DEFAULT_PREFS.crossImagePill,
      sidebarNavGrid:
        typeof parsed.sidebarNavGrid === "boolean"
          ? parsed.sidebarNavGrid
          : DEFAULT_PREFS.sidebarNavGrid,
      askQuestionPanel:
        typeof parsed.askQuestionPanel === "boolean"
          ? parsed.askQuestionPanel
          : DEFAULT_PREFS.askQuestionPanel,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function updateFanframePrefs(patch: Partial<FanframePrefs>): FanframePrefs {
  activePrefs = { ...activePrefs, ...patch };
  if (Platform.OS === "web") {
    try {
      window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(activePrefs));
    } catch {
      // Ignore storage quota or private-mode failures.
    }
    applyWebEnhancements();
  }
  for (const listener of prefListeners) listener();
  return activePrefs;
}

export function subscribeFanframePrefs(listener: () => void): () => void {
  prefListeners.add(listener);
  return () => {
    prefListeners.delete(listener);
  };
}

function detectDarkMode(): boolean {
  try {
    const bg = window.getComputedStyle?.(document.body)?.backgroundColor ?? "";
    const match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (match) {
      const r = Number(match[1]);
      const g = Number(match[2]);
      const b = Number(match[3]);
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      return luminance < 0.5;
    }
    if (window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
  } catch {
    // Fallback to dark when computed style is unavailable.
  }
  return true;
}

function buildStylesheet(prefs: FanframePrefs): string {
  const parts: string[] = [];

  parts.push(`
/* FanFrame: Clear context-window usage ring (composer bottom-right) */
html[${MODE_ATTR}="dark"] [data-testid="context-window-meter"] svg circle:first-of-type {
  stroke: rgba(214, 204, 188, 0.18) !important;
  stroke-width: 1.8 !important;
}
html[${MODE_ATTR}="light"] [data-testid="context-window-meter"] svg circle:first-of-type {
  stroke: rgba(30, 34, 42, 0.16) !important;
  stroke-width: 1.8 !important;
}
html[${MODE_ATTR}="dark"] [data-testid="context-window-meter"] svg circle[stroke-dasharray] {
  stroke-width: 2.3 !important;
}
html[${MODE_ATTR}="light"] [data-testid="context-window-meter"] svg circle[stroke-dasharray] {
  stroke-width: 2.3 !important;
}
html[${MODE_ATTR}="dark"] [data-testid="context-window-meter"] svg circle[stroke-dasharray]:not([stroke="#f59e0b" i]):not([stroke="#c64f43" i]):not([stroke="#b04138" i]) {
  stroke: #7ec4cf !important;
}
html[${MODE_ATTR}="light"] [data-testid="context-window-meter"] svg circle[stroke-dasharray]:not([stroke="#f59e0b" i]):not([stroke="#c64f43" i]):not([stroke="#b04138" i]) {
  stroke: #2f7480 !important;
}
html[${MODE_ATTR}="dark"] [data-testid="context-window-meter"] svg circle[stroke-dasharray][stroke="#c64f43" i] {
  stroke: #e06c65 !important;
}
html[${MODE_ATTR}="light"] [data-testid="context-window-meter"] svg circle[stroke-dasharray][stroke="#f59e0b" i] {
  stroke: #d97706 !important;
}
/* FanFrame: Match sidebar project & workspace row height (28px) to top-left sidebar nav buttons */
html[${MODE_ATTR}] [data-testid^="sidebar-workspace-row-"],
html[${MODE_ATTR}] [data-testid^="sidebar-project-new-workspace-row-"] {
  min-height: 28px !important;
  padding-top: 4px !important;
  padding-bottom: 4px !important;
}
html[${MODE_ATTR}] [data-testid^="sidebar-project-row-"] {
  min-height: 28px !important;
  height: 28px !important;
  padding-top: 2px !important;
  padding-bottom: 2px !important;
  margin-bottom: 2px !important;
}
html[${MODE_ATTR}] [data-ff-project-title="true"] {
  color: var(--ff-project-color) !important;
}
`);

  if (prefs.sharpCorners) {
    parts.push(`
/* FanFrame: Global sharp corners, opaque popups, non-outline focus */
html[${MODE_ATTR}] *,
html[${MODE_ATTR}] *::before,
html[${MODE_ATTR}] *::after {
  border-radius: 0 !important;
}
html[${MODE_ATTR}] ::-webkit-scrollbar-thumb,
html[${MODE_ATTR}] ::-webkit-scrollbar-track {
  border-radius: 0 !important;
}
html[${MODE_ATTR}] [role="menu"],
html[${MODE_ATTR}] [role="listbox"],
html[${MODE_ATTR}] [role="dialog"] {
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
html[${MODE_ATTR}] *:focus,
html[${MODE_ATTR}] *:focus-visible {
  outline: none !important;
}
/* FanFrame: Square-perimeter running status spinner (no skewed rotating border-top) */
@keyframes fanframe-square-orbit {
  from { transform: translate(-50%, -50%) rotate(0deg); }
  to { transform: translate(-50%, -50%) rotate(360deg); }
}
html[${MODE_ATTR}] [data-ff-tab-spinner="true"] {
  display: none !important;
}
html[${MODE_ATTR}] [data-ff-square-spinner="true"] {
  transform: none !important;
  overflow: hidden !important;
}
html[${MODE_ATTR}] [data-ff-square-arc="true"] {
  border: 0 !important;
  box-sizing: border-box !important;
  background: transparent !important;
  position: relative !important;
  overflow: hidden !important;
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  padding: 1.5px !important;
}
html[${MODE_ATTR}] [data-ff-square-arc="true"]::before {
  content: "" !important;
  position: absolute !important;
  top: 50% !important;
  left: 50% !important;
  width: 220% !important;
  height: 220% !important;
  background: conic-gradient(from 0deg, transparent 0deg 230deg, var(--ff-spinner-color, #5caaf6) 310deg 360deg) !important;
  animation: fanframe-square-orbit 900ms linear infinite !important;
  pointer-events: none !important;
}
@media (prefers-reduced-motion: reduce) {
  html[${MODE_ATTR}] [data-ff-square-arc="true"]::before {
    animation: none !important;
  }
}
/* FanFrame: Anchor scroll-to-bottom button to bottom-right aligned with composer */
html[${MODE_ATTR}] [data-ff-scroll-host="true"] {
  align-items: flex-end !important;
  padding-right: var(--ff-scroll-right, 20px) !important;
  pointer-events: none !important;
}
html[${MODE_ATTR}] [data-testid="scroll-to-bottom-button"] {
  pointer-events: auto !important;
  width: 36px !important;
  height: 36px !important;
  border: 1px solid rgba(255, 255, 255, 0.14) !important;
}
html[${MODE_ATTR}="light"] [data-testid="scroll-to-bottom-button"] {
  border-color: rgba(30, 34, 42, 0.16) !important;
}
`);
  }

  if (prefs.markdownPalette) {
    parts.push(`
/* FanFrame: Low-saturation Markdown hierarchy (dark & light adaptive) */
html[${MODE_ATTR}="dark"] {
  --ff-accent: #916db0;
  --ff-ink-blue: #9cb8dc;
  --ff-ink-amber: #ddbc86;
  --ff-md-h1: #b9c9df;
  --ff-md-h1-border: rgba(185, 201, 223, 0.25);
  --ff-md-h2: #a4cccc;
  --ff-md-h2-border: rgba(164, 204, 204, 0.2);
  --ff-md-h3: #cbb7e1;
  --ff-md-minor-heading: #d6ccbc;
  --ff-md-bold: #c3aee0;
  --ff-md-italic: #dca8b9;
  --ff-md-code: #dfcd9a;
  --ff-md-code-bg: rgba(223, 205, 154, 0.1);
  --ff-md-code-border: rgba(223, 205, 154, 0.28);
  --ff-md-quote: #c3cbd8;
  --ff-md-quote-bg: rgba(145, 109, 176, 0.08);
  --ff-md-mark: #d9c68c;
  --ff-md-mark-bg: rgba(217, 198, 140, 0.22);
  --ff-md-deleted: #8b949e;
  --ff-md-deleted-line: #cf8188;
  --ff-md-ul-marker: #d2b489;
  --ff-md-ol-marker: #d3bb92;
  --ff-md-summary: #9bb8d9;
  --ff-md-summary-hover: #abc5e3;
  --ff-md-table-th: rgba(145, 109, 176, 0.12);
  --ff-md-kbd-text: #d6ccbc;
  --ff-md-kbd-bg: #21262d;
  --ff-md-kbd-border: #484f58;
  --ff-md-kbd-bottom: #565f6c;
}
html[${MODE_ATTR}="light"] {
  --ff-accent: #6f4c91;
  --ff-ink-blue: #42658e;
  --ff-ink-amber: #815817;
  --ff-md-h1: hsl(214.74, 37.25%, 32%);
  --ff-md-h1-border: rgba(66, 101, 142, 0.22);
  --ff-md-h2: hsl(180, 28.17%, 32%);
  --ff-md-h2-border: rgba(58, 105, 105, 0.2);
  --ff-md-h3: hsl(268.57, 41.18%, 32%);
  --ff-md-minor-heading: hsl(218.18, 21.57%, 28%);
  --ff-md-bold: hsl(265.2, 44.64%, 32%);
  --ff-md-italic: hsl(340.38, 42.62%, 32%);
  --ff-md-code: hsl(44.35, 51.88%, 30%);
  --ff-md-code-bg: rgba(129, 88, 23, 0.08);
  --ff-md-code-border: rgba(129, 88, 23, 0.24);
  --ff-md-quote: hsl(217.14, 21.21%, 34%);
  --ff-md-quote-bg: rgba(111, 76, 145, 0.07);
  --ff-md-mark: hsl(45.19, 50.33%, 30%);
  --ff-md-mark-bg: rgba(180, 146, 62, 0.2);
  --ff-md-deleted: hsl(211.58, 8.92%, 38%);
  --ff-md-deleted-line: hsl(354.62, 44.83%, 32%);
  --ff-md-ul-marker: hsl(35.34, 44.79%, 32%);
  --ff-md-ol-marker: hsl(37.85, 42.48%, 32%);
  --ff-md-summary: hsl(211.94, 44.93%, 32%);
  --ff-md-summary-hover: hsl(212.14, 50%, 36%);
  --ff-md-table-th: rgba(111, 76, 145, 0.1);
  --ff-md-kbd-text: #1e222a;
  --ff-md-kbd-bg: #eef0f5;
  --ff-md-kbd-border: #c8cfd9;
  --ff-md-kbd-bottom: #aeb7c5;
}
html[${MODE_ATTR}] h1,
html[${MODE_ATTR}] [role="heading"][aria-level="1"] {
  color: var(--ff-md-h1) !important;
  border-bottom: 1px solid var(--ff-md-h1-border) !important;
  padding-bottom: 0.28em !important;
}
html[${MODE_ATTR}] h2,
html[${MODE_ATTR}] [role="heading"][aria-level="2"] {
  color: var(--ff-md-h2) !important;
  border-bottom: 1px solid var(--ff-md-h2-border) !important;
  padding-bottom: 0.22em !important;
}
html[${MODE_ATTR}] h3,
html[${MODE_ATTR}] [role="heading"][aria-level="3"] {
  color: var(--ff-md-h3) !important;
}
html[${MODE_ATTR}] h4,
html[${MODE_ATTR}] h5,
html[${MODE_ATTR}] h6,
html[${MODE_ATTR}] [role="heading"][aria-level="4"],
html[${MODE_ATTR}] [role="heading"][aria-level="5"],
html[${MODE_ATTR}] [role="heading"][aria-level="6"] {
  color: var(--ff-md-minor-heading) !important;
}
html[${MODE_ATTR}] strong,
html[${MODE_ATTR}] b {
  color: var(--ff-md-bold) !important;
  font-weight: 600 !important;
}
html[${MODE_ATTR}] em,
html[${MODE_ATTR}] i {
  color: var(--ff-md-italic) !important;
  font-style: italic !important;
}
html[${MODE_ATTR}] strong em,
html[${MODE_ATTR}] em strong,
html[${MODE_ATTR}] b i,
html[${MODE_ATTR}] i b {
  color: var(--ff-md-italic) !important;
}
html[${MODE_ATTR}] del,
html[${MODE_ATTR}] s,
html[${MODE_ATTR}] strike {
  color: var(--ff-md-deleted) !important;
  text-decoration: line-through !important;
  text-decoration-color: var(--ff-md-deleted-line) !important;
}
html[${MODE_ATTR}] a {
  color: var(--ff-ink-blue) !important;
}
html[${MODE_ATTR}] :not(pre) > code {
  color: var(--ff-md-code) !important;
  background: var(--ff-md-code-bg) !important;
  border: 1px solid var(--ff-md-code-border) !important;
  padding: 0.1em 0.36em !important;
}
html[${MODE_ATTR}] blockquote {
  border-left: 3px solid var(--ff-accent) !important;
  background: var(--ff-md-quote-bg) !important;
  color: var(--ff-md-quote) !important;
  padding: 0.55em 0.9em !important;
}
html[${MODE_ATTR}] mark {
  background: var(--ff-md-mark-bg) !important;
  color: var(--ff-md-mark) !important;
  padding: 0.1em 0.3em !important;
}
html[${MODE_ATTR}] kbd {
  color: var(--ff-md-kbd-text) !important;
  background: var(--ff-md-kbd-bg) !important;
  border: 1px solid var(--ff-md-kbd-border) !important;
  border-bottom: 2px solid var(--ff-md-kbd-bottom) !important;
  padding: 0.15em 0.45em !important;
  font-size: 0.85em !important;
}
html[${MODE_ATTR}] hr {
  border: none !important;
  border-top: 1px solid color-mix(in srgb, var(--ff-accent) 30%, transparent) !important;
}
html[${MODE_ATTR}] details {
  border-left: 2px solid color-mix(in srgb, var(--ff-md-summary) 40%, transparent) !important;
  padding-left: 0.75rem !important;
}
html[${MODE_ATTR}] details > summary {
  color: var(--ff-md-summary) !important;
  font-weight: 600 !important;
}
html[${MODE_ATTR}] details > summary:hover {
  color: var(--ff-md-summary-hover) !important;
}
html[${MODE_ATTR}] th {
  background: var(--ff-md-table-th) !important;
  color: var(--ff-md-h3) !important;
}
html[${MODE_ATTR}] ul > li::marker {
  color: var(--ff-md-ul-marker) !important;
  font-weight: 600 !important;
}
html[${MODE_ATTR}] ol > li::marker {
  color: var(--ff-md-ol-marker) !important;
  font-weight: 600 !important;
}
html[${MODE_ATTR}] li input[type="checkbox"] {
  accent-color: var(--ff-accent) !important;
}
`);
  }

  if (prefs.proseLayering) {
    parts.push(`
/* FanFrame: CSS Custom Highlight API prose brightness layering */
html[${MODE_ATTR}="dark"]::highlight(paseo-fanframe-bracket) { color: #9cb8dc; }
html[${MODE_ATTR}="light"]::highlight(paseo-fanframe-bracket) { color: #42658e; }
html[${MODE_ATTR}="dark"]::highlight(paseo-fanframe-number) { color: #ddbc86; }
html[${MODE_ATTR}="light"]::highlight(paseo-fanframe-number) { color: #815817; }
html[${MODE_ATTR}="dark"]::highlight(paseo-fanframe-bright) { color: #d6ccbc; }
html[${MODE_ATTR}="dark"]::highlight(paseo-fanframe-mid) { color: color-mix(in oklab, #d6ccbc 80%, #1c1e23); }
html[${MODE_ATTR}="dark"]::highlight(paseo-fanframe-soft) { color: color-mix(in oklab, #d6ccbc 60%, #1c1e23); }
html[${MODE_ATTR}="light"]::highlight(paseo-fanframe-bright) { color: #1e222a; }
html[${MODE_ATTR}="light"]::highlight(paseo-fanframe-mid) { color: color-mix(in oklab, #1e222a 78%, #f7f8fa); }
html[${MODE_ATTR}="light"]::highlight(paseo-fanframe-soft) { color: color-mix(in oklab, #1e222a 56%, #f7f8fa); }
@media (forced-colors: active) {
  ::highlight(paseo-fanframe-bright),
  ::highlight(paseo-fanframe-soft),
  ::highlight(paseo-fanframe-mid) {
    color: CanvasText;
  }
}
`);
  }

  if (prefs.smoothMotion) {
    parts.push(`
/* FanFrame: Smooth micro-transitions on interactive controls (RNW Pressable + native controls) */
@media (prefers-reduced-motion: no-preference) {
  html[${MODE_ATTR}] :is(
    button,
    a,
    summary,
    input,
    select,
    textarea,
    [role="button"],
    [role="tab"],
    [role="menuitem"],
    [role="option"],
    [role="treeitem"],
    [role="switch"],
    [role="checkbox"],
    [tabindex="0"],
    [data-testid="tool-call-badge"],
    [data-testid="scroll-to-bottom-button"]
  ):not([role="dialog"]):not([role="menu"]):not([role="listbox"]):not([data-ff-square-spinner]):not([data-ff-square-arc]):not([data-ff-scroll-host]):not([data-ff-collapse-ghost]) {
    transition-property: background-color, color, border-color, opacity, fill, stroke !important;
    transition-duration: 140ms !important;
    transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1) !important;
  }
  html[${MODE_ATTR}] :is(button, summary, [role="button"], [tabindex="0"], [data-testid="tool-call-badge"]):not([data-ff-square-spinner]) svg {
    transition: transform 180ms cubic-bezier(0.16, 1, 0.3, 1), color 140ms ease, opacity 140ms ease !important;
  }
  html[${MODE_ATTR}="dark"] [data-testid="scroll-to-bottom-button"]:hover {
    background-color: #2f343f !important;
    border-color: rgba(255, 255, 255, 0.26) !important;
  }
  html[${MODE_ATTR}="light"] [data-testid="scroll-to-bottom-button"]:hover {
    background-color: #e6e9f0 !important;
    border-color: rgba(30, 34, 42, 0.28) !important;
  }
  html[${MODE_ATTR}="dark"] [data-testid="tool-call-badge"]:hover {
    background-color: rgba(214, 204, 188, 0.05) !important;
  }
  html[${MODE_ATTR}="light"] [data-testid="tool-call-badge"]:hover {
    background-color: rgba(30, 34, 42, 0.045) !important;
  }
}
`);
  }

  if (prefs.sidebarNavGrid) {
    parts.push(`
/* FanFrame: Compact 3-column grid for sidebar top navigation (icon left, text right, ellipsis) */
html[${MODE_ATTR}] [data-ff-sidebar-nav-grid="true"] {
  display: grid !important;
  grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
  column-gap: 4px !important;
  row-gap: 2px !important;
  padding-left: 8px !important;
  padding-right: 8px !important;
  align-items: stretch !important;
}
html[${MODE_ATTR}] [data-ff-sidebar-nav-full="true"] {
  grid-column: 1 / -1 !important;
  min-width: 0 !important;
  width: 100% !important;
  padding-left: 0 !important;
  padding-right: 0 !important;
}
html[${MODE_ATTR}] [data-ff-sidebar-nav-full="true"] [data-ff-sidebar-nav-pad="true"] {
  padding-left: 0 !important;
  padding-right: 0 !important;
}
html[${MODE_ATTR}] [data-ff-sidebar-nav-full="true"] [data-ff-sidebar-nav-row="true"],
html[${MODE_ATTR}] [data-ff-sidebar-nav-full="true"] [data-ff-sidebar-nav-btn="true"] {
  min-height: 28px !important;
  height: 28px !important;
}
html[${MODE_ATTR}] [data-ff-sidebar-nav-full="true"] [data-ff-sidebar-nav-btn="true"] {
  padding-top: 3px !important;
  padding-bottom: 3px !important;
}
html[${MODE_ATTR}] [data-ff-sidebar-nav-full="true"] > button,
html[${MODE_ATTR}] [data-ff-sidebar-nav-full="true"] > [role="button"] {
  margin-right: 0 !important;
  min-height: 28px !important;
  height: 28px !important;
  min-width: 28px !important;
  width: 28px !important;
}
html[${MODE_ATTR}] [data-ff-sidebar-nav-cell="true"] {
  min-width: 0 !important;
  width: 100% !important;
  padding-left: 0 !important;
  padding-right: 0 !important;
}
html[${MODE_ATTR}] [data-ff-sidebar-nav-cell="true"] [data-ff-sidebar-nav-pad="true"] {
  min-width: 0 !important;
  width: 100% !important;
  padding-left: 0 !important;
  padding-right: 0 !important;
}
html[${MODE_ATTR}] [data-ff-sidebar-nav-cell="true"] [data-ff-sidebar-nav-row="true"] {
  min-width: 0 !important;
  width: 100% !important;
  min-height: 28px !important;
  height: 28px !important;
  overflow: hidden !important;
}
html[${MODE_ATTR}] [data-ff-sidebar-nav-cell="true"] [data-ff-sidebar-nav-btn="true"] {
  display: flex !important;
  flex-direction: row !important;
  align-items: center !important;
  justify-content: flex-start !important;
  min-width: 0 !important;
  width: 100% !important;
  min-height: 28px !important;
  height: 28px !important;
  gap: 5px !important;
  padding-left: 5px !important;
  padding-right: 5px !important;
  padding-top: 3px !important;
  padding-bottom: 3px !important;
  overflow: hidden !important;
}
html[${MODE_ATTR}] [data-ff-sidebar-nav-cell="true"] [data-ff-sidebar-nav-btn="true"] svg {
  flex-shrink: 0 !important;
}
html[${MODE_ATTR}] [data-ff-sidebar-nav-cell="true"] [data-ff-sidebar-nav-label="true"] {
  flex: 1 1 0% !important;
  min-width: 0 !important;
  display: block !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
}
html[${MODE_ATTR}] [data-ff-sidebar-nav-cell="true"] [data-testid="sidebar-search"] + * {
  display: none !important;
}
`);
  }

  return parts.join("\n");
}

function computeProseTones(text: string): Uint8Array {
  const n = text.length;
  const tone = new Uint8Array(n);
  const pairs = new Int32Array(n + 1);
  const stack: Array<[number, number]> = [];

  for (let i = 0; i < n; i++) {
    const ch = text[i]!;
    const open = PROSE_STOPS.indexOf(ch);
    const close = PROSE_ENDS.indexOf(ch);
    if (open >= 0) {
      stack.push([open, i]);
    } else if (close >= 0) {
      const top = stack.pop();
      if (top && top[0] === close) {
        pairs[top[1]]!++;
        pairs[i + 1]!--;
      } else {
        stack.length = 0;
      }
    } else if (ch === "\n") {
      stack.length = 0;
    }
  }

  let openDepth = 0;
  for (let i = 0; i < n; i++) {
    openDepth += pairs[i]!;
    if (openDepth > 0) tone[i] = 1;
  }

  const numbers =
    /[+\-−＋－]?[0-9０-９]+(?:[,，][0-9０-９]{3}(?![0-9０-９]))*(?:[.．:：/／][0-9０-９]+)*(?:[%％])?/g;
  let match: RegExpExecArray | null;
  while ((match = numbers.exec(text)) !== null) {
    tone.fill(2, match.index, numbers.lastIndex);
  }

  let shade = 3;
  for (let i = 0; i < n; i++) {
    if (!tone[i]) tone[i] = shade;
    const ch = text[i]!;
    if (
      tone[i] !== 1 &&
      tone[i] !== 2 &&
      (ch === "\n" ||
        PROSE_CJK_BREAK.test(ch) ||
        (PROSE_ASCII_BREAK.test(ch) && (i + 1 === n || PROSE_SPACE.test(text[i + 1] ?? ""))))
    ) {
      if (!PROSE_ANY_BREAK.test(text[i + 1] ?? "")) {
        const mixed = Math.imul(i + 1, 0x9e3779b1);
        shade = 3 + ((shade - 3 + 1 + ((mixed >>> 16) & 1)) % 3);
      }
    }
  }

  return tone;
}

function collectProseRanges(block: DomElement): Array<Array<DomStaticRange> | undefined> {
  let text = "";
  const leaves: Array<[DomText, number, number, boolean]> = [];
  let budget = 1800;
  const buckets: Array<Array<DomStaticRange> | undefined> = [];

  function visit(node: DomNode, neutral: boolean, depth: number) {
    if (--budget < 0 || depth > 48 || text.length >= PROSE_BUDGET) return;
    if (node.nodeType === 3) {
      const textNode = node as DomText;
      const part = textNode.data.slice(0, PROSE_BUDGET - text.length);
      if (part) {
        leaves.push([textNode, text.length, part.length, neutral]);
        text += part;
      }
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as DomElement;
    if (el !== block && el.matches(`${PROSE_BLOCKS},br`)) {
      text += "\n";
      return;
    }
    if (el.matches(`${PROSE_EXCLUDED},${PROSE_HIDDEN}`)) {
      text += "\u0000";
      return;
    }
    const nextNeutral = neutral && !el.matches(PROSE_SEMANTIC);
    for (
      let child = el.firstChild;
      child && budget >= 0 && text.length < PROSE_BUDGET;
      child = child.nextSibling
    ) {
      visit(child, nextNeutral, depth + 1);
    }
  }

  visit(block, !block.closest(PROSE_SEMANTIC), 0);
  if (!text || budget < 0 || text.length >= PROSE_BUDGET) return [];

  const tones = computeProseTones(text);
  let rangeCount = 0;

  for (const [leafNode, base, size, leafNeutral] of leaves) {
    let tone = 0;
    let start = 0;
    for (let i = 0; i <= size; i++) {
      let next = i < size ? (tones[base + i] ?? 0) : 0;
      if (next >= 3 && !leafNeutral) next = 0;
      if (next === tone) continue;
      if (PROSE_NAMES[tone]) {
        if (++rangeCount > 768) return [];
        const bucket = buckets[tone] ?? (buckets[tone] = []);
        bucket.push(
          new StaticRange({
            startContainer: leafNode,
            startOffset: start,
            endContainer: leafNode,
            endOffset: i,
          }),
        );
      }
      start = i;
      tone = next;
    }
  }

  return buckets;
}

function mountProseLayer(): () => void {
  const registry = window.CSS?.highlights;
  if (
    !registry ||
    typeof Highlight !== "function" ||
    typeof StaticRange !== "function" ||
    typeof IntersectionObserver !== "function"
  ) {
    return () => {};
  }

  const channels = PROSE_NAMES.map((name) => (name ? new Highlight() : null));
  channels.forEach((hl, i) => {
    const name = PROSE_NAMES[i];
    if (hl && name) registry.set(name, hl);
  });

  type Entry = { visible: boolean; ranges: Array<Array<DomStaticRange> | undefined> | null };
  const blocks = new Map<DomElement, Entry>();
  const pending = new Set<DomElement>();
  let frame = 0;

  const clearEntry = (entry: Entry) => {
    if (!entry.ranges) return;
    entry.ranges.forEach((ranges, tone) => {
      const channel = channels[tone];
      if (!ranges || !channel) return;
      for (const range of ranges) channel.delete(range);
    });
    entry.ranges = null;
  };

  const eligible = (el: DomElement) =>
    !el.closest(PROSE_EXCLUDED) && !el.closest(PROSE_HIDDEN) && !el.closest('[role="navigation"]');

  const render = () => {
    frame = 0;
    const deadline = performance.now() + 4;
    let count = 0;
    for (const el of pending) {
      pending.delete(el);
      const entry = blocks.get(el);
      if (entry) {
        clearEntry(entry);
        if (entry.visible && el.isConnected && eligible(el)) {
          entry.ranges = collectProseRanges(el);
          entry.ranges.forEach((ranges, tone) => {
            const channel = channels[tone];
            if (!ranges || !channel) return;
            for (const range of ranges) channel.add(range);
          });
        }
      }
      if (++count >= 8 || performance.now() > deadline) break;
    }
    if (pending.size > 0) {
      frame = window.requestAnimationFrame(render);
    }
  };

  const enqueue = (el: DomElement) => {
    const entry = blocks.get(el);
    if (!entry || !entry.visible) return;
    pending.add(el);
    if (!frame) frame = window.requestAnimationFrame(render);
  };

  const visibility = new IntersectionObserver((changes) => {
    for (const change of changes) {
      const entry = blocks.get(change.target);
      if (!entry) continue;
      entry.visible = change.isIntersecting;
      if (entry.visible) enqueue(change.target);
      else {
        pending.delete(change.target);
        clearEntry(entry);
      }
    }
  });

  const track = (el: DomElement) => {
    if (blocks.has(el) || !eligible(el)) return;
    blocks.set(el, { visible: false, ranges: null });
    visibility.observe(el);
  };

  const untrack = (el: DomElement) => {
    const entry = blocks.get(el);
    if (!entry) return;
    visibility.unobserve(el);
    pending.delete(el);
    clearEntry(entry);
    blocks.delete(el);
  };

  const scanNode = (node: DomNode) => {
    if (node.nodeType !== 1) return;
    const el = node as DomElement;
    if (el.matches(PROSE_BLOCKS)) track(el);
    for (const child of el.querySelectorAll(PROSE_BLOCKS)) track(child);
  };

  const dropNode = (node: DomNode) => {
    if (node.nodeType !== 1) return;
    const el = node as DomElement;
    if (blocks.has(el)) untrack(el);
    for (const child of el.querySelectorAll(PROSE_BLOCKS)) {
      if (blocks.has(child)) untrack(child);
    }
  };

  scanNode(document.body);

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "characterData") {
        const parentBlock = m.target.parentElement?.closest(PROSE_BLOCKS);
        if (parentBlock) {
          if (!blocks.has(parentBlock)) track(parentBlock);
          enqueue(parentBlock);
        }
        continue;
      }
      for (const removed of m.removedNodes) dropNode(removed);
      for (const added of m.addedNodes) scanNode(added);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  return () => {
    observer.disconnect();
    visibility.disconnect();
    if (frame) window.cancelAnimationFrame(frame);
    for (const entry of blocks.values()) clearEntry(entry);
    blocks.clear();
    pending.clear();
    PROSE_NAMES.forEach((name) => {
      if (name) registry.delete(name);
    });
  };
}

function applyWebEnhancements(): void {
  if (Platform.OS !== "web") return;
  if (activeTeardown) {
    activeTeardown();
    activeTeardown = null;
  }

  let modeFrame = 0;
  const syncMode = () => {
    modeFrame = 0;
    const next = detectDarkMode() ? "dark" : "light";
    if (document.documentElement.getAttribute(MODE_ATTR) !== next) {
      document.documentElement.setAttribute(MODE_ATTR, next);
    }
  };
  const scheduleSyncMode = () => {
    if (!modeFrame) {
      modeFrame = window.requestAnimationFrame(syncMode);
    }
  };
  syncMode();

  const style = document.createElement("style");
  style.setAttribute(STYLE_ATTR, "true");
  style.textContent = buildStylesheet(activePrefs);
  document.head.appendChild(style);

  const modeObserver = new MutationObserver(() => scheduleSyncMode());
  modeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style", "data-theme"],
  });
  modeObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ["class", "style", "data-theme"],
  });

  const stopProse = activePrefs.proseLayering ? mountProseLayer() : () => {};
  const stopMotion = activePrefs.smoothMotion ? mountFanframeMotion() : () => {};

  // Keep the scroll-to-bottom button's right edge aligned with the composer box.
  // Persist --ff-scroll-right on documentElement and keep the host attribute until unmount
  // so exit animations never snap back to center.
  let alignFrame = 0;
  let lastHost: DomElement | null = null;
  const clearHost = () => {
    if (lastHost) {
      lastHost.removeAttribute("data-ff-scroll-host");
      lastHost = null;
    }
  };
  const alignScrollButton = () => {
    alignFrame = 0;
    if (lastHost && !lastHost.isConnected) {
      lastHost = null;
    }
    const btn = document.querySelector('[data-testid="scroll-to-bottom-button"]');
    if (!btn) return;
    // Find the nearest ancestor with position: absolute (scrollToBottomContainer).
    let host: DomElement | null = null;
    let probe = btn.parentElement;
    for (let depth = 0; probe && probe !== document.body && depth < 4; depth++) {
      if (window.getComputedStyle?.(probe)?.position === "absolute") {
        host = probe;
        break;
      }
      probe = probe.parentElement;
    }
    if (!host) return;
    if (lastHost && lastHost !== host) {
      lastHost.removeAttribute("data-ff-scroll-host");
    }
    lastHost = host;
    if (host.getAttribute("data-ff-scroll-host") !== "true") {
      host.setAttribute("data-ff-scroll-host", "true");
    }

    const textarea = document.querySelector("textarea");
    if (!textarea) return;
    const hostRect = host.getBoundingClientRect();
    if (hostRect.width <= 0) return;
    let composerEl: DomElement = textarea;
    let cur = textarea.parentElement;
    while (cur && cur !== document.body) {
      const r = cur.getBoundingClientRect();
      if (r.width > 0 && r.width < hostRect.width - 8) {
        composerEl = cur;
      } else if (r.width >= hostRect.width - 8) {
        break;
      }
      cur = cur.parentElement;
    }
    const composerRect = composerEl.getBoundingClientRect();
    if (composerRect.width <= 0) return;
    const inset = Math.max(12, Math.round(hostRect.right - composerRect.right));
    const nextValue = `${inset}px`;
    if (document.documentElement.getAttribute("data-ff-scroll-right") !== nextValue) {
      document.documentElement.setAttribute("data-ff-scroll-right", nextValue);
      document.documentElement.style.setProperty("--ff-scroll-right", nextValue);
    }
  };
  const scheduleAlign = () => {
    if (!alignFrame) alignFrame = window.requestAnimationFrame(alignScrollButton);
  };
  scheduleAlign();
  const alignObserver = new MutationObserver(() => scheduleAlign());
  alignObserver.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("resize", scheduleAlign);

  const stopSquareSpinners = mountSquareSpinners();
  const stopProjectTitleColors = mountProjectTitleColors();
  const stopSidebarNavGrid = activePrefs.sidebarNavGrid ? mountSidebarNavGrid() : () => {};

  activeTeardown = () => {
    if (modeFrame) window.cancelAnimationFrame(modeFrame);
    if (alignFrame) window.cancelAnimationFrame(alignFrame);
    window.removeEventListener("resize", scheduleAlign);
    alignObserver.disconnect();
    clearHost();
    document.documentElement.removeAttribute("data-ff-scroll-right");
    document.documentElement.style.removeProperty("--ff-scroll-right");
    stopSidebarNavGrid();
    stopProjectTitleColors();
    stopSquareSpinners();
    stopMotion();
    stopProse();
    modeObserver.disconnect();
    style.remove();
    document.documentElement.removeAttribute(MODE_ATTR);
  };
}

export function installFanframeWeb(): () => void {
  if (Platform.OS !== "web") return () => {};
  activePrefs = readFanframePrefs();
  applyWebEnhancements();
  return () => {
    clearCrossImageUrlCache();
    if (activeTeardown) {
      activeTeardown();
      activeTeardown = null;
    }
  };
}

function isTransparentColor(value: string | undefined): boolean {
  if (!value) return true;
  const v = value.replace(/\s+/g, "").toLowerCase();
  return v === "transparent" || v === "rgba(0,0,0,0)";
}

function mountSquareSpinners(): () => void {
  if (Platform.OS !== "web") return () => {};
  const markedArcs = new Set<DomElement>();
  const markedHosts = new Set<DomElement>();
  const markedTabBadges = new Set<DomElement>();
  let frame = 0;

  const inspect = (el: DomElement) => {
    if (markedArcs.has(el) || !el.isConnected) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 10 || rect.width > 18 || Math.abs(rect.width - rect.height) > 2) return;
    const cs = window.getComputedStyle?.(el);
    if (!cs) return;
    const topColor = cs.borderTopColor;
    if (
      !topColor ||
      isTransparentColor(topColor) ||
      !isTransparentColor(cs.borderRightColor) ||
      !isTransparentColor(cs.borderBottomColor) ||
      !isTransparentColor(cs.borderLeftColor)
    ) {
      return;
    }
    markedArcs.add(el);
    el.setAttribute("data-ff-square-arc", "true");
    el.style.setProperty("--ff-spinner-color", topColor);
    const parent = el.parentElement;
    if (parent && parent !== document.body) {
      markedHosts.add(parent);
      parent.setAttribute("data-ff-square-spinner", "true");
      // Hide redundant overlapping running badge inside top tab bar.
      if (parent.closest('[role="tab"]')) {
        const badgeContainer = parent.parentElement;
        if (badgeContainer && badgeContainer !== document.body) {
          const br = badgeContainer.getBoundingClientRect();
          if (br.width >= 10 && br.width <= 20 && br.height >= 10 && br.height <= 20) {
            markedTabBadges.add(badgeContainer);
            badgeContainer.setAttribute("data-ff-tab-spinner", "true");
          }
        }
      }
    }
  };

  const scan = () => {
    frame = 0;
    for (const el of Array.from(markedArcs)) {
      if (!el.isConnected) markedArcs.delete(el);
    }
    for (const el of Array.from(markedHosts)) {
      if (!el.isConnected) markedHosts.delete(el);
    }
    for (const el of Array.from(markedTabBadges)) {
      if (!el.isConnected) markedTabBadges.delete(el);
    }
    for (const el of document.body.querySelectorAll("div")) {
      inspect(el);
    }
  };

  const schedule = () => {
    if (!frame) frame = window.requestAnimationFrame(scan);
  };

  schedule();
  const observer = new MutationObserver(() => schedule());
  observer.observe(document.body, { childList: true, subtree: true });

  return () => {
    if (frame) window.cancelAnimationFrame(frame);
    observer.disconnect();
    for (const el of markedArcs) {
      el.removeAttribute("data-ff-square-arc");
      el.style.removeProperty("--ff-spinner-color");
    }
    for (const el of markedHosts) {
      el.removeAttribute("data-ff-square-spinner");
    }
    for (const el of markedTabBadges) {
      el.removeAttribute("data-ff-tab-spinner");
    }
    markedArcs.clear();
    markedHosts.clear();
    markedTabBadges.clear();
  };
}

const SIDEBAR_NAV_ATTRS = [
  "data-ff-sidebar-nav-grid",
  "data-ff-sidebar-nav-full",
  "data-ff-sidebar-nav-cell",
  "data-ff-sidebar-nav-pad",
  "data-ff-sidebar-nav-row",
  "data-ff-sidebar-nav-btn",
  "data-ff-sidebar-nav-label",
] as const;

function mountSidebarNavGrid(): () => void {
  if (Platform.OS !== "web") return () => {};

  const HEADER_ITEM_SELECTOR =
    '[data-testid="sidebar-global-new-workspace"],[data-testid="sidebar-sessions"],[data-testid="sidebar-search"],[data-testid="sidebar-schedules"]';
  const tracked = new Set<DomElement>();
  const titledBtns = new Set<DomElement>();
  let frame = 0;

  const mark = (el: DomElement, attr: (typeof SIDEBAR_NAV_ATTRS)[number]) => {
    if (el.getAttribute(attr) !== "true") {
      el.setAttribute(attr, "true");
    }
    tracked.add(el);
  };

  const clearElement = (el: DomElement) => {
    for (const attr of SIDEBAR_NAV_ATTRS) {
      if (el.getAttribute(attr) !== null) el.removeAttribute(attr);
    }
  };

  const isInvalidContainer = (el: DomElement | null): boolean => {
    if (!el || el === document.body || el === document.documentElement) return true;
    if (
      el.querySelector(
        '[data-testid^="sidebar-workspace-row-"],[data-testid="sidebar-usage-icon"],textarea',
      )
    ) {
      return true;
    }
    return false;
  };

  const findCommonAncestor = (a: DomElement, b: DomElement): DomElement | null => {
    let cur: DomElement | null = a.parentElement;
    for (let depth = 0; cur && depth < 6; depth++) {
      if (cur.contains?.(b)) return isInvalidContainer(cur) ? null : cur;
      cur = cur.parentElement;
    }
    return null;
  };

  const collectGridItems = (root: DomElement): DomElement[] => {
    const out: DomElement[] = [];
    if (!root.children) return out;
    for (const child of root.children) {
      if (window.getComputedStyle?.(child)?.display === "contents") {
        out.push(...collectGridItems(child));
      } else {
        out.push(child);
      }
    }
    return out;
  };

  const findLabelChild = (btn: DomElement): DomElement | null => {
    if (!btn.children) return null;
    for (const child of btn.children) {
      if (child.querySelector("svg")) continue;
      if ((child.textContent ?? "").trim().length > 0) return child;
    }
    return null;
  };

  const scan = () => {
    frame = 0;

    // Prune disconnected references.
    for (const el of Array.from(tracked)) {
      if (!el.isConnected) tracked.delete(el);
    }
    for (const btn of Array.from(titledBtns)) {
      if (!btn.isConnected) titledBtns.delete(btn);
    }

    const anchors = Array.from(document.body.querySelectorAll(HEADER_ITEM_SELECTOR));
    const containers = new Set<DomElement>();

    if (anchors.length >= 2) {
      for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i]!;
        for (let j = i + 1; j < anchors.length; j++) {
          const anc = findCommonAncestor(a, anchors[j]!);
          if (anc) {
            containers.add(anc);
            break;
          }
        }
      }
    } else if (anchors.length === 1) {
      const btn = anchors[0]!;
      const containerCompact = btn.parentElement?.parentElement ?? null;
      const parent = containerCompact?.parentElement ?? null;
      if (parent && !isInvalidContainer(parent)) {
        // If wrapped in mobile firstRowItem -> firstRow, step up to SidebarNavRows.
        const grandParent = parent.parentElement;
        const greatGrandParent = grandParent?.parentElement ?? null;
        if (
          grandParent &&
          greatGrandParent &&
          !isInvalidContainer(greatGrandParent) &&
          Array.from(grandParent.querySelectorAll('button,[role="button"]')).length > 1
        ) {
          containers.add(greatGrandParent);
        } else {
          containers.add(parent);
        }
      }
    }

    // Keep only the outermost valid SidebarNavRows container per subtree.
    const resolvedContainers = Array.from(containers).filter(
      (c) => !Array.from(containers).some((other) => other !== c && other.contains?.(c)),
    );

    const nextMarked = new Set<DomElement>();
    const markActive = (el: DomElement, attr: (typeof SIDEBAR_NAV_ATTRS)[number]) => {
      mark(el, attr);
      nextMarked.add(el);
    };

    for (const gridEl of resolvedContainers) {
      const items = collectGridItems(gridEl);
      if (items.length < 2) continue;

      markActive(gridEl, "data-ff-sidebar-nav-grid");

      for (const item of items) {
        const buttons = Array.from(item.querySelectorAll('button,[role="button"]'));
        if (buttons.length === 0) continue;

        const isFullRow =
          Boolean(item.querySelector('[data-testid="sidebar-global-new-workspace"]')) ||
          buttons.length > 1;

        if (isFullRow) {
          markActive(item, "data-ff-sidebar-nav-full");
          for (const btn of buttons) {
            markActive(btn, "data-ff-sidebar-nav-btn");
            const rowEl = btn.parentElement;
            if (rowEl && item.contains?.(rowEl) && rowEl !== item) {
              markActive(rowEl, "data-ff-sidebar-nav-row");
              const padEl = rowEl.parentElement;
              if (padEl && item.contains?.(padEl) && padEl !== item) {
                markActive(padEl, "data-ff-sidebar-nav-pad");
              }
            }
          }
          continue;
        }

        const btn = buttons[0]!;
        markActive(item, "data-ff-sidebar-nav-cell");

        const rowEl = btn.parentElement;
        if (rowEl && item.contains?.(rowEl)) {
          markActive(rowEl, "data-ff-sidebar-nav-row");
          const padEl = rowEl.parentElement;
          if (padEl && item.contains?.(padEl) && padEl !== item) {
            markActive(padEl, "data-ff-sidebar-nav-pad");
          }
        }

        markActive(btn, "data-ff-sidebar-nav-btn");
        const labelEl = findLabelChild(btn);
        if (labelEl) {
          markActive(labelEl, "data-ff-sidebar-nav-label");
          const labelText = (labelEl.textContent ?? "").trim();
          if (labelText && !btn.getAttribute("title")) {
            btn.setAttribute("title", labelText);
            titledBtns.add(btn);
          }
        }
      }
    }

    // Clear stale attributes from elements no longer part of a sidebar nav grid.
    for (const el of Array.from(tracked)) {
      if (!nextMarked.has(el)) {
        clearElement(el);
        tracked.delete(el);
      }
    }
  };

  let scheduled = false;
  const runScan = () => {
    scheduled = false;
    frame = 0;
    scan();
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    frame = window.requestAnimationFrame(runScan);
    // Fallback for background tabs or immediate drawer transitions where rAF may be deferred.
    void Promise.resolve().then(() => {
      if (scheduled) {
        if (frame) window.cancelAnimationFrame(frame);
        runScan();
      }
    });
  };

  scan();
  const observer = new MutationObserver(() => schedule());
  observer.observe(document.body, { childList: true, subtree: true });

  return () => {
    scheduled = false;
    if (frame) window.cancelAnimationFrame(frame);
    observer.disconnect();
    for (const el of tracked) clearElement(el);
    tracked.clear();
    for (const btn of titledBtns) btn.removeAttribute("title");
    titledBtns.clear();
  };
}

function mountProjectTitleColors(): () => void {
  if (Platform.OS !== "web") return () => {};

  const coloredRows = new Set<DomElement>();
  const coloredTitles = new Set<DomElement>();
  let scheduled = false;

  const findIconBgColor = (iconBox: DomElement): string | null => {
    if (iconBox.querySelector("img")) return null;
    const candidates: DomElement[] = [iconBox, ...Array.from(iconBox.querySelectorAll("div"))];
    for (const el of candidates) {
      const bg = window.getComputedStyle?.(el)?.backgroundColor;
      if (bg && !isTransparentColor(bg)) return bg;
    }
    return null;
  };

  const scan = () => {
    scheduled = false;

    for (const row of Array.from(coloredRows)) {
      if (!row.isConnected) coloredRows.delete(row);
    }
    for (const el of Array.from(coloredTitles)) {
      if (!el.isConnected) coloredTitles.delete(el);
    }

    const activeRows = new Set<DomElement>();
    const activeTitles = new Set<DomElement>();

    for (const row of document.body.querySelectorAll('[data-testid^="sidebar-project-row-"]')) {
      const rowKids = row.children ? Array.from(row.children) : [];
      const left = rowKids[0];
      if (!left || !left.children) continue;
      const leftKids = Array.from(left.children);
      const iconBox = leftKids[0];
      const titleBox = leftKids[1];
      if (!iconBox || !titleBox) continue;

      const bgColor = findIconBgColor(iconBox);
      if (!bgColor) continue;

      row.style.setProperty("--ff-project-color", bgColor);
      coloredRows.add(row);
      activeRows.add(row);

      const titleTargets: DomElement[] = [titleBox, ...Array.from(titleBox.querySelectorAll("div,span"))];
      for (const t of titleTargets) {
        if (t.getAttribute("data-ff-project-title") !== "true") {
          t.setAttribute("data-ff-project-title", "true");
        }
        coloredTitles.add(t);
        activeTitles.add(t);
      }
    }

    for (const row of Array.from(coloredRows)) {
      if (!activeRows.has(row)) {
        row.style.removeProperty("--ff-project-color");
        coloredRows.delete(row);
      }
    }
    for (const el of Array.from(coloredTitles)) {
      if (!activeTitles.has(el)) {
        el.removeAttribute("data-ff-project-title");
        coloredTitles.delete(el);
      }
    }
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    void Promise.resolve().then(() => {
      if (scheduled) scan();
    });
  };

  scan();
  const observer = new MutationObserver(() => schedule());
  observer.observe(document.body, { childList: true, subtree: true });

  return () => {
    scheduled = false;
    observer.disconnect();
    for (const row of coloredRows) row.style.removeProperty("--ff-project-color");
    for (const el of coloredTitles) el.removeAttribute("data-ff-project-title");
    coloredRows.clear();
    coloredTitles.clear();
  };
}

function mountFanframeMotion(): () => void {
  if (Platform.OS !== "web") return () => {};
  const reducedMotion = () =>
    Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  const CARD_SELECTOR = '[data-fan-inline-viz],[data-fan-media-preview],details > :not(summary)';
  const TRIGGER_SELECTOR =
    'button,[role="button"],[tabindex="0"],[data-testid="tool-call-badge"],[data-testid="tool-call-group"],[data-testid="turn-summary"],summary';
  const animated = new WeakSet<DomElement>();
  const recentClickScopes = new Map<DomElement, number>();
  const preCollapseHeights = new WeakMap<DomElement, number>();
  const activeGhosts = new Set<DomElement>();

  const recordScopeFromTarget = (target: DomNode | null | undefined) => {
    if (!target || target.nodeType !== 1) return;
    const trigger = (target as DomElement).closest(TRIGGER_SELECTOR);
    if (!trigger) return;
    const now = performance.now();
    // Record ancestors up to 5 levels so React Native Web wrapper divs are covered
    // BEFORE React commits the expand/collapse DOM mutation.
    let scope = trigger.parentElement;
    for (let depth = 0; scope && scope !== document.body && depth < 5; depth++) {
      recentClickScopes.set(scope, now);
      if (scope.children) {
        for (const child of scope.children) {
          if (child === trigger || child.contains?.(trigger)) continue;
          if (child.getAttribute("data-ff-collapse-ghost") === "true") continue;
          const r = child.getBoundingClientRect();
          if (r.height >= 16 && r.height <= 900) {
            preCollapseHeights.set(child, Math.round(r.height));
          }
        }
      }
      scope = scope.parentElement;
    }
  };

  const onPointerDown = (rawEvent: unknown) => {
    const target = (rawEvent as { target?: DomNode | null })?.target;
    recordScopeFromTarget(target);
  };

  const onKeyDown = (rawEvent: unknown) => {
    const ev = rawEvent as { key?: string; target?: DomNode | null };
    if (ev?.key === "Enter" || ev?.key === " ") {
      recordScopeFromTarget(ev.target);
    }
  };

  // Use CAPTURE phase on pointerdown/keydown so scopes & pre-collapse heights are recorded
  // BEFORE React Native Web's Pressable handles the press and mutates the DOM.
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("keydown", onKeyDown, true);

  const isInRecentClickScope = (el: DomElement | null): boolean => {
    if (!el) return false;
    const now = performance.now();
    for (const [scope, ts] of recentClickScopes) {
      if (now - ts > 420 || !scope.isConnected) {
        recentClickScopes.delete(scope);
      }
    }
    let cur: DomElement | null = el;
    for (let depth = 0; cur && cur !== document.body && depth < 5; depth++) {
      if (recentClickScopes.has(cur)) return true;
      cur = cur.parentElement;
    }
    return false;
  };

  const playFade = (el: DomElement, duration: number, liftPx: number) => {
    if (reducedMotion() || animated.has(el) || typeof el.animate !== "function") return;
    animated.add(el);
    const keyframes =
      liftPx > 0
        ? [
            { opacity: 0, transform: `translateY(${liftPx}px)` },
            { opacity: 1, transform: "translateY(0px)" },
          ]
        : [{ opacity: 0 }, { opacity: 1 }];
    el.animate(keyframes, { duration, easing: "ease" });
  };

  const playDisclosureExpand = (el: DomElement) => {
    if (reducedMotion() || animated.has(el) || typeof el.animate !== "function") return;
    if (el.getAttribute("data-ff-collapse-ghost") === "true") return;
    if (el.closest('[role="dialog"],[role="menu"],[role="listbox"]')) return;
    const rect = el.getBoundingClientRect();
    if (rect.height < 14 || rect.height > 1200) return;
    animated.add(el);
    el.animate(
      [
        { opacity: 0, height: "0px", overflow: "hidden", transform: "translateY(-3px)" },
        { opacity: 1, height: `${Math.round(rect.height)}px`, overflow: "hidden", transform: "translateY(0px)" },
      ],
      { duration: 200, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
  };

  const playDisclosureCollapse = (
    parent: DomElement,
    removed: DomElement,
    nextSibling: DomNode | null,
  ) => {
    if (reducedMotion() || typeof removed.cloneNode !== "function" || typeof parent.insertBefore !== "function") {
      return;
    }
    if (removed.getAttribute("data-ff-collapse-ghost") === "true") return;
    if (parent.closest('[role="dialog"],[role="menu"],[role="listbox"]')) return;
    const height = preCollapseHeights.get(removed);
    if (!height || height < 16 || height > 900) return;
    preCollapseHeights.delete(removed);

    const ghost = removed.cloneNode(true);
    ghost.setAttribute("data-ff-collapse-ghost", "true");
    ghost.setAttribute("aria-hidden", "true");
    ghost.style.setProperty("pointer-events", "none");
    ghost.style.setProperty("overflow", "hidden");
    const refNode = nextSibling && nextSibling.parentElement === parent ? nextSibling : null;
    parent.insertBefore(ghost, refNode);
    activeGhosts.add(ghost);

    const cleanup = () => {
      activeGhosts.delete(ghost);
      ghost.remove();
    };
    const anim = ghost.animate?.(
      [
        { opacity: 1, height: `${height}px`, overflow: "hidden" },
        { opacity: 0, height: "0px", overflow: "hidden" },
      ],
      { duration: 160, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" },
    );
    if (anim) {
      anim.onfinish = cleanup;
      anim.oncancel = cleanup;
    } else {
      cleanup();
    }
  };

  const inspectAdded = (node: DomNode) => {
    if (node.nodeType !== 1) return;
    const el = node as DomElement;
    if (el.getAttribute("data-ff-collapse-ghost") === "true") return;
    if (el.matches(CARD_SELECTOR)) {
      playFade(el, 180, 4);
      return;
    }
    if (isInRecentClickScope(el.parentElement)) {
      playDisclosureExpand(el);
      return;
    }
    for (const card of el.querySelectorAll(CARD_SELECTOR)) {
      playFade(card, 180, 4);
    }
  };

  const observer = new MutationObserver((records) => {
    if (reducedMotion()) return;
    for (const record of records) {
      if (record.type !== "childList") continue;
      const parentEl = record.target.nodeType === 1 ? (record.target as DomElement) : null;
      for (const added of record.addedNodes) {
        inspectAdded(added);
      }
      if (parentEl && isInRecentClickScope(parentEl)) {
        for (const removed of record.removedNodes) {
          if (removed.nodeType === 1) {
            playDisclosureCollapse(parentEl, removed as DomElement, record.nextSibling);
          }
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("keydown", onKeyDown, true);
    for (const ghost of activeGhosts) ghost.remove();
    activeGhosts.clear();
    recentClickScopes.clear();
    observer.disconnect();
  };
}

// ==========================================================================
// FanFrame Visualize Sandboxed Iframe Host (Web / Desktop only)
// ==========================================================================

const VISUALIZE_ICONS_SVG = (() => {
  const icons: Record<string, string> = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M19 5l-1.5 1.5m-11 11L5 19"/>',
    cloud: '<path d="M7 18a4 4 0 0 1-.4-8A5.6 5.6 0 0 1 17 8.6a4.8 4.8 0 0 1 .5 9.4Z"/>',
    "cloud-sun":
      '<path d="M3.5 10a3.8 3.8 0 0 1 6.8-3.2M7 2v1.5M2.4 4.4l1 1M11.6 4.4l-1 1M2 9h1.5M8 19a3.4 3.4 0 0 1-.4-6.8 4.8 4.8 0 0 1 8.9-1.2 4 4 0 0 1 .5 8Z"/>',
    rain: '<path d="M6.5 14a3.2 3.2 0 0 1-.3-6.4 5.3 5.3 0 0 1 9.7-1.4 4 4 0 0 1 1.6 7.8ZM8 17l-1 3m6-3-1 3m6-3-1 3"/>',
    storm:
      '<path d="M7 14a3.5 3.5 0 0 1-.4-7 5 5 0 0 1 9.2-1.3 4.2 4.2 0 0 1 1.7 8.3H16m-4-2-2.5 5h4l-2.5 5"/>',
    snow: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 3.5l3 3 3-3m-6 17 3-3 3 3M3.5 10.4l4.1-1.1-1.1-4.1m11 13.6-1.1-4.1 4.1-1.1m-17 0 4.1 1.1-1.1 4.1m11-13.6-1.1 4.1 4.1 1.1"/>',
    wind: '<path d="M3 8h12a2.5 2.5 0 1 0-2.4-3M2 12h17a2 2 0 1 0-1.8-2.8M4 16h10a2.5 2.5 0 1 1-2.4 3"/>',
    thermometer:
      '<path d="M10 14.1V5a2 2 0 1 1 4 0v9.1a4 4 0 1 1-4 0ZM12 10v7"/><circle cx="12" cy="17.5" r="1" fill="currentColor" stroke="none"/>',
    "trend-up": '<path d="m3 17 6-6 4 4 7-8m-5 0h5v5"/>',
    "trend-down": '<path d="m3 7 6 6 4-4 7 8m-5 0h5v-5"/>',
    calendar:
      '<rect x="3" y="5" width="18" height="16" rx="1"/><path d="M7 3v4m10-4v4M3 10h18m-13 5h2m4 0h2"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    "chevron-right": '<path d="m9 5 7 7-7 7"/>',
  };
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" id="fanframe-viz-symbols" aria-hidden="true" focusable="false" width="0" height="0" style="position:absolute;overflow:hidden" fill="none"><defs>' +
    Object.keys(icons)
      .map(
        (name) =>
          `<symbol id="fanframe-icon-${name}" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</g></symbol>`,
      )
      .join("") +
    "</defs></svg>"
  );
})();

export interface MountVisualizeCardOptions {
  host: unknown;
  channel: string;
  html: string;
  isDark: boolean;
  colors: {
    background: string;
    foreground: string;
    muted: string;
    border: string;
    accent: string;
  };
  onHeight: (height: number) => void;
}

export function mountVisualizeCard(options: MountVisualizeCardOptions): () => void {
  if (Platform.OS !== "web") return () => {};
  const host = options.host as DomElement | null;
  if (!host || typeof host.appendChild !== "function") return () => {};

  const { channel, html, isDark, colors, onHeight } = options;
  const series1 = isDark ? "#ddbc86" : "#815817";
  const series2 = isDark ? "#9cb8dc" : "#42658e";
  const highlight = isDark ? "#a4cccc" : "hsl(180, 28.17%, 32%)";
  const scheme = isDark ? "dark" : "light";
  const channelJson = JSON.stringify(channel).replace(/</g, "\\u003c");

  const srcdoc = `<!doctype html>
<html style="color-scheme:${scheme};--fanframe-viz-background:${colors.background};--fanframe-viz-foreground:${colors.foreground};--fanframe-viz-muted:${colors.muted};--fanframe-viz-border:${colors.border};--fanframe-viz-accent:${colors.accent};--fanframe-viz-focus:${colors.accent};--fanframe-viz-series-1:${series1};--fanframe-viz-series-2:${series2};--fanframe-viz-highlight:${highlight};">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:;" />
<style>
*, *::before, *::after { box-sizing: border-box; border-radius: 0; }
:root { overflow-x: auto; overflow-y: hidden; background: color-mix(in srgb, var(--fanframe-viz-background) 96%, var(--fanframe-viz-foreground)); color: var(--fanframe-viz-foreground); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 13px; line-height: 1.5; }
body { margin: 0; overflow-x: auto; overflow-y: hidden; }
#fanframe-visualize-content {
  padding: 10px 14px 12px;
  --fan-viz-control-border: color-mix(in srgb, var(--fanframe-viz-muted) 24%, var(--fanframe-viz-background));
  --fan-viz-control-hover: color-mix(in srgb, var(--fanframe-viz-foreground) 8%, var(--fanframe-viz-background));
  --fan-viz-control-ink: var(--fanframe-viz-foreground);
  --fan-viz-control-focus: var(--fanframe-viz-focus);
}
#fanframe-visualize-content :is(button, select) {
  color: var(--fan-viz-control-ink); background: var(--fanframe-viz-background); border: 1px solid var(--fan-viz-control-border);
  min-block-size: 28px; padding: 3px 9px; font: inherit; cursor: pointer; outline: none;
}
#fanframe-visualize-content :is(button, select):hover { background: var(--fan-viz-control-hover); }
#fanframe-visualize-content :is(button, select):focus-visible { border-color: var(--fan-viz-control-focus); }
#fanframe-visualize-content input[type=range] { appearance: none; inline-size: 10em; block-size: 24px; background: none; cursor: pointer; outline: none; }
#fanframe-visualize-content input[type=range]::-webkit-slider-runnable-track { height: 1px; background: var(--fan-viz-control-border); }
#fanframe-visualize-content input[type=range]::-webkit-slider-thumb { appearance: none; width: 10px; height: 10px; margin-top: -4.5px; background: var(--fan-viz-control-ink); transform: rotate(45deg); }
#fanframe-visualize-content input[type=range]:hover::-webkit-slider-thumb { background: var(--fan-viz-control-focus); }
</style>
<script>
(function(){
  var ch = ${channelJson};
  var frame = 0;
  function measure(){
    frame = 0;
    var root = document.getElementById('fanframe-visualize-content');
    if(!root) return;
    var h = Math.ceil(Math.max(root.scrollHeight, root.getBoundingClientRect().height)) + 2;
    parent.postMessage({ type: 'paseo-fanframe:viz:height', channel: ch, height: h }, '*');
  }
  function schedule(){ if(!frame) frame = requestAnimationFrame(measure); }
  window.addEventListener('load', schedule);
  window.addEventListener('resize', schedule);
  document.addEventListener('DOMContentLoaded', function(){
    var root = document.getElementById('fanframe-visualize-content');
    if(root && typeof ResizeObserver === 'function'){ new ResizeObserver(schedule).observe(root); }
    if(root && typeof MutationObserver === 'function'){ new MutationObserver(schedule).observe(root, { childList:true, subtree:true, attributes:true, characterData:true }); }
    schedule();
  }, { once: true });
})();
</script>
</head>
<body>${VISUALIZE_ICONS_SVG}<div id="fanframe-visualize-content">${html}</div></body>
</html>`;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.setAttribute("scrolling", "no");
  iframe.setAttribute("srcdoc", srcdoc);
  iframe.setAttribute("title", "FanFrame Visualization");
  iframe.style.setProperty("width", "100%");
  iframe.style.setProperty("height", "100%");
  iframe.style.setProperty("border", "0");
  iframe.style.setProperty("display", "block");
  host.appendChild(iframe);

  const onMessage = (rawEvent: unknown) => {
    const ev = rawEvent as {
      data?: { type?: string; channel?: string; height?: number };
    };
    if (
      ev?.data?.type === "paseo-fanframe:viz:height" &&
      ev.data.channel === channel &&
      typeof ev.data.height === "number"
    ) {
      onHeight(ev.data.height);
    }
  };
  window.addEventListener("message", onMessage);

  return () => {
    window.removeEventListener("message", onMessage);
    iframe.remove();
  };
}

// ==========================================================================
// FanFrame Cross-Device Image Compression & DOM Helpers (Web / Desktop only)
// ==========================================================================

export type CrossImageMime = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export interface PreparedWebImage {
  name: string;
  mimeType: CrossImageMime;
  width: number;
  height: number;
  bytes: Uint8Array;
  originalSize: number;
  compressedSize: number;
  previewUrl: string;
}

const MAX_RAW_CROSS_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_COMPRESSED_LONG_EDGE = 1600;
const JPEG_QUALITY = 0.85;
const WEBP_QUALITY = 0.86;
const MAX_SHARED_URL_CACHE = 80;

const sharedImageUrlCache = new Map<string, string>();
const sharedImagePending = new Map<string, Promise<string>>();

export function clearCrossImageUrlCache(): void {
  if (Platform.OS === "web") {
    for (const url of sharedImageUrlCache.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Ignore cleanup errors.
      }
    }
  }
  sharedImageUrlCache.clear();
  sharedImagePending.clear();
}

export function createWebBlobUrl(bytes: Uint8Array, mimeType: string): string {
  if (Platform.OS !== "web") return "";
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

export function decodeUtf8Bytes(bytes: Uint8Array, maxChars = 65536): string {
  if (typeof TextDecoder === "function") {
    return new TextDecoder("utf-8").decode(bytes).slice(0, maxChars);
  }
  let out = "";
  const limit = Math.min(bytes.length, maxChars);
  for (let i = 0; i < limit; i++) {
    out += String.fromCharCode(bytes[i] ?? 0);
  }
  return out;
}

export interface WebMediaPlayerState {
  playing: boolean;
  currentTime: number;
  duration: number;
  muted: boolean;
  ready: boolean;
  ended: boolean;
}

export interface WebMediaPlayerHandle {
  togglePlay(): void;
  seek(seconds: number): void;
  seekRatio(ratio: number): void;
  toggleMute(): void;
  download(): void;
  toggleFullscreen(): void;
  destroy(): void;
}

interface DomMediaElement extends DomElement {
  src: string;
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly ended: boolean;
  muted: boolean;
  load?: () => void;
  play(): Promise<void> | void;
  pause(): void;
  requestFullscreen?: () => Promise<void> | void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

interface DomPointerTarget extends DomElement {
  setPointerCapture?(pointerId: number): void;
  releasePointerCapture?(pointerId: number): void;
  addEventListener(
    type: string,
    listener: (ev: unknown) => void,
    options?: boolean | { passive?: boolean; capture?: boolean },
  ): void;
  removeEventListener(
    type: string,
    listener: (ev: unknown) => void,
    options?: boolean | { passive?: boolean; capture?: boolean },
  ): void;
}

interface DomAnchorElement extends DomElement {
  href: string;
  download: string;
  click(): void;
}

export function createWebMediaPlayer(
  host: unknown,
  options: {
    kind: "audio" | "video";
    bytes: Uint8Array;
    mime: string;
    filename: string;
    onState: (state: WebMediaPlayerState) => void;
  },
): WebMediaPlayerHandle | null {
  if (Platform.OS !== "web") return null;
  const container = host as DomElement | null;
  if (!container || typeof container.appendChild !== "function") return null;

  const blobUrl = URL.createObjectURL(new Blob([options.bytes], { type: options.mime }));
  const media = document.createElement(options.kind) as unknown as DomMediaElement;
  // Local blob is already in memory; preload="auto" ensures mobile browsers decode duration immediately.
  media.setAttribute(
    "preload",
    options.kind === "audio" || options.bytes.byteLength <= 8 * 1024 * 1024 ? "auto" : "metadata",
  );
  if (options.kind === "video") {
    media.setAttribute("playsinline", "");
    media.style.setProperty("display", "block");
    media.style.setProperty("width", "100%");
    media.style.setProperty("max-height", "360px");
    media.style.setProperty("height", "auto");
    media.style.setProperty("background", "#000");
    media.style.setProperty("cursor", "pointer");
  } else {
    media.style.setProperty("display", "none");
  }
  media.src = blobUrl;

  let pendingSeekRatio: number | null = null;

  const readDuration = (): number =>
    Number.isFinite(media.duration) && media.duration > 0 ? media.duration : 0;

  const emit = () => {
    const dur = readDuration();
    if (dur > 0 && pendingSeekRatio !== null) {
      const target = Math.max(0, Math.min(dur, pendingSeekRatio * dur));
      pendingSeekRatio = null;
      media.currentTime = target;
    }
    const cur = Number.isFinite(media.currentTime) && media.currentTime >= 0 ? media.currentTime : 0;
    options.onState({
      playing: !media.paused && !media.ended,
      currentTime: dur > 0 ? Math.min(cur, dur) : cur,
      duration: dur,
      muted: Boolean(media.muted),
      ready: dur > 0,
      ended: Boolean(media.ended),
    });
  };

  const togglePlay = () => {
    if (media.paused || media.ended) {
      if (media.ended) media.currentTime = 0;
      const p = media.play();
      if (p && typeof (p as Promise<void>).catch === "function") {
        void (p as Promise<void>).catch(() => undefined);
      }
    } else {
      media.pause();
    }
    emit();
  };

  const onVideoClick = () => {
    if (options.kind === "video") togglePlay();
  };

  const events = [
    "loadedmetadata",
    "loadeddata",
    "canplay",
    "durationchange",
    "timeupdate",
    "seeking",
    "seeked",
    "play",
    "pause",
    "ended",
    "volumechange",
  ];
  for (const ev of events) media.addEventListener(ev, emit);
  if (options.kind === "video") media.addEventListener("click", onVideoClick);

  container.appendChild(media);
  media.load?.();
  emit();

  return {
    togglePlay,
    seek(seconds: number) {
      const dur = readDuration();
      if (dur <= 0) return;
      media.currentTime = Math.max(0, Math.min(dur, seconds));
      emit();
    },
    seekRatio(ratio: number) {
      const clamped = Math.max(0, Math.min(1, ratio));
      const dur = readDuration();
      if (dur > 0) {
        pendingSeekRatio = null;
        media.currentTime = clamped * dur;
        emit();
      } else {
        pendingSeekRatio = clamped;
        media.load?.();
      }
    },
    toggleMute() {
      media.muted = !media.muted;
      emit();
    },
    download() {
      const a = document.createElement("a") as unknown as DomAnchorElement;
      a.href = blobUrl;
      a.download = options.filename || (options.kind === "audio" ? "audio" : "video");
      a.style.setProperty("display", "none");
      document.body.appendChild(a);
      a.click();
      a.remove();
    },
    toggleFullscreen() {
      if (options.kind === "video") {
        const res = media.requestFullscreen?.();
        if (res && typeof (res as Promise<void>).catch === "function") {
          void (res as Promise<void>).catch(() => undefined);
        }
      }
    },
    destroy() {
      media.pause();
      for (const ev of events) media.removeEventListener(ev, emit);
      if (options.kind === "video") media.removeEventListener("click", onVideoClick);
      media.remove();
      revokeWebPreviewUrl(blobUrl);
    },
  };
}

export function bindWebScrubber(
  host: unknown,
  onRatio: (ratio: number) => void,
  onScrubbingChange?: (scrubbing: boolean) => void,
): () => void {
  if (Platform.OS !== "web") return () => {};
  const el = host as DomPointerTarget | null;
  if (!el || typeof el.addEventListener !== "function") return () => {};

  el.style.setProperty("touch-action", "none");
  el.style.setProperty("user-select", "none");
  el.style.setProperty("-webkit-user-select", "none");
  el.style.setProperty("cursor", "pointer");

  let pointerDragging = false;
  let touchDragging = false;
  let activePointerId: number | null = null;

  const ratioFromClientX = (clientX: number): number => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  const extractTouchX = (rawEvent: unknown): number | null => {
    const ev = rawEvent as {
      touches?: ArrayLike<{ clientX?: number }>;
      changedTouches?: ArrayLike<{ clientX?: number }>;
    };
    const point =
      (ev.touches && ev.touches.length > 0 ? ev.touches[0] : null) ??
      (ev.changedTouches && ev.changedTouches.length > 0 ? ev.changedTouches[0] : null);
    return typeof point?.clientX === "number" ? point.clientX : null;
  };

  const onTouchStart = (rawEvent: unknown) => {
    const x = extractTouchX(rawEvent);
    if (x === null) return;
    (rawEvent as { preventDefault?: () => void }).preventDefault?.();
    (rawEvent as { stopPropagation?: () => void }).stopPropagation?.();
    touchDragging = true;
    onScrubbingChange?.(true);
    onRatio(ratioFromClientX(x));
  };

  const onTouchMove = (rawEvent: unknown) => {
    if (!touchDragging) return;
    const x = extractTouchX(rawEvent);
    if (x === null) return;
    (rawEvent as { preventDefault?: () => void }).preventDefault?.();
    (rawEvent as { stopPropagation?: () => void }).stopPropagation?.();
    onRatio(ratioFromClientX(x));
  };

  const onTouchEnd = (rawEvent: unknown) => {
    if (!touchDragging) return;
    const x = extractTouchX(rawEvent);
    if (x !== null) onRatio(ratioFromClientX(x));
    touchDragging = false;
    onScrubbingChange?.(false);
  };

  const onPointerDown = (rawEvent: unknown) => {
    const ev = rawEvent as {
      pointerType?: string;
      pointerId?: number;
      clientX?: number;
      preventDefault?: () => void;
      stopPropagation?: () => void;
    };
    if (ev.pointerType === "touch") return;
    ev.preventDefault?.();
    ev.stopPropagation?.();
    pointerDragging = true;
    onScrubbingChange?.(true);
    if (typeof ev.pointerId === "number") {
      activePointerId = ev.pointerId;
      try {
        el.setPointerCapture?.(ev.pointerId);
      } catch {
        // Ignore capture failure on synthetic events.
      }
    }
    if (typeof ev.clientX === "number") onRatio(ratioFromClientX(ev.clientX));
  };

  const onPointerMove = (rawEvent: unknown) => {
    if (!pointerDragging) return;
    const ev = rawEvent as {
      pointerType?: string;
      clientX?: number;
      preventDefault?: () => void;
      stopPropagation?: () => void;
    };
    if (ev.pointerType === "touch") return;
    ev.preventDefault?.();
    ev.stopPropagation?.();
    if (typeof ev.clientX === "number") onRatio(ratioFromClientX(ev.clientX));
  };

  const onPointerEnd = () => {
    if (!pointerDragging) return;
    pointerDragging = false;
    onScrubbingChange?.(false);
    if (activePointerId !== null) {
      try {
        el.releasePointerCapture?.(activePointerId);
      } catch {
        // Ignore release errors.
      }
      activePointerId = null;
    }
  };

  el.addEventListener("touchstart", onTouchStart, { passive: false });
  el.addEventListener("touchmove", onTouchMove, { passive: false });
  el.addEventListener("touchend", onTouchEnd);
  el.addEventListener("touchcancel", onTouchEnd);
  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerEnd);
  el.addEventListener("pointercancel", onPointerEnd);

  return () => {
    el.removeEventListener("touchstart", onTouchStart, { passive: false });
    el.removeEventListener("touchmove", onTouchMove, { passive: false });
    el.removeEventListener("touchend", onTouchEnd);
    el.removeEventListener("touchcancel", onTouchEnd);
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerup", onPointerEnd);
    el.removeEventListener("pointercancel", onPointerEnd);
  };
}

export function mountWebMediaElement(
  host: unknown,
  options: {
    kind: "video" | "audio" | "pdf";
    bytes: Uint8Array;
    mime: string;
    title: string;
  },
): () => void {
  if (Platform.OS !== "web") return () => {};
  const container = host as DomElement | null;
  if (!container || typeof container.appendChild !== "function") return () => {};

  const blobUrl = URL.createObjectURL(new Blob([options.bytes], { type: options.mime }));
  let el: DomElement;

  if (options.kind === "video") {
    el = document.createElement("video");
    el.setAttribute("controls", "");
    el.setAttribute("preload", "metadata");
    el.setAttribute("playsinline", "");
    el.setAttribute("src", blobUrl);
    el.style.setProperty("display", "block");
    el.style.setProperty("width", "100%");
    el.style.setProperty("max-height", "360px");
    el.style.setProperty("height", "auto");
    el.style.setProperty("background", "#000");
  } else if (options.kind === "audio") {
    el = document.createElement("audio");
    el.setAttribute("controls", "");
    el.setAttribute("preload", "metadata");
    el.setAttribute("src", blobUrl);
    el.style.setProperty("display", "block");
    el.style.setProperty("width", "100%");
    el.style.setProperty("padding", "6px 8px");
    el.style.setProperty("box-sizing", "border-box");
  } else {
    el = document.createElement("iframe");
    el.setAttribute("src", blobUrl);
    el.setAttribute("title", options.title);
    el.style.setProperty("display", "block");
    el.style.setProperty("width", "100%");
    el.style.setProperty("height", "420px");
    el.style.setProperty("border", "0");
  }

  container.appendChild(el);
  return () => {
    el.remove();
    revokeWebPreviewUrl(blobUrl);
  };
}

export function revokeWebPreviewUrl(url: string | null | undefined): void {
  if (Platform.OS !== "web" || !url) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    // Ignore revoke failures.
  }
}

function normalizeImageMime(type: string | undefined, name: string | undefined): CrossImageMime | null {
  const lower = (type ?? "").toLowerCase().trim();
  if (lower === "image/jpeg" || lower === "image/jpg") return "image/jpeg";
  if (lower === "image/png") return "image/png";
  if (lower === "image/webp") return "image/webp";
  if (lower === "image/gif") return "image/gif";
  const fileLower = (name ?? "").toLowerCase();
  if (fileLower.endsWith(".jpg") || fileLower.endsWith(".jpeg")) return "image/jpeg";
  if (fileLower.endsWith(".png")) return "image/png";
  if (fileLower.endsWith(".webp")) return "image/webp";
  if (fileLower.endsWith(".gif")) return "image/gif";
  return null;
}

function canvasHasTransparency(ctx: DomCanvasContext, width: number, height: number): boolean {
  try {
    const data = ctx.getImageData(0, 0, width, height).data;
    for (let i = 3; i < data.length; i += 4) {
      if ((data[i] ?? 255) < 252) return true;
    }
    return false;
  } catch {
    return true;
  }
}

function encodeCanvasBlob(
  canvas: DomCanvasElement,
  mime: CrossImageMime,
  quality: number,
): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        void blob
          .arrayBuffer()
          .then((ab) => resolve(new Uint8Array(ab)))
          .catch(() => resolve(null));
      },
      mime,
      quality,
    );
  });
}

function loadDomImage(blobUrl: string): Promise<DomImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("无法解码图片内容"));
    img.src = blobUrl;
  });
}

export async function prepareCrossImageFile(
  rawFile: unknown,
  options: { keepOriginal: boolean },
): Promise<PreparedWebImage> {
  if (Platform.OS !== "web") {
    throw new Error("当前运行环境不支持浏览器图片处理。");
  }
  const file = rawFile as DomWebFile | null;
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new Error("无效的图片文件。");
  }
  const mime = normalizeImageMime(file.type, file.name);
  if (!mime) {
    throw new Error("仅支持 JPG、PNG、WebP 或 GIF 图片。");
  }
  if (file.size <= 0) {
    throw new Error("图片文件为空。");
  }
  if (file.size > MAX_RAW_CROSS_IMAGE_BYTES) {
    throw new Error("单张图片不能超过 20 MiB。");
  }

  const rawBytes = new Uint8Array(await file.arrayBuffer());
  const rawName = (file.name ?? "").trim() || `image.${mime.split("/")[1] ?? "png"}`;
  const tempUrl = URL.createObjectURL(new Blob([rawBytes], { type: mime }));

  let width = 0;
  let height = 0;
  let finalBytes: Uint8Array = rawBytes;
  let finalMime: CrossImageMime = mime;

  try {
    const img = await loadDomImage(tempUrl);
    width = img.naturalWidth || 0;
    height = img.naturalHeight || 0;

    // Never rasterize animated GIFs or explicit keepOriginal uploads.
    if (!options.keepOriginal && mime !== "image/gif" && width > 0 && height > 0) {
      const longEdge = Math.max(width, height);
      const scale = longEdge > MAX_COMPRESSED_LONG_EDGE ? MAX_COMPRESSED_LONG_EDGE / longEdge : 1;
      const targetW = Math.max(1, Math.round(width * scale));
      const targetH = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement("canvas") as unknown as DomCanvasElement;
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0, targetW, targetH);
        const checkAlpha = mime === "image/png" || mime === "image/webp";
        const hasAlpha = checkAlpha && canvasHasTransparency(ctx, targetW, targetH);
        const candidateMime: CrossImageMime = hasAlpha ? "image/webp" : "image/jpeg";
        const quality = hasAlpha ? WEBP_QUALITY : JPEG_QUALITY;
        const encoded = await encodeCanvasBlob(canvas, candidateMime, quality);
        const shrunk = scale < 1;
        if (encoded && (shrunk || encoded.byteLength < rawBytes.byteLength)) {
          finalBytes = encoded;
          finalMime = candidateMime;
          width = targetW;
          height = targetH;
        }
      }
    }
  } finally {
    revokeWebPreviewUrl(tempUrl);
  }

  const previewUrl = URL.createObjectURL(new Blob([finalBytes], { type: finalMime }));
  return {
    name: rawName,
    mimeType: finalMime,
    width,
    height,
    bytes: finalBytes,
    originalSize: rawBytes.byteLength,
    compressedSize: finalBytes.byteLength,
    previewUrl,
  };
}

export function packCrossImageUploadPacket(
  header: { agentId: string; name: string; mimeType: CrossImageMime; width: number; height: number },
  bytes: Uint8Array,
): Uint8Array {
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(4 + headerBytes.byteLength + bytes.byteLength);
  new DataView(out.buffer).setUint32(0, headerBytes.byteLength, false);
  out.set(headerBytes, 4);
  out.set(bytes, 4 + headerBytes.byteLength);
  return out;
}

export function encodeBytesToDataUri(bytes: Uint8Array, mimeType: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const hasB1 = i + 1 < bytes.length;
    const hasB2 = i + 2 < bytes.length;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    const triplet = (b0 << 16) | (b1 << 8) | b2;
    out += alphabet[(triplet >> 18) & 0x3f];
    out += alphabet[(triplet >> 12) & 0x3f];
    out += hasB1 ? alphabet[(triplet >> 6) & 0x3f] : "=";
    out += hasB2 ? alphabet[triplet & 0x3f] : "=";
  }
  return `data:${mimeType};base64,${out}`;
}

export async function resolveCrossImagePreviewUri(
  imageId: string,
  mimeType: CrossImageMime,
  readBytes: (imageId: string) => Promise<Uint8Array>,
): Promise<string> {
  const cached = sharedImageUrlCache.get(imageId);
  if (cached) {
    // Refresh LRU order.
    sharedImageUrlCache.delete(imageId);
    sharedImageUrlCache.set(imageId, cached);
    return cached;
  }
  const existing = sharedImagePending.get(imageId);
  if (existing) return existing;

  const task = (async () => {
    const bytes = await readBytes(imageId);
    const uri =
      Platform.OS === "web"
        ? URL.createObjectURL(new Blob([bytes], { type: mimeType }))
        : encodeBytesToDataUri(bytes, mimeType);
    if (sharedImageUrlCache.size >= MAX_SHARED_URL_CACHE) {
      const oldestKey = sharedImageUrlCache.keys().next().value;
      if (oldestKey) {
        const oldestUrl = sharedImageUrlCache.get(oldestKey);
        sharedImageUrlCache.delete(oldestKey);
        if (Platform.OS === "web" && oldestUrl) revokeWebPreviewUrl(oldestUrl);
      }
    }
    sharedImageUrlCache.set(imageId, uri);
    return uri;
  })().finally(() => {
    sharedImagePending.delete(imageId);
  });

  sharedImagePending.set(imageId, task);
  return task;
}

export function openWebImagePicker(onFiles: (files: unknown[]) => void): () => void {
  if (Platform.OS !== "web") return () => {};
  const input = document.createElement("input") as unknown as DomInputElement;
  input.type = "file";
  input.accept = "image/jpeg,image/png,image/webp,image/gif,image/*";
  input.multiple = true;

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    input.removeEventListener("change", onChange);
    input.removeEventListener("cancel", cleanup);
    input.remove();
  };
  const onChange = () => {
    const selected = input.files ? Array.from(input.files) : [];
    cleanup();
    if (selected.length > 0) onFiles(selected);
  };

  input.addEventListener("change", onChange, { once: true });
  input.addEventListener("cancel", cleanup, { once: true });
  input.style.setProperty("display", "none");
  document.body.appendChild(input);
  input.click();
  return cleanup;
}

export function attachWebPasteAndDrop(
  host: unknown,
  callbacks: {
    onFiles: (files: unknown[]) => void;
    onDragChange?: (dragging: boolean) => void;
  },
): () => void {
  if (Platform.OS !== "web") return () => {};
  const el = host as (DomElement & {
    addEventListener?(type: string, fn: (ev: unknown) => void): void;
    removeEventListener?(type: string, fn: (ev: unknown) => void): void;
  }) | null;

  let dragDepth = 0;

  const extractClipboardImages = (rawEvent: unknown): DomWebFile[] => {
    const cd = (rawEvent as {
      clipboardData?: {
        files?: ArrayLike<DomWebFile>;
        items?: ArrayLike<{ kind?: string; type?: string; getAsFile?: () => DomWebFile | null }>;
      };
    })?.clipboardData;
    if (!cd) return [];
    const out: DomWebFile[] = [];
    if (cd.items) {
      for (let i = 0; i < cd.items.length; i++) {
        const item = cd.items[i];
        if (item?.kind === "file" && typeof item.getAsFile === "function") {
          const f = item.getAsFile();
          if (f && (!f.type || f.type.startsWith("image/"))) out.push(f);
        }
      }
    }
    if (out.length === 0 && cd.files) {
      for (let i = 0; i < cd.files.length; i++) {
        const f = cd.files[i];
        if (f && (!f.type || f.type.startsWith("image/"))) out.push(f);
      }
    }
    return out;
  };

  const onPaste = (rawEvent: unknown) => {
    const imgs = extractClipboardImages(rawEvent);
    if (imgs.length === 0) return;
    (rawEvent as { preventDefault?: () => void }).preventDefault?.();
    callbacks.onFiles(imgs);
  };

  const hasFileTransfer = (rawEvent: unknown): boolean => {
    const types = (rawEvent as { dataTransfer?: { types?: ArrayLike<string> } })?.dataTransfer?.types;
    if (!types) return false;
    for (let i = 0; i < types.length; i++) {
      if (types[i] === "Files") return true;
    }
    return false;
  };

  const onDragEnter = (rawEvent: unknown) => {
    if (!hasFileTransfer(rawEvent)) return;
    (rawEvent as { preventDefault?: () => void }).preventDefault?.();
    dragDepth += 1;
    callbacks.onDragChange?.(true);
  };

  const onDragOver = (rawEvent: unknown) => {
    if (!hasFileTransfer(rawEvent)) return;
    (rawEvent as { preventDefault?: () => void }).preventDefault?.();
  };

  const onDragLeave = (rawEvent: unknown) => {
    if (!hasFileTransfer(rawEvent)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) callbacks.onDragChange?.(false);
  };

  const onDrop = (rawEvent: unknown) => {
    (rawEvent as { preventDefault?: () => void }).preventDefault?.();
    dragDepth = 0;
    callbacks.onDragChange?.(false);
    const files = (rawEvent as { dataTransfer?: { files?: ArrayLike<DomWebFile> } })?.dataTransfer?.files;
    if (!files || files.length === 0) return;
    const list: DomWebFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f) list.push(f);
    }
    if (list.length > 0) callbacks.onFiles(list);
  };

  window.addEventListener("paste", onPaste);
  el?.addEventListener?.("dragenter", onDragEnter);
  el?.addEventListener?.("dragover", onDragOver);
  el?.addEventListener?.("dragleave", onDragLeave);
  el?.addEventListener?.("drop", onDrop);

  return () => {
    window.removeEventListener("paste", onPaste);
    el?.removeEventListener?.("dragenter", onDragEnter);
    el?.removeEventListener?.("dragover", onDragOver);
    el?.removeEventListener?.("dragleave", onDragLeave);
    el?.removeEventListener?.("drop", onDrop);
  };
}
