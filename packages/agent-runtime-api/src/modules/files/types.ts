export interface FilesService {
  buildTree: () => { path: string; type: "file" | "dir" }[];
  readFileSafe: (
    rel: string,
  ) => Promise<{
    path: string;
    content?: string;  // UTF-8 for text, base64 for binary
    binary?: boolean;  // true when content is base64-encoded or file exceeds size limit
    mimeType?: string; // detected MIME type (absent when file exceeds size limit)
  } | null>;
}
