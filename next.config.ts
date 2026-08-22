import type { NextConfig } from "next";

// Phase 8 transport hardening. Applied here (not middleware) since these
// are static per-response headers, not conditional on auth state --
// next.config's headers() runs for every response without needing a
// round-trip through middleware logic. See docs/SECURITY.md.
const securityHeaders = [
  // No inline framing by anyone, anywhere -- this app has no legitimate
  // reason to be embedded in another site's iframe.
  { key: "X-Frame-Options", value: "DENY" },
  // Browsers that respect CSP's frame-ancestors ignore X-Frame-Options;
  // both are set so older browsers still get the DENY behavior.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Only meaningful once actually served over HTTPS (Render staging,
  // not local http://localhost dev) -- browsers ignore HSTS on plain
  // HTTP anyway, so this is safe to set unconditionally.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
