import { tuple } from './normalize.js';
import { rowIdentity, navigationTarget } from './navigation-rows.js';
import { projectRoster, viewState, VIEWS } from './projection.js';
export { rowIdentity, navigationTarget, navigationOrder, moveCursor } from './navigation-rows.js';

// Action state is JSON-shaped caller evidence, not a UI-default request.
const plain = value => value !== null && typeof value === 'object'
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const scalarId = value => value === null || (typeof value === 'string' && value.length > 0
  && value.length <= 1024 && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value));
const dataEntries = value => {
  if (!plain(value)) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !Object.hasOwn(descriptors[key], 'value'))) return null;
  return Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]);
};
function validActionState(state) {
  try {
    const entries = dataEntries(state);
    if (!entries) return false;
    return entries.every(([key, value]) => {
      if (key === 'view') return VIEWS.includes(value);
      if (key === 'coreIds' || key === 'contextIds') {
        if (value === null) return true;
        if (!Array.isArray(value)) return false;
        const descriptors = Object.getOwnPropertyDescriptors(value);
        return Reflect.ownKeys(descriptors).length === value.length + 1
          && Array.from({ length: value.length }, (_, i) => descriptors[i]
            && Object.hasOwn(descriptors[i], 'value') && scalarId(descriptors[i].value)).every(Boolean);
      }
      if (key === 'folds') return dataEntries(value)?.every(([, collapsed]) => typeof collapsed === 'boolean') === true;
      return false;
    });
  } catch {
    return false;
  }
}

// current is an independent caller assertion of state and acquisition generation
// at activation time. No pure function can detect an unseen host change or a lie.
// Rebuild eligibility from current rows; never trust cached instance flags.
export function actionIntent(reduced, projection, key, evidence = {}, current) {
  const disabled = reason => ({ enabled: false, reason, intent: null });
  if (!validActionState(current?.state) || current.generation == null || !projection.binding
    || current.generation !== projection.binding.generation || current.generation !== evidence.generation
    || tuple(viewState(current.state)) !== tuple(projection.binding.state)) return disabled('projection-state-changed');
  const old = projection.instances.find(i => i.key === key && i.kind === 'terminal');
  if (!old) return disabled('not-actionable-instance');
  const rows = reduced.rows.filter(r => rowIdentity(r) === old.identity);
  if (rows.length !== 1) return disabled('identity-changed');
  const fresh = projectRoster(reduced, current.state, { navigation: evidence, scopes: current.scopes ?? [], repositories: current.repositories ?? [], spaces: current.spaces ?? {}, catalog: current.catalog ?? null });
  const instance = fresh.instances.find(i => i.key === key && i.kind === 'terminal' && i.identity === old.identity);
  if (!instance || instance.contextOnly || instance.outsideFilters.length) return disabled('not-actionable-instance');
  const check = navigationTarget(rows[0], reduced.rows, evidence);
  if (!check.enabled) return disabled(check.reason);
  // The exact target drawn must still be the exact target now.
  if (!old.navigation?.enabled || tuple(old.navigation.target) !== tuple(check.target)) return disabled('target-changed');
  return { enabled: true, reason: null, intent: { type: 'navigate', ...check.target } };
}
