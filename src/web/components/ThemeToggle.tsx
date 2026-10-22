import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemeChoice } from "../lib/theme";
import { IconButton } from "./ui";

const NEXT: Record<ThemeChoice, ThemeChoice> = { system: "light", light: "dark", dark: "system" };

export function ThemeToggle(): React.JSX.Element {
  const [theme, setTheme] = useTheme();
  const icon =
    theme === "system" ? (
      <Monitor className="size-4" />
    ) : theme === "light" ? (
      <Sun className="size-4" />
    ) : (
      <Moon className="size-4" />
    );
  return (
    <IconButton
      label={`Theme: ${theme}`}
      onClick={() => {
        setTheme(NEXT[theme]);
      }}
    >
      {icon}
    </IconButton>
  );
}
