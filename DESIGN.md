# DESIGN.md — orOS

Design language for orOS (useoros.online): the shell, every app, the installers' screens and the download page. Source of truth: OROS_BIBLE.md (Part VII UI standards, rules R32/R33, Part III app registry). Where this file and the Bible differ, the Bible wins and this file gets fixed.

## Identity

- "A static operating system in your browser": Linux-desktop feel, offline-first, mobile-first, free and open for anyone.
- Logo: gold triangle in the skin gold `#d4af37` (decision of Christos, 2026-10-31: the logo follows the skin; the older logo gold `#c8a96e` is retired). The PNG icons are built from `icon.svg` by `node tools/brand-icons.js` (app and add-on icons) and `node tools/solo-icons.js` (single apps); never edit them by hand.
- Public product: nothing tied to Christos, Glarolykoi or his accounts unless he asks.

## Skins and theme

- Default: skin `oros`, theme dark (`<html data-skin="oros" data-theme="dark">`). Light theme always available.
- `oros` dark: `--bg #14120d`, `--bg-desktop #1a1712`, `--bar-bg rgba(20,18,13,.93)`, `--text #f0ead9`, `--text-dim #a89f8a`, `--accent #d4af37`, `--accent-hover #ecc75f`, `--accent-soft rgba(212,175,55,.20)`, `--panel-bg #1d1a13`, `--border #322d20`, `--shadow rgba(0,0,0,.50)`.
- `oros` light: `--bg #faf7ef`, `--text #241f14`, `--accent #b8860b`, `--panel-bg #ffffff`, `--border #ddd5c0`.
- Other skins (Adwaita, Lumo violet, Ubuntu, Fedora, Mint, Arch, Debian, elementary, Tux, Manjaro, openSUSE, NixOS, Gentoo, Pop!_OS) are full palettes. Apps never hard-code colours: they inherit the skin through `inheritPalette` / `watchPalette`.
- Manifest theme colour `#1b1a18`, background `#14120d` (the splash).

## Typography

- Nunito, self-hosted woff2 (400–800), Greek-capable. No web-font services.
- Apps that offer user fonts (Atelier, Layout) use their own offline font sets; the shell font stays Nunito.

## Layout and components

- Shell: taskbar, start menu with Linux-style categories (Office, Creativity, Games, Sound, Accessories, Fun), CSS-gradient wallpapers, optional Dock.
- Popups centred (R32): native `<dialog>` with `margin: auto`, or a fixed overlay with a centred panel; long content scrolls inside. Context menus stay at the pointer.
- All dialogs and file handling go through `dialogs.js` / `orosDialog` (R33).
- Icons: inline SVG with viewBox and explicit size.
- Toasts bottom-right by default, max 5, undo toasts ≥ 8 s. Notifications (inbox, bell) are a different thing from toasts.
- Scrollbars 10px, pill thumb, hover in the accent.
- `[hidden]{display:none!important}` is the last rule of every app stylesheet.

## Mobile and input

- Touch targets ≥ 44px, safe-area insets, breakpoints 480/420/360; long-press 450ms mirrors right-click.
- Toolbars wider than the phone scroll sideways, never clip.
- Desktop ≥ 1024px may split views.

## Behaviour

- Autosave (debounced, no Save buttons for settings). Delete = danger styling plus an Undo toast rather than confirmations.
- Bilingual EN/EL in every release (help and What's new included), German as a third language; EL dates ηη/μμ/εεεε.
- Never key CSS or JS on localised text.

## Do / don't

- Do: warm dark gold desktop, clear app icons, calm motion that respects `prefers-reduced-motion`.
- Don't: external CDNs or trackers, Google dependencies, per-app colour schemes that ignore the skin, off-centre popups.
