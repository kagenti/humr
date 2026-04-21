import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "../../modules/skills/infrastructure/skill-scanner.js";

describe("parseFrontmatter", () => {
  it("extracts name and description from a SKILL.md", () => {
    const content = [
      "---",
      "name: pdf",
      "description: Work with PDF files",
      "---",
      "",
      "# PDF skill",
      "",
      "Body content here.",
    ].join("\n");
    expect(parseFrontmatter(content)).toEqual({
      name: "pdf",
      description: "Work with PDF files",
    });
  });

  it("returns an empty object when frontmatter is absent", () => {
    expect(parseFrontmatter("# PDF\n\nNo frontmatter here.")).toEqual({});
  });

  it("tolerates CRLF line endings", () => {
    const content = "---\r\nname: docx\r\ndescription: >\r\n  Multi-line\r\n  description\r\n---\r\n\r\nBody";
    const fm = parseFrontmatter(content);
    expect(fm.name).toBe("docx");
    expect(fm.description).toContain("Multi-line");
  });

  it("ignores non-object frontmatter payloads", () => {
    expect(parseFrontmatter("---\njust a string\n---\nbody")).toEqual({});
  });
});
