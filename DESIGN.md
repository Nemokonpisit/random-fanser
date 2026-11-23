# Design System — Lucky Draw

## Visual world

Inked event card: a mobile-first raffle tool that feels like a carefully filled-in j-card or ticket stub. White stock, blue ballpoint rules, and one warm orange mark for the live state and the winner. The interface should feel dependable in a noisy event scene, not like a generic SaaS dashboard.

## Tokens

```css
--paper: #fffdf9;
--paper-deep: #e4eaf2;
--ink: #10233f;
--ink-soft: #526178;
--blue: #2057c8;
--blue-pale: #e7eefc;
--orange: #f15a3b;
--orange-pale: #fff0eb;
--yellow: #f7c94b;
--line: #cbd3df;
--success: #187a61;
--radius-card: 18px;
--radius-button: 12px;
--shadow-paper: 0 16px 42px rgba(16, 35, 63, .12);
```

## Typography

Use Noto Sans Thai when available, with a readable sans fallback. Headings are heavy and compact; operational numbers use tabular numerals. Thai copy is short and action-led.

## Composition

- The first viewport shows the current action or the QR/countdown mechanism, not a marketing hero.
- Use a ruled-paper texture through real 1px borders and repeated rows, never gradients.
- Keep one dominant paper surface per view; use dividers and rows inside it instead of nested card stacks.
- QR, countdown, and round status are always visible without hunting.

## States

Open is blue/orange and says that names can still be submitted. Closed is ink-only and prevents further input. Drawn gives the winner a warm, high-contrast treatment. Every state also has a text label so color is never the only signal.

## Responsive behavior

Mobile is the primary layout: one column, 44px minimum touch targets, sticky-safe bottom spacing, and a QR that remains comfortably scannable. At wider widths the host view becomes a two-column board: QR/countdown on the left, participant ledger on the right.
