/**
 * TRUSTED OPERATOR SCRIPT — grants / revokes the Firebase custom claim `admin: true`
 * that authorises manual mandi ingestion (POST /api/mandi/sync).
 *
 * Run it only from a trusted operator machine that holds Firebase Admin credentials
 * (FIREBASE_SERVICE_ACCOUNT_PATH in backend/.env, or the inline FIREBASE_CLIENT_EMAIL /
 * FIREBASE_PRIVATE_KEY). It is never executed automatically and never imported by the server.
 *
 *   npm run admin:claim -- status --uid=<UID>              read-only: describe one account
 *   npm run admin:claim -- list                            read-only: list current administrators
 *   npm run admin:claim -- grant  --uid=<UID>              DRY RUN: shows the plan, changes nothing
 *   npm run admin:claim -- grant  --uid=<UID> --apply --confirm-project=<FIREBASE_PROJECT_ID>
 *   npm run admin:claim -- revoke --uid=<UID> --apply --confirm-project=<FIREBASE_PROJECT_ID>
 *
 * Safety:
 *   - grant/revoke are dry runs unless BOTH --apply and --confirm-project=<project id> are given,
 *     and the confirmed id must equal the project the credentials belong to;
 *   - grant only works for an existing, enabled account with a verified email;
 *   - other custom claims are preserved; revoke also revokes the refresh tokens;
 *   - the target project (and whether it is the local Auth Emulator) is printed first;
 *   - nothing secret is printed: e-mail addresses are masked, no tokens or keys are shown.
 *
 * After a grant the person must sign in again (or refresh their ID token) before the claim
 * shows up in their token. The server additionally confirms the claim live on every request,
 * so a revoke takes effect immediately.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from '../src/config/index.js';
import { applyChange, findAdmins, inspectAccount, planChange } from '../src/admin/adminClaim.js';
import { getFirebaseAdminAuth } from '../src/config/firebaseAdmin.js';
import { parseArgs } from './cli-utils.js';

const USAGE = `Usage: npm run admin:claim -- <status|list|grant|revoke> [--uid=<UID>] [--apply --confirm-project=<project id>]`;

function targetLabel(projectId, emulator) {
  return emulator ? `Firebase Auth EMULATOR (${emulator}), project "${projectId}"` : `Firebase project "${projectId}" (LIVE)`;
}

/**
 * @param {string[]} argv
 * @param {{ getAuth?: Function, projectId?: string, emulatorHost?: string, out?: Function, err?: Function }} deps
 * @returns {Promise<number>} process exit code
 */
export async function run(argv, deps = {}) {
  const {
    getAuth = getFirebaseAdminAuth,
    projectId: injectedProjectId,
    emulatorHost = config.firebase.authEmulatorHost,
    out = console.log,
    err = console.error,
  } = deps;

  let args;
  try {
    args = parseArgs(argv, { allowPositional: true });
  } catch (e) {
    err(`[admin:claim] ${e.message}\n${USAGE}`);
    return 2;
  }
  const [command] = args._;
  if (!['status', 'list', 'grant', 'revoke'].includes(command)) {
    err(`[admin:claim] unknown or missing command.\n${USAGE}`);
    return 2;
  }

  let auth;
  try {
    auth = getAuth();
  } catch (e) {
    err(`[admin:claim] cannot use Firebase Admin: ${e.code === 'auth/admin-credentials-missing'
      ? 'no service account configured (set FIREBASE_SERVICE_ACCOUNT_PATH in backend/.env)'
      : e.message}`);
    return 1;
  }

  // The project id comes from backend/.env, or from the service account when .env does not set it.
  const projectId = injectedProjectId ?? config.firebase.projectId ?? auth.app?.options?.projectId;
  out(`[admin:claim] target: ${targetLabel(projectId, emulatorHost)}`);
  try {
    if (command === 'list') {
      const result = await findAdmins(auth);
      out(JSON.stringify(result, null, 2));
      if (!result.complete) out('[admin:claim] WARNING: scan stopped before all accounts were read.');
      return 0;
    }

    if (!args.uid || args.uid === true) {
      err(`[admin:claim] --uid is required.\n${USAGE}`);
      return 2;
    }
    if (command === 'status') {
      out(JSON.stringify(await inspectAccount(auth, args.uid), null, 2));
      return 0;
    }

    const apply = args.apply === true;
    if (!apply) {
      const plan = await planChange(auth, args.uid, command);
      out(JSON.stringify({ mode: 'DRY RUN (nothing changed)', ...plan, nextClaims: undefined }, null, 2));
      out(plan.problems.length
        ? `[admin:claim] ${command} would be REFUSED: ${plan.problems.join('; ')}`
        : `[admin:claim] To apply: add  --apply --confirm-project=${projectId}`);
      return plan.problems.length ? 1 : 0;
    }
    if (!projectId || args['confirm-project'] !== projectId) {
      err(`[admin:claim] refused: --confirm-project must equal the target project id ("${projectId}").`);
      return 1;
    }
    const result = await applyChange(auth, args.uid, command);
    out(JSON.stringify({ mode: 'APPLIED', ...result, nextClaims: undefined }, null, 2));
    out(result.applied
      ? (command === 'grant'
        ? '[admin:claim] Granted. The person must sign in again (or refresh their ID token) for the claim to appear in their token.'
        : '[admin:claim] Revoked. Refresh tokens were revoked; the server stops accepting this account immediately.')
      : `[admin:claim] No change needed: ${result.note}.`);
    return 0;
  } catch (e) {
    err(`[admin:claim] ${e.code || 'ERROR'}: ${e.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
