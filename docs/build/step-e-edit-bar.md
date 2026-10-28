# Step E: a shorter edit bar

Lex (2026-10-28): "Can we simplify the edit bar, it is very long now." Today it has nine controls: Sound like me, Simpler, Shorter, Explain how it works, Check facts, Add B-roll, Suggest B-roll, and Ask… with send.

## The new bar

`[Shorter] [Simpler] [Sound like me] [More ▾] [B-roll ▾] [Ask… ➤]`

- **Shorter, Simpler and Sound like me** stay as they are: the three most-used rewrites.
- **More ▾** is a small menu with "Explain how it works" and "Check facts". It uses the same menu style as the script and export menus, opening up or down, whichever fits.
- **B-roll ▾** is a small menu:
  - "Add B-roll…" opens the C3 card.
  - "Suggest B-roll" makes the C4 ask.

  Disabled items stay disabled, as now. For guests, where only Suggest is allowed, the button is just "Suggest B-roll", with no menu.
- **Ask…** stays a text field, a little narrower. It grows when focused.
- The word count label stays.
- On phones the bar fits the screen width without sideways scrolling: Sound like me shows its icon only, and the field takes the rest.
- **Keyboard:** Tab moves through the bar, Enter or Space opens a menu, arrow keys move inside it, and Escape closes it and returns focus to its button. Opening a menu must not lose the text selection; the ask still uses the selected text.
- The bar's behaviour stays the same otherwise: pending dots, the agent shimmer, disabled states, guests' limits (D2) and the `/` menu.
- No tooltips that explain, and no new text beyond the menu labels.

## Checks

- Browser check with the demo at desktop and phone width, in light and dark, as host and as guest:
  - each item still makes its ask or opens its card;
  - the selection is kept through a menu;
  - nothing scrolls sideways.

  Measure the bar's width before and after, and report both.
- Run `kit doctor` and `kit specs`. Do not commit, push, deploy or stash. Report in at most 10 lines.
