import { Controller } from './controller.js';
import { LayoutOptIn } from './layout.js';
import { desktopHost, desktopLayoutHost } from './desktop.js';

export function timerDeadline(cx, promise) {
  return new Promise((resolve, reject) => {
    let settled = false;
    cx.timer.after(2000, () => { if (!settled) { settled = true; reject(Error('deadline')); } });
    promise.then(v => { if (!settled) { settled = true; resolve(v); } }, e => { if (!settled) { settled = true; reject(e); } });
  });
}
const reasons = { 'unverified-identity': 'Open unavailable: terminal identity is unverified',
  'not-current-live': 'Open unavailable: terminal is stale or absent',
  'missing-or-ambiguous-route-evidence': 'Open unavailable: current route is unverified',
  'outside-current-filters': 'Outside current filters', 'context-only': 'Context for a child that needs you' };
export function createRosterView(kit, app, options = {}) {
  const { View, div } = kit;
  return class Roster extends View {
    init(_props, cx) {
      this.handle = cx.focus_handle();
      this.controller = new Controller(options.host ?? desktopHost(app));
      this.optIn = new LayoutOptIn(options.layoutHost ?? desktopLayoutHost(app));
      this.controls = []; this.message = ''; this.selection = null; this.reading = false;
      if (!app.checking()) cx.spawn(async cx => {
        for (;;) { if (await app.nextCommand() === 'focus') this.focus(cx); }
      });
    }
    focus(cx) { this.handle.focus(); cx.notify(); }
    async layoutAction(operation, cx) {
      if (app.checking()) return;
      try { await operation(); this.message = 'Agents slot updated'; } catch (e) { this.message = `Layout unchanged or incomplete: ${e.message}`; }
      cx.notify();
    }
    key(event, cx) {
      const chord = event.keystroke;
      if (!['up', 'down', 'enter'].includes(chord)) return;
      cx.stop_propagation();
      const c = this.controller;
      if (chord === 'enter') this.controls.find(i => i.key === c.cursor)?.activate(cx);
      else {
        const index = this.controls.findIndex(i => i.key === c.cursor), step = chord === 'up' ? -1 : 1;
        c.cursor = this.controls[index < 0 ? (step > 0 ? 0 : this.controls.length - 1)
          : (index + step + this.controls.length) % this.controls.length]?.key ?? null;
      }
      cx.notify();
    }
    render(cx) {
      const projection = this.controller.render(), theme = app.theme(), props = app.props();
      const previousControls = this.controls, previousIndex = previousControls.findIndex(c => c.key === this.controller.cursor);
      this.controls = [];
      const parents = new Set(this.controller.feed.reduced.rows.map(r => r.parent?.associationKey).filter(Boolean));
      const v = () => div().flex().flex_col();
      const button = (key, label, activate) => {
        this.controls.push({ key, label, activate });
        return div().id(key).p(5).child(label).accessibility_label(label)
          .bg(this.controller.cursor === key ? theme.raised : theme.surface)
          .on_click((_e, cx) => { this.controller.cursor = key; this.focus(cx); activate(cx); });
      };
      const change = event => cx => { this.controller.change(event); cx.notify(); };
      const body = v().gap(3);
      for (const i of projection.instances) {
        if (i.kind === 'section') {
          const count = i.label === 'Working' ? i.counts?.working : i.label === 'Needs you' ? i.counts?.needsYou : i.counts?.identities ?? i.count;
          body.child(button(i.key, `${i.collapsed ? '▸' : '▾'} ${i.label}${count != null ? ` · ${count}` : ''}`,
            change({ type: 'fold', key: i.key, collapsed: !i.collapsed })));
          continue;
        }
        const row = i.row, waiting = row.roster.state === 'waiting';
        const status = waiting ? i.display.compact ? '◈' : i.display.label : i.display.error ?? i.status;
        const provider = row.providerBadge?.accessibleName;
        const host = row.core.hostLabel ?? (row.core.alias ? `Route ${row.core.alias} (host unverified)` : 'Local route (host unverified)');
        const context = `${host} / ${row.executionContext.label}`;
        const explanation = i.navigation.enabled ? 'Open terminal' : reasons[i.navigation.reason] ?? `Open unavailable: ${i.navigation.reason}`;
        const label = [row.displayLabel, row.project.displayName, waiting ? i.display.detail : status, provider, context,
          i.context.parent ? `Parent ${i.context.parent.displayLabel}` : null, ...i.outsideFilters, explanation].filter(Boolean).join(' · ');
        const element = button(i.key, `${row.displayLabel} · ${status}${provider ? ` · ${provider}` : ''}`,
          () => { this.controller.activate(projection, i.key); });
        this.controls[this.controls.length - 1].label = label;
        if (provider) element.child(div().w(18).h(18).child(provider === 'GitHub' ? 'G' : '◆').accessibility_label(`${provider} provider badge`));
        element.pl(i.depth * 12 + 5).accessibility_label(label).tooltip(waiting ? i.display.detail : label)
          .child(div().text_size(11).child(`${row.project.displayName} · ${context}`));
        // Persistent 18px monogram: no private image path is trusted by this adapter.
        element.child(div().w(18).h(18).child(Array.from(row.project.displayName)[0] ?? '?').accessibility_label(`${row.project.displayName} project icon fallback`));
        if (i.context.parent) element.child(div().text_size(11).child(`Parent ${i.context.parent.displayLabel}`));
        if (!i.navigation.enabled) element.child(div().text_size(11).child(explanation));
        body.child(element);
        if (parents.has(row.associationKey)) {
          body.child(button(`fold:${i.key}`, this.controller.state.folds[i.key] ? 'Show children' : 'Hide children',
            change({ type: 'fold', key: i.key, collapsed: !this.controller.state.folds[i.key] })));
        }
      }
      const rowControls = this.controls; this.controls = [];
      const root = v().id('roster').size_full().p(6).gap(4).bg(theme.surface).text_color(theme.foreground).text_size(13)
        .track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx));
      root.child(button('mode:projects', 'Projects', change({ type: 'view', view: 'projects' })))
        .child(button('mode:status', 'Status', change({ type: 'view', view: 'status' })));
      // Independent machine/context controls include explicit unknown values.
      for (const [field, title, getId] of [['coreIds', 'Machine', r => r.core.id], ['contextIds', 'Context', r => r.executionContext.id]]) {
        root.child(button(`all:${field}`, `${title}: all`, change({ type: 'filters', [field]: null })));
        for (const id of new Set(this.controller.feed.reduced.rows.map(getId))) root.child(button(`filter:${field}:${id}`, `${title}: ${id ?? 'unknown'}`,
          change({ type: 'filters', [field]: [id] })));
      }
      this.controls.push(...rowControls);
      root.child(body.flex_1().overflow_y_scrollbar());
      if (!projection.instances.length) root.child('No observed terminals');
      root.child(button('layout:select', 'Choose an existing Agents slot…', cx => {
        if (app.checking()) return;
        try { this.selection = this.optIn.inspect(); this.message = this.selection.slots.length ? 'Select the Agents slot to replace in a new layout copy' : 'No existing Agents slot'; }
        catch (e) { this.message = e.message; } cx.notify();
      }));
      for (const slot of this.selection?.slots ?? []) root.child(button(`layout:enable:${slot.id}`, `Use Roster in ${slot.id}`, cx => {
        const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        cx.spawn(async cx => this.layoutAction(() => this.optIn.enable(this.selection, slot.id, token, p => timerDeadline(cx, p)), cx));
      }));
      if (props?.rosterToken) root.child(button('layout:undo', 'Restore Agents in this slot', cx => {
        cx.spawn(async cx => this.layoutAction(() => this.optIn.undo(props.rosterToken, p => timerDeadline(cx, p)), cx));
      }));
      root.child(this.message);
      if (this.controller.cursor !== null && !this.controls.some(c => c.key === this.controller.cursor)) {
        this.controller.cursor = this.controls[Math.min(Math.max(previousIndex, 0), this.controls.length - 1)]?.key ?? null;
        cx.notify();
      }
      // Full focus tooltip is also visible with the keyboard; native tooltip is pointer-only.
      const selected = this.controls.find(c => c.key === this.controller.cursor);
      root.accessibility_label(selected?.label ?? 'Roster sidebar: Up and Down select, Enter activates');
      if (selected) root.child(div().id('roster-focus-tooltip').child(selected.label).accessibility_label(selected.label));
      if (!this.reading && this.controller.feed.evidence.admissions?.length) {
        this.reading = true;
        cx.spawn(async cx => { try { if (await this.controller.refresh(p => timerDeadline(cx, p))) cx.notify(); } finally { this.reading = false; } });
      }
      return root;
    }
  };
}
