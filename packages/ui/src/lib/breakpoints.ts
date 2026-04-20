// Shared mobile breakpoint. Must match Tailwind's `md:` breakpoint (default 768px)
// so JS `isMobile()` checks stay in sync with `md:` utility classes in the markup.
export const MOBILE_BREAKPOINT = 768;

export const isMobile = () => window.innerWidth < MOBILE_BREAKPOINT;
