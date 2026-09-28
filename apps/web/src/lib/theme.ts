import { useCallback, useEffect, useState } from "react";

export type ThemeSetting = "system" | "light" | "dark";

const THEME_KEY = "hb.theme";

export function readTheme(): ThemeSetting {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return raw === "light" || raw === "dark" ? raw : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(setting: ThemeSetting): void {
  const dark =
    setting === "dark" || (setting === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute("content", dark ? "#101014" : "#f7f6f3");
  }
}

export function useTheme(): { theme: ThemeSetting; setTheme: (next: ThemeSetting) => void } {
  const [theme, setThemeState] = useState<ThemeSetting>(() => readTheme());

  useEffect(() => {
    applyTheme(theme);
    const listener = () => {
      if (theme === "system") applyTheme("system");
    };
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [theme]);

  const setTheme = useCallback((next: ThemeSetting) => {
    try {
      if (next === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      // preference persistence is best-effort
    }
    setThemeState(next);
  }, []);

  return { theme, setTheme };
}
