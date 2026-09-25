---
name: Framer Motion tab indicators
description: Keep shared-layout navigation markers centered while Framer Motion animates between tabs.
---

For a shared `layoutId` tab indicator, let the motion element span the tab width and center a fixed-width child inside it. Avoid combining the shared-layout transform with a centering translate on the same element.

**Why:** Framer Motion animates shared element geometry with transforms. Separating that animation from the inner marker's centering keeps the indicator aligned as it moves between tabs.

**How to apply:** Use an absolutely positioned `inset-x-0` flex wrapper for the `layoutId` element, center the inner marker with `justify-center`, and verify multiple tabs after the spring settles at desktop and mobile widths.