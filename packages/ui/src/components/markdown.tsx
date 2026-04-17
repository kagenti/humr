import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeHighlight];

function isRelativePath(href: string) {
  if (!href) return false;
  if (/^https?:\/\//.test(href)) return false;
  if (href.startsWith("mailto:")) return false;
  if (href.startsWith("#")) return false;
  return true;
}

export function Markdown({ children, onFileClick }: { children: string; onFileClick?: (path: string) => void }) {
  const components = useMemo<Components | undefined>(() =>
    onFileClick ? {
      a({ href, children }) {
        if (href && isRelativePath(href)) {
          const path = href.replace(/^\.\//, "");
          return (
            <a href="#" onClick={e => { e.preventDefault(); onFileClick(path); }} className="cursor-pointer">
              {children}
            </a>
          );
        }
        return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
      }
    } : undefined,
  [onFileClick]);

  return (
    <div className="prose">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
