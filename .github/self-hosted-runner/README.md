# Self-hosted runner installer

This directory contains the installer script and instructions to install a GitHub Actions self-hosted runner (Linux x64) for the repository GAMC786/SafeNet-Shield-Official.

Files
- install-runner.sh — Automated installer script that downloads the latest GitHub Actions runner, configures it for the repository, and installs it as a service.

Quick usage (manual, recommended)
1. Get a short-lived registration token:
   - In GitHub: Repository → Settings → Actions → Runners → New self-hosted runner → Linux → x64 → copy the registration token.
   - Tokens are short-lived; run the installer immediately after copying.

2. On the target Linux x64 host, run (as a user with sudo):

```bash
sudo RUNNER_TOKEN=PASTE_UI_TOKEN_HERE bash -c 'curl -fsSL -o /tmp/install-runner.sh https://raw.githubusercontent.com/GAMC786/SafeNet-Shield-Official/main/.github/self-hosted-runner/install-runner.sh && chmod +x /tmp/install-runner.sh && /tmp/install-runner.sh --repo GAMC786/SafeNet-Shield-Official --name safe-runner-01 --labels linux,x64,self-hosted'
```

3. Verify in GitHub: Repository → Settings → Actions → Runners — `safe-runner-01` should appear online.

Alternative (automatic token creation with PAT)
- If you prefer the installer to create the registration token automatically, create a Personal Access Token (PAT) with repo permissions that allow creating runner tokens. Then run:

```bash
sudo GITHUB_PAT=ghp_yourPAThere bash -c 'curl -fsSL -o /tmp/install-runner.sh https://raw.githubusercontent.com/GAMC786/SafeNet-Shield-Official/main/.github/self-hosted-runner/install-runner.sh && chmod +x /tmp/install-runner.sh && /tmp/install-runner.sh --repo GAMC786/SafeNet-Shield-Official --name safe-runner-01 --labels linux,x64,self-hosted'
```

Do not commit PATs into the repository. Revoke the PAT after setup if it was created solely for this purpose.

Run workflow remotely (SSH) — prerequisites
- If you want to run the installer via the repository Actions workflow (.github/workflows/install-runner-remote.yml), add the following repository secrets (Settings → Secrets and variables → Actions):
  - RUNNER_HOST — target host IP/hostname
  - RUNNER_USER — SSH user on the target (must be able to sudo non-interactively)
  - SSH_PRIVATE_KEY — private key (corresponding public key in target's ~/.ssh/authorized_keys)
  - RUNNER_SSH_PORT — optional SSH port (defaults to 22)
  - Either RUNNER_TOKEN (short-lived registration token) OR GITHUB_PAT (PAT with repo permissions)

- Trigger the workflow: Repository → Actions → Remote install self-hosted runner → Run workflow. Choose use_pat=true if you provided GITHUB_PAT; otherwise leave false and ensure RUNNER_TOKEN is set.

What to watch in the workflow logs
- The step "Run install script on remote host" will SSH into the machine and output the install script logs. Look for:
  - Successful SSH connection
  - Output from the installer: download, extraction, config.sh messages (Runner registration success), and svc.sh install/start messages.

Troubleshooting
- SSH authentication failure: verify RUNNER_HOST, RUNNER_USER, and SSH_PRIVATE_KEY. Test locally with: `ssh -i /path/to/key -p PORT user@host 'echo ok'`.
- Sudo requires password: the SSH user must sudo without a password for automatic remote run. Test: `ssh ... 'sudo -n true'` (returns non-zero if password required).
- Token expired: generate a fresh token if config.sh reports token invalid.
- Missing packages: installer uses curl/tar; install them manually if the target has no package manager.

If the workflow run fails
- Open the run in Actions, copy the full log of the SSH step, and paste it here. I'll analyze and provide actionable fixes.

Contact
- If you want me to monitor a run, paste the Actions run URL or the SSH-step logs and I’ll analyze them and guide the next steps.
