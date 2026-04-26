# Canonical User-Facing Page Template — Sovereign Synthesis

**Source of truth.** When generating a new sales page, diagnostic, member-portal page, or any consumer-facing surface served from `sovereign-synthesis.com`, start from this pattern.

**Locked:** 2026-04-26 — after the cyan-on-dark diagnostic readability problem proved consumer pages need light theme + high contrast.

---

## The five non-negotiable rules

1. **Light theme is the default.** Cream `#f5f4f0` outer + white `#ffffff` cards. Dark theme is reserved for operator UIs (Mission Control, Sentinel Bot dashboard) and TCF video content only — never for sovereign-synthesis.com.
2. **Sovereign gold (`#d4a843`) is the primary accent.** Brand orange (`#E5850F`) for kicker labels and the wordmark. Cyan blue is **NOT** a sovereign-synthesis.com color anymore.
3. **Georgia/serif headlines, Helvetica body.** Editorial, sovereign, easy to read.
4. **Minimum body text 16px on consumer pages, 17–18px preferred.** Keep line-height 1.55–1.7 for readability.
5. **Mom Test passes on every word before ship.** See `voice-tone.md` for the jargon kill list.

---

## CSS variables (paste into `<style>` of any new page)

```css
:root {
  /* Backgrounds */
  --bg: #f5f4f0;          /* warm cream — outer page background */
  --card: #ffffff;        /* white — inner cards */
  --card-soft: #faf9f5;   /* off-white — secondary cards / nested blocks */
  --border: #ddd8d0;      /* subtle warm gray — dividers / card edges */

  /* Text */
  --text: #1a1a2e;        /* charcoal navy — headlines + signature */
  --body: #3A3A3A;        /* dark gray — primary paragraph text */
  --body-dim: #555555;    /* secondary description text */
  --muted: #8E8C9A;       /* mid-gray — fine print, footers */

  /* Accents */
  --gold: #d4a843;        /* sovereign gold — primary CTAs, accent lines */
  --gold-hover: #e8bf5a;  /* hover/lift state */
  --orange: #E5850F;      /* brand orange — wordmark + kicker labels */

  /* Optional state colors (use sparingly) */
  --success: #2E8B57;     /* darker green for light bg */
  --warning: #C8881C;     /* darker amber for light bg */
  --error: #B33A3A;       /* muted red for light bg */

  /* Typography */
  --serif: Georgia, 'Times New Roman', serif;
  --sans: 'Helvetica Neue', Helvetica, Arial, sans-serif;
  --mono: 'Courier Prime', 'Courier New', monospace;

  /* Spacing scale */
  --space-1: 8px;
  --space-2: 16px;
  --space-3: 24px;
  --space-4: 32px;
  --space-5: 48px;
  --space-6: 72px;

  /* Radius */
  --radius: 8px;
  --radius-sm: 4px;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; -webkit-font-smoothing: antialiased; }
body {
  background: var(--bg);
  color: var(--body);
  font-family: var(--sans);
  font-size: 17px;
  line-height: 1.65;
}
```

---

## Component patterns

### Headline + kicker label

```html
<p style="margin:0 0 8px 0;font-family:var(--sans);font-size:12px;letter-spacing:3px;text-transform:uppercase;color:var(--orange);font-weight:700;">
  Tier 02 — The Shield
</p>
<h1 style="margin:0 0 20px 0;font-family:var(--serif);font-size:36px;font-weight:600;color:var(--text);line-height:1.2;letter-spacing:-0.3px;">
  Burnout is not a personal failure.<br/>
  It is the architecture you are running.
</h1>
```

### Card (white on cream)

```html
<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:32px 36px;">
  <!-- card content -->
</div>
```

### Primary CTA button

```html
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td style="background-color:var(--gold);border-radius:var(--radius-sm);">
      <a href="{{URL}}" style="display:inline-block;padding:16px 36px;font-family:var(--sans);font-size:14px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--text);text-decoration:none;">
        Install The Shield &rarr;
      </a>
    </td>
  </tr>
</table>
```

### Secondary outline button

```html
<a href="{{URL}}" style="display:inline-block;padding:14px 28px;font-family:var(--sans);font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--text);text-decoration:none;border:1.5px solid var(--gold);border-radius:var(--radius-sm);background:transparent;">
  Get Protocol 77 &rarr;
</a>
```

### Section header (small mono caps)

```html
<p style="margin:32px 0 12px 0;font-family:var(--mono);font-size:11px;letter-spacing:3px;color:var(--gold);text-transform:uppercase;font-weight:700;">
  §01 — The Observation
</p>
```

### Pull quote / sovereign callout

```html
<blockquote style="font-family:var(--serif);font-style:italic;font-size:22px;line-height:1.45;color:var(--text);border-left:3px solid var(--gold);padding:8px 0 8px 24px;margin:32px 0;">
  If this is landing against something already inside you, this was for you.
</blockquote>
```

---

## What NOT to do

- **No cyan blue accents on consumer pages.** That was the TCF aesthetic, retired from website use.
- **No `@media (prefers-color-scheme: dark)` overrides.** A buyer on a dark-mode browser still gets the light page.
- **No background gradients on outer body.** Flat cream only.
- **No bright neon colors for state indicators.** Use the muted state colors above.
- **No Helvetica or Georgia substitutes** unless rendering forces a fallback.

---

## When this template is required

Read this skill before producing any of the following on `sovereign-synthesis.com`:

- Sales pages (`/p77`, `/tier-3/manifesto`, etc.)
- Diagnostic / quiz UIs
- Lead-magnet capture pages (`/`, `/manual`, `/about`)
- Member-portal pages (post-purchase)
- Application pages (`/tier-7/inner-circle`)
- Static content pages (`/privacy`, `/terms`, `/unsubscribe`, `/about`)

For email HTML, see [`email-templates.md`](email-templates.md) — different rules apply because email clients are not browsers.
