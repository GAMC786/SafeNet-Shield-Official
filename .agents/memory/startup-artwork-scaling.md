---
name: Startup artwork scaling
description: Responsive sizing rule for the tall SafeNet startup PNG on Android and wide preview surfaces
---

Use the uploaded 1008×2244 PNG as a full-viewport layer with a full-size frame and aspect-preserving `contain` rendering. Android phone viewports, including Pixel-class portrait ratios, are close enough to the source ratio that the artwork fills the display while keeping both the shield and astronaut visible.

**Why:** A full-size `cover` layer crops the tall composition on wide preview surfaces and can hide both visual anchors, while a constrained frame leaves some phone layouts underutilized. The white artwork background makes small aspect-ratio margins invisible, so `contain` provides the correct fit without destructive cropping.

**How to apply:** Keep the frame at the available viewport width and height, preserve the source aspect ratio, and keep loader controls in a separate overlay so image scaling never moves or clips them.