import { HOST_VERSION } from "../version.js";

export const USAGE = `Homebase Host ${HOST_VERSION}

Usage: homebase [options]
       homebase pair [--url https://machine.tailnet.ts.net]
       homebase devices
       homebase revoke <device-id>
       homebase projects [list]
       homebase projects add [path]
       homebase projects remove <path>

Commands:
  setup                   First-run setup, review, and repair
  service status|install|start|stop|restart|uninstall
                          Manage the current user's background Host
  doctor [--json]         Read-only installation diagnostics
  uninstall [--purge-state]
                          Remove the service; preserve state by default
  upgrade                 Refresh the service after a manual source update
  (no command)            Start the Homebase Host
  pair                    Print a pairing invitation and QR for a new device
  devices                 List paired devices
  revoke <device-id>      Revoke a paired device (short or full id)
  projects                List configured project roots
  projects add [path]     Add a project root (defaults to the current folder)
  projects remove <path>  Remove a project root

Options:
  --no-restart      Skip automatic service restart after project-root changes
  --json            Machine-readable doctor output
  --purge-state     Confirm and remove verified Homebase-owned state
  --config <path>   Path to the Homebase config file
                    (default: <state-dir>/config.json, state dir: ~/.homebase)
  --port <port>     Override host.port
  --bind <address>  Override host.bindAddress (non-loopback binds require auth)
  --url <origin>    Explicit HTTPS origin for pair
  -h, --help        Show this help
  -v, --version     Print the Homebase version

Environment:
  HOMEBASE_CONFIG, HOMEBASE_PORT, HOMEBASE_BIND_ADDRESS, HOMEBASE_LOG_LEVEL,
  HOMEBASE_DEV_TOKEN, HOMEBASE_PROJECT_ROOTS, HOMEBASE_STATE_DIR`;
