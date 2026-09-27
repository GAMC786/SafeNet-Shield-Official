---
name: Light Mode accent contrast
description: Keep text contrast accessible without darkening shared accent surfaces or selection states.
---

In Light Mode, keep the shared accent token pale for subtle fills and selected controls; override `.text-accent` directly when that pale value is used for text.

**Why:** The same semantic token serves both background fills and text. Darkening it globally to fix a statistic or icon can make accent surfaces and selected controls overly saturated.

**How to apply:** Before changing a shared theme token for contrast, inspect its foreground and background uses. Prefer a scoped text/status override when the two roles need different colors.