import { Feed, capture, emptyEvidence } from './feed.js';
import { projectRoster, transition, viewState } from './projection.js';
import { actionIntent } from './navigation.js';
import { LocalReader } from './local-reader.js';
export class Controller {
  constructor(host) { this.host = host; this.feed = new Feed(); this.state = viewState(); this.cursor = null; this.reader = new LocalReader(host); }
  observe() {
    const snapshot = capture(this.host);
    const evidence = this.host.evidence ? this.host.evidence(snapshot, this.feed.generation) : emptyEvidence();
    this.feed.update(snapshot, this.host.now(), evidence);
    return this.feed;
  }
  render() {
    this.observe();
    this.projection = projectRoster(this.feed.reduced, this.state, { navigation: this.feed.navigation, scopes: this.feed.evidence.scopes ?? [] });
    return this.projection;
  }
  change(event) { this.state = transition(this.state, event); this.cursor = null; }
  activate(projection, key) {
    this.observe();
    const plan = actionIntent(this.feed.reduced, projection, key, this.feed.navigation,
      { state: this.state, generation: this.feed.generation, scopes: this.feed.evidence.scopes ?? [] });
    if (plan.enabled) this.host.run(plan.intent.action === 'focus' ? 'pane.focus' : 'terminal.peek', { terminal: plan.intent.address });
    return plan;
  }
  async refresh(deadline) {
    const admitted = await this.reader.refresh(this.feed, this.host.now(), deadline);
    if (admitted) {
      // Same capture and proof, no additional getters; assess fresh text immediately.
      this.feed.update(this.feed.snapshot, this.host.now(), this.feed.evidence);
    }
    return admitted;
  }
}
