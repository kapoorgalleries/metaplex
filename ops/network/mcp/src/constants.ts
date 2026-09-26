import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// dist/constants.js or src/constants.ts -> ops/network/mcp -> ops/network
const here = path.dirname(fileURLToPath(import.meta.url));
export const OPS_DIR = process.env.TRIMURTI_OPS_DIR ?? path.resolve(here, '..', '..');
export const SCRIPTS_DIR = path.join(OPS_DIR, 'scripts');
export const CHECKLISTS_DIR = path.join(OPS_DIR, 'checklists');
export const OUT_DIR = process.env.OUT_DIR ?? path.join(OPS_DIR, 'out');
export const INVENTORY = process.env.INVENTORY ?? path.join(OPS_DIR, 'inventory.csv');
export const KEY_FILE = process.env.KEY_FILE ?? path.join(os.homedir(), '.ssh', 'id_ed25519_trimurti');

export const IS_WINDOWS = process.platform === 'win32';
export const CHARACTER_LIMIT = 25_000;
export const STREAM_LIMIT = 10_000;

/** Scripts run-remote.sh may push to hosts through this server. */
export const REMOTE_SCRIPTS = ['bootstrap-ai-clis', 'update-all', 'enable-ssh-server', 'disk-triage'] as const;
export const OS_VALUES = ['windows', 'macos', 'linux', 'nas', 'other'] as const;
export const ROLE_VALUES = ['admin', 'workstation', 'nas', 'new', 'router', 'printer', 'iot'] as const;
export const YES_NO = ['yes', 'no'] as const;

export const SSH_BASE_OPTS = [
  '-o',
  'BatchMode=yes',
  '-o',
  'StrictHostKeyChecking=accept-new',
  '-o',
  'IdentitiesOnly=yes',
  '-o',
  'PasswordAuthentication=no',
  '-i',
  KEY_FILE,
];
