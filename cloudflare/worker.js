// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SOVEREIGN SYNTHESIS — Cloudflare Worker
// Serves legal pages + TikTok verification on sovereign-synthesis.com
// Deploy: Cloudflare Dashboard → Workers & Pages → Create Worker
// Then add route: sovereign-synthesis.com/* → this worker
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const BRAND = {
  name: "Sovereign Synthesis",
  contact: "empoweredservices2013@gmail.com",
  colors: { bg: "#0a0a0f", text: "#e0e0e0", accent: "#00f0ff", muted: "#b8b8cc", subtle: "#666" },
};

// ── TikTok Domain Verification ──────────────────────
// Multiple verification codes — TikTok generates new ones per attempt
const TIKTOK_VERIFICATIONS = {
  "MLHJDkp6yFPkV9GuX9PKQpSCJXdzNlC7": "tiktok-developers-site-verification=MLHJDkp6yFPkV9GuX9PKQpSCJXdzNlC7",
  "6pbC2JaU0eMZd91d8kPQRWsak8LmfhIT": "tiktok-developers-site-verification=6pbC2JaU0eMZd91d8kPQRWsak8LmfhIT",
};

// ── Legal Page Content ──────────────────────────────
const TERMS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Terms of Service — ${BRAND.name}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; color: ${BRAND.colors.text}; background: ${BRAND.colors.bg}; line-height: 1.7; }
    h1 { color: ${BRAND.colors.accent}; border-bottom: 1px solid #1a1a2e; padding-bottom: 16px; }
    h2 { color: ${BRAND.colors.muted}; margin-top: 32px; }
    p { margin: 12px 0; }
    .updated { color: ${BRAND.colors.subtle}; font-size: 14px; }
    a { color: ${BRAND.colors.accent}; }
    ul { padding-left: 24px; }
    li { margin: 6px 0; }
  </style>
</head>
<body>
  <h1>Terms of Service</h1>
  <p class="updated">Last updated: March 30, 2026</p>

  <h2>1. Acceptance of Terms</h2>
  <p>By accessing or using Sovereign Synthesis services, applications, and content distribution platform ("Service"), you agree to be bound by these Terms of Service.</p>

  <h2>2. Description of Service</h2>
  <p>Sovereign Synthesis is a content management and distribution platform that creates and publishes educational and personal development content across social media platforms including TikTok, Instagram, YouTube, and other channels.</p>

  <h2>3. User Accounts and Authorization</h2>
  <p>The Service operates under the authorization of the account owner. By connecting your social media accounts, you grant Sovereign Synthesis permission to publish content on your behalf. You may revoke this authorization at any time by disconnecting your accounts through the respective platform's settings.</p>

  <h2>4. Content Ownership</h2>
  <p>You retain all rights to content created and published through the Service. Sovereign Synthesis does not claim ownership of any user-generated content.</p>

  <h2>5. Prohibited Uses</h2>
  <p>You agree not to use the Service to publish content that is illegal, harmful, threatening, abusive, harassing, defamatory, or otherwise objectionable.</p>

  <h2>6. API Usage</h2>
  <p>The Service integrates with third-party APIs including TikTok Content Posting API, Instagram Graph API, and YouTube Data API. Your use of these integrations is subject to each platform's respective terms of service.</p>

  <h2>7. Privacy</h2>
  <p>Your use of the Service is also governed by our <a href="/legal/privacy">Privacy Policy</a>.</p>

  <h2>8. Limitation of Liability</h2>
  <p>The Service is provided "as is" without warranties of any kind, either express or implied. Sovereign Synthesis shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the Service.</p>

  <h2>9. Modifications</h2>
  <p>We reserve the right to modify these Terms at any time. Changes will be reflected by updating the "Last updated" date. Continued use of the Service after changes constitutes acceptance of the modified Terms.</p>

  <h2>10. Contact</h2>
  <p>Questions about these Terms: <a href="mailto:${BRAND.contact}">${BRAND.contact}</a></p>
</body>
</html>`;

const PRIVACY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Privacy Policy — ${BRAND.name}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; color: ${BRAND.colors.text}; background: ${BRAND.colors.bg}; line-height: 1.7; }
    h1 { color: ${BRAND.colors.accent}; border-bottom: 1px solid #1a1a2e; padding-bottom: 16px; }
    h2 { color: ${BRAND.colors.muted}; margin-top: 32px; }
    p { margin: 12px 0; }
    .updated { color: ${BRAND.colors.subtle}; font-size: 14px; }
    a { color: ${BRAND.colors.accent}; }
    ul { padding-left: 24px; }
    li { margin: 6px 0; }
  </style>
</head>
<body>
  <h1>Privacy Policy</h1>
  <p class="updated">Last updated: March 30, 2026</p>

  <h2>1. Introduction</h2>
  <p>Sovereign Synthesis ("we", "our", "us") operates a content management and distribution platform. This Privacy Policy explains how we collect, use, and protect information when you use our Service.</p>

  <h2>2. Information We Collect</h2>
  <p>When you connect your social media accounts to our Service, we may collect:</p>
  <ul>
    <li>OAuth access tokens for authorized social media accounts (TikTok, Instagram, YouTube)</li>
    <li>Basic profile information from connected accounts (username, account ID)</li>
    <li>Content publishing metadata (post IDs, publishing timestamps, platform responses)</li>
  </ul>
  <p>We do not collect personal data from the audiences of published content. We do not access private messages, follower lists, or analytics data beyond what is necessary for content publishing.</p>

  <h2>3. How We Use Information</h2>
  <p>Information collected is used solely for:</p>
  <ul>
    <li>Publishing content to connected social media accounts on behalf of the authorized account holder</li>
    <li>Monitoring publishing success/failure for operational purposes</li>
    <li>Maintaining service functionality and troubleshooting errors</li>
  </ul>

  <h2>4. Data Storage and Security</h2>
  <p>Access tokens and account credentials are stored securely using encrypted environment variables on secure cloud infrastructure. Content metadata is stored in encrypted databases with row-level security enabled. We do not sell, rent, or share your data with third parties.</p>

  <h2>5. Third-Party Services</h2>
  <p>Our Service integrates with:</p>
  <ul>
    <li><strong>TikTok Content Posting API</strong> — for publishing video content to TikTok</li>
    <li><strong>Instagram Graph API (Meta)</strong> — for publishing Reels to Instagram</li>
    <li><strong>YouTube Data API (Google)</strong> — for uploading Shorts to YouTube</li>
  </ul>
  <p>Your use of these integrations is subject to each platform's privacy policy. We encourage you to review: <a href="https://www.tiktok.com/legal/privacy-policy">TikTok Privacy Policy</a>, <a href="https://www.facebook.com/privacy/policy/">Meta Privacy Policy</a>, and <a href="https://policies.google.com/privacy">Google Privacy Policy</a>.</p>

  <h2>6. Data Retention</h2>
  <p>OAuth tokens are retained only while your accounts are connected to the Service. You may revoke access at any time by disconnecting your accounts, at which point tokens are deleted. Content metadata is retained for operational analytics and may be deleted upon request.</p>

  <h2>7. Your Rights</h2>
  <p>You have the right to:</p>
  <ul>
    <li>Request access to your stored data</li>
    <li>Request deletion of your data</li>
    <li>Revoke API access at any time through the connected platform's settings</li>
    <li>Opt out of the Service entirely</li>
  </ul>

  <h2>8. Children's Privacy</h2>
  <p>The Service is not directed at children under 13. We do not knowingly collect information from children under 13.</p>

  <h2>9. Changes to This Policy</h2>
  <p>We may update this Privacy Policy from time to time. Changes will be reflected by updating the "Last updated" date.</p>

  <h2>10. Contact</h2>
  <p>For privacy inquiries: <a href="mailto:${BRAND.contact}">${BRAND.contact}</a></p>
</body>
</html>`;

// ── Request Router ──────────────────────────────────
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    // TikTok domain verification — URL prefix method
    // Matches /tiktok<CODE>.txt pattern
    const tiktokMatch = path.match(/^\/tiktok([A-Za-z0-9]+)\.txt$/);
    if (tiktokMatch) {
      const code = tiktokMatch[1];
      const verification = TIKTOK_VERIFICATIONS[code];
      if (verification) {
        return new Response(verification, {
          headers: { "Content-Type": "text/plain" },
        });
      }
      // Fallback — serve the latest verification for generic requests
      return new Response(Object.values(TIKTOK_VERIFICATIONS).pop(), {
        headers: { "Content-Type": "text/plain" },
      });
    }
    if (path === "/tiktok-developers-site-verification.txt") {
      return new Response(Object.values(TIKTOK_VERIFICATIONS).pop(), {
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Legal pages
    if (path === "/legal/terms") {
      return new Response(TERMS_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (path === "/legal/privacy") {
      return new Response(PRIVACY_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // Fallback — pass through to origin or return 404
    return new Response("Not Found", { status: 404 });
  },
};
