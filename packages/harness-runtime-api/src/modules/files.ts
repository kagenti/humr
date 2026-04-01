export interface FilesContext {
  fileVersion: () => number;
  buildTree: () => { path: string; type: "file" | "dir" }[];
  readFileSafe: (
    rel: string,
  ) => {
    path: string;
    content?: string;
    binary?: boolean;
    version: number;
  } | null;
}
