# Claude Code: official install, update, diagnostics and auth vs. the network kit (as of 2026-09-22)

Source currency: all code.claude.com pages were fetched 2026-09-22 (they carry no visible "last updated" stamp; the authentication page references behaviour "before v2.1.265", so it is current to at least that release). npm `latest` is 2.1.278, published 2026-09-19T01:48:59Z; npm `stable` dist-tag is 2.1.267 — [npm registry](https://registry.npmjs.org/@anthropic-ai/claude-code). The GitHub CHANGELOG's newest heading is also 2.1.278 — [CHANGELOG](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md). Two sources could not be fetched directly through this session's egress proxy: `support.claude.com` (support articles) and `downloads.claude.ai` (the installer script that `https://claude.ai/install.sh` 302-redirects to, `https://downloads.claude.ai/claude-code-releases/bootstrap.sh`); support-article facts below are therefore quoted from search-result snippets and marked as such.

Kit files reviewed (absolute paths):
- `/home/user/metaplex/ops/network/scripts/bootstrap-ai-clis.sh`
- `/home/user/metaplex/ops/network/scripts/bootstrap-ai-clis.ps1`
- `/home/user/metaplex/ops/network/scripts/update-all.sh`
- `/home/user/metaplex/ops/network/scripts/update-all.ps1`
- `/home/user/metaplex/ops/network/scripts/verify.sh`
- `/home/user/metaplex/ops/network/README.md` (section "Sign-in for the three CLIs", lines 74-80)

Verdict summary: the kit's install commands, install-location assumptions, `claude update` usage, auto-update claims and SSH login text are all correct against the current docs. Corrections needed: (1) README "Check: `claude doctor`" is the wrong command for checking sign-in (`claude auth status --text` is the official one); (2) `setup-token` plan list should include Enterprise and the kit should state its limitations and that it needs a browser (not a signed-in machine); (3) `bootstrap-ai-clis.ps1` never persists `%USERPROFILE%\.local\bin` on the User PATH, which the docs say may be necessary; (4) `verify.sh`'s Windows probe does not prepend that directory the way its Unix probe does; (5) several fleet-relevant facts (macOS Keychain fallback over SSH, `claude auth login` for SSH, `ANTHROPIC_API_KEY` precedence, shared usage limits, AVX requirement) are worth adding.

## Key question 1: Install commands per OS, package managers, npm/Node, and which methods auto-update

### Takeaway
The kit's two install commands are exactly the documented native installer for macOS/Linux/WSL and (in long form) for Windows PowerShell, and the kit's claim that native installs auto-update is correct. Homebrew (`claude-code` = stable, `claude-code@latest` = latest), WinGet (`Anthropic.ClaudeCode`), apt/dnf/apk and npm (Node 22+ since v2.1.198, same native binary) all exist but do not auto-update by default; the kit doesn't use them for Claude, so no change is required there.

### Cited Findings

#### 1a. macOS/Linux/WSL native installer
- Kit says (`bootstrap-ai-clis.sh` line 78): `curl -fsSL https://claude.ai/install.sh | bash`, preceded at line 77 by `log "installing Claude Code (native installer, auto-updates itself)"`.
- Official: "**macOS, Linux, WSL:** `curl -fsSL https://claude.ai/install.sh | bash`" and "Native installations automatically update in the background to keep you on the latest version." — [Setup](https://code.claude.com/docs/en/setup)
- Correction: none. Command and auto-update claim match exactly.
- Optional: the installer accepts a channel or version: "`curl -fsSL https://claude.ai/install.sh | bash -s stable`" and "`curl -fsSL https://claude.ai/install.sh | bash -s 2.1.89`"; "The channel you choose at install time becomes your default for auto-updates." — [Setup](https://code.claude.com/docs/en/setup)

#### 1b. Windows PowerShell native installer
- Kit says (`bootstrap-ai-clis.ps1` line 49): `Invoke-Expression (Invoke-RestMethod -Uri 'https://claude.ai/install.ps1')`, with line 15 `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12` and line 48 `'installing Claude Code (native installer, auto-updates itself)'`.
- Official: "**Windows PowerShell:** `irm https://claude.ai/install.ps1 | iex`" — [Setup](https://code.claude.com/docs/en/setup). The TLS line the kit uses is the documented fix for TLS errors: "On Windows, enable TLS 1.2 in PowerShell before running the installer: `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12` / `irm https://claude.ai/install.ps1 | iex`" — [Troubleshoot installation](https://code.claude.com/docs/en/troubleshoot-install)
- Official also: "Run the install command from PowerShell or CMD. You do not need to run as Administrator." — [Setup](https://code.claude.com/docs/en/setup)
- Correction: none needed; `Invoke-Expression (Invoke-RestMethod …)` is the un-aliased form of `irm … | iex`. Optional: change line 49 to the documented literal `irm https://claude.ai/install.ps1 | iex` so it is greppable against the docs.

#### 1c. Windows CMD variant
- Kit says: nothing (the kit only uses PowerShell).
- Official: "**Windows CMD:** `curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd`" and "If you see `The token '&&' is not a valid statement separator`, you're in PowerShell, not CMD. If you see `'irm' is not recognized as an internal or external command`, you're in CMD, not PowerShell." — [Setup](https://code.claude.com/docs/en/setup)
- Correction: none required; optionally add the CMD line to the README for a hand-run fallback.

#### 1d. Homebrew casks
- Kit says: nothing for Claude (macOS uses the native installer); `update-all.sh` line 25 runs `brew upgrade` generically.
- Official: "`brew install --cask claude-code`" ; "Homebrew offers two casks. `claude-code` tracks the stable release channel, which is typically about a week behind and skips releases with major regressions. `claude-code@latest` tracks the latest channel and receives new versions as soon as they ship." ; "Homebrew installations do not auto-update. Run `brew upgrade claude-code` or `brew upgrade claude-code@latest`, depending on which cask you installed" ; "Homebrew keeps old versions on disk after upgrades. Run `brew cleanup` periodically" — [Setup](https://code.claude.com/docs/en/setup)
- Correction: none. (`update-all.sh` already runs `brew upgrade` and `brew cleanup -s`, so a Homebrew-installed Claude would be upgraded anyway.)

#### 1e. WinGet
- Kit says (`update-all.ps1` line 40): `& winget upgrade --id Anthropic.ClaudeCode --silent --accept-source-agreements --accept-package-agreements *> $null` (plus `winget upgrade --all` at line 20).
- Official: "`winget install Anthropic.ClaudeCode`" ; "WinGet installations do not auto-update. Run `winget upgrade Anthropic.ClaudeCode` periodically" ; "On WinGet the upgrade may fail while Claude Code is running because Windows locks the executable." — [Setup](https://code.claude.com/docs/en/setup)
- Correction: none; the package id is correct. Note the line is a no-op on machines bootstrapped with the native installer (WinGet does not manage that install), which is why output is suppressed.

#### 1f. apt / dnf / apk repositories
- Kit says: nothing (Linux uses the native installer).
- Official: "Claude Code publishes signed apt, dnf, and apk repositories. Each repository offers two channels: `stable` … and `latest`" ; apt line: `deb [signed-by=/etc/apt/keyrings/claude-code.asc] https://downloads.claude.ai/claude-code/apt/stable stable main` (key from `https://downloads.claude.ai/keys/claude-code.asc`, fingerprint `31DDDE24DDFAB679F42D7BD2BAA929FF1A7ECACE`); dnf `baseurl=https://downloads.claude.ai/claude-code/rpm/stable`; apk `https://downloads.claude.ai/claude-code/apk/stable`; "Package manager installations do not auto-update through Claude Code; updates arrive through your normal system upgrade workflow." ; "apt, dnf, and apk continue to require a manual upgrade because those commands need elevated privileges." — [Setup](https://code.claude.com/docs/en/setup)
- Correction: none required for the kit.

#### 1g. npm package and Node requirement
- Kit says (`bootstrap-ai-clis.sh` lines 2-4): "plus Node.js 20+ (Codex and Gemini are npm packages; Claude Code is a native binary and needs no Node)".
- Official: "`npm install -g @anthropic-ai/claude-code`" ; "As of v2.1.198, the npm package requires Node.js 22 or later. On an older Node.js version, npm prints an `EBADENGINE` warning during install rather than failing; the install completes and `claude` still runs, since the package downloads a native binary that doesn't use your Node.js at runtime." ; "The npm package installs the same native binary as the standalone installer." ; "To upgrade an npm installation, run `npm install -g @anthropic-ai/claude-code@latest`. Avoid `npm update -g`" ; "Do NOT use `sudo npm install -g`" — [Setup](https://code.claude.com/docs/en/setup). Registry metadata confirms `engines: {node: ">=22.0.0"}`, `bin: {claude: "bin/claude.exe"}`, eight per-platform optionalDependencies (`@anthropic-ai/claude-code-{darwin-arm64,darwin-x64,linux-x64,linux-arm64,linux-x64-musl,linux-arm64-musl,win32-x64,win32-arm64}`) — [npm registry](https://registry.npmjs.org/@anthropic-ai/claude-code/latest)
- Correction: none; the kit's statement that Claude Code needs no Node is correct for the native installer.

#### 1h. Which methods auto-update (README claim)
- Kit says (`README.md` line 80): "Native Claude Code installs auto-update; Codex and Gemini are npm packages that `update-all` moves to `@latest`."
- Official: "Native installations automatically update in the background. … Homebrew, WinGet, and Linux package manager installations require manual updates by default." ; "Claude Code checks for updates on startup and periodically while running. Updates download and install in the background, then take effect the next time you start Claude Code." ; opt-in for Homebrew/WinGet: "set `CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE` to `1`." — [Setup](https://code.claude.com/docs/en/setup)
- Correction: none; optionally append "(Homebrew/WinGet/apt installs do not; `claude update` still works on all of them)".

### Inferences
- Because the kit uses only the native installer on every OS, the auto-update story is uniform across the fleet and `update-all` calling `claude update` is a harmless accelerator, not a necessity.
- `winget upgrade --all` in `update-all.ps1` line 20 would also upgrade a WinGet-installed Claude, so line 40 is redundant but harmless.

### Gaps
- Could not verify the Homebrew cask or WinGet manifest contents directly (Homebrew/WinGet repos not fetched); the cask names and id are taken from the official docs only.

## Key question 2: Install locations and whether the installer edits PATH / shell rc files

### Takeaway
The docs confirm the native install lands at `~/.local/bin/claude` (symlink into `~/.local/share/claude/versions/`) on macOS/Linux and `%USERPROFILE%\.local\bin\claude.exe` on Windows, exactly as the kit assumes; the docs do not promise that the installer persists PATH and their troubleshooting table anticipates "PowerShell installer completes but `claude` is not found", so the kit's `ensure_path` on Unix is the right belt-and-braces and the PowerShell script should do the equivalent.

### Cited Findings

#### 2a. Unix install location and launcher
- Kit says (`bootstrap-ai-clis.sh` line 79): `ensure_path "$HOME/.local/bin"`; (`update-all.sh` line 17 and `verify.sh` line 15): `export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"`.
- Official: "the installer places `claude` at `~/.local/bin/claude` on macOS/Linux or `%USERPROFILE%\.local\bin\claude.exe` on Windows." — [Troubleshoot installation](https://code.claude.com/docs/en/troubleshoot-install). "On macOS and Linux, the native installer manages the launcher at `~/.local/bin/claude` as a symlink into `~/.local/share/claude/versions/`. If you replace that launcher with your own script or symlink, auto-update and `claude update` leave it in place … Before v2.1.207, the auto-updater replaced a custom launcher at that path with its own symlink on every update." — [Setup](https://code.claude.com/docs/en/setup). "The installer needs write access to `~/.local/bin/` and `~/.claude/` on macOS and Linux." — [Troubleshoot installation](https://code.claude.com/docs/en/troubleshoot-install)
- Correction: none; the paths the kit exports are correct.

#### 2b. Windows install location
- Kit says (`bootstrap-ai-clis.ps1` lines 19-21): `Refresh-Path` re-reads Machine + User PATH from the registry after install; nothing in the script adds `%USERPROFILE%\.local\bin`. (`verify.sh` lines 22-26, `WIN_PROBE`): relies on `Get-Command` with whatever PATH the SSH session inherits.
- Official: uninstall paths are `"$env:USERPROFILE\.local\bin\claude.exe"` and `"$env:USERPROFILE\.local\share\claude"`; the installer's download staging folder is `%USERPROFILE%\.claude\downloads` — [Setup](https://code.claude.com/docs/en/setup), [Troubleshoot installation](https://code.claude.com/docs/en/troubleshoot-install). "On Windows the install location is under `%USERPROFILE%`, which is writable by your user by default" — [Troubleshoot installation](https://code.claude.com/docs/en/troubleshoot-install)
- Correction: see 2c.

#### 2c. Does the installer edit PATH / rc files?
- Kit says (`bootstrap-ai-clis.sh` lines 27-35): its own `ensure_path` appends `export PATH="<dir>:$PATH"` to `~/.zshrc`, `~/.bashrc`, `~/.profile` when they exist (touching `.zshrc` on macOS, `.bashrc` elsewhere), guarded by `grep -qs "$1"`. `bootstrap-ai-clis.ps1` does not persist anything.
- Official docs never state that the installer edits shell config. They instead instruct the user: "If installation succeeded but you get a `command not found` or `not recognized` error when running `claude`, the install directory isn't in your PATH." Zsh fix: "`echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc`"; Bash fix: same into `~/.bashrc`; Windows PowerShell fix: "`$currentPath = [Environment]::GetEnvironmentVariable('PATH', 'User')` / `[Environment]::SetEnvironmentVariable('PATH', "$currentPath;$env:USERPROFILE\.local\bin", 'User')`" then "Restart your terminal". The error table has the row "PowerShell installer completes but `claude` is not found or shows an old version → Add the install directory to your PATH, then open a new terminal." — [Troubleshoot installation](https://code.claude.com/docs/en/troubleshoot-install)
- Official-repo issue (user report, not a maintainer statement): "`claude install` adds ~/.local/bin to ~/.bashrc only — macOS login shells do not read it, so `claude` is missing from PATH in new terminals" (opened 2026-06-06, v2.1.167, macOS arm64; reports the installer appends `export PATH="$HOME/.local/bin:$PATH"` to `~/.bashrc`, that duplicate lines accumulate on repeated installs, and that zsh users are unaffected; closed as "not planned"/stale, no maintainer response) — [anthropics/claude-code#65855](https://github.com/anthropics/claude-code/issues/65855). An older issue titled "claude install doesn't persist ~/.local/bin to PATH in shell config" also exists — [anthropics/claude-code#21069](https://github.com/anthropics/claude-code/issues/21069) (title only; body not fetched).
- Correction (`bootstrap-ai-clis.ps1`): after the install at line 49, persist the User PATH the way the docs do, and prepend it to the current session so the version table at lines 57-61 does not print `claude MISSING`. Exact text to insert after line 50 (`Refresh-Path`):
  ```powershell
  $claudeBin = "$env:USERPROFILE\.local\bin"
  $userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
  if (($userPath -split ';') -notcontains $claudeBin) { [Environment]::SetEnvironmentVariable('PATH', "$userPath;$claudeBin", 'User') }
  $env:Path = "$claudeBin;$env:Path"
  ```
- Correction (`verify.sh` line 22, `WIN_PROBE`): prepend the same directory so the Windows probe mirrors the Unix probe. Exact text: change the first line of `WIN_PROBE` to `WIN_PROBE='$env:Path = "$env:USERPROFILE\.local\bin;$env:USERPROFILE\AppData\Roaming\npm;" + $env:Path` followed by the existing `foreach …` block on the next line.
- Correction (`bootstrap-ai-clis.sh` `ensure_path`, optional): the grep guard at line 33 looks for the expanded directory (e.g. `/Users/x/.local/bin`) while the docs and the installer write the `$HOME`-form; both lines then coexist. Harmless, but to match the docs' snippet exactly, write `export PATH="$HOME/.local/bin:$PATH"` for that directory and grep for `.local/bin`.

### Inferences
- Since the docs anticipate `command not found` after both the Unix and PowerShell installers, the kit must not rely on the installer for PATH persistence; on Unix it already doesn't, on Windows it does (via `Refresh-Path`, which only helps if the installer wrote a User PATH entry).
- The `.sh` script writes to `~/.profile` as well, which sidesteps the macOS bash-login-shell problem described in #65855.

### Gaps
- The installer script itself (`https://downloads.claude.ai/claude-code-releases/bootstrap.sh`, the 302 target of `https://claude.ai/install.sh`) and `install.ps1` could not be fetched (egress proxy blocks `downloads.claude.ai`), so whether the current installer writes to rc files / User PATH, and to which files, is unverified against the script. The only evidence is the docs (silent, but plan for it not to) and user issue #65855 (says `.bashrc` only, as of v2.1.167).

## Key question 3: `claude update`, `claude doctor`, `claude --version`, release channels

### Takeaway
`claude update` (used by both `update-all` scripts and both bootstrap scripts) is the documented manual update path and works regardless of install method; `claude --version` prints e.g. `2.1.211 (Claude Code)`; `claude doctor` is a read-only install/settings diagnostic, not a login check. Release channel is `autoUpdatesChannel` (`latest` default, `stable` about a week behind), settable in `settings.json`, `/config`, or at install time.

### Cited Findings

#### 3a. `claude update`
- Kit says (`bootstrap-ai-clis.sh` line 74): `claude update >/dev/null 2>&1 || true`; (`bootstrap-ai-clis.ps1` line 46): `try { & claude update | Out-Host } catch { }`; (`update-all.sh` line 47): `claude update 2>&1 | tail -2`; (`update-all.ps1` line 39): `try { & claude update | Out-Host } catch { }`.
- Official: "To apply an update immediately without waiting for the next background check, run: `claude update`. When an update installs, the command reports `Successfully updated from <old version> to version <new version>`. If you're already on the newest version, it reports `Claude Code is up to date (<version>)`. Installs managed by Homebrew, WinGet, or apk report `Claude is up to date!` instead." — [Setup](https://code.claude.com/docs/en/setup). CLI reference: "`claude update` — Update to latest version" — [CLI reference](https://code.claude.com/docs/en/cli-reference). "`DISABLE_AUTOUPDATER` only stops the background check; `claude update` and `claude install` still work. To block all update paths, including manual updates, set `DISABLE_UPDATES` instead." — [Setup](https://code.claude.com/docs/en/setup)
- Known hang (fixed): "`claude update` and `claude doctor` scan your shell configuration files for an outdated `claude` alias … Before v2.1.214, a directory at one of those paths made both commands hang" — [Troubleshoot installation](https://code.claude.com/docs/en/troubleshoot-install). Changelog 2.1.277: "Fixed `claude update` on winget- or apk-managed installs reporting 'up to date' when the version lookup failed" and "Fixed `claude update` hanging when a minimum or maximum version is set, if a proxy returns an invalid version" — [CHANGELOG](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md)
- Correction: none. `tail -2` in `update-all.sh` will show the "Successfully updated…"/"up to date" line.
- Related: "`claude install [version]` — Install or reinstall the native binary. Accepts a version like `2.1.118`, or `stable` or `latest`." — [CLI reference](https://code.claude.com/docs/en/cli-reference)

#### 3b. `claude doctor`
- Kit says (`README.md` line 76): "Check: `claude doctor`" (in the Claude sign-in bullet).
- Official: "`claude doctor` prints read-only installation and settings diagnostics without starting a session, including install health, settings-file validation errors, and any warnings with suggested fixes." ; "Run `claude doctor` to see the result of the most recent update attempt." ; after disabling auto-updates, "checking that the `Auto-updates` line shows `disabled (set by env: DISABLE_AUTOUPDATER)` instead of `enabled`." — [Setup](https://code.claude.com/docs/en/setup). CLI reference: "`claude doctor` — Print read-only installation and settings diagnostics from the terminal without starting a session, including install health, settings-file validation errors, and Remote Control eligibility. For the in-session setup checkup that can also apply fixes, run `/doctor`" — [CLI reference](https://code.claude.com/docs/en/cli-reference). It also checks Keychain writability: "Run `claude doctor` to check Keychain access. When the Keychain rejects writes, the report lists a warning that starts with `macOS Keychain is not writable`" — [Troubleshoot installation](https://code.claude.com/docs/en/troubleshoot-install)
- Official login check: "`claude auth status` — Show authentication status as JSON. Use `--text` for human-readable output. Exits with code 0 if logged in, 1 if not" — [CLI reference](https://code.claude.com/docs/en/cli-reference); in-session "`/status`" "shows a `Login` row reading `Expired — log in again`" when expired, and "check `/status` to confirm which method is active" — [Authentication](https://code.claude.com/docs/en/authentication)
- Correction (`README.md` line 76): replace "Check: `claude doctor`." with "Check: `claude auth status --text` (exit 0 = logged in; `/status` inside a session shows which credential is active); `claude doctor` checks the install, auto-update state and, on macOS, Keychain writability."

#### 3c. `claude --version`
- Kit says (`bootstrap-ai-clis.sh` line 98, `update-all.sh` line 59, `verify.sh` line 17, `.ps1` equivalents): `claude --version 2>&1 | head -1`.
- Official: "`claude --version` … A working installation prints a version number such as `2.1.211 (Claude Code)`." — [Setup](https://code.claude.com/docs/en/setup); "The command prints a version number followed by `(Claude Code)`." — [Quickstart](https://code.claude.com/docs/en/quickstart)
- Correction: none. (The `--version` flag row is absent from the CLI-reference table, but the setup and quickstart pages document it.)

#### 3d. Release channels
- Kit says: nothing.
- Official: "Control which release channel Claude Code follows for auto-updates and `claude update` with the `autoUpdatesChannel` setting: `"latest"`, the default: receive new features as soon as they're released; `"stable"`: use a version that is typically about one week old, skipping releases with major regressions. Configure this via `/config` → **Auto-update channel**, or add it to your settings.json file: `{ "autoUpdatesChannel": "stable" }`" ; "`minimumVersion` … Background auto-updates and `claude update` refuse to install any version below this value" ; install-time: "`curl -fsSL https://claude.ai/install.sh | bash -s stable`" / "`& ([scriptblock]::Create((irm https://claude.ai/install.ps1))) stable`" — [Setup](https://code.claude.com/docs/en/setup). npm dist-tags on 2026-09-22: `stable` 2.1.267, `latest` 2.1.278 — [npm registry](https://registry.npmjs.org/@anthropic-ai/claude-code)
- Correction: none required. Optional for a personal fleet: add a `--stable` flag to the bootstrap scripts that passes `stable` to the installer, or document `"autoUpdatesChannel": "stable"` in `~/.claude/settings.json`.

### Inferences
- `claude doctor` is a fine post-update sanity check in `update-all`, but it is not what the README uses it for (sign-in verification); `claude auth status` is the correct tool and is scriptable (exit code), so `verify.sh` could add an `auth=` column cheaply.

### Gaps
- Docs do not state how often "periodically while running" checks for updates.

## Key question 4: Authentication (first-run, SSH/WSL/containers, `setup-token`, `ANTHROPIC_API_KEY`, credential storage)

### Takeaway
The kit's SSH login text ("press `c` … paste the code back at 'Paste code here if prompted'") matches the docs verbatim; the `setup-token` bullet needs three fixes (it needs a browser, not a signed-in machine; plans are Pro/Max/Team/Enterprise; the token can only make model requests, so no Remote Control or claude.ai connectors); and the kit should mention `claude auth login` for SSH, the macOS Keychain-locked-over-SSH fallback to plaintext `~/.claude/.credentials.json`, and that `ANTHROPIC_API_KEY` overrides the subscription.

### Cited Findings

#### 4a. First-run browser login and the SSH/WSL/container case
- Kit says (`bootstrap-ai-clis.sh` lines 103-104, `.ps1` lines 65-66): "run `claude`. A browser opens. Over SSH press `c` to copy the URL, open it on any machine, then paste the code back at "Paste code here if prompted"." (`README.md` line 76): "`claude` opens a browser. Over SSH press `c` to copy the URL, open it anywhere, paste the code back."
- Official: "On first launch, Claude Code opens a browser window for you to log in. If you've set the `ANTHROPIC_API_KEY` environment variable, Claude Code skips the login prompt and asks you to approve the key instead. If the browser doesn't open automatically, press `c` to copy the login URL to your clipboard, then paste it into your browser. If your browser shows a login code instead of redirecting back after you sign in, paste it into the terminal at the `Paste code here if prompted` prompt. This happens when the browser can't reach Claude Code's local callback server, which is common in WSL2, SSH sessions, and containers. When login completes, the terminal shows `Login successful` and prompts you to press `Enter` to continue." — [Authentication](https://code.claude.com/docs/en/authentication)
- Official SSH detail: "If using a remote/SSH session, the browser may open on the wrong machine. Copy the URL displayed in the terminal and open it in your local browser instead." ; "Alternatively, press `c` at the interactive login prompt to copy the OAuth URL, or copy the URL that `claude auth login` prints, and open it in a browser on your local machine. If pasting the code into the interactive prompt does nothing, your terminal's paste binding likely isn't reaching the input field. Try your terminal's alternate paste shortcut, often right-click or Shift+Insert in Windows Terminal, or use `claude auth login` instead, which reads the pasted code from standard input: `claude auth login`. This fallback also applies on native Windows or any terminal where pasting into the interactive prompt fails." — [Troubleshoot installation](https://code.claude.com/docs/en/troubleshoot-install). "`claude auth login` — Sign in to your Anthropic account. Use `--email` to pre-fill your email address, `--sso` to force SSO authentication, and `--console` to sign in with Anthropic Console" ; "`claude auth logout`" — [CLI reference](https://code.claude.com/docs/en/cli-reference)
- Plans: "Claude Code requires a Pro, Max, Team, Enterprise, or Console account. The free claude.ai plan does not include Claude Code access." — [Setup](https://code.claude.com/docs/en/setup)
- Correction: the existing text is accurate. Recommended addition to all three places (exact text): "Over SSH the simplest path is `claude auth login`: it prints the URL (open it in any browser, signed in to the fleet account) and reads the code from stdin. `/logout` inside a session signs out; `claude auth status --text` shows the state."

#### 4b. `claude setup-token` and `CLAUDE_CODE_OAUTH_TOKEN`
- Kit says (`bootstrap-ai-clis.sh` lines 105-106): "No-browser alternative: on a machine that is already signed in run `claude setup-token`, then on this machine  export CLAUDE_CODE_OAUTH_TOKEN=<token>  (needs a Pro/Max/Team plan)." (`.ps1` lines 67-68: same with `$env:CLAUDE_CODE_OAUTH_TOKEN = '<token>'`.) (`README.md` line 76): "Without any browser: `claude setup-token` on a signed-in machine, then `CLAUDE_CODE_OAUTH_TOKEN` on the target."
- Official: "For CI pipelines, scripts, or other environments where interactive browser login isn't available, generate a one-year OAuth token with `claude setup-token` … The command opens the same browser authorization flow as `/login`, and the token prints to the terminal after you approve access in the browser. It does not save the token anywhere; copy it and set it as the `CLAUDE_CODE_OAUTH_TOKEN` environment variable wherever you want to authenticate: `export CLAUDE_CODE_OAUTH_TOKEN=your-token`. This token authenticates with your Claude subscription and requires a Pro, Max, Team, or Enterprise plan. It can only make model requests, so it can't establish Remote Control sessions or fetch claude.ai connectors. MCP servers you configure locally still work. Bare mode does not read `CLAUDE_CODE_OAUTH_TOKEN`." — [Authentication](https://code.claude.com/docs/en/authentication). CLI reference: "`claude setup-token` — Generate a long-lived OAuth token for CI and scripts. Prints the token to the terminal without saving it. Requires a Claude subscription." — [CLI reference](https://code.claude.com/docs/en/cli-reference)
- Precedence: "5. `CLAUDE_CODE_OAUTH_TOKEN` environment variable. A long-lived OAuth token generated by `claude setup-token`. Use this for CI pipelines and scripts where browser login isn't available. If you run `/login` while the variable is set, Claude Code switches the current session to the new login, but reads the variable again in every new session until you remove it from your shell profile or the `env` block of a settings file." (ranked above "7. Subscription OAuth credentials from `/login`") — [Authentication](https://code.claude.com/docs/en/authentication)
- Correction (`bootstrap-ai-clis.sh` lines 105-106; mirror in `.ps1` lines 67-68 and README line 76). Exact text: "No-browser alternative for this machine: on any machine with a browser run `claude setup-token` (it opens the same browser authorization as login and prints a one-year token; needs Pro/Max/Team/Enterprise), then here  export CLAUDE_CODE_OAUTH_TOKEN=<token>. The token can only make model requests: no Remote Control, no claude.ai connectors (local MCP servers still work), and it overrides a normal login until you unset it. Prefer the interactive login on personal machines."

#### 4c. `ANTHROPIC_API_KEY`
- Kit says: nothing about it for Claude Code.
- Official: "3. `ANTHROPIC_API_KEY` environment variable. Sent as the `X-Api-Key` header … In interactive mode, you are prompted once to approve or decline the key, and your choice is remembered. To change it later, use the "Use custom API key" toggle in `/config`. … In non-interactive mode (`-p`), the key is always used when present." ; "If you have an active Claude subscription but also have `ANTHROPIC_API_KEY` set in your environment, Claude Code uses the API key once you approve it. This can cause authentication failures if the key belongs to a disabled or expired organization. Run `unset ANTHROPIC_API_KEY` to fall back to your subscription, and check `/status` to confirm which method is active." — [Authentication](https://code.claude.com/docs/en/authentication). "If you see `API Error: 400 ... "This organization has been disabled"` despite having an active Claude subscription, an `ANTHROPIC_API_KEY` environment variable is overriding your subscription." — [Troubleshoot installation](https://code.claude.com/docs/en/troubleshoot-install)
- Correction: add one line to README line 76 (exact text): "Do not export `ANTHROPIC_API_KEY` on these machines: once approved it takes precedence over the subscription login and bills the Console instead."

#### 4d. Credential storage per OS (and the SSH-on-macOS case)
- Kit says: nothing.
- Official: "On macOS, credentials are stored in the encrypted macOS Keychain. When the Keychain rejects the write, such as when it's locked in an SSH session, Claude Code stores your login in `~/.claude/.credentials.json` with file mode `0600` instead, the same storage it uses on Linux. A Console login that creates an API key fails until the Keychain is writable. … On Linux, credentials are stored in `~/.claude/.credentials.json` with file mode `0600`. On Windows, credentials are stored in `%USERPROFILE%\.claude\.credentials.json` and inherit the access controls of your user profile directory … If you've set the `CLAUDE_CONFIG_DIR` environment variable, Claude Code keeps the `.credentials.json` file under that directory instead" — [Authentication](https://code.claude.com/docs/en/authentication). Recovery: "`security unlock-keychain ~/Library/Keychains/login.keychain-db`" then "run `/logout` and then `/login`. Logging out removes all stored credentials, including the plaintext file's contents, saved MCP server logins, and plugin sensitive values" — [Troubleshoot installation](https://code.claude.com/docs/en/troubleshoot-install)
- Multi-session/expiry: "Parallel sessions on one machine share a saved login and coordinate its renewal so that only one process refreshes the token at a time. Before v2.1.211, waking the machine from sleep could cause two sessions to renew with the same token, which revoked the saved login" — [Troubleshoot installation](https://code.claude.com/docs/en/troubleshoot-install); "When the login you created with `/login` is within three days of expiring, Claude Code shows a warning at startup: `Your login expires in 3 days · run /login to renew`. Requires Claude Code v2.1.203 or later." — [Authentication](https://code.claude.com/docs/en/authentication); "To log out and re-authenticate, type `/logout` … Logging out also resets your first-launch setup state" — [Authentication](https://code.claude.com/docs/en/authentication)
- Correction: add to README (exact text): "Credentials live in the macOS Keychain, or `~/.claude/.credentials.json` (0600) on Linux and `%USERPROFILE%\.claude\.credentials.json` on Windows. On a Mac signed in over SSH the Keychain is usually locked, so the login lands in the plaintext file; either sign in once at the Mac's own terminal, or run `security unlock-keychain ~/Library/Keychains/login.keychain-db` first, then `/logout` and `/login` to move it into the Keychain (`claude doctor` reports 'macOS Keychain is not writable')."

### Inferences
- Because the kit's model is "push scripts over SSH, sign in over SSH", every Mac in the fleet will end up with a plaintext credentials file unless the Keychain is unlocked first; that is worth a checklist line, not just a README note.
- The SSH copy-URL step: `c` copies to the clipboard of the machine running `claude` (the remote), so over plain SSH the docs' "copy the URL displayed in the terminal" or `claude auth login` is the reliable path; the kit's "press `c`" is not wrong but may do nothing useful without clipboard forwarding.

### Gaps
- The docs do not state the lifetime of a normal `/login` credential (only that a warning appears three days before expiry and that `setup-token` tokens last one year).

## Key question 5: System requirements

### Takeaway
Current requirements are macOS 13+, Windows 10 1809+/Server 2019+, Ubuntu 20.04+/Debian 10+/Alpine 3.19+, 4 GB+ RAM, x64/ARM64 with AVX, ~512 MB free to install, ripgrep bundled; Git for Windows is recommended-but-optional for the Bash tool (PowerShell tool otherwise), matching the kit's `-WithGit` design.

### Cited Findings
- Official: "**Operating system**: macOS 13.0+; Windows 10 1809+ or Windows Server 2019+; Ubuntu 20.04+; Debian 10+; Alpine Linux 3.19+. **Hardware**: 4 GB+ RAM, x64 or ARM64 processor. **Network**: internet connection required. **Shell**: Bash, Zsh, PowerShell, or CMD." ; "**ripgrep**: usually included with Claude Code." — [Setup](https://code.claude.com/docs/en/setup)
- Kit says (`bootstrap-ai-clis.ps1` lines 3-4, 41): "with -WithGit, Git for Windows so Claude Code gets a Bash tool" / `Winget-Install 'Git.Git'`. Official: "Git for Windows is recommended on native Windows so Claude Code can use the Bash tool. If Git for Windows is not installed, Claude Code uses PowerShell as the shell tool instead. WSL setups do not need Git for Windows." ; "Installing Git for Windows is optional. It enables the Bash tool by providing Git Bash." ; if not found, settings `"CLAUDE_CODE_GIT_BASH_PATH": "C:\\Program Files\\Git\\bin\\bash.exe"` — [Setup](https://code.claude.com/docs/en/setup). Correction: none; optionally note in the `.ps1` header that without `-WithGit` Claude Code falls back to the PowerShell tool.
- Kit says (`bootstrap-ai-clis.ps1` line 6): "Needs winget (App Installer; present on Windows 10 1809+ and 11)." Official Claude floor is the same "Windows 10 1809+" — [Setup](https://code.claude.com/docs/en/setup). Correction: none.
- Install memory: "Installing needs roughly 512 MB of free memory, and running Claude Code needs more." ; "Claude Code requires at least 4 GB of RAM." — [Troubleshoot installation](https://code.claude.com/docs/en/troubleshoot-install)
- CPU: "`Illegal instruction` … your CPU likely lacks AVX or another instruction the binary requires. This affects roughly pre-2013 Intel and AMD processors, and virtual machines where the hypervisor does not pass AVX through … There is no native-binary workaround" ; "Claude Code requires a 64-bit operating system." — [Troubleshoot installation](https://code.claude.com/docs/en/troubleshoot-install)
- WSL: "WSL 2 … Sandboxing Supported; WSL 1 … Not supported" ; on WSL1 "`cannot execute binary file: Exec format error` … known native-binary regression tracked in issue #38788" — [Setup](https://code.claude.com/docs/en/setup), [Troubleshoot installation](https://code.claude.com/docs/en/troubleshoot-install)
- Alpine/musl: "requires `bash` and `curl` for the install command, and `libgcc`, `libstdc++`, and `ripgrep` at runtime … `apk add bash curl libgcc libstdc++ ripgrep` … then set `USE_BUILTIN_RIPGREP=0`" — [Setup](https://code.claude.com/docs/en/setup). Kit's `bootstrap-ai-clis.sh` line 85 already requires curl; Alpine additionally needs bash before the script can run at all.
- Correction (README, optional exact text): "Claude Code needs macOS 13+, Windows 10 1809+, Ubuntu 20.04+/Debian 10+, 4 GB RAM and a 64-bit CPU with AVX (roughly 2013 or newer); older personal machines fail with `Illegal instruction`."

### Inferences
- For a fleet of older personal machines, the AVX requirement is the most likely hard blocker and is not detected by any kit script; a one-line `grep -m1 -ow avx /proc/cpuinfo` (Linux) / `sysctl -a | grep -i avx` (macOS) pre-check in `bootstrap-ai-clis.sh` would surface it before the installer fails.

### Gaps
- No official statement found on macOS Intel vs Apple-silicon minimums beyond "x64 or ARM64" and "macOS 13.0+".

## Key question 6: Fleet of personal machines on one Pro/Max account (multi-machine login, device limits)

### Takeaway
Official material says one Pro/Max subscription covers Claude Code and the apps, that you log in with the same claude.ai credentials on every device, and that all surfaces draw from one shared 5-hour and weekly usage pool; no document reachable in this session states any device or concurrent-login limit for Claude Code.

### Cited Findings
- "To use Claude Code with a Pro or Max plan, ensure you have an active Pro or Max plan subscription, then log in with the same credentials you use for Claude to connect your subscription to Claude Code." (search snippet; article itself blocked from direct fetch) — [Use Claude Code with your Pro or Max plan](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan)
- "Your usage of all different Claude product surfaces (claude.ai, Claude Code, Claude Desktop) counts towards the same usage limit." Pro and Max "have a session-based usage limit that resets every five hours, plus a weekly usage limit that applies across all models and resets at a fixed time each week assigned to your account." (search snippets) — [Use Claude Code with your Pro or Max plan](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan); [Models, usage, and limits in Claude Code](https://support.claude.com/en/articles/14552983-models-usage-and-limits-in-claude-code)
- "To use your Claude account across multiple devices, enter the same email address you use to log in on your usual device." (search snippet) — [Log in to your Claude account](https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account)
- "With Pro and Max plans, you have access to both Claude on the web, desktop, and mobile apps and Claude Code in your terminal with one unified subscription." (search snippet) — [Use Claude Code with your Pro or Max plan](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan)
- Docs: logins are per machine and per user: "Parallel sessions on one machine share a saved login" — [Troubleshoot installation](https://code.claude.com/docs/en/troubleshoot-install); credentials are stored per user home directory (see 4d) — [Authentication](https://code.claude.com/docs/en/authentication)
- Docs: "Auto mode is the built-in starting permission mode for interactive terminal sessions on Pro, Max, and Team plans: a classifier reviews actions instead of you" — [Quickstart](https://code.claude.com/docs/en/quickstart) (fleet-relevant default behaviour, not an auth fact).
- Correction (README, optional exact text): "One Pro/Max account can be signed in on every machine (same email on each); all machines share the account's single 5-hour and weekly usage pool, so two hosts working at once drain it twice as fast. Each machine/user keeps its own credential; `/logout` on one does not affect the others."

### Inferences
- Nothing found suggests a device cap, but the shared usage pool is the practical fleet constraint; the kit's per-machine sign-in instructions are consistent with the support guidance.

### Gaps
- `support.claude.com` is blocked by this session's egress proxy, so the support-article quotes are search-engine snippets, not verified page text; the "last updated" dates of those articles are unknown.
- No official source found (docs or support snippets) that states a maximum number of devices or concurrent Claude Code logins per account, nor one that addresses sharing one personal account across machines used by different people (the fleet is described as one person's machines, so this may be moot).
