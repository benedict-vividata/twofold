import { useEffect, useState } from "react";

export type ThemeChoice = "system" | "light" | "dark";

const KEY = "twofold.theme";

function read(): ThemeChoice {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch (_error) {
    return "system";
  }
}

function apply(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

export function initTheme(): void {
  apply(read());
}

export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(read);
  useEffect(() => {
    apply(choice);
    try {
      if (choice === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, choice);
    } catch (_error) {
      // Private mode: the choice lasts for this page only.
    }
  }, [choice]);
  return [choice, setChoice];
}

/** Whether the page is currently dark, following the system when no choice is stored. */
export function useIsDark(): boolean {
  const query = "(prefers-color-scheme: dark)";
  const compute = (): boolean => {
    const forced = document.documentElement.getAttribute("data-theme");
    if (forced === "dark") return true;
    if (forced === "light") return false;
    return window.matchMedia(query).matches;
  };
  const [dark, setDark] = useState(compute);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = (): void => {
      setDark(compute());
    };
    media.addEventListener("change", update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => {
      media.removeEventListener("change", update);
      observer.disconnect();
    };
  }, []);
  return dark;
}
