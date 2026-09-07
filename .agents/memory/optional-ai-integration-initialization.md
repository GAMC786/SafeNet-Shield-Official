---
name: Optional AI integration initialization
description: How optional OpenAI-backed routes should behave when hosted CI has no AI credentials
---

Optional OpenAI integrations must not instantiate their clients during module import when the application can run without those integrations. Initialize the client on first use and return a clear request-time configuration error if credentials are missing.

**Why:** Hosted release workflows intentionally validate packaging without granting AI credentials. Import-time client construction made unrelated billing and release tests fail before the Android build could run.

**How to apply:** Keep AI-backed routes importable in credential-free CI; test the actual AI route separately with a mocked client or test credential.