---
name: Android SMS regex safety
description: Why local SMS rules use a deliberately restricted regular-expression subset.
---

Keep user-authored SMS regexes simple enough to execute with bounded cost on the incoming SMS delivery path. Reject grouping, alternation, backreferences, and patterns with more than one repetition operator.

**Why:** Incoming SMS bodies are untrusted input, and a pathological expression can delay message delivery or consume CPU during broadcast handling.

**How to apply:** If expanding SMS pattern syntax, preserve the bounded-execution guarantee or move matching to a guaranteed-linear-time engine before permitting richer expressions.