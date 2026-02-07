import { useState, useCallback } from "react";

export interface Settings {
  launcherBaseUrl: string;
  engineBaseUrl: string;
  gameInstanceId: string;
  adminApiKey: string;
}

const STORAGE_KEY = "gameng-sandbox-settings";

const DEFAULTS: Settings = {
  launcherBaseUrl: "http://localhost:4010",
  engineBaseUrl: "http://localhost:4000",
  gameInstanceId: "instance_001",
  adminApiKey: "",
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return { ...DEFAULTS, ...JSON.parse(raw) as Partial<Settings> };
    }
  } catch {
    // ignore corrupt data
  }
  return { ...DEFAULTS };
}

function save(s: Settings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [settings, setSettings] = useState<Settings>(load);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      save(next);
      return next;
    });
  }, []);

  return [settings, update];
}
