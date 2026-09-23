# Nixlabs Project & Design System Directives - Karaoke Theater

This project is part of the Nixlabs ecosystem (`*.nixlabs.tech`).

## Design & Color Scheme Exception
- **BESPOKE COLOR SCHEME**: Karaoke Theater maintains its own dark cinematic brass aesthetic.
  - `--theater-bg`: `#131211`
  - `--theater-sidebar-bg`: `#181614`
  - `--theater-surface`: `#1f1c19`
  - `--theater-surface-hover`: `#282420`
  - `--theater-border`: `#2e2924`
  - `--accent-brass`: `#deb668`
  - `--accent-brass-hover`: `#edd18e`
  - `--theater-text`: `#f5f0e6`
  - `--theater-text-muted`: `#9a9183`
  - `--theater-text-dim`: `#686055`
- Fonts: `Plus Jakarta Sans`, `JetBrains Mono`, `Zen Kurenaido` / `Noto Sans JP`.

## Ecosystem Continuity & Auth Separation
- `accounts.nixlabs.tech`: The ecosystem Identity Provider (SSO via `_nixlabs_session` cookie).
- `security.nixlabs.tech`: Sovereign Master Vault. Protected by Master PIN, Security Questions, Turnstile, and Host-Only cookie (`__Host-_sec_vault`).
- Floating top-right profile avatar connects into the Nixlabs ecosystem drawer while respecting the Theater aesthetic.
