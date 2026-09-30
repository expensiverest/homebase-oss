# Setup and background service (pre-alpha)

Install from the source checkout with Node 22+: `npm install`, then `npm run setup`. The Node orchestration
script builds, links `@homebase/host` through npm workspaces, and invokes the built setup command. There is no
published Homebase npm package or public release. No install hook changes the machine during `npm install`.

## Setup

The terminal wizard shows version/config/state/platform, validates or creates compact user configuration,
adds canonical project folders through the existing CLI security implementation, detects provider status,
offers private Serve, installs/starts a user service and waits for matching API/protocol/version health,
offers existing pairing, and finishes with diagnostics. No model prompts, automatic OAuth, or Tailscale login
are performed. Temporary detection-owned OpenCode/Grok processes are disposed.

Rerunning setup preserves settings and devices. Only explicit wizard choices change configuration; shell
overrides and provider keys are not serialized. Fixed service ports are required; port 0 prompts for a port
(8787 by default). An occupied port is never cleared by killing another application. Setup keeps valid work
when later steps fail and supports clean cancellation. Stop an existing foreground Host before switching
to the background service.

## Service commands

```text
homebase service status
homebase service install
homebase service start
homebase service stop
homebase service restart
homebase service uninstall
homebase doctor
homebase doctor --json
```

Installation writes a definition and private versioned `<state>/service.json`; OS state is authoritative.
Metadata contains manager/identifier/install time/version, absolute Node/entry/config/state paths, and PATH.
The logical command is:

```text
<absolute-node> <absolute-entry> --config <absolute-config> --service-runtime --state-dir <absolute-state> --service-path <sanitized-PATH>
```

No cwd or interactive `homebase` PATH lookup is required. Only Homebase state and sanitized absolute PATH
directories are persisted as runtime context. No keys, cookies, entire environment, or provider logins are
copied. Providers keep using current-user saved authentication; shell-only credentials may not work at login.
Keep a custom `HOMEBASE_STATE_DIR` set for subsequent CLI management; invoke custom configs with `--config`.

| OS      | Definition                                       | Behavior                                                                                                           |
| ------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Windows | `Homebase Host` Task Scheduler XML               | Current SID, InteractiveToken, LeastPrivilege, logon, ignore duplicate starts, three failure retries at one minute |
| macOS   | `~/Library/LaunchAgents/com.homebase.host.plist` | `gui/<uid>` bootstrap/bootout/kickstart, exact ProgramArguments, RunAtLoad, restart on unsuccessful exit           |
| Linux   | `~/.config/systemd/user/homebase.service`        | `systemctl --user`, default.target, Restart=on-failure, control-group termination                                  |

**Windows launch detail:** Task Scheduler's Hidden setting does not suppress a console window. The action
therefore uses absolute Windows PowerShell with a fixed encoded .NET launcher (`UseShellExecute=false`,
`CreateNoWindow=true`), waiting for the exact Node executable and quoted argv. Paths are base64 data, never
PowerShell expressions; this also avoids Task Scheduler expanding literal `%VARIABLE%` path components.
No `cmd.exe`, Node SCM registration, third-party daemon, or administrator account is used. Native stop snapshots
children of that exact action, stops the task through COM, verifies process creation identity, and terminates
only its captured child trees. Normal stop first uses the protected local-admin shutdown API.

Stop/restart requests local graceful shutdown, waits boundedly for health/task exit, then uses bounded native
fallback. The Host disposes managed provider processes, and the HTTP 202 response finishes before shutdown.
Version mismatch or a missing executable is actionable through doctor/setup/upgrade. Alternate-state commands
refuse to operate on a native service that does not match their installation. Corrupt metadata is reported;
Homebase does not delete or overwrite services based on corrupt metadata.

Homebase rotates its sanitized operational log at `<state>/logs/host.log` (1 MiB plus one 1 MiB backup).
Linux additionally has `journalctl --user -u homebase.service`; macOS uses the same bounded Host log and
`launchctl print gui/<uid>/com.homebase.host`; Windows includes Task Scheduler results/operational events.
Prompt bodies, headers and credentials are not logged by default. Native launchd stdout/stderr go to
`/dev/null`, preventing unbounded native redirection logs. CLI failures before Host logging can be diagnosed
by foreground `homebase` and native service status.

Unsupported user service managers produce a warning and foreground guidance. Linux startup follows the user
session; Homebase never runs `sudo` or enables lingering. For a machine intended to remain running after
logout, consult your administrator about `loginctl enable-linger <user>` rather than assuming session startup
is headless system startup. macOS/Linux native lifecycle tests are opt-in and have not been run on this
Windows developer machine.

## Diagnostics and troubleshooting

Start with `homebase doctor`. It checks Node/entrypoint, config/security/permissions, canonical project roots
and allowlisted discovery, native service/metadata/executable/config/PATH, Host health/version, private Serve,
local admin/device counts, and cached provider status. Doctor never initializes providers, changes config,
starts services, changes Tailscale, pairs devices, or sends prompts. When the Host is down, provider runtime
status is unknown. Diagnostic subprocesses are bounded read-only OS/Tailscale queries.

JSON is `{ "ok": true, "checks": [{ "id": "host.health", "status": "pass", "message": "..." }] }`.
Statuses are pass/warn/fail; exit 1 means at least one fail, and warnings alone exit 0. Keys, cookies, raw
environment, and raw child stderr are excluded. No automatic repairs are made.

If needed, inspect the native manager: Windows Task Scheduler UI / `schtasks /Query /TN "Homebase Host"`,
macOS `launchctl print gui/<uid>/com.homebase.host`, or Linux `systemctl --user status homebase.service`.

## Upgrade and removal

Update the source yourself (`git pull`, `npm install`, `npm run build`), then run `homebase upgrade`. It refreshes
the service's current exact paths/version/PATH when changed, restarts gracefully and verifies health.
If already current, it reports that. It performs no git/npm/network download. `npm run setup` also repairs
or refreshes the installation. A true network updater is deferred to public-release hardening.

`homebase uninstall` stops/removes the service and preserves Homebase state, repositories, provider CLIs/logins,
and Tailscale. `--purge-state` requires explicit confirmation and an ownership marker created by setup;
root/home/repository/project ancestors, shallow paths, symlinks, and unexpected directory contents are refused.
Custom config outside the state directory is preserved. Remove the linked CLI with `npm run unlink:cli`
and remove the source checkout separately. Serve is left unchanged: inspect `tailscale serve status`; only
for an HTTPS root dedicated to Homebase, the current removal command is `tailscale serve --https=443 off`.
Do not reset unrelated Serve handlers.

## Platform sources consulted

- [Tailscale Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve), verified against installed CLI help: `status --json`, `serve --bg http://127.0.0.1:<port>`, and handler-specific `off`.
- [Microsoft schtasks /Create](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/schtasks-create), [task security contexts](https://learn.microsoft.com/en-us/windows/win32/taskschd/security-contexts-for-running-tasks), and [Hidden property](https://learn.microsoft.com/en-us/windows/win32/taskschd/tasksettings-hidden).
- [Microsoft ProcessStartInfo.CreateNoWindow](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.processstartinfo.createnowindow) and [Task Scheduler restart policy](https://learn.microsoft.com/en-us/windows/win32/taskschd/taskschedulerschema-restartonfailure-settingstype-element).
- [Apple LaunchAgent design](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html) and [Apple launchctl training](https://it-training.apple.com/compliance/tutorials/course/sec050/).
- Official systemd manual sources: [service](https://github.com/systemd/systemd/blob/main/man/systemd.service.xml), [execution](https://github.com/systemd/systemd/blob/main/man/systemd.exec.xml), [syntax](https://github.com/systemd/systemd/blob/main/man/systemd.syntax.xml).
