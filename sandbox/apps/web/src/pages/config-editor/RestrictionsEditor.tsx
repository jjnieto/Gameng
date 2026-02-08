import type { GearRestrictions } from "../../lib/types.ts";

type ListMode = "none" | "allow" | "block";

interface RestrictionsEditorProps {
  restrictions: GearRestrictions | undefined;
  knownClasses: string[];
  onChange: (updated: GearRestrictions | undefined) => void;
}

export default function RestrictionsEditor({ restrictions, knownClasses, onChange }: RestrictionsEditorProps) {
  const hasRestrictions = restrictions !== undefined;

  const listMode: ListMode = restrictions?.allowedClasses
    ? "allow"
    : restrictions?.blockedClasses
      ? "block"
      : "none";

  const classList = restrictions?.allowedClasses ?? restrictions?.blockedClasses ?? [];

  const toggleRestrictions = (enabled: boolean) => {
    onChange(enabled ? {} : undefined);
  };

  const setListMode = (mode: ListMode) => {
    if (!restrictions) return;
    const base: GearRestrictions = {
      ...(restrictions.requiredCharacterLevel !== undefined && { requiredCharacterLevel: restrictions.requiredCharacterLevel }),
      ...(restrictions.maxLevelDelta !== undefined && { maxLevelDelta: restrictions.maxLevelDelta }),
    };
    if (mode === "allow") {
      onChange({ ...base, allowedClasses: [] });
    } else if (mode === "block") {
      onChange({ ...base, blockedClasses: [] });
    } else {
      onChange(base);
    }
  };

  const toggleClass = (classId: string) => {
    if (!restrictions) return;
    const key = listMode === "allow" ? "allowedClasses" : "blockedClasses";
    const current = (restrictions[key] as string[] | undefined) ?? [];
    const updated = current.includes(classId)
      ? current.filter((c) => c !== classId)
      : [...current, classId];
    onChange({ ...restrictions, [key]: updated });
  };

  const setNumericField = (field: "requiredCharacterLevel" | "maxLevelDelta", value: string) => {
    if (!restrictions) return;
    const copy = { ...restrictions };
    if (value === "") {
      delete copy[field];
    } else {
      copy[field] = Number(value);
    }
    onChange(copy);
  };

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={hasRestrictions}
          onChange={(e) => toggleRestrictions(e.target.checked)}
          className="rounded"
        />
        <span className="font-semibold text-gray-400 uppercase">Restrictions</span>
      </label>

      {hasRestrictions && (
        <div className="rounded bg-gray-900 border border-gray-700 p-2 space-y-2">
          {/* List mode radio */}
          <div className="flex gap-3 text-xs text-gray-300">
            {(["none", "allow", "block"] as const).map((mode) => (
              <label key={mode} className="flex items-center gap-1">
                <input
                  type="radio"
                  name="listMode"
                  checked={listMode === mode}
                  onChange={() => setListMode(mode)}
                />
                {mode === "none" ? "No class filter" : mode === "allow" ? "Allow list" : "Block list"}
              </label>
            ))}
          </div>

          {/* Class pills */}
          {listMode !== "none" && (
            <div className="flex flex-wrap gap-1">
              {knownClasses.map((cls) => {
                const selected = classList.includes(cls);
                return (
                  <button
                    key={cls}
                    onClick={() => toggleClass(cls)}
                    className={`rounded px-2 py-0.5 text-xs border ${
                      selected
                        ? "bg-blue-700 border-blue-500 text-white"
                        : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500"
                    }`}
                  >
                    {cls}
                  </button>
                );
              })}
              {knownClasses.length === 0 && (
                <p className="text-xs text-gray-600 italic">No classes defined in config</p>
              )}
            </div>
          )}

          {/* Numeric fields */}
          <div className="flex gap-4">
            <label className="text-xs text-gray-400 flex items-center gap-1">
              Req. char level:
              <input
                type="number"
                min={1}
                value={restrictions.requiredCharacterLevel ?? ""}
                onChange={(e) => setNumericField("requiredCharacterLevel", e.target.value)}
                className="w-16 rounded bg-gray-950 border border-gray-700 px-2 py-0.5 text-xs text-white focus:border-blue-500 focus:outline-none"
                placeholder="—"
              />
            </label>
            <label className="text-xs text-gray-400 flex items-center gap-1">
              Max level delta:
              <input
                type="number"
                min={0}
                value={restrictions.maxLevelDelta ?? ""}
                onChange={(e) => setNumericField("maxLevelDelta", e.target.value)}
                className="w-16 rounded bg-gray-950 border border-gray-700 px-2 py-0.5 text-xs text-white focus:border-blue-500 focus:outline-none"
                placeholder="—"
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
