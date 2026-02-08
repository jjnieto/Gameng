import { useState } from "react";
import type { VisualPanelProps } from "./types.ts";
import StatMapEditor from "./StatMapEditor.tsx";

export default function ClassesPanel({ config, onChange }: VisualPanelProps) {
  const [newClassId, setNewClassId] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const classIds = Object.keys(config.classes);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const addClass = () => {
    const id = newClassId.trim();
    if (!id || config.classes[id]) return;
    onChange({
      ...config,
      classes: { ...config.classes, [id]: { baseStats: {} } },
    });
    setNewClassId("");
    setExpanded((prev) => ({ ...prev, [id]: true }));
  };

  const deleteClass = (id: string) => {
    if (!confirm(`Delete class "${id}"?`)) return;
    const copy = { ...config.classes };
    delete copy[id];
    onChange({ ...config, classes: copy });
  };

  const updateClassStats = (id: string, baseStats: Record<string, number>) => {
    onChange({
      ...config,
      classes: {
        ...config.classes,
        [id]: { ...config.classes[id], baseStats },
      },
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">
          Classes <span className="text-gray-500 font-normal">({classIds.length})</span>
        </h3>
      </div>

      {classIds.length === 0 && (
        <p className="text-xs text-gray-600 italic">No classes defined</p>
      )}

      {classIds.map((id) => (
        <div key={id} className="rounded-lg bg-gray-800 border border-gray-700 overflow-hidden">
          <button
            onClick={() => toggleExpand(id)}
            className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-750"
          >
            <span className="text-sm font-mono text-blue-300">{id}</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">
                {Object.keys(config.classes[id].baseStats).length} stats
              </span>
              <span className="text-gray-500 text-xs">{expanded[id] ? "▾" : "▸"}</span>
            </div>
          </button>
          {expanded[id] && (
            <div className="px-3 pb-3 space-y-2 border-t border-gray-700">
              <div className="pt-2">
                <StatMapEditor
                  stats={config.classes[id].baseStats}
                  knownStats={config.stats}
                  onChange={(s) => updateClassStats(id, s)}
                  label="Base Stats"
                />
              </div>
              <button
                onClick={() => deleteClass(id)}
                className="text-xs text-red-500 hover:text-red-400"
              >
                Delete class
              </button>
            </div>
          )}
        </div>
      ))}

      {/* Add new class */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newClassId}
          onChange={(e) => setNewClassId(e.target.value)}
          placeholder="New class ID..."
          className="rounded bg-gray-900 border border-gray-700 px-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none"
          onKeyDown={(e) => { if (e.key === "Enter") addClass(); }}
        />
        <button
          onClick={addClass}
          disabled={!newClassId.trim() || !!config.classes[newClassId.trim()]}
          className="rounded bg-green-700 px-3 py-1 text-xs text-white hover:bg-green-600 disabled:opacity-40"
        >
          + Add Class
        </button>
      </div>
    </div>
  );
}
