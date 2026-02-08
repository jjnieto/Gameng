import { useState } from "react";

interface StatMapEditorProps {
  stats: Record<string, number>;
  knownStats: string[];
  onChange: (updated: Record<string, number>) => void;
  label?: string;
}

export default function StatMapEditor({ stats, knownStats, onChange, label }: StatMapEditorProps) {
  const [newStat, setNewStat] = useState("");

  const entries = Object.entries(stats);
  const usedStats = new Set(Object.keys(stats));
  const availableStats = knownStats.filter((s) => !usedStats.has(s));

  const updateValue = (key: string, value: number) => {
    onChange({ ...stats, [key]: value });
  };

  const removeStat = (key: string) => {
    const copy = { ...stats };
    delete copy[key];
    onChange(copy);
  };

  const addStat = () => {
    const name = newStat.trim();
    if (!name || usedStats.has(name)) return;
    onChange({ ...stats, [name]: 0 });
    setNewStat("");
  };

  return (
    <div className="space-y-1">
      {label && <label className="text-xs font-semibold text-gray-400 uppercase">{label}</label>}
      {entries.length === 0 && (
        <p className="text-xs text-gray-600 italic">No stats defined</p>
      )}
      {entries.map(([key, val]) => (
        <div key={key} className="flex items-center gap-2">
          <span className="text-xs text-gray-300 w-28 truncate" title={key}>{key}</span>
          <input
            type="number"
            value={val}
            onChange={(e) => updateValue(key, Number(e.target.value))}
            className="w-20 rounded bg-gray-900 border border-gray-700 px-2 py-0.5 text-xs text-white focus:border-blue-500 focus:outline-none"
          />
          <button
            onClick={() => removeStat(key)}
            className="text-red-500 hover:text-red-400 text-xs px-1"
            title="Remove stat"
          >
            &times;
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2 pt-1">
        {availableStats.length > 0 ? (
          <select
            value={newStat}
            onChange={(e) => setNewStat(e.target.value)}
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
            value={newStat}
            onChange={(e) => setNewStat(e.target.value)}
            placeholder="Custom stat name"
            className="rounded bg-gray-900 border border-gray-700 px-2 py-0.5 text-xs text-gray-300 focus:border-blue-500 focus:outline-none"
            onKeyDown={(e) => { if (e.key === "Enter") addStat(); }}
          />
        )}
        <button
          onClick={addStat}
          disabled={!newStat.trim()}
          className="rounded bg-blue-700 px-2 py-0.5 text-xs text-white hover:bg-blue-600 disabled:opacity-40"
        >
          + Add
        </button>
      </div>
    </div>
  );
}
