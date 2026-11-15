import { neutral, presets, type Preset } from "@hedronite/lts-tokens";
import { createContext, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "lts-catalog-preset";

function storedPreset(): Preset {
  try {
    const id = window.localStorage.getItem(STORAGE_KEY);
    return presets.find((preset) => preset.id === id) ?? neutral;
  } catch {
    return neutral;
  }
}

/** The token preset the catalog is showing; a per-viewer convenience, remembered when storage allows. */
export function usePresetState(): readonly [Preset, (preset: Preset) => void] {
  const [preset, setPreset] = useState<Preset>(storedPreset);
  useEffect(() => {
    document.documentElement.dataset["preset"] = preset.id;
    try {
      window.localStorage.setItem(STORAGE_KEY, preset.id);
    } catch {
      // Storage can be unavailable (private windows, blocked site data); the choice just isn't remembered.
    }
  }, [preset]);
  return [preset, setPreset];
}

export const PresetContext = createContext<Preset>(neutral);

export function usePreset(): Preset {
  return useContext(PresetContext);
}
