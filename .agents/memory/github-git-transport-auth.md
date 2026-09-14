---
name: GitHub Git transport authentication
description: The authentication format required when publishing repository refs through Git HTTPS.
---

GitHub’s REST API accepts a personal access token in a Bearer authorization header, but Git smart HTTP pushes require Basic authentication using `x-access-token:<PAT>`. A Bearer header can therefore report “invalid credentials” for Git pushes even when the same token successfully authenticates API requests.

**Why:** The release token was valid against the GitHub API, but the initial Git push failed until the transport used GitHub’s Basic format.

**How to apply:** For Git HTTPS operations, disable stale credential helpers and send `Authorization: Basic <base64(x-access-token:PAT)>`. Keep the token in the workspace secret manager and never print it.