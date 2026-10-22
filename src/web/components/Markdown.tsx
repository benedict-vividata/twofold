import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./code/CodeBlock";
import { cx } from "./ui";

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map((child: ReactNode) => textOf(child)).join("");
  return "";
}

const components: Components = {
  // Fenced blocks arrive as <pre><code class="language-x">; render them ourselves.
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const text = textOf(children);
    const match = /language-([\w+#.-]+)/.exec(className ?? "");
    if (match === null && !text.includes("\n")) return <code>{children}</code>;
    return <CodeBlock code={text.replace(/\n$/, "")} language={match?.[1] ?? ""} />;
  },
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
};

export function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={cx("prose-tf", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
