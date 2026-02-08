import type { VisualPanelProps } from "./types.ts";
import type { StatClamp } from "../../lib/types.ts";
import StatMapEditor from "./StatMapEditor.tsx";
import { useState } from "react";

// ---- Algorithm option definitions ----

const GROWTH_ALGORITHMS = ["flat", "linear", "exponential"] as const;
const LEVEL_COST_ALGORITHMS = ["flat", "free", "linear_cost"] as const;

function defaultGrowthParams(algorithmId: string): Record<string, unknown> | undefined {
  if (algorithmId === "linear") return { perLevelMultiplier: 1 };
  if (algorithmId === "exponential") return { exponent: 1.1 };
  return undefined;
}

function defaultLevelCostParams(algorithmId: string): Record<string, unknown> | undefined {
  if (algorithmId === "linear_cost") return { resourceId: "xp", base: 10, perLevel: 5 };
  return undefined;
}

// ---- Algorithm card ----

function AlgorithmCard({
  title,
  algorithmId,
  params,
  options,
  onChangeId,
  onChangeParams,
  knownStats,
}: {
  title: string;
  algorithmId: string;
  params: Record<string, unknown> | undefined;
  options: readonly string[];
  onChangeId: (id: string) => void;
  onChangeParams: (params: Record<string, unknown> | undefined) => void;
  knownStats: string[];
}) {
  return (
    <div className="rounded-lg bg-gray-800 border border-gray-700 p-3 space-y-2">
      <h4 className="text-sm font-semibold text-white">{title}</h4>
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-400">Algorithm:</label>
        <select
          value={algorithmId}
          onChange={(e) => onChangeId(e.target.value)}
          className="rounded bg-gray-900 border border-gray-700 px-2 py-0.5 text-xs text-gray-300 focus:border-blue-500 focus:outline-none"
        >
          {options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>

      {/* Params based on algorithmId */}
      {algorithmId === "linear" && params && (
        <div className="space-y-2 pl-2 border-l-2 border-gray-700">
          <label className="text-xs text-gray-400 flex items-center gap-2">
            perLevelMultiplier:
            <input
              type="number"
              step="0.1"
              value={(params["perLevelMultiplier"] as number | undefined) ?? 1}
              onChange={(e) => onChangeParams({ ...params, perLevelMultiplier: Number(e.target.value) })}
              className="w-20 rounded bg-gray-900 border border-gray-700 px-2 py-0.5 text-xs text-white focus:border-blue-500 focus:outline-none"
            />
          </label>
          <StatMapEditor
            stats={(params["additivePerLevel"] as Record<string, number> | undefined) ?? {}}
            knownStats={knownStats}
            onChange={(s) => {
              if (Object.keys(s).length === 0) {
                const { additivePerLevel: _, ...rest } = params;
                onChangeParams(rest);
              } else {
                onChangeParams({ ...params, additivePerLevel: s });
              }
            }}
            label="additivePerLevel (optional)"
          />
        </div>
      )}
      {algorithmId === "exponential" && params && (
        <div className="pl-2 border-l-2 border-gray-700">
          <label className="text-xs text-gray-400 flex items-center gap-2">
            exponent:
            <input
              type="number"
              step="0.01"
              value={(params["exponent"] as number | undefined) ?? 1.1}
              onChange={(e) => onChangeParams({ ...params, exponent: Number(e.target.value) })}
              className="w-20 rounded bg-gray-900 border border-gray-700 px-2 py-0.5 text-xs text-white focus:border-blue-500 focus:outline-none"
            />
          </label>
        </div>
      )}
      {algorithmId === "linear_cost" && params && (
        <div className="space-y-2 pl-2 border-l-2 border-gray-700">
          <label className="text-xs text-gray-400 flex items-center gap-2">
            resourceId:
            <input
              type="text"
              value={(params["resourceId"] as string | undefined) ?? ""}
              onChange={(e) => onChangeParams({ ...params, resourceId: e.target.value })}
              className="w-24 rounded bg-gray-900 border border-gray-700 px-2 py-0.5 text-xs text-white focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="text-xs text-gray-400 flex items-center gap-2">
            base:
            <input
              type="number"
              value={(params["base"] as number | undefined) ?? 0}
              onChange={(e) => onChangeParams({ ...params, base: Number(e.target.value) })}
              className="w-20 rounded bg-gray-900 border border-gray-700 px-2 py-0.5 text-xs text-white focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="text-xs text-gray-400 flex items-center gap-2">
            perLevel:
            <input
              type="number"
              value={(params["perLevel"] as number | undefined) ?? 0}
              onChange={(e) => onChangeParams({ ...params, perLevel: Number(e.target.value) })}
              className="w-20 rounded bg-gray-900 border border-gray-700 px-2 py-0.5 text-xs text-white focus:border-blue-500 focus:outline-none"
            />
          </label>
        </div>
      )}
      {algorithmId === "flat" && (
        <p className="text-xs text-gray-600 italic pl-2">No parameters (flat scaling)</p>
      )}
      {algorithmId === "free" && (
        <p className="text-xs text-gray-600 italic pl-2">No parameters (free leveling)</p>
      )}
    </div>
  );
}

// ---- StatClamps sub-panel ----

function StatClampsPanel({
  statClamps,
  knownStats,
  onChange,
}: {
  statClamps: Record<string, StatClamp> | undefined;
  knownStats: string[];
  onChange: (updated: Record<string, StatClamp> | undefined) => void;
}) {
  const [newClampStat, setNewClampStat] = useState("");
  const enabled = statClamps !== undefined;
  const entries = statClamps ? Object.entries(statClamps) : [];
  const usedStats = new Set(entries.map(([k]) => k));
  const availableStats = knownStats.filter((s) => !usedStats.has(s));

  const toggle = (on: boolean) => {
    onChange(on ? {} : undefined);
  };

  const updateClamp = (stat: string, clamp: StatClamp) => {
    if (!statClamps) return;
    onChange({ ...statClamps, [stat]: clamp });
  };

  const removeClamp = (stat: string) => {
    if (!statClamps) return;
    const copy = { ...statClamps };
    delete copy[stat];
    onChange(copy);
  };

  const addClamp = () => {
    const s = newClampStat.trim();
    if (!s || !statClamps) return;
    onChange({ ...statClamps, [s]: {} });
    setNewClampStat("");
  };

  return (
    <div className="rounded-lg bg-gray-800 border border-gray-700 p-3 space-y-2">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => toggle(e.target.checked)}
          className="rounded"
        />
        <span className="text-sm font-semibold text-white">Stat Clamps</span>
      </label>

      {enabled && (
        <div className="space-y-2">
          {entries.length === 0 && (
            <p className="text-xs text-gray-600 italic">No clamps defined</p>
          )}
          {entries.map(([stat, clamp]) => (
            <div key={stat} className="flex items-center gap-2">
              <span className="text-xs text-gray-300 w-24 truncate" title={stat}>{stat}</span>
              <label className="text-xs text-gray-500 flex items-center gap-1">
                min:
                <input
                  type="number"
                  value={clamp.min ?? ""}
                  onChange={(e) => {
                    const c = { ...clamp };
                    if (e.target.value === "") delete c.min;
                    else c.min = Number(e.target.value);
                    updateClamp(stat, c);
                  }}
                  className="w-16 rounded bg-gray-900 border border-gray-700 px-2 py-0.5 text-xs text-white focus:border-blue-500 focus:outline-none"
                  placeholder="—"
                />
              </label>
              <label className="text-xs text-gray-500 flex items-center gap-1">
                max:
                <input
                  type="number"
                  value={clamp.max ?? ""}
                  onChange={(e) => {
                    const c = { ...clamp };
                    if (e.target.value === "") delete c.max;
                    else c.max = Number(e.target.value);
                    updateClamp(stat, c);
                  }}
                  className="w-16 rounded bg-gray-900 border border-gray-700 px-2 py-0.5 text-xs text-white focus:border-blue-500 focus:outline-none"
                  placeholder="—"
                />
              </label>
              <button
                onClick={() => removeClamp(stat)}
                className="text-red-500 hover:text-red-400 text-xs px-1"
              >
                &times;
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            {availableStats.length > 0 ? (
              <select
                value={newClampStat}
                onChange={(e) => setNewClampStat(e.target.value)}
                className="rounded bg-gray-900 border border-gray-700 px-2 py-0.5 text-xs text-gray-300 focus:border-blue-500 focus:outline-none"
              >
                <option value="">Select stat...</option>
                {availableStats.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={newClampStat}
                onChange={(e) => setNewClampStat(e.target.value)}
                placeholder="Stat name"
                className="rounded bg-gray-900 border border-gray-700 px-2 py-0.5 text-xs text-gray-300 focus:border-blue-500 focus:outline-none"
              />
            )}
            <button
              onClick={addClamp}
              disabled={!newClampStat.trim()}
              className="rounded bg-blue-700 px-2 py-0.5 text-xs text-white hover:bg-blue-600 disabled:opacity-40"
            >
              + Add Clamp
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Main panel ----

export default function AlgorithmsPanel({ config, onChange }: VisualPanelProps) {
  const updateAlgorithm = (
    key: "growth" | "levelCostCharacter" | "levelCostGear",
    algorithmId: string,
    params: Record<string, unknown> | undefined,
  ) => {
    onChange({
      ...config,
      algorithms: {
        ...config.algorithms,
        [key]: params ? { algorithmId, params } : { algorithmId },
      },
    });
  };

  const isGrowth = (key: string) => key === "growth";

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-white">Algorithms &amp; Stat Clamps</h3>

      {(["growth", "levelCostCharacter", "levelCostGear"] as const).map((key) => {
        const algo = config.algorithms[key];
        const options = isGrowth(key) ? GROWTH_ALGORITHMS : LEVEL_COST_ALGORITHMS;
        const defaultParams = isGrowth(key) ? defaultGrowthParams : defaultLevelCostParams;
        const titles: Record<string, string> = {
          growth: "Growth (stat scaling)",
          levelCostCharacter: "Level Cost — Character",
          levelCostGear: "Level Cost — Gear",
        };
        return (
          <AlgorithmCard
            key={key}
            title={titles[key]}
            algorithmId={algo.algorithmId}
            params={algo.params}
            options={options}
            knownStats={config.stats}
            onChangeId={(id) => updateAlgorithm(key, id, defaultParams(id))}
            onChangeParams={(p) => updateAlgorithm(key, algo.algorithmId, p)}
          />
        );
      })}

      <StatClampsPanel
        statClamps={config.statClamps}
        knownStats={config.stats}
        onChange={(sc) => {
          if (sc === undefined) {
            const { statClamps: _, ...rest } = config;
            onChange(rest as typeof config);
          } else {
            onChange({ ...config, statClamps: sc });
          }
        }}
      />
    </div>
  );
}
