import { useState } from "react";
import type { VisualPanelProps } from "./types.ts";
import type { GearDef, GearRestrictions } from "../../lib/types.ts";
import StatMapEditor from "./StatMapEditor.tsx";
import EquipPatternsEditor from "./EquipPatternsEditor.tsx";
import RestrictionsEditor from "./RestrictionsEditor.tsx";

export default function GearDefsPanel({ config, onChange }: VisualPanelProps) {
  const [newGearDefId, setNewGearDefId] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const gearDefIds = Object.keys(config.gearDefs);
  const knownClasses = Object.keys(config.classes);
  const knownSetIds = Object.keys(config.sets);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const updateGearDef = (id: string, gearDef: GearDef) => {
    onChange({
      ...config,
      gearDefs: { ...config.gearDefs, [id]: gearDef },
    });
  };

  const addGearDef = () => {
    const id = newGearDefId.trim();
    if (!id || config.gearDefs[id]) return;
    const defaultSlot = config.slots[0] ?? "slot";
    onChange({
      ...config,
      gearDefs: {
        ...config.gearDefs,
        [id]: { baseStats: {}, equipPatterns: [[defaultSlot]] },
      },
    });
    setNewGearDefId("");
    setExpanded((prev) => ({ ...prev, [id]: true }));
  };

  const deleteGearDef = (id: string) => {
    if (!confirm(`Delete gear definition "${id}"?`)) return;
    const copy = { ...config.gearDefs };
    delete copy[id];
    onChange({ ...config, gearDefs: copy });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">
          Gear Definitions <span className="text-gray-500 font-normal">({gearDefIds.length})</span>
        </h3>
      </div>

      {gearDefIds.length === 0 && (
        <p className="text-xs text-gray-600 italic">No gear definitions</p>
      )}

      {gearDefIds.map((id) => {
        const def = config.gearDefs[id];
        return (
          <div key={id} className="rounded-lg bg-gray-800 border border-gray-700 overflow-hidden">
            <button
              onClick={() => toggleExpand(id)}
              className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-750"
            >
              <span className="text-sm font-mono text-purple-300">{id}</span>
              <div className="flex items-center gap-2">
                {def.setId && (
                  <span className="text-xs text-yellow-500">set:{def.setId}</span>
                )}
                {def.restrictions && (
                  <span className="text-xs text-orange-400">restricted</span>
                )}
                <span className="text-xs text-gray-500">
                  {def.equipPatterns.length} pattern{def.equipPatterns.length !== 1 ? "s" : ""}
                </span>
                <span className="text-gray-500 text-xs">{expanded[id] ? "▾" : "▸"}</span>
              </div>
            </button>
            {expanded[id] && (
              <div className="px-3 pb-3 space-y-3 border-t border-gray-700 pt-2">
                {/* Base stats */}
                <StatMapEditor
                  stats={def.baseStats}
                  knownStats={config.stats}
                  onChange={(s) => updateGearDef(id, { ...def, baseStats: s })}
                  label="Base Stats"
                />

                {/* Equip patterns */}
                <EquipPatternsEditor
                  patterns={def.equipPatterns}
                  knownSlots={config.slots}
                  onChange={(p) => updateGearDef(id, { ...def, equipPatterns: p })}
                />

                {/* Set fields */}
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-400 uppercase">Set</label>
                  <div className="flex items-center gap-2">
                    <select
                      value={def.setId ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val) {
                          updateGearDef(id, { ...def, setId: val, setPieceCount: def.setPieceCount ?? 1 });
                        } else {
                          const { setId: _s, setPieceCount: _p, ...rest } = def;
                          updateGearDef(id, rest as GearDef);
                        }
                      }}
                      className="rounded bg-gray-900 border border-gray-700 px-2 py-0.5 text-xs text-gray-300 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="">No set</option>
                      {knownSetIds.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    {def.setId && (
                      <div className="flex items-center gap-2 text-xs text-gray-400">
                        <span>Piece count:</span>
                        {[1, 2].map((n) => (
                          <label key={n} className="flex items-center gap-1">
                            <input
                              type="radio"
                              checked={def.setPieceCount === n}
                              onChange={() => updateGearDef(id, { ...def, setPieceCount: n })}
                            />
                            {n}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Restrictions */}
                <RestrictionsEditor
                  restrictions={def.restrictions}
                  knownClasses={knownClasses}
                  onChange={(r: GearRestrictions | undefined) => {
                    if (r === undefined) {
                      const { restrictions: _r, ...rest } = def;
                      updateGearDef(id, rest as GearDef);
                    } else {
                      updateGearDef(id, { ...def, restrictions: r });
                    }
                  }}
                />

                <button
                  onClick={() => deleteGearDef(id)}
                  className="text-xs text-red-500 hover:text-red-400"
                >
                  Delete gear definition
                </button>
              </div>
            )}
          </div>
        );
      })}

      {/* Add new gearDef */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newGearDefId}
          onChange={(e) => setNewGearDefId(e.target.value)}
          placeholder="New gearDef ID..."
          className="rounded bg-gray-900 border border-gray-700 px-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none"
          onKeyDown={(e) => { if (e.key === "Enter") addGearDef(); }}
        />
        <button
          onClick={addGearDef}
          disabled={!newGearDefId.trim() || !!config.gearDefs[newGearDefId.trim()]}
          className="rounded bg-green-700 px-3 py-1 text-xs text-white hover:bg-green-600 disabled:opacity-40"
        >
          + Add GearDef
        </button>
      </div>
    </div>
  );
}
