import { Feed, capture, emptyEvidence } from './feed.js';
import { projectRoster, transition, viewState } from './projection.js';
import { actionIntent } from './navigation.js';
import { LocalReader } from './local-reader.js';
export class Controller {
  constructor(host, { collapseUnassigned = true, initialView = 'projects' } = {}) { this.host = host; this.collapseUnassigned = collapseUnassigned; this.feed = new Feed(); this.state = viewState({ view: initialView }); this.cursor = null; this.reader = new LocalReader(host);
    // Only a host that declares it (the stock desktop adapter) navigates natively.
    this.nativeNavigation = host.nativeNavigation === true; }
  observe(refresh = false) {
    const snapshot = capture(this.host);
    const evidence = this.host.evidence ? (snapshot, generation) => this.host.evidence(snapshot, generation) : emptyEvidence();
    this.feed.update(snapshot, this.host.now(), evidence, { refresh, nativeNavigation: this.nativeNavigation });
    return this.feed;
  }
  project() {
    return projectRoster(this.feed.reduced, this.state, { navigation: this.feed.navigation, scopes: this.feed.evidence.scopes ?? [],
      repositories: this.feed.evidence.repositories ?? [], spaces: this.feed.spaces ?? {}, collapseUnassigned: this.collapseUnassigned });
  }
  render() {
    this.observe();
    this.projection = this.project();
    return this.projection;
  }
  // "Open {role}" on an alert: re-read now, and go only if the same verified recipient is
  // still the alert's recipient and its exact target is unchanged since it was drawn.
  openRecipient(projection, key) {
    const old = projection.instances.find(i => i.key === key && i.kind === 'terminal')?.alert?.recipient;
    if (!old) return { enabled: false, reason: 'not-actionable-instance' };
    this.observe();
    const now = this.project().instances.find(i => i.key === key && i.kind === 'terminal')?.alert?.recipient;
    if (!now || now.identity !== old.identity) return { enabled: false, reason: 'target-changed' };
    if (!now.navigation.enabled) return { enabled: false, reason: now.navigation.reason };
    if (!old.navigation.enabled || JSON.stringify(now.navigation.target) !== JSON.stringify(old.navigation.target)) return { enabled: false, reason: 'target-changed' };
    this.go(now.navigation.target);
    return { enabled: true, reason: null, target: now.navigation.target };
  }
  // Native targets: the exact pane id to focus, or the exact address to peek; verified
  // routes keep the terminal form for both.
  go(target) {
    this.host.run(target.action === 'focus' ? 'pane.focus' : 'terminal.peek',
      target.scope === 'native' && target.action === 'focus' ? { pane: target.pane } : { terminal: target.address });
  }
  change(event) { this.state = transition(this.state, event); }
  activate(projection, key) {
    this.observe();
    const plan = actionIntent(this.feed.reduced, projection, key, this.feed.navigation,
      { state: this.state, generation: this.feed.generation, scopes: this.feed.evidence.scopes ?? [],
        repositories: this.feed.evidence.repositories ?? [], spaces: this.feed.spaces ?? {} });
    if (plan.enabled) this.go(plan.intent);
    return plan;
  }
  async refresh(deadline) {
    const throttled = this.host.now() - this.reader.last < 10000;
    // A fresh acquisition invalidates old documents/routes before any await.
    this.observe(!throttled);
    if (throttled) return false;
    const admitted = await this.reader.refresh(this.feed, this.host.now(), deadline);
    if (admitted) {
      // Same capture and proof, no additional getters; assess fresh text immediately.
      this.feed.update(this.feed.snapshot, this.host.now(), this.feed.evidence, { nativeNavigation: this.nativeNavigation });
    }
    return admitted;
  }
}
