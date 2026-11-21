import { tuple } from './normalize.js';
import { rowIdentity, navigationTarget } from './navigation-rows.js';
import { projectRoster, viewState } from './projection.js';
export { rowIdentity, navigationTarget, navigationOrder, moveCursor } from './navigation-rows.js';

// current is an independent caller assertion of state and acquisition generation
// at activation time. No pure function can detect an unseen host change or a lie.
// Rebuild eligibility from current rows; never trust cached instance flags.
export function actionIntent(reduced, projection, key, evidence = {}, current) {
  const disabled = reason => ({ enabled: false, reason, intent: null });
  if (!current?.state || current.generation == null || !projection.binding
    || current.generation !== projection.binding.generation || current.generation !== evidence.generation
    || tuple(viewState(current.state)) !== tuple(projection.binding.state)) return disabled('projection-state-changed');
  const old = projection.instances.find(i => i.key === key && i.kind === 'terminal');
  if (!old) return disabled('not-actionable-instance');
  const rows = reduced.rows.filter(r => rowIdentity(r) === old.identity);
  if (rows.length !== 1) return disabled('identity-changed');
  const fresh = projectRoster(reduced, current.state, { navigation: evidence, scopes: current.scopes ?? [] });
  const instance = fresh.instances.find(i => i.key === key && i.kind === 'terminal' && i.identity === old.identity);
  if (!instance || instance.contextOnly || instance.outsideFilters.length) return disabled('not-actionable-instance');
  const check = navigationTarget(rows[0], reduced.rows, evidence);
  return check.enabled ? { enabled: true, reason: null, intent: { type: 'navigate', ...check.target } }
    : disabled(check.reason);
}
