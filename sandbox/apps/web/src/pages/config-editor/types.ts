import type { GameConfig } from "../../lib/types.ts";

export interface VisualPanelProps {
  config: GameConfig;
  onChange: (updated: GameConfig) => void;
}
