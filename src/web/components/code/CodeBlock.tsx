import { highlightCode, classHighlighter } from "@lezer/highlight";
import { Check, Copy } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { languageForTag } from "./languages";

/** Turns code into highlighted spans using the same token classes as the editor. */
function useHighlighted(code: string, tag: string): ReactNode[] | null {
  const [result, setResult] = useState<{ key: string; nodes: ReactNode[] } | null>(null);
  const key = `${tag}\0${code}`;
  useEffect(() => {
    let cancelled = false;
    if (tag === "") return undefined;
    void languageForTag(tag).then((support) => {
      if (cancelled || support === null) return;
      const tree = support.language.parser.parse(code);
      const out: ReactNode[] = [];
      highlightCode(
        code,
        tree,
        classHighlighter,
        (text, classes) => {
          out.push(
            classes === "" ? (
              text
            ) : (
              <span key={out.length} className={classes}>
                {text}
              </span>
            ),
          );
        },
        () => {
          out.push("\n");
        },
      );
      setResult({ key, nodes: out });
    });
    return () => {
      cancelled = true;
    };
  }, [code, tag, key]);
  return result?.key === key ? result.nodes : null;
}

export function CodeBlock({
  code,
  language,
}: {
  code: string;
  language: string;
}): React.JSX.Element {
  const highlighted = useHighlighted(code, language);
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border border-line bg-surface-2">
      {language !== "" && (
        <div className="border-b border-line px-3 py-1 font-mono text-[10.5px] uppercase tracking-wide text-faint">
          {language}
        </div>
      )}
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => {
              setCopied(false);
            }, 1200);
          });
        }}
        className="absolute right-1.5 top-1.5 inline-flex size-6 items-center justify-center rounded-md text-faint opacity-0 transition hover:bg-surface-3 hover:text-ink group-hover:opacity-100"
        aria-label="Copy code"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
      <pre className="m-0! overflow-x-auto px-3 py-2.5 font-mono text-[12px] leading-[1.6]">
        <code>{highlighted ?? code}</code>
      </pre>
    </div>
  );
}
