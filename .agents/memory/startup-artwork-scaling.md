---
name: Startup artwork scaling
description: Responsive sizing rule for the tall SafeNet startup PNG on Android and wide preview surfaces
---

Use the uploaded 1008×2244 PNG as a full-viewport layer with a full-size frame and `fill` rendering so the artwork reaches every screen edge without cropping away the Shield or astronaut. Android phone viewports, including Pixel-class portrait ratios, are close enough to the source ratio that distortion stays limited on the target devices.

**Why:** Edge-to-edge `cover` rendering can crop the tall composition so aggressively on wide screens that the visible preview becomes an empty white field. Stretching the complete image preserves the loader's visual anchors while meeting the edge-to-edge requirement.

**How to apply:** Keep the frame at the available viewport width and height, use `object-fit: fill`, and keep loader controls in a separate overlay so image scaling never moves or clips them.