# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated (inferred from the request): static HTML/CSS/JS so the tool can open directly in a mobile browser without installation or build tooling.

## Users

Event hosts who need to collect participant names from a shared QR code and choose one winner fairly at the end of a timed round. Participants use their phones to scan the QR code and submit a name.

## Product Purpose

Create a repeatable timed name-draw flow: the host enters a duration, the site generates a QR code, participants submit names while the countdown is active, and the host closes the round and randomly selects one winner.

## Positioning

The same simple page acts as both the host control panel and the participant join page, with a round that can be reset and run again without rebuilding the experience.

## Operating Context

Used on a phone at an event or fan activity. The host starts a round and shows the QR code; participants scan it from their own phones. The host watches the countdown, closes submissions, reviews the collected names, and draws one winner.

## Capabilities and Constraints

- Duration input is required before a round can start.
- A QR code encodes a join URL for the active round.
- Participants submit a display name while the round is open.
- The countdown is visible to the host and on the participant join view.
- The host can close the round early and draw exactly one winner.
- The same experience supports starting multiple rounds.
- No real-time server, authentication, or persistent cross-device transport was supplied; the first implementation uses a shareable browser/local-session flow and clearly labels any local-only state.
- Thai is the primary interface language.

## Product Principles

- Start a round in seconds.
- Make the countdown and current state impossible to miss.
- Keep participant submission friction low.
- Make the winner draw feel clear and fair.
- Make another round one tap away.

## Accessibility & Inclusion

Use large touch targets, readable Thai labels, visible focus states, high contrast, and clear open/closed/finished states. Do not rely on color alone to communicate round status.
