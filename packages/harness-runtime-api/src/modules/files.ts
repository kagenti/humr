export interface FilesContext {
  buildTree: () => { path: string; type: "file" | "dir" }[];
  readFileSafe: (
    rel: string,
  ) => {
    path: string;
    content?: string;
    binary?: boolean;
  } | null;
}
