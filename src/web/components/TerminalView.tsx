import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import { TerminalServerMessage, type TerminalTarget } from "../../shared/model";
import { useIsDark } from "../lib/theme";

export type TerminalState =
  Extract<TerminalServerMessage, { t: "s" }>["state"] | "connecting" | "exited";

export interface TerminalStatus {
  state: TerminalState;
  message: string;
}

const LIGHT: ITheme = {
  black: "#1b1a18",
  red: "#c4321f",
  green: "#18794e",
  yellow: "#a35c00",
  blue: "#2f5fc4",
  magenta: "#8b3fb8",
  cyan: "#0f7c84",
  white: "#8a877f",
  brightBlack: "#66635c",
  brightRed: "#e0452f",
  brightGreen: "#1f9d63",
  brightYellow: "#c27700",
  brightBlue: "#3d73e0",
  brightMagenta: "#a352d6",
  brightCyan: "#11939c",
  brightWhite: "#b9b6ae",
};

const DARK: ITheme = {
  black: "#2a2927",
  red: "#f07a6a",
  green: "#4cc38a",
  yellow: "#e7a74a",
  blue: "#7ea6f5",
  magenta: "#c3a6ff",
  cyan: "#6fd3cf",
  white: "#d6d3cc",
  brightBlack: "#75726b",
  brightRed: "#ff9a8c",
  brightGreen: "#6fdba6",
  brightYellow: "#f5c06f",
  brightBlue: "#a2c0ff",
  brightMagenta: "#d8c4ff",
  brightCyan: "#93e6e2",
  brightWhite: "#ffffff",
};

/** Colours from the page's own design tokens, so the terminal matches the theme. */
function theme(dark: boolean): ITheme {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string): string => style.getPropertyValue(name).trim();
  return {
    ...(dark ? DARK : LIGHT),
    background: token("--surface"),
    foreground: token("--text"),
    cursor: token("--text"),
    cursorAccent: token("--surface"),
    selectionBackground: dark ? "rgba(164, 140, 240, 0.35)" : "rgba(124, 92, 214, 0.22)",
  };
}

function socketUrl(token: string, target: TerminalTarget, cols: number, rows: number): string {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  const query = new URLSearchParams({ target, cols: String(cols), rows: String(rows) });
  return `${scheme}://${window.location.host}/api/c/${encodeURIComponent(token)}/terminal?${query.toString()}`;
}

/**
 * One terminal, connected to one shell on the server. The shell outlives the
 * page: reconnecting replays what it printed.
 */
export function TerminalView({
  token,
  target,
  visible,
  restart,
  onStatus,
}: {
  token: string;
  target: TerminalTarget;
  visible: boolean;
  /** Bump to restart the shell on a fresh copy of the code. */
  restart: number;
  onStatus: (status: TerminalStatus) => void;
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const onStatusRef = useRef(onStatus);
  const dark = useIsDark();

  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  useEffect(() => {
    const element = host.current;
    if (element === null) return undefined;

    const term = new Terminal({
      fontFamily: '"JetBrains Mono Variable", ui-monospace, Menlo, Consolas, monospace',
      fontSize: 12.5,
      lineHeight: 1.25,
      cursorBlink: true,
      scrollback: 5000,
    });
    const fitter = new FitAddon();
    term.loadAddon(fitter);
    term.loadAddon(new WebLinksAddon());
    // Ctrl+` toggles the panel; let it through to the page.
    term.attachCustomKeyEventHandler((event) => !(event.ctrlKey && event.key === "`"));
    term.open(element);
    terminal.current = term;
    fit.current = fitter;

    let closed = false;
    let exited = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    const sendJson = (message: unknown): void => {
      if (socket.current?.readyState === WebSocket.OPEN)
        socket.current.send(JSON.stringify(message));
    };

    const open = (): void => {
      onStatusRef.current({ state: "connecting", message: "" });
      const ws = new WebSocket(socketUrl(token, target, term.cols, term.rows));
      socket.current = ws;
      let replaying = true;
      ws.addEventListener("open", () => {
        attempts = 0;
      });
      ws.addEventListener("message", (event) => {
        let parsed;
        try {
          parsed = TerminalServerMessage.safeParse(JSON.parse(String(event.data)));
        } catch (_error) {
          return;
        }
        if (!parsed.success) return;
        const message = parsed.data;
        if (message.t === "o") {
          // The first frame after (re)connecting is the scrollback: start clean.
          if (replaying) term.reset();
          replaying = false;
          term.write(message.d);
        } else if (message.t === "s") {
          if (message.state === "preparing") term.reset();
          if (message.state === "ready") exited = false;
          if (message.state === "closed") closed = true;
          replaying = false;
          onStatusRef.current({ state: message.state, message: message.message });
        } else {
          exited = true;
          term.write("\r\n\x1b[2m[The shell exited. Press Enter to start a new one.]\x1b[0m\r\n");
          onStatusRef.current({ state: "exited", message: "" });
        }
      });
      ws.addEventListener("close", () => {
        if (socket.current !== ws || closed) return;
        attempts += 1;
        onStatusRef.current({ state: "connecting", message: "Reconnecting…" });
        retry = setTimeout(open, Math.min(500 * 2 ** attempts, 5000));
      });
    };

    term.onData((data) => {
      if (exited) {
        if (data === "\r") {
          exited = false;
          sendJson({ t: "restart" });
        }
        return;
      }
      sendJson({ t: "i", d: data });
    });
    term.onResize(({ cols, rows }) => {
      sendJson({ t: "r", c: cols, r: rows });
    });

    const resize = new ResizeObserver(() => {
      if (element.offsetWidth > 0 && element.offsetHeight > 0) fitter.fit();
    });
    resize.observe(element);

    // Measure the font once it has loaded, then connect at the right size.
    void document.fonts.ready.then(() => {
      if (element.offsetWidth > 0) fitter.fit();
      open();
    });

    return () => {
      closed = true;
      if (retry !== null) clearTimeout(retry);
      resize.disconnect();
      socket.current?.close();
      socket.current = null;
      term.dispose();
      terminal.current = null;
    };
  }, [token, target]);

  useEffect(() => {
    if (terminal.current !== null) terminal.current.options.theme = theme(dark);
  }, [dark]);

  useEffect(() => {
    if (!visible) return;
    const element = host.current;
    if (element !== null && element.offsetWidth > 0) fit.current?.fit();
    terminal.current?.focus();
  }, [visible]);

  useEffect(() => {
    if (restart === 0) return;
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify({ t: "restart" }));
    }
  }, [restart]);

  return <div ref={host} className="h-full w-full px-3 py-2" />;
}
