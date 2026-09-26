# macOS OpenSSH server (Sonoma 14 / Sequoia 15 / Tahoe 26 / Golden Gate 27) and Tailscale — kit verification, as of 2026-09-22

Scope note on sourcing: this session's egress proxy blocks `support.apple.com`, `discussions.apple.com`, `tailscale.com`, `ss64.com`, `eclecticlight.co`, `learn.microsoft.com`, `web.archive.org` and most man-page mirrors. GitHub (`github.com`, `raw.githubusercontent.com`) and `developer.apple.com/forums` were reachable. So: Apple and Tailscale *source code* (apple-oss-distributions/OpenSSH, tailscale/tailscale, Homebrew, winget-pkgs, mas-cli) is quoted verbatim from fetched files; Apple Support and Tailscale Docs pages are quoted only as far as their text appeared in search-result excerpts, and each such quote is marked "(search excerpt)". Nothing below is from memory alone; unverifiable items are listed under Gaps.

Kit files reviewed (absolute paths):
- `/home/user/metaplex/ops/network/scripts/enable-ssh-server.sh` (macOS branch lines 22–32, `--harden` lines 52–69)
- `/home/user/metaplex/ops/network/scripts/update-all.sh` (macOS block lines 21–26)
- `/home/user/metaplex/ops/network/scripts/bootstrap-ai-clis.sh` (macOS parts lines 30, 42–44)
- `/home/user/metaplex/ops/network/checklists/trimurti-join.md` (Case A, lines 12–30)
- `/home/user/metaplex/ops/network/README.md` ("SSH troubleshooting", lines 64–72)

---

## Q1. Does `sudo systemsetup -setremotelogin on` still work; what does the Full Disk Access failure look like; is `launchctl load -w …/ssh.plist` (or `launchctl enable` + `bootstrap`/`kickstart`) a valid fallback; what does `-getremotelogin` print?

### Takeaway
`systemsetup -setremotelogin on` still works on Sonoma, Sequoia and Tahoe **only if the calling terminal app has Full Disk Access**; otherwise it fails with `setremotelogin: Turning Remote Login on or off requires Full Disk Access privileges.` (confirmed on macOS 15.7.3 in Sept 2026). Toggling the `com.openssh.sshd` launchd job directly needs no FDA; `launchctl load -w` still works but is a legacy subcommand, the non-deprecated form is `launchctl enable system/com.openssh.sshd` + `launchctl bootstrap system /System/Library/LaunchDaemons/ssh.plist`. `-getremotelogin` prints `Remote Login: On` / `Remote Login: Off` and the kit's case-insensitive `grep ': on'` handles it.

### Cited Findings

**(a) What the kit says** — `/home/user/metaplex/ops/network/scripts/enable-ssh-server.sh` lines 22–32:
```bash
if [ "$OS" = "Darwin" ]; then
  if $SUDO systemsetup -getremotelogin 2>/dev/null | grep -qi ': on'; then
    echo "Remote Login already on"
  else
    $SUDO systemsetup -setremotelogin on 2>/dev/null || $SUDO launchctl load -w /System/Library/LaunchDaemons/ssh.plist 2>/dev/null || true
    if ! $SUDO systemsetup -getremotelogin 2>/dev/null | grep -qi ': on'; then
      echo "Could not enable Remote Login from the shell (macOS wants Full Disk Access for the terminal app)."
      echo "Turn it on in System Settings > General > Sharing > Remote Login, allow your user, then rerun."
      exit 1
    fi
  fi
```

**(b) What the official sources say**
- Apple Support, "Use the systemsetup command-line utility on macOS Catalina 10.15" (search excerpt): "To use the systemsetup command with either the -setremotelogin or -setremoteappleevents flag in macOS Catalina 10.15 or later, first give the parent process full-disk-access." — [Apple Support 101653](https://support.apple.com/en-us/101653)
- Exact error text, reproduced on macOS 15.7.3 (issue filed 2026-09-06): `setremotelogin: Turning Remote Login on or off requires Full Disk Access privileges.` followed by `command failed with exit code 1`. Same issue notes: "Granting Full Disk Access and restarting the terminal isn't sufficient if the command runs under a pre-existing daemonized tmux server. The tmux process retains its prior permission context and must be terminated separately." — [alehatsman/dotfiles issue #4](https://github.com/alehatsman/dotfiles/issues/4)
- Apple Community threads with the same error title "Turning Remote Login on or off requires Full Disk Access privileges" — [discussions.apple.com/thread/251833298](https://discussions.apple.com/thread/251833298), [thread/250864855](https://discussions.apple.com/thread/250864855) (titles from search results; pages not fetchable here)
- Workaround stated in those threads / Alan Siu (community, search excerpt): "You can enable or disable SSH using launchctl commands instead: `sudo launchctl load -w /System/Library/LaunchDaemons/ssh.plist` to enable SSH and `sudo launchctl unload /System/Library/LaunchDaemons/ssh.plist` to disable it." — [Alan Siu, Scripting SSH off/on without needing a PPPC/TCC profile (2020)](https://www.alansiu.net/2020/09/02/scripting-ssh-off-on-without-needing-a-pppc-tcc-profile/)
- `-getremotelogin` output: "if remote login and SSH is currently disabled and in the default macOS state, the command will report `Remote Login: Off`" (search excerpt) — [OSXDaily](https://osxdaily.com/2016/08/16/enable-ssh-mac-command-line/)
- Apple's own launchd job for sshd — verbatim from Apple's OpenSSH source (`com.openssh.sshd.plist`, shipped as `/System/Library/LaunchDaemons/ssh.plist`): `Label` = `com.openssh.sshd`; `Disabled` = `true`; `Program` = `/usr/libexec/sshd-keygen-wrapper`; `Sockets/Listeners/SockServiceName` = `ssh` with Bonjour `ssh`,`sftp-ssh`; `inetdCompatibility` with `Wait` = `false`, `Instances` = `42`; `SHAuthorizationRight` = `system.preferences`. — [apple-oss-distributions/OpenSSH com.openssh.sshd.plist](https://github.com/apple-oss-distributions/OpenSSH/blob/main/com.openssh.sshd.plist)
- Apple's status helper reads the launchd enable state, not a separate preference: `remote-login-status.c`: `int enabled = SMJobIsEnabled(kSMDomainSystemLaunchd, CFSTR("com.openssh.sshd"), &persistent);` … `printf("Remote Login: %s\n", (enabled ? "on": "off"));` — [apple-oss-distributions/OpenSSH remote-login-status.c](https://github.com/apple-oss-distributions/OpenSSH/blob/main/remote-login-status.c)
- `launchctl load`/`unload` are legacy: "The launchctl manual lists load and unload as legacy subcommands … deprecated since macOS 10.10 (Yosemite)"; replacement is `launchctl enable system/<label>` then `launchctl bootstrap system /path/to/plist` (search excerpts) — [Alan Siu, launchctl "new" subcommand basics (2023)](https://www.alansiu.net/2023/11/15/launchctl-new-subcommand-basics-for-macos/); Homebrew itself migrated: PR "Convert to using launchctl bootstrap instead of deprecated launchctl load -w" — [Homebrew/homebrew-services #112](https://github.com/Homebrew/homebrew-services/pull/112); cheat sheet: "deprecation of the old commands with launchctl 2 (10.10) has been terrible", lists `bootstrap`, `bootout`, `enable`, `disable`, `kickstart`, `print` with `system` / `user/<uid>` / `gui/<uid>` targets — [masklinn launchctl cheat sheet](https://gist.github.com/masklinn/a532dfe55bdeab3d60ab8e46ccc38a68)
- `kickstart -k`: "The kickstart subcommand can take -k to kill any currently running instance before starting the new one" (search excerpt) — [rakhesh.com launchctl commands](https://rakhesh.com/mac/macos-launchctl-commands/)
- Tahoe 26.1 (25B78) regression: Full Disk Access could not be granted to `sshd-keygen-wrapper` through the Settings UI (a UI-visibility bug per Apple DTS "Quinn"); still present in 26.2 RC; **fixed in 26.3 beta 1**; workaround: "Drag the binary (e.g sshd-keygen-wrapper) from Finder to the full disk access list in System Settings window. The permission will be given, but it won't show in the list" — [Apple Developer Forums thread 806187](https://developer.apple.com/forums/thread/806187)

**(c) Correction needed** — yes, three small ones (the logic is right, the fallback is deprecated and the FDA error is silently discarded):
1. `2>/dev/null` on `systemsetup -setremotelogin` hides the one error message the operator needs to see; capture and echo it.
2. Prefer the non-deprecated `launchctl enable` + `bootstrap` pair, keep `load -w` as the last resort (it still works today).
3. Failure text: name the (i) button and the "Allow access for" pop-up, and say to open a *new* terminal window (and kill any old tmux server) after granting FDA.

Corrected block (replaces lines 22–32):
```bash
if [ "$OS" = "Darwin" ]; then
  if $SUDO systemsetup -getremotelogin 2>/dev/null | grep -qi ': on'; then
    echo "Remote Login already on"
  else
    # 1) Apple's supported switch. Needs Full Disk Access for the *calling* terminal app
    #    (Terminal/iTerm). A tmux server started before FDA was granted keeps the old denial.
    out="$($SUDO systemsetup -setremotelogin on 2>&1)" || true
    case "$out" in *"Full Disk Access"*) echo "systemsetup: $out" ;; esac
    if ! $SUDO systemsetup -getremotelogin 2>/dev/null | grep -qi ': on'; then
      # 2) Flip the launchd job directly (no FDA needed). Non-deprecated subcommands first,
      #    legacy 'load -w' as the last resort. sshd is socket-activated, so nothing to start.
      $SUDO launchctl enable system/com.openssh.sshd 2>/dev/null || true
      $SUDO launchctl bootstrap system /System/Library/LaunchDaemons/ssh.plist 2>/dev/null \
        || $SUDO launchctl load -w /System/Library/LaunchDaemons/ssh.plist 2>/dev/null || true
    fi
    if ! $SUDO systemsetup -getremotelogin 2>/dev/null | grep -qi ': on'; then
      echo "Could not enable Remote Login from the shell."
      echo "Either: System Settings > Privacy & Security > Full Disk Access > add your terminal app, open a NEW terminal window, rerun;"
      echo "or: System Settings > General > Sharing > Remote Login: turn on, click (i), set 'Allow access for' to All users (or add your user), then rerun."
      exit 1
    fi
  fi
```

**(d) Source URLs** — listed inline above.

### Inferences
- Because Apple's own `remote-login-status` helper and System Settings read `SMJobIsEnabled(... "com.openssh.sshd")`, enabling the job with `launchctl enable`/`load -w` is what makes `-getremotelogin` (and the Sharing toggle) report On; this is consistent with the community reports that the launchctl route "works", but I could not fetch a page that states it for Sequoia/Tahoe explicitly.
- `-getremotelogin` does not need FDA: Apple's note lists only the `-set…` flags, and the kit relies on `-get…` succeeding without FDA — consistent with the 2026 issue report where `-set` failed but the state was still readable.
- The `SHAuthorizationRight = system.preferences` in ssh.plist is why the launchctl route still needs `sudo` (admin), just not TCC/FDA.

### Gaps
- Could not fetch the Sequoia/Tahoe/Golden Gate `systemsetup(8)` man page itself (ss64, keith.github.io, manp.gs, unix.com all blocked); the `-f` "skip confirmation" flag and the exact `-setremotelogin off` confirmation prompt are therefore unverified here (the kit only turns the service *on*, which has no prompt in any report I saw).
- No source found that documents whether `launchctl enable system/com.openssh.sshd` alone (without `bootstrap`) is enough on a cold-booted Mac where the job was never bootstrapped; the corrected code runs both, then `load -w`, so it is safe either way.

---

## Q2. GUI path (System Settings → General → Sharing → Remote Login) and the "Allow access for: All users / Only these users" restriction

### Takeaway
The kit's GUI path and troubleshooting item are correct for Ventura 13 through macOS 26; the official page (macOS 26 edition exists) adds the (i) button, the "Allow access for" pop-up with "All users" / "Only these users", and (behind (i)) the "Allow full disk access for remote users" checkbox. Add those three details to the README's troubleshooting item 3 and the script's failure text.

### Cited Findings

**(a) What the kit says**
- `/home/user/metaplex/ops/network/README.md` line 68: `3. **macOS Remote Login off**, or on but restricted to "Only these users" without yours: System Settings → General → Sharing → Remote Login.`
- `/home/user/metaplex/ops/network/scripts/enable-ssh-server.sh` line 29: `echo "Turn it on in System Settings > General > Sharing > Remote Login, allow your user, then rerun."`

**(b) What Apple says** — "Allow a remote computer to access your Mac", Mac User Guide (search excerpts; a macOS 26-specific edition of the page exists at the URL below):
- "On your Mac, choose Apple menu > System Settings, click General in the sidebar, then click Sharing. Click (i) next to Remote Login and turn on Remote Login."
- "To choose who can log in to your computer, click the pop-up menu next to 'Allow access for,' choose 'Only these users,' click (+) at the bottom of the list, select users who can log in remotely, then click Select. Users & Groups includes all the users of your Mac, while Network Users and Network Groups include people on your network."
- "Remote Login allows you to access your Mac from another computer using SSH (Secure Shell Protocol) or SFTP (SSH File Transfer Protocol)."
— [Apple Support mchlp1066 (macOS 26 edition)](https://support.apple.com/en-bn/guide/mac-help/allow-a-remote-computer-to-access-your-mac-mchlp1066/26/mac/26); generic link [support.apple.com/guide/mac-help/mchlp1066/mac](https://support.apple.com/guide/mac-help/mchlp1066/mac)
- "Allow full disk access for remote users" checkbox: "This setting is now under General ‣ Sharing instead of Privacy & Security ‣ Full Disk Access, and it's only visible if you click the little i button next to Remote Login." (search excerpt) — [Michael Tsai, Allowing a Remote Computer to Access Your Mac (2023)](https://mjtsai.com/blog/2023/04/28/allowing-a-remote-computer-to-access-your-mac/); "This checkbox enables full disk access for /usr/libexec/sshd-keygen-wrapper" (search excerpt) — [rtrouton/profiles EnableFullDiskAccessforSSH](https://github.com/rtrouton/profiles/tree/main/EnableFullDiskAccessforSSH)
- Tahoe 26 added: "FileVault can now be unlocked over SSH after a restart if Remote Login is enabled and a network connection is available" (search excerpt) — [Der Flounder, Unlocking FileVault via SSH on macOS Tahoe](https://derflounder.wordpress.com/2025/10/11/unlocking-filevault-via-ssh-on-macos-tahoe/); Apple's enterprise notes for Tahoe: [What's new for enterprise in macOS Tahoe 26](https://support.apple.com/en-us/124963)

**(c) Correction** — wording only. Suggested README line 68:
`3. **macOS Remote Login off**, or on but "Allow access for" is set to "Only these users" without yours: System Settings → General → Sharing → Remote Login → (i) → set "Allow access for" to All users, or (+) your user. (Same panel: "Allow full disk access for remote users" if scripts run over SSH must read protected folders — it grants FDA to /usr/libexec/sshd-keygen-wrapper. On macOS 26.1–26.2 that grant may not show in the list even when it works; fixed in 26.3.)`

**(d) URLs** — inline above.

### Inferences
- The "Only these users" list is what makes a *key* login fail for an unlisted user even with a correct `authorized_keys` — the Apple page frames the pop-up as controlling "who can log in", which covers all auth methods; the kit's README already draws this conclusion.

### Gaps
- Apple's page text was only available through search excerpts; the exact button glyphs ("(i)", "(+)") are as rendered in those excerpts.

---

## Q3. Does macOS's `/etc/ssh/sshd_config` contain `Include /etc/ssh/sshd_config.d/*`, so a drop-in `50-trimurti.conf` with `PasswordAuthentication no` works? How to restart sshd (`launchctl kickstart -k system/com.openssh.sshd`)? Does `sudo sshd -t` work?

### Takeaway
Yes — Apple's build script inserts `Include /etc/ssh/sshd_config.d/*` near the top of the shipped `sshd_config` and ships `/etc/ssh/sshd_config.d/100-macos.conf` (`UsePAM yes`, `AcceptEnv LANG LC_*`, `Include /etc/ssh/crypto.conf`). Because sshd keeps the *first* value it sees, drop-ins override the defaults below; `50-trimurti.conf` sorts before `100-macos.conf` and does not collide with it. `sshd -t` is a standard sshd flag; `launchctl kickstart -k system/com.openssh.sshd` is valid, though sshd on macOS is spawned per-connection by launchd so new connections read the new config without a restart. The kit's `--harden` is correct as written.

### Cited Findings

**(a) What the kit says** — `/home/user/metaplex/ops/network/scripts/enable-ssh-server.sh` lines 52–69:
```bash
if [ "$HARDEN" = 1 ]; then
  SSHD_DIR=/etc/ssh/sshd_config.d
  if ! grep -qs '^Include /etc/ssh/sshd_config.d/' /etc/ssh/sshd_config; then
    echo "/etc/ssh/sshd_config does not Include sshd_config.d; add these lines to it by hand instead:"
    ...
    exit 1
  fi
  $SUDO mkdir -p "$SSHD_DIR"
  printf 'PubkeyAuthentication yes\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin no\n' \
    | $SUDO tee "$SSHD_DIR/50-trimurti.conf" >/dev/null
  if $SUDO sshd -t; then
    if [ "$OS" = "Darwin" ]; then $SUDO launchctl kickstart -k system/com.openssh.sshd; else $SUDO systemctl restart "$SVC"; fi
    ...
```

**(b) What Apple's source says** — verbatim from `xcscripts/make-config.zsh`, the script that generates `/etc/ssh` for the OS (current `main`; tags run OpenSSH-328.x = 2024 through OpenSSH-354.120.2 = Jun 2026):
```
# NOTE: The following Include directive is not part of the default
# sshd_config shipped with OpenSSH. Options set in the included
# configuration files generally override those that follow. The defaults
# only apply to options that have not been explicitly set. Options that
# appear multiple times keep the first value set, unless they are a
# multivalue option such as HostKey or IdentityFile.
Include /etc/ssh/@@@_config.d/*
```
with `@@@` replaced by `sshd` for `sshd_config` (inserted after the `# default value` header line) and `ssh` for `ssh_config`; the mtree then creates `sshd_config.d type=dir mode=755` containing `100-macos.conf content=${src}/conf/100-macos.conf`, plus `crypto/apple.conf`, `crypto/fips.conf` and `crypto.conf -> crypto/apple.conf`. — [apple-oss-distributions/OpenSSH xcscripts/make-config.zsh](https://github.com/apple-oss-distributions/OpenSSH/blob/main/xcscripts/make-config.zsh)
- `conf/100-macos.conf`, verbatim: `# Options set by macOS that differ from the OpenSSH defaults.` / `UsePAM yes` / `AcceptEnv LANG LC_*` / `Include /etc/ssh/crypto.conf` — [conf/100-macos.conf](https://github.com/apple-oss-distributions/OpenSSH/blob/main/conf/100-macos.conf)
- `conf/apple.conf` (default `crypto.conf` target): `Ciphers ^aes128-gcm@openssh.com,aes256-gcm@openssh.com` / `KexAlgorithms ^ecdh-sha2-nistp256` / `MACs ^hmac-sha2-256-etm@openssh.com,hmac-sha2-256` — [conf/apple.conf](https://github.com/apple-oss-distributions/OpenSSH/blob/main/conf/apple.conf)
- Apple ships a reset helper installed at `/usr/libexec/reset-ssh-configuration` ("WARNING: Continuing will overwrite the existing SSH configuration files in /etc/ssh with the macOS default configuration. Only host keys … will be preserved."; must be run with sudo) — [reset-ssh-configuration.zsh](https://github.com/apple-oss-distributions/OpenSSH/blob/main/reset-ssh-configuration.zsh)
- Apple's tag history (newest first): OpenSSH-354.120.2 (Jun 5 2026), 354.100.6 (Apr 13 2026), 354.80.3 (Feb 19 2026), 354.0.3 (Oct 4 2025), 346.120.3 (May 16 2025), 346 (Apr 25 2025), 342 (Jan 14 2025), 341 (Sep 24 2024), 328.141.1 (Aug 19 2024), 328.100.5 (Mar 25 2024) — [apple-oss-distributions/OpenSSH tags](https://github.com/apple-oss-distributions/OpenSSH/tags)
- `sshd_config(5)` as shipped by Apple: "**Include** Include the specified configuration file(s). Multiple pathnames may be specified and each pathname may contain glob(7) wildcards that will be expanded and processed in lexical order. Files without absolute paths are assumed to be in /etc/ssh." — [openssh/sshd_config.5](https://github.com/apple-oss-distributions/OpenSSH/blob/main/openssh/sshd_config.5)
- `sshd(8)` as shipped by Apple: "**-t** Test mode. Only check the validity of the configuration file and sanity of the keys. This is useful for updating sshd reliably as configuration options may change." — [openssh/sshd.8](https://github.com/apple-oss-distributions/OpenSSH/blob/main/openssh/sshd.8)
- Community confirmation that the shipped file has the line and that the `.d` scheme dates from Monterey: "The /etc/ssh/sshd_config file on macOS includes a line `Include /etc/ssh/sshd_config.d/*` … Apple changed the way the config works in Monterey to add a .d directory scheme … with /etc/ssh/sshd_config.d containing 100-macos.conf" (search excerpts) — [MacRumors thread](https://forums.macrumors.com/threads/question-about-securing-sshd-by-disallowing-password-login.2387994/), [jtesta/ssh-audit issue #201](https://github.com/jtesta/ssh-audit/issues/201); "you can't go past it with a higher number. Instead, you have to get in front of them and use a LOWER number" (search excerpt, about overriding 100-macos.conf) — [same MacRumors thread](https://forums.macrumors.com/threads/question-about-securing-sshd-by-disallowing-password-login.2387994/)
- launchd spawns sshd per connection: ssh.plist has `inetdCompatibility` / `Wait=false` and `Program /usr/libexec/sshd-keygen-wrapper` (see Q1) — [com.openssh.sshd.plist](https://github.com/apple-oss-distributions/OpenSSH/blob/main/com.openssh.sshd.plist); the wrapper's man page: "sshd-keygen-wrapper — Simple wrapper for sshd ensuring host keys are properly created" — [sshd-keygen-wrapper.8](https://github.com/apple-oss-distributions/OpenSSH/blob/main/sshd-keygen-wrapper.8)

**(c) Correction needed** — none to the logic. Optional improvements:
- The kit's grep `'^Include /etc/ssh/sshd_config.d/'` matches Apple's exact line `Include /etc/ssh/sshd_config.d/*`. Keep.
- `50-trimurti.conf` sorts before `100-macos.conf`; the two files set disjoint options, so ordering is moot, but the "first value wins" rule from Apple's NOTE means a lower number is the right choice if you ever override a macOS default. Keep `50-`.
- Optionally make the macOS restart a no-op-tolerant step and say why: `$SUDO launchctl kickstart -k system/com.openssh.sshd 2>/dev/null || true  # sshd is spawned per connection by launchd; new sessions already see the new config`.
- Add to README troubleshooting: `sudo /usr/libexec/reset-ssh-configuration` restores Apple's default /etc/ssh (keeps host keys) if a hand edit ever breaks sshd.

**(d) URLs** — inline above.

### Inferences
- `sudo sshd -t` resolves to `/usr/sbin/sshd` under macOS sudo's default PATH (sudo on macOS does not set `secure_path`; `/usr/sbin` is in the default PATH). Not separately sourced; the kit could spell `$SUDO /usr/sbin/sshd -t` on Darwin to remove the dependency.
- Because `UsePAM yes` is set by `100-macos.conf`, `KbdInteractiveAuthentication no` in the drop-in is what actually closes the PAM password path — the kit already includes it.

### Gaps
- I could not confirm from a fetched Apple page *which* OS release first shipped the `Include` line (community says Monterey 12). For the three versions in scope (14/15/26) every source agrees it is present, and Apple's current build script generates it.
- Did not fetch the `sshd-keygen-wrapper` C source (directory listing needs the GitHub API, which this session cannot use), so the exact `execv("/usr/sbin/sshd", …)` line is unquoted; the path `/usr/sbin/sshd` is only from general knowledge.

---

## Q4. macOS Keychain and SSH keys: `ssh-add --apple-use-keychain`; `UseKeychain` in `~/.ssh/config`

### Takeaway
Apple's `ssh-add` has `--apple-use-keychain` (store passphrase in Keychain when adding) and `--apple-load-keychain` (load identities using stored passphrases); the old `-K`/`-A` spellings still behave as before but are renamed. `UseKeychain yes` (Apple-only `ssh_config` option, default `no`, incompatible with `PKCS11Provider`) plus `AddKeysToAgent yes` is the standard `Host *` stanza. The kit does not mention any of this; `ssh-keys.sh` runs a plain `ssh-add "$KEY_FILE"` — fine, but add a one-line macOS note.

### Cited Findings

**(a) What the kit says** — only `/home/user/metaplex/ops/network/scripts/ssh-keys.sh` line 29: `ssh-add "$KEY_FILE" >/dev/null 2>&1 || true`. No `UseKeychain`, `AddKeysToAgent` or `--apple-use-keychain` anywhere under `ops/network`.

**(b) What Apple's man pages say** (verbatim from Apple's OpenSSH source):
- `ssh-add(1)`: "**--apple-use-keychain** When adding identities, each passphrase will also be stored in the user's keychain. When removing identities with -d, each passphrase will be removed from it." / "**--apple-load-keychain** Add identities to the agent using any passphrase stored in the user's keychain." / "… options used in earlier macOS releases. These options have been renamed --apple-load-keychain and --apple-use-keychain respectively. However, -A and -K still behave as in earlier releases except in the following circumstances. If a security provider was specified with -S …" — [openssh/ssh-add.1](https://github.com/apple-oss-distributions/OpenSSH/blob/main/openssh/ssh-add.1)
- `ssh_config(5)`: "**UseKeychain** On macOS, specifies whether the system should search for passphrases in the user's keychain when attempting to use a particular key. When the passphrase is provided by the user, this option also specifies whether the passphrase should be stored into the keychain once it has been verified to be correct. The argument must be 'yes' or 'no'. The default is 'no'. Incompatible with PKCS11Provider." — [openssh/ssh_config.5](https://github.com/apple-oss-distributions/OpenSSH/blob/main/openssh/ssh_config.5)
- GitHub Docs (fetched from the github/docs source): config example `Host github.com` / `AddKeysToAgent yes` / `UseKeychain yes` / `IdentityFile ~/.ssh/id_ed25519`; command `ssh-add --apple-use-keychain ~/.ssh/id_ed25519`; notes: "The --apple-use-keychain option is included in Apple's standard ssh-add utility, replacing the older -K flag"; "If you did not create a passphrase for your key, you should remove the UseKeychain line"; "For a `Bad configuration option: usekeychain` error, add `IgnoreUnknown UseKeychain`" — [GitHub Docs: Generating a new SSH key and adding it to the ssh-agent](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/generating-a-new-ssh-key-and-adding-it-to-the-ssh-agent)

**(c) Correction** — additive. Suggested text for the README "SSH troubleshooting" or a "macOS admin machine" note:
```
# macOS admin machine: remember the key passphrase in Keychain (Apple-only options)
ssh-add --apple-use-keychain ~/.ssh/trimurti-admin      # once
# ~/.ssh/config (generated by ssh-config-gen.sh): add to the Host * block on macOS only
#   AddKeysToAgent yes
#   UseKeychain yes          # omit if the key has no passphrase; Linux ssh rejects it (use IgnoreUnknown UseKeychain if the file is shared)
```
And in `ssh-keys.sh`, on Darwin: `ssh-add --apple-use-keychain "$KEY_FILE"` instead of `ssh-add "$KEY_FILE"` (with the plain form as fallback for older releases).

**(d) URLs** — inline above.

### Inferences
- None beyond the above.

### Gaps
- None material.

---

## Q5. `softwareupdate -ia --verbose` vs `--install --all --restart`; does `-ia` install macOS OS updates without `--restart`? Is `mas upgrade` still valid / is `mas` maintained in 2026?

### Takeaway
`-i -a` (= `--install --all`) is valid; `-R/--restart` only adds "Automatically restart (or shut down) if required to complete installation". Without `-R` a restart-requiring macOS update is downloaded/prepared but completes only after a restart — which is exactly the kit's "never reboots" contract — but on Apple silicon `softwareupdate` needs a volume-owner login (`--user`/`--stdinpass`) to actually install OS updates, so unattended `-ia` may leave OS updates pending. `mas` is actively maintained (v7.0.0 in Homebrew, commits Aug 2026); `mas upgrade` still works as an alias of `mas update`, but `update` "require[s] root privileges" and will prompt for sudo if not already cached.

### Cited Findings

**(a) What the kit says** — `/home/user/metaplex/ops/network/scripts/update-all.sh` lines 21–26:
```bash
  if [ "$OS" = "Darwin" ]; then
    log "macOS software update (installs what it can without a restart)"
    $SUDO softwareupdate -ia --verbose 2>&1 | tail -15
    softwareupdate -l 2>&1 | grep -qi 'restart' && REBOOT=yes
    if have brew; then log "Homebrew"; brew update >/dev/null 2>&1; brew upgrade; brew cleanup -s >/dev/null 2>&1; fi
    if have mas; then log "App Store"; mas upgrade; fi
```
and `/home/user/metaplex/ops/network/scripts/bootstrap-ai-clis.sh` lines 42–44: `have brew || { warn "Homebrew is missing. Install it from https://brew.sh, then rerun."; return 1; }` / `brew install node >/dev/null 2>&1 || brew upgrade node >/dev/null 2>&1 || true`.

**(b) What the sources say**
- `softwareupdate(8)` (man page text via search excerpts of ss64's transcription; the page itself is blocked here): "`-R | --restart` Automatically restart (or shut down) if required to complete installation. … if the user invoking the tool is logged in then macOS will attempt to quit all applications, logout, and restart."; "`--all` All updates that are applicable to your system, including those non-recommended ones."; "`--agree-to-license` agree to the software license agreement without any user interaction."; "`--stdinpass` collects a password from STDIN without interaction and is Apple silicon only. The `--user` flag specifies a local username to authenticate as an owner and is also Apple silicon only." — [ss64 softwareupdate](https://ss64.com/mac/softwareupdate.html)
- "When installing macOS updates on Apple silicon Macs, unlike Intel models, an admin 'owner' of that system is required to authenticate before the update can be installed. Those options allow that to be performed using the softwareupdate command." (search excerpt) — [Eclectic Light, Taking manual control of macOS updates with softwareupdate (2023)](https://eclecticlight.co/2023/09/06/taking-manual-control-of-macos-updates-with-softwareupdate/); 2026 follow-up (blocked, title only): [Take control of updates using softwareupdate (2026-07-30)](https://eclecticlight.co/2026/07/30/take-control-of-updates-using-softwareupdate/)
- "neither the man page for softwareupdate nor its current usage information are complete or accurate, and the man page claims to have been last updated in 2012" (search excerpt) — [Eclectic Light 2026](https://eclecticlight.co/2026/07/30/take-control-of-updates-using-softwareupdate/)
- Community (Jamf, search excerpt): "You cannot avoid restart with modern macOS updates on Apple Silicon … tools that would use --download to pre-load the update but not force it to install were finding that it was unexpectedly being installed at reboot." — [Jamf Nation: MacOS Update from Terminal](https://community.jamf.com/t5/jamf-pro/macos-update-from-terminal/m-p/294822)
- Community (search excerpt): "You must use the -R command to automatically restart your Mac for the update to work. Otherwise, you may find the softwareupdate command not working. This is particularly important for macOS major version updates" — [iBoysoft](https://iboysoft.com/tips/update-mac-from-terminal.html) (low-authority; included only because it is the sole explicit statement found)
- mas README (fetched raw): install table "Homebrew Core | `brew install mas` | 14+ (recommended)"; "Homebrew Tap | `brew install mas-cli/tap/mas` | 13+"; badge "supported OS: macOS 13+"; commands table: "`update [<id>…]` | Update outdated apps | spotlight, root, account | alias `upgrade`" and "`update --accurate [<id>…]` … alias `upgrade`"; "## Root Privileges — `get`, `install`, `lucky`, `update` & `uninstall` require root privileges. If run without root privileges, mas requests them as necessary. mas uses existing valid sudo credentials, falling back to prompting for the macOS user password, which is piped directly to a sudo process"; "`get`, `install`, `lucky`, `update` & `outdated --accurate` require an Apple Account signed in to the App Store"; Spotlight indexing "must be enabled & valid for folders containing App Store apps"; "Manage system software (macOS, Safari…) — Use softwareupdate" — [mas-cli/mas README](https://github.com/mas-cli/mas/blob/main/README.md)
- Homebrew formula `mas`: `tag: "v7.0.0"`; `depends_on :macos`; `uses_from_macos "swift" => :build, since: :sequoia # swift 6.2+`; bottles for `arm64_golden_gate`, `arm64_tahoe`, `arm64_sequoia`, `arm64_sonoma`, `sonoma`; backport patch "to fix build with Swift 6.4" on Tahoe or newer — [Homebrew/homebrew-core Formula/m/mas.rb](https://github.com/Homebrew/homebrew-core/blob/main/Formula/m/mas.rb)
- Maintenance: "actively maintained, with 45 contributors and 55 releases, with the last commit on 2026-08-25" (search excerpt) — [x-cmd mas page](https://www.x-cmd.com/install/mas/); repo shows ~2,987 commits, Swift 6.3, MIT — [github.com/mas-cli/mas](https://github.com/mas-cli/mas)
- Homebrew bottle naming confirms the 2026 release is "golden_gate": `arm64_golden_gate` bottle in the mas formula (above); Apple released macOS 27 "Golden Gate" on 2026-09-14 (search excerpts) — [MacRumors](https://www.macrumors.com/2026/09/10/macos-27-golden-gate-release-date/), [9to5Mac](https://9to5mac.com/2026/09/09/apple-confirms-macos-27-golden-gate-launch-date-september-14/)

**(c) Correction needed** — two small ones plus a caveat:
1. Add `--agree-to-license` so a licence prompt cannot stall an unattended run, and print the whole log rather than only `tail -15` when `--verbose` is on (or drop `--verbose`). Corrected line 23:
   `$SUDO softwareupdate -ia --agree-to-license --verbose 2>&1 | tail -25`
2. `mas upgrade` → `mas update` (the documented name; `upgrade` is only an alias) and run it through `$SUDO` so it uses the already-cached sudo credential instead of prompting mid-script: `if have mas; then log "App Store"; $SUDO mas update; fi`. (`update-all.sh` is documented as run with `--tty` so sudo can ask; without a TTY mas's own password prompt would hang.)
3. Add a comment above the macOS block (no code change): on Apple silicon, macOS OS updates via `softwareupdate` need a volume-owner login (`--user <admin> --stdinpass`) — unattended `-ia` installs app/security-response updates but may leave the OS update pending; the `REBOOT_REQUIRED` line already tells the operator to finish it. The kit's decision to omit `--restart` is correct for a script that promises never to reboot.
   No change to the `brew` lines (`brew cleanup -s` is valid); `bootstrap-ai-clis.sh`'s Homebrew handling is fine.

**(d) URLs** — inline above.

### Inferences
- The kit's `softwareupdate -l | grep -qi restart` relies on the list output flagging restart-requiring updates; I could not fetch a page showing the modern `-l` format (`Action: restart` in my recollection), so treat that detector as plausible but unverified.

### Gaps
- No fetched Apple document answers "does `-ia` without `--restart` install an OS update" definitively; the man page's `-R` wording plus the Eclectic Light / Jamf excerpts support "downloaded and prepared, applied at next restart; on Apple silicon owner auth is required". Mark as community-confirmed.
- `mas` on macOS 27 Golden Gate: the Homebrew bottle exists (`arm64_golden_gate`), but I found no explicit statement from mas-cli about 27 support.

---

## Q6. Tailscale install per OS (Linux script; macOS App Store vs Standalone vs `brew install --cask` vs `brew install tailscale`; where the CLI lives; Windows winget vs MSI)

### Takeaway
Linux one-liner is correct. macOS: Tailscale recommends the **Standalone** build; the Homebrew cask was **renamed `tailscale` → `tailscale-app`** (old name still resolves) and installs that Standalone `.pkg`; the GUI variants' CLI is `/Applications/Tailscale.app/Contents/MacOS/Tailscale` (alias it, do not symlink); the formula `brew install tailscale` is the CLI-only open-source `tailscaled`, which is the only macOS variant that can run the Tailscale SSH *server*, and it cannot coexist with the app. Windows: winget id is `Tailscale.Tailscale`, and because the kit passes `-e` (case-sensitive exact match) the lowercase `tailscale.tailscale` must be fixed; the winget package is the `.exe` bootstrapper, the MSI is the unattended alternative.

### Cited Findings

**(a) What the kit says** — `/home/user/metaplex/ops/network/checklists/trimurti-join.md` lines 16–28:
```bash
# Linux
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh              # --ssh lets tailnet members SSH in with tailnet identity (Linux only)
# macOS
brew install --cask tailscale        # the menu-bar app; sign in from it. CLI: /Applications/Tailscale.app/Contents/MacOS/Tailscale
```
```powershell
# Windows
winget install --id tailscale.tailscale -e
# then sign in from the tray icon, or:  tailscale up
```

**(b) What the sources say**
- Linux: Tailscale's installer script header, verbatim: "This script detects the current operating system, and installs Tailscale according to that OS's conventions. … Examples: `curl -fsSL https://tailscale.com/install.sh | sh` / `curl -fsSL https://tailscale.com/install.sh | TAILSCALE_VERSION=1.88.4 sh` / `curl -fsSL https://tailscale.com/install.sh | TRACK=unstable sh`" — [tailscale/tailscale scripts/installer.sh](https://github.com/tailscale/tailscale/blob/main/scripts/installer.sh); docs: "After installation completes, start the Tailscale client using: `sudo tailscale up` … The output will display a URL that you can use to authenticate" (search excerpt) — [Install Tailscale on Linux](https://tailscale.com/docs/install/linux)
- macOS variants (search excerpts of the official page): "Standalone variant (recommended): Download and install directly from Tailscale's package server"; "Tailscale recommends … the Standalone variant … as this variant offers more features, is not subject to limitations imposed on apps distributed through the App Store, and provides more control over the deployment of updates"; "Mac App Store variant: Requires signing in with your Apple Account and cannot detect third-party tools that interfere with VPN tunnels"; "Open source tailscaled: Does not include a graphical user interface (GUI); all functionality must be managed from the command line … Only recommended for unattended installs managed by experienced macOS system administrators" — [Three ways to run Tailscale on macOS](https://tailscale.com/docs/concepts/macos-variants); "The current version of the Tailscale client requires macOS Monterey 12.0 or later" (search excerpt) — [Install Tailscale on macOS](https://tailscale.com/docs/install/mac)
- Homebrew cask rename, verbatim from `cask_renames.json`: `"tailscale": "tailscale-app",` — [Homebrew/homebrew-cask cask_renames.json](https://github.com/Homebrew/homebrew-cask/blob/master/cask_renames.json); `Casks/t/tailscale.rb` returns 404 — old token exists only as a rename.
- Cask `tailscale-app` (fetched verbatim): `version "1.102.4"`; `url "https://pkgs.tailscale.com/stable/Tailscale-#{version}-macos.pkg"`; `depends_on macos: :monterey`; `pkg "Tailscale-#{version}-macos.pkg"`; `uninstall quit: "io.tailscale.ipn.macsys", login_item: "Tailscale", pkgutil: "com.tailscale.ipn.macsys", delete: ["/usr/local/bin/tailscale", "/usr/local/share/man/man8/tssentineld.8"]`; `caveats do kext; license "https://tailscale.com/terms" end` — [Homebrew/homebrew-cask Casks/t/tailscale-app.rb](https://github.com/Homebrew/homebrew-cask/blob/master/Casks/t/tailscale-app.rb) (`ipn.macsys` is Tailscale's bundle-id family for the Standalone build — see `version.IsMacSys*` below)
- Formula `tailscale` (fetched): `desc "Easiest, most secure way to use WireGuard and 2FA"`, v1.102.4; `service do run opt_bin/"tailscaled"; require_root true; keep_alive true; log_path var/"log/tailscaled.log" end`; Linux caveat "tailscaled needs root privileges to configure iptables/nftables and DNS. Start the root service with: `sudo --preserve-env=HOME brew services start tailscale` … To run without root, use userspace-networking mode: `tailscaled --tun=userspace-networking`" — [Homebrew/homebrew-core Formula/t/tailscale.rb](https://github.com/Homebrew/homebrew-core/blob/main/Formula/t/tailscale.rb); "there's also a Tailscale formula (not a cask) that conflicts with the tailscale-app cask, so you should choose between installing either the GUI cask version or the command-line formula version, but not both" (search excerpt) — [formulae.brew.sh/cask/tailscale-app](https://formulae.brew.sh/cask/tailscale-app)
- CLI path (search excerpts of the official CLI page): "On macOS, the Tailscale CLI is located at `/Applications/Tailscale.app/Contents/MacOS/Tailscale`"; "add an alias to your .bashrc, .zshrc … `alias tailscale="/Applications/Tailscale.app/Contents/MacOS/Tailscale"`" — [Tailscale CLI (macOS tab)](https://tailscale.com/docs/reference/tailscale-cli?tab=macos); symlinking the binary "can cause the command to hang without any error" — [tailscale/tailscale issue #3805](https://github.com/tailscale/tailscale/issues/3805)
- Tailscale's own variant detection (source, verbatim comments): "IsSandboxedMacOS … true for the App Store and macsys (only its System Extension) variants on macOS, and false for tailscaled and the macsys GUI process"; "IsMacSys reports whether this process is part of the Standalone variant of Tailscale for macOS"; "IsMacAppStore returns whether this binary is from the App Store version"; "Both macsys and app store versions can run CLI executable with suffix /Contents/MacOS/Tailscale" — [tailscale/tailscale version/prop.go](https://github.com/tailscale/tailscale/blob/main/version/prop.go)
- Windows (search excerpts of official pages): "download the latest .exe installer, which works on both 32- and 64-bit Windows"; "Alternatively, you can use the Tailscale .msi installer … download the latest .msi file from the Tailscale Packages page, choosing the version for your CPU architecture … use the msiexec command"; "requires Windows 10 or later or Windows Server 2016 or later"; "After installation, a new Tailscale icon appears in your system tray" — [Install Tailscale on Windows](https://tailscale.com/docs/install/windows), [Install with MSI](https://tailscale.com/docs/install/windows/msi)
- winget manifest (fetched): `PackageIdentifier: Tailscale.Tailscale`; `Publisher: Tailscale Inc.`; `PackageName: Tailscale`; installers for x86/x64/arm64 all `InstallerType: burn` with `InstallerUrl: https://pkgs.tailscale.com/stable/tailscale-setup-full-1.102.4.exe` — [microsoft/winget-pkgs manifests/t/Tailscale/Tailscale](https://github.com/microsoft/winget-pkgs/tree/master/manifests/t/Tailscale/Tailscale)
- winget `-e` semantics (fetched from the docs source): "**-e, --exact** Uses the exact string in the query, including checking for case-sensitivity. It will not use the default behavior of a substring."; "By default, winget performs a case-insensitive substring match against the package name, ID, and moniker … Use -e, --exact to require an exact match (case-sensitive)."; recommended form "`winget install --id Git.Git -e`" — [winget install reference](https://github.com/microsoft/winget-cli/blob/master/doc/windows/package-manager/winget/install.md)
- Latest stable Tailscale v1.102.4 (Sept 10, 2026) — [tailscale/tailscale releases](https://github.com/tailscale/tailscale/releases)

**(c) Correction needed** — yes (cask token, Windows id case, and the SSH-server comment; see Q7 for the `--ssh` text). Corrected Case A install block:
```bash
# Linux
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up            # prints a login URL; add --ssh only where the Tailscale SSH server runs (see note)
# macOS — GUI app. Tailscale recommends its Standalone build, which is what the cask installs.
brew install --cask tailscale-app     # cask renamed from "tailscale" (old name still resolves). Needs macOS 12+.
# sign in from the menu-bar app. CLI: /Applications/Tailscale.app/Contents/MacOS/Tailscale
#   alias tailscale="/Applications/Tailscale.app/Contents/MacOS/Tailscale"   # alias, do not symlink (hangs)
# macOS as a Tailscale SSH *server* instead (CLI-only, no GUI; cannot coexist with the app):
#   brew install tailscale && sudo --preserve-env=HOME brew services start tailscale && sudo tailscale up --ssh
```
```powershell
# Windows 10+/Server 2016+. winget ids are case-sensitive with -e.
winget install --id Tailscale.Tailscale -e --accept-package-agreements --accept-source-agreements
# unattended alternative: the .msi from https://pkgs.tailscale.com (msiexec /i tailscale-setup-<ver>-<arch>.msi /quiet)
# then sign in from the tray icon, or:  tailscale up
```

**(d) URLs** — inline above.

### Inferences
- The cask's uninstall stanza deletes `/usr/local/bin/tailscale`, so the Standalone `.pkg` evidently installs a CLI there too; Tailscale's docs still document the in-bundle path, so the kit's path is right and `/usr/local/bin/tailscale` is a bonus, not a contract.
- `brew install --cask tailscale` will keep working for now via the rename map (Homebrew prints a rename notice), so the current kit line is not broken today, only stale.

### Gaps
- The exact msiexec argument list and MSI filename pattern are from general knowledge of the MSI page, which was only visible as an excerpt; verify on `https://pkgs.tailscale.com/stable/` before hard-coding.
- Path of `tailscale.exe` on Windows (`C:\Program Files\Tailscale\`) was not verified from a fetched source; the kit's `tailscale up` works because the installer adds it to PATH, per the docs excerpt only implicitly.

---

## Q7. `tailscale up --ssh`: Tailscale SSH server platform support as of 2026 (Linux; macOS only with open-source tailscaled?; Windows unsupported?)

### Takeaway
From Tailscale's own gate (`featureknob.CanRunTailscaleSSH`, current `main`): the SSH *server* runs on Linux (not Synology/QNAP without WIP code), on macOS **only when not sandboxed** (i.e., the open-source `tailscaled`, not the App Store or Standalone app), and on FreeBSD/OpenBSD/Plan 9; any other GOOS — including Windows — returns "The Tailscale SSH server is not supported on <os>". A PR adding a Windows server was opened by bradfitz on 2026-09-16 and is still open. Connecting *from* any platform is fine. Enabling also requires an `ssh` section in the tailnet policy. The kit's "(Linux only)" comment needs widening.

### Cited Findings

**(a) What the kit says** — `/home/user/metaplex/ops/network/checklists/trimurti-join.md` line 19: `sudo tailscale up --ssh              # --ssh lets tailnet members SSH in with tailnet identity (Linux only)`

**(b) What Tailscale's source and docs say**
- `envknob/featureknob/featureknob.go`, verbatim:
```go
// CanRunTailscaleSSH reports whether serving a Tailscale SSH server is
// supported for the current os/distro.
func CanRunTailscaleSSH() error {
	switch runtime.GOOS {
	case "linux":
		if distro.Get() == distro.Synology && !envknob.UseWIPCode() {
			return errors.New("The Tailscale SSH server does not run on Synology.")
		}
		if distro.Get() == distro.QNAP && !envknob.UseWIPCode() {
			return errors.New("The Tailscale SSH server does not run on QNAP.")
		}
		// otherwise okay
	case "darwin":
		// okay only in tailscaled mode for now.
		if version.IsSandboxedMacOS() {
			return errors.New("The Tailscale SSH server does not run in sandboxed Tailscale GUI builds.")
		}
	case "freebsd", "openbsd", "plan9":
	default:
		return errors.New("The Tailscale SSH server is not supported on " + runtime.GOOS)
	}
	if !envknob.CanSSHD() {
		return errors.New("The Tailscale SSH server has been administratively disabled.")
	}
	return nil
}
```
— [tailscale/tailscale envknob/featureknob/featureknob.go](https://github.com/tailscale/tailscale/blob/main/envknob/featureknob/featureknob.go)
- Build constraint of the server package: `//go:build (linux && !android) || (darwin && !ios) || freebsd || openbsd || plan9` / "Package tailssh is an SSH server integrated into Tailscale." — [ssh/tailssh/tailssh.go](https://github.com/tailscale/tailscale/blob/main/ssh/tailssh/tailssh.go); the directory has `_linux`, `_unix`, `_plan9` files and "No files with _windows, _darwin, or _stub suffixes" — [ssh/tailssh](https://github.com/tailscale/tailscale/tree/main/ssh/tailssh)
- CLI flags: `upf.BoolVar(&upArgs.runSSH, "ssh", false, "run an SSH server, permitting access per tailnet admin's declared policy")` — [cmd/tailscale/cli/up.go](https://github.com/tailscale/tailscale/blob/main/cmd/tailscale/cli/up.go); same flag on `tailscale set`: `setf.BoolVar(&setArgs.runSSH, "ssh", false, "run an SSH server, permitting access per tailnet admin's declared policy")` — [cmd/tailscale/cli/set.go](https://github.com/tailscale/tailscale/blob/main/cmd/tailscale/cli/set.go)
- Policy requirement, from `ipn/ipnlocal/local.go`: `checkSSHPrefsLocked` returns `"Unable to enable local Tailscale SSH server; not enabled on Tailnet. See https://tailscale.com/s/ssh"` when the node lacks the SSH capability; and the health warning when no rules exist: `healthmsg.TailscaleSSHOnBut + "access controls don't allow anyone to access this device. Update your tailnet's ACLs at https://tailscale.com/s/ssh-policy"` — [ipn/ipnlocal/local.go](https://github.com/tailscale/tailscale/blob/main/ipn/ipnlocal/local.go)
- Docs (search excerpts): "Tailscale SSH can only be used to connect to Linux devices and macOS open source tailscale + tailscaled CLI version devices, though you can connect from any device running Tailscale, regardless of platform"; "The `tailscale ssh` command is not available on sandboxed macOS builds—use the regular ssh client instead"; "Tailscale SSH is available for all plans"; "In addition to network ACLs, the Tailscale policy file has another top-level section used to configure Tailscale SSH rules" — [Tailscale SSH docs](https://tailscale.com/docs/features/tailscale-ssh), [policy file syntax](https://tailscale.com/docs/reference/syntax/policy-file); background issue "cmd/tailscale: disable 'tailscale ssh' in Mac sandbox" — [tailscale/tailscale #4628](https://github.com/tailscale/tailscale/issues/4628); "To get Tailscale SSH you must use the formula (the Homebrew formula version), which is the open source tailscaled daemon" (search excerpt) — [Tailscaled on macOS wiki](https://github.com/tailscale/tailscale/wiki/Tailscaled-on-macOS)
- Windows server work: PR "ssh/tailssh: support Tailscale SSH on Windows" by bradfitz, opened 2026-09-16, **status Open (not merged)**; description: LocalSystem service logs on target users via S4U, PTY via pseudoconsole relay, SFTP as `tailscaled be-child sftp`, shell selection follows OpenSSH-for-Windows registry then pwsh/PowerShell/cmd, reuses OpenSSH host keys; limitations "Non-LocalSystem tailscaled instances can only execute sessions as themselves" and "Agent forwarding is not supported"; "Updates #4697" — [tailscale/tailscale PR #21312](https://github.com/tailscale/tailscale/pull/21312)

**(c) Correction needed** — yes. Replace the line-19 comment:
```bash
sudo tailscale up --ssh   # Tailscale SSH *server*: Linux (not Synology/QNAP), FreeBSD/OpenBSD, and macOS only with the
                          # open-source tailscaled (brew formula) — not the App Store/Standalone app; not Windows as of
                          # v1.102 (a Windows server PR is open, Sept 2026). Needs an "ssh" section in the tailnet policy
                          # file or nobody can connect. Toggle later with: sudo tailscale set --ssh
```
Also drop `--ssh` from the generic Windows/macOS-app instructions (it errors there).

**(d) URLs** — inline above.

### Inferences
- The Standalone build's *system extension* is sandboxed (`IsSandboxedMacOS()` = App Store ∨ macsys ext), which is why both GUI variants are excluded even though `tailssh` compiles for darwin.

### Gaps
- Whether PR #21312 lands in v1.104/1.106 is unknown at 2026-09-22; re-check before promising Windows SSH.

---

## Q8. MagicDNS naming (`host.tailnet-name.ts.net`), enabling it, disabling key expiry per machine, device approval

### Takeaway
MagicDNS names are `machine-name.tailnet-name.ts.net`, enabled on the admin console's DNS page and **on by default for tailnets created on/after 2022-10-20**; key expiry defaults to 180 days (custom 1–180) and is disabled per machine from Machines → ⋯ → "Disable key expiry" (all plans); device approval is Settings → Device management → "Manually approve new devices", approved from the Machines page ("Needs approval" badge → ⋯ → Approve) by an Owner/Admin/IT admin, and auth keys can be minted pre-approved. The kit's line 30 is correct; add the defaults and the exact menu paths.

### Cited Findings

**(a) What the kit says** — `/home/user/metaplex/ops/network/checklists/trimurti-join.md` line 30: "Then in the Tailscale admin console: approve the machine if approval is on, give it the right tags/ACL group, turn on **MagicDNS** so `ssh new-pc-1` resolves by tailnet name, and disable key expiry for machines that must stay reachable unattended. Put the tailnet name (`new-pc-1.<tailnet>.ts.net`) in the inventory notes."

**(b) What Tailscale's docs say** (search excerpts; pages blocked here)
- MagicDNS: "You can enable MagicDNS in the DNS page of the admin console. Tailnets created on or after October 20, 2022 have MagicDNS enabled by default."; "MagicDNS generates a fully qualified domain name for every device on your Tailscale network … You can find your tailnet DNS name in the DNS page of the admin console."; "MagicDNS automatically uses a device's machine name as part of the DNS entry … devices can access other machines using just their machine names" — [MagicDNS](https://tailscale.com/docs/features/magicdns), [Tailnet names and types](https://tailscale.com/docs/concepts/tailnet-name)
- Key expiry: "By default, new domains are set with an expiry period of 180 days."; "You may want to disable key expiry on some devices, such as trusted servers, subnet routers, or remote IoT devices that are hard to reach. … Open the Machines page of the admin console and find the row corresponding to the device … Select the ⋯ menu at the far right and select the Disable Key Expiry option."; "you can select from 1 to 180 days as the custom authentication period"; "Disabling key expiry is available for all plans." — [Key expiry](https://tailscale.com/docs/features/access-control/key-expiry) ("Last validated Jan 5, 2026" per the page's .md variant)
- Device approval: "open the Machines page of the admin console. At the top of the list you will find the device with a 'Needs approval' badge … select the ⋯ menu and select Approve"; "You must be an Owner, Admin, or IT admin of a tailnet to approve devices"; "A device awaiting approval cannot send or receive traffic on your Tailscale network until it is approved"; "When you generate a new auth key, you can specify that the key should automatically approve devices for which the auth key is used." — [Device approval](https://tailscale.com/docs/features/access-control/device-management/device-approval); setting location "Settings → Device management → Manually approve new devices" — [Tailscale blog: Enable device approval and set key expiry](https://tailscale.com/blog/authentication-settings)

**(c) Correction** — additive. Suggested line 30:
"Then in the admin console: **Machines** → the new row shows *Needs approval* if device approval is on (Settings → Device management → *Manually approve new devices*) → ⋯ → Approve; give it tags/ACL group; **DNS** page → MagicDNS is on by default for tailnets created after 2022-10-20 (turn it on if not) so `ssh new-pc-1` resolves; **Machines** → ⋯ → *Disable key expiry* for machines that must stay reachable unattended (default expiry 180 days, custom 1–180). Record `new-pc-1.<tailnet-name>.ts.net` in the inventory notes."

**(d) URLs** — inline above.

### Inferences
- With MagicDNS on and the tailnet's search domain applied, the short `ssh new-pc-1` works from tailnet members; the kit's `ssh-config-gen.sh` (LAN IPs) and MagicDNS names can coexist by adding a second Host alias.

### Gaps
- The exact label of the admin-console toggle ("Manually approve new devices") comes from the 2023 blog excerpt; the docs page could not be fetched to confirm current wording.

---

## Q9. 2025–2026 changes (Tailscale SSH on Windows/macOS; personal-tailnet plan limits; macOS releases)

### Takeaway
Tailscale "pricing v4" (announced 2026-04-08): the free **Personal** plan now allows **6 users and unlimited user-owned devices** (was 3 users / 100 devices); Personal Plus was retired; Standard is $8/seat/mo, Premium $18; existing customers get ≥12 months to migrate. Tailscale SSH server support is unchanged (Linux/BSD/open-source-macOS) with a Windows server PR open since 2026-09-16. Apple: macOS 26 Tahoe (Sept 2025) added FileVault unlock over SSH and had a 26.1–26.2 FDA-UI bug for `sshd-keygen-wrapper` (fixed 26.3); macOS 27 "Golden Gate" shipped 2026-09-14 with no Remote-Login-specific change found.

### Cited Findings
- "The Personal plan is getting better and staying free, now supporting up to six users—the same limit Personal Plus had."; "places no limit on the number of user-owned devices"; "retired its Personal Plus tier, simplified its lineup to four plans, and shifted business subscriptions from usage-based to seat-based billing — all effective April 8, 2026"; "The former Starter plan is now called Standard and costs $8 per seat per month … Premium stays at USD 18 per seat per month"; "existing customers have at least 12 months before any mandatory migration" (search excerpts) — [Tailscale blog: pricing update (pricing-v4)](https://tailscale.com/blog/pricing-v4), [Tailscale pricing](https://tailscale.com/pricing), [pbxscience summary](https://pbxscience.com/tailscale-overhauls-pricing-free-plan-now-supports-six-users-with-unlimited-devices/), [birdhost summary](https://birdhost.de/en/blog/tailscale-preiserhoehung-2026-alternative), [HN thread](https://news.ycombinator.com/item?id=47691281)
- Previous limit for contrast: "Tailscale Personal is free for up to 3 users and 100 devices" (search excerpt describing the pre-April-2026 plan) — [costbench](https://costbench.com/software/business-vpn/tailscale/free-plan/)
- Tailscale SSH on Windows: open PR #21312 (2026-09-16) — [PR](https://github.com/tailscale/tailscale/pull/21312); community write-up on the state as of Jan 2026 (blocked; title only): [Dave Potts, Tailscale SSH on Windows](https://davepotts.software/infrastructure/2026/01/12/tailscale-ssh-on-windows.html)
- Tailscale releases in 2026: v1.98.5 (Jun 2) … v1.102.1 (Aug 3), 1.102.2 (Aug 4), 1.102.3 (Aug 20), **1.102.4 (Sep 10)** — [releases](https://github.com/tailscale/tailscale/releases)
- macOS 27 "Golden Gate" released 2026-09-14 (search excerpts) — [MacRumors](https://www.macrumors.com/2026/09/10/macos-27-golden-gate-release-date/), [9to5Mac](https://9to5mac.com/2026/09/09/apple-confirms-macos-27-golden-gate-launch-date-september-14/); Apple's enterprise notes: [What's new for enterprise in macOS Golden Gate 27](https://support.apple.com/en-us/148830) (blocked; not read)
- macOS 26 Tahoe: FileVault unlock over SSH (Q2 sources); `sshd-keygen-wrapper` FDA UI bug 26.1→fixed 26.3 b1 — [Apple Developer Forums 806187](https://developer.apple.com/forums/thread/806187)
- Apple OpenSSH package for 2026 releases: OpenSSH-354.x line (Oct 2025 – Jun 2026) — [tags](https://github.com/apple-oss-distributions/OpenSSH/tags)

### Inferences
- For this gallery's tailnet (a handful of people, ~5–10 machines) the free Personal plan is sufficient under both the old (3 users/100 devices) and new (6 users/unlimited) limits; the kit need not mention pricing, but the checklist could note "free Personal plan: up to 6 users".

### Gaps
- Could not read Apple's macOS 27 enterprise notes or any 27-specific Remote Login change; treat Sonoma/Sequoia/Tahoe findings as applying to 27 until verified on a real machine.
- Tailscale's changelog page (tailscale.com/changelog) was unreachable, so month-by-month 2026 feature changes (e.g., Tailscale Services, peer relays) are not covered here.

---

## Summary of corrections for the kit (ranked)

1. **`trimurti-join.md` Windows line** — `winget install --id tailscale.tailscale -e` will not match with `-e` (case-sensitive). Use `--id Tailscale.Tailscale -e`. Source: winget docs + manifest (Q6).
2. **`trimurti-join.md` `--ssh` comment** — "(Linux only)" is wrong on both sides: also FreeBSD/OpenBSD and open-source-tailscaled macOS; never the GUI apps; not Windows (PR open). Requires an `ssh` policy section. (Q7)
3. **`trimurti-join.md` macOS cask** — `brew install --cask tailscale` → `tailscale-app` (renamed; installs the Standalone pkg Tailscale recommends). Add the CLI alias note and the `brew install tailscale` route for a Mac SSH server. (Q6)
4. **`enable-ssh-server.sh` macOS branch** — surface the FDA error instead of `2>/dev/null`; prefer `launchctl enable` + `bootstrap` over deprecated `load -w` (keep as last resort); improve the GUI instructions ((i), "Allow access for", new terminal / tmux). (Q1, Q2)
5. **`update-all.sh`** — `mas upgrade` → `$SUDO mas update` (alias still works; `update` needs root and prompts); add `--agree-to-license` to `softwareupdate -ia`; comment that Apple-silicon OS updates need owner auth and finish at reboot. (Q5)
6. **README troubleshooting #3** — add (i) button, "Allow access for: All users / Only these users", the "Allow full disk access for remote users" checkbox and its 26.1–26.2 UI bug; optionally mention `sudo /usr/libexec/reset-ssh-configuration`. (Q2, Q3)
7. **Keychain** — add `ssh-add --apple-use-keychain` / `UseKeychain yes` + `AddKeysToAgent yes` note for the macOS admin machine (macOS-only options). (Q4)
8. **No change**: `--harden` drop-in logic (Include line, `sshd -t`, `kickstart -k`) matches Apple's shipped configuration exactly. (Q3)
