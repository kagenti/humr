export const ANTHROPIC_HOST_PATTERN = "api.anthropic.com";

export function hostPatternFor(
  type: "anthropic" | "generic",
  userSupplied?: string,
): string {
  if (type === "anthropic") return ANTHROPIC_HOST_PATTERN;
  if (!userSupplied) throw new Error("hostPattern is required for generic secrets");
  return userSupplied;
}
