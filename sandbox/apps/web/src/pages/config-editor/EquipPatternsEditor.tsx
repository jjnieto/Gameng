import { useState } from "react";

interface EquipPatternsEditorProps {
  patterns: string[][];
  knownSlots: string[];
  onChange: (updated: string[][]) => void;
}

export default function EquipPatternsEditor({ patterns, knownSlots, onChange }: EquipPatternsEditorProps) {
  const [newSlotSelections, setNewSlotSelections] = useState<Record<number, string>>({});

  const removeSlotFromPattern = (patternIdx: number, slotIdx: number) => {
    const pattern = patterns[patternIdx];
    if (pattern.length <= 1) return; // minItems: 1
    const updated = [...patterns];
    updated[patternIdx] = pattern.filter((_, i) => i !== slotIdx);
    onChange(updated);
  };

  const addSlotToPattern = (patternIdx: number) => {
    const slot = newSlotSelections[patternIdx];
    if (!slot) return;
    const updated = [...patterns];
    updated[patternIdx] = [...patterns[patternIdx], slot];
    onChange(updated);
    setNewSlotSelections((prev) => ({ ...prev, [patternIdx]: "" }));
  };

  const removePattern = (patternIdx: number) => {
    if (patterns.length <= 1) return; // minItems: 1
    onChange(patterns.filter((_, i) => i !== patternIdx));
  };

  const addPattern = () => {
    const defaultSlot = knownSlots[0] ?? "slot";
    onChange([...patterns, [defaultSlot]]);
  };

  return (
    <div className="space-y-2">
      <label className="text-xs font-semibold text-gray-400 uppercase">Equip Patterns</label>
      {patterns.map((pattern, pi) => (
        <div key={pi} className="rounded bg-gray-900 border border-gray-700 p-2 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Pattern {pi + 1}</span>
            <button
              onClick={() => removePattern(pi)}
              disabled={patterns.length <= 1}
              className="text-red-500 hover:text-red-400 text-xs disabled:opacity-30"
              title="Remove pattern"
            >
              &times;
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {pattern.map((slot, si) => (
              <span
                key={si}
                className="inline-flex items-center gap-1 rounded bg-gray-700 px-2 py-0.5 text-xs text-gray-300"
              >
                {slot}
                <button
                  onClick={() => removeSlotFromPattern(pi, si)}
                  disabled={pattern.length <= 1}
                  className="text-red-500 hover:text-red-400 disabled:opacity-30"
                >
                  &times;
                </button>
              </span>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <select
              value={newSlotSelections[pi] ?? ""}
              onChange={(e) => setNewSlotSelections((prev) => ({ ...prev, [pi]: e.target.value }))}
              className="rounded bg-gray-950 border border-gray-700 px-2 py-0.5 text-xs text-gray-300 focus:border-blue-500 focus:outline-none"
            >
              <option value="">Add slot...</option>
              {knownSlots.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <button
              onClick={() => addSlotToPattern(pi)}
              disabled={!newSlotSelections[pi]}
              className="rounded bg-blue-700 px-2 py-0.5 text-xs text-white hover:bg-blue-600 disabled:opacity-40"
            >
              +
            </button>
          </div>
        </div>
      ))}
      <button
        onClick={addPattern}
        className="rounded bg-gray-700 px-3 py-1 text-xs text-gray-300 hover:bg-gray-600"
      >
        + Add Pattern
      </button>
    </div>
  );
}
