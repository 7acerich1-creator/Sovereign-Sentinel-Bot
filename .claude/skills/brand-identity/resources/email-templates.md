# Canonical Email Template — Sovereign Synthesis

**Source of truth.** When generating any email (welcome, nurture, purchase confirmation, broadcast), start from this pattern. Do not author email HTML from scratch.

**Locked:** 2026-04-26 — after the Christina rendering incident proved dark-mode emails fail in Gmail. This template has been verified to render cleanly across Gmail web, Gmail iOS, Gmail Android, Outlook, Apple Mail, and Yahoo.

---

## Why this pattern, not the old dark one

The previous email template used `background-color:#0D0D0D` (jet black) with `@media (prefers-color-scheme: light)` overrides. Result: Gmail flagged the dark-bg HTML as suspicious, suppressed rendering, and customers saw blank emails. The new pattern below uses a light cream background by default and works everywhere.

---

## The five non-negotiable rules

1. **Light background only.** `#f5f4f0` (cream) outer, `#FFFFFF` (white) card. Never pure black.
2. **No `@media (prefers-color-scheme)` rules.** Inline CSS only. Email clients are not browsers; conditional CSS confuses them.
3. **Table-based layout.** Use `<table role="presentation">` for every section. Flexbox/grid does not survive email rendering.
4. **Always include a plaintext fallback URL under every primary CTA button.** Even if the button fails to render, the URL is clickable and copy-pasteable.
5. **Pure inline CSS on every element.** No `<style>` blocks. No external stylesheets.

---

## The canonical structure

Every Sovereign Synthesis email contains, in order:

1. **Preheader** (hidden, shows in inbox preview)
2. **Header bar** — `SOVEREIGN SYNTHESIS` wordmark + transmission/order tag right-aligned
3. **Gold accent line** — 3px `#d4a843` divider
4. **Main body** — kicker label + serif headline + body paragraphs
5. **Primary CTA block** — gold button + plaintext fallback URL
6. **Optional upsell card** — cream-bg card with secondary outline button
7. **Closing** — short paragraph + signature ("— Ace" / "Sovereign Synthesis")
8. **Footer** — unsubscribe link + brand line

---

## The HTML pattern

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{{SUBJECT}}</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f4f0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1a1a2e;">

  <!-- Preheader (hidden in body, shows in inbox preview) -->
  <div style="display:none;font-size:1px;color:#f5f4f0;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    {{PREHEADER_TEXT}}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f4f0;">
    <tr>
      <td align="center" style="padding:40px 16px;">

        <!-- Email card -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border:1px solid #ddd8d0;border-radius:8px;overflow:hidden;">

          <!-- Header bar -->
          <tr>
            <td style="background-color:#ffffff;padding:28px 40px;border-bottom:1px solid #ddd8d0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td><span style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#E5850F;">SOVEREIGN SYNTHESIS</span></td>
                  <td align="right"><span style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;color:#8E8C9A;letter-spacing:2px;text-transform:uppercase;">{{HEADER_TAG}}</span></td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Gold accent line -->
          <tr><td style="height:3px;background-color:#d4a843;font-size:0;line-height:0;">&nbsp;</td></tr>

          <!-- Body -->
          <tr>
            <td style="padding:48px 40px 8px 40px;">
              <p style="margin:0 0 8px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#E5850F;font-weight:600;">{{KICKER_LABEL}}</p>
              <h1 style="margin:0 0 28px 0;font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:600;color:#1a1a2e;line-height:1.25;letter-spacing:-0.3px;">{{HEADLINE}}</h1>
              <p style="margin:0 0 18px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.7;color:#3A3A3A;">{{BODY_PARAGRAPH_1}}</p>
            </td>
          </tr>

          <!-- Primary CTA block -->
          <tr>
            <td style="padding:32px 40px 8px 40px;">
              <p style="margin:0 0 8px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#d4a843;font-weight:700;">{{CTA_KICKER}}</p>
              <h2 style="margin:0 0 14px 0;font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:600;color:#1a1a2e;line-height:1.35;">{{CTA_HEADLINE}}</h2>
              <p style="margin:0 0 26px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.7;color:#555555;">{{CTA_DESCRIPTION}}</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background-color:#d4a843;border-radius:4px;">
                    <a href="{{PRIMARY_URL}}" style="display:inline-block;padding:16px 36px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#1a1a2e;text-decoration:none;">{{BUTTON_TEXT}} &rarr;</a>
                  </td>
                </tr>
              </table>
              <p style="margin:14px 0 0 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;color:#8E8C9A;line-height:1.6;">
                If the button doesn't work, paste this into your browser:<br/>
                <a href="{{PRIMARY_URL}}" style="color:#E5850F;text-decoration:underline;word-break:break-all;">{{PRIMARY_URL}}</a>
              </p>
            </td>
          </tr>

          <!-- Closing -->
          <tr>
            <td style="padding:32px 40px 40px 40px;">
              <p style="margin:0 0 8px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.7;color:#3A3A3A;">{{CLOSING_LINE}}</p>
              <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:16px;color:#1a1a2e;font-weight:600;">— Ace</p>
              <p style="margin:4px 0 0 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;color:#8E8C9A;letter-spacing:1px;">Sovereign Synthesis</p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f5f4f0;padding:24px 40px;border-top:1px solid #ddd8d0;">
              <p style="margin:0 0 8px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;color:#8E8C9A;line-height:1.6;text-align:center;">
                You're receiving this because you entered your email at sovereign-synthesis.com.<br/>
                <a href="https://sovereign-synthesis.com/unsubscribe" style="color:#8E8C9A;text-decoration:underline;">Unsubscribe</a>
              </p>
              <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;color:#aaaaaa;text-align:center;letter-spacing:2px;text-transform:uppercase;">
                Sovereign Synthesis · sovereign-synthesis.com
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>
```

---

## Color tokens used (do not change)

| Purpose | Hex | Use |
|---|---|---|
| Outer page bg | `#f5f4f0` | cream — outer wrapper |
| Card bg | `#ffffff` | white — email body card |
| Card border | `#ddd8d0` | subtle warm gray |
| Headline color | `#1a1a2e` | charcoal navy — h1, h2, signature |
| Body text | `#3A3A3A` | dark gray — paragraphs |
| Body dim | `#555555` | for secondary description text |
| Muted footer | `#8E8C9A` | mid-gray for fine print |
| Brand orange | `#E5850F` | wordmark + kicker labels |
| Sovereign gold | `#d4a843` | accent line + primary CTA bg |

---

## Anita / agent rule

When Anita or any other agent drafts a new email type (broadcast, nurture step, transactional), the agent MUST:

1. Read this template first.
2. Substitute only the `{{VARIABLES}}` — never modify the table structure, colors, or fonts.
3. Run the body copy through the Mom Test from `voice-tone.md` before submitting.
4. If the email type genuinely needs a different layout (rare), propose the change to the Architect before shipping.

---

## Storing live templates

Live email bodies for the nurture sequence are stored in Supabase `nurture_templates.html_body`. Update them via SQL using PostgreSQL `$tag$` dollar-quoted strings to avoid escape issues. The `send-nurture-email` edge function fetches them by `step` and ships via Resend with **no placeholder substitution** — so the stored HTML must be self-contained and not contain `{{LITERAL_PLACEHOLDERS}}` that won't be substituted at send time.
