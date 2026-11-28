import type { PluginClientContext } from "@getpaseo/plugin/client";
import { contributeAskQuestion } from "./client/ask-question";
import { contributeCrossImage } from "./client/cross-image";
import { contributeRichMessage } from "./client/rich-message";
import { FanframeSettings } from "./client/settings";
import { contributeStatusByProjectSidebarView } from "./client/sidebar-status-projects";
import { FANFRAME_DARK_THEME, FANFRAME_LIGHT_THEME } from "./client/themes";
import { FanframeVisualizeCard } from "./client/visualize";
import { installFanframeWeb } from "./client/web";
import {
  VISUALIZE_TIMELINE_KIND,
  VISUALIZE_TIMELINE_VERSION,
  visualizeTimelineDataSchema,
} from "./shared/visualize";

export default function contribute(client: PluginClientContext) {
  const removeDark = client.addTheme(FANFRAME_DARK_THEME);
  const removeLight = client.addTheme(FANFRAME_LIGHT_THEME);
  const removeSettings = client.addSettingsScreen({
    id: "fanframe-settings",
    title: "FanFrame",
    icon: "Sparkles",
    Component: FanframeSettings,
  });
  const removeVisualizer = client.addTimelineRenderer({
    kind: VISUALIZE_TIMELINE_KIND,
    version: VISUALIZE_TIMELINE_VERSION,
    schema: visualizeTimelineDataSchema,
    Component: FanframeVisualizeCard,
  });
  const cleanupWeb = installFanframeWeb();

  const cleanupCrossImage = contributeCrossImage(client);
  const cleanupAskQuestion = contributeAskQuestion(client);
  const cleanupRichMessage = contributeRichMessage(client);
  const removeSidebarView = contributeStatusByProjectSidebarView(client);

  return () => {
    removeSidebarView();
    cleanupRichMessage();
    cleanupAskQuestion();
    cleanupCrossImage();
    cleanupWeb();
    removeVisualizer();
    removeSettings();
    removeLight();
    removeDark();
  };
}
