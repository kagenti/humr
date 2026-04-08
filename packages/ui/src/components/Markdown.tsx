import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

function isRelativePath(href: string) {
  if (!href) return false;
  if (/^https?:\/\//.test(href)) return false;
  if (href.startsWith("mailto:")) return false;
  if (href.startsWith("#")) return false;
  return true;
}

export function Markdown({ children, onFileClick }: { children: string; onFileClick?: (path: string) => void }) {
  return (
    <div className="prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={onFileClick ? {
          a({ href, children }) {
            if (href && isRelativePath(href)) {
              // Normalize ./foo to foo
              const path = href.replace(/^\.\//, "");
              return (
                <a href="#" onClick={e => { e.preventDefault(); onFileClick(path); }} className="cursor-pointer">
                  {children}
                </a>
              );
            }
            return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
          }
        } : undefined}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
