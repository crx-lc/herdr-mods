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
  const { View, div, h_flex, v_flex, ScrollHandle } = kit;
  return class Roster extends View {
    init(_props, cx) {
      this.handle = cx.focus_handle();
      this.rowScroll = ScrollHandle.new();
      this.optionsScroll = ScrollHandle.new();
      this.controller = new Controller(options.host ?? desktopHost(app));
      this.optIn = new LayoutOptIn(options.layoutHost ?? desktopLayoutHost(app));
      this.controls = []; this.message = ''; this.selection = null; this.reading = false; this.toolsOpen = false;
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
        const selected = this.controls.find(i => i.key === c.cursor);
        if (selected?.rowIndex != null) this.rowScroll.scroll_to_item(selected.rowIndex);
        if (selected?.optionIndex != null) this.optionsScroll.scroll_to_item(selected.optionIndex);
      }
      cx.notify();
    }
    render(cx) {
      const projection = this.controller.render(), theme = app.theme(), props = app.props();
      const c = this.controller, previousControls = this.controls, previousIndex = previousControls.findIndex(control => control.key === c.cursor);
      this.controls = [];
      const parents = new Set(c.feed.reduced.rows.map(r => r.parent?.associationKey).filter(Boolean));
      const fg = theme.foreground ?? theme.text;
      const muted = theme.muted ?? fg;
      const v = () => v_flex();
      const h = () => h_flex().items_center();
      const labelText = (value, size, color = fg) => div().min_w(0).truncate().text_size(size).text_color(color).child(value);
      const click = (key, label, activate) => {
        this.controls.push({ key, label, activate });
        return h().id(key).min_w(0).px(6).rounded(4).accessibility_label(label)
          .bg(c.cursor === key ? theme.selected ?? theme.raised : theme.surface)
          .on_click((_e, cx) => { c.cursor = key; this.focus(cx); activate(cx); });
      };
      const button = (key, label, activate, { active = false, text = label } = {}) => {
        const element = click(key, label, activate).h(24).flex_none().tooltip(label);
        if (active && c.cursor !== key) element.bg(theme.raised);
        const content = labelText(text, 12, active ? theme.accent ?? fg : fg);
        if (active) content.font_semibold();
        return element.child(content);
      };
      const change = event => cx => { c.change(event); cx.notify(); };
      const viewMode = c.state.view;
      const root = v().id('roster').size_full().p(5).gap(3).bg(theme.surface).text_color(fg).text_size(12)
        .track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx));
      const toolbar = h().id('roster-toolbar').h(26).flex_none().gap(3);
      toolbar.child(button('mode:projects', 'Projects', change({ type: 'view', view: 'projects' }), { active: viewMode === 'projects' }))
        .child(button('mode:status', 'Status', change({ type: 'view', view: 'status' }), { active: viewMode === 'status' }))
        .child(div().flex_1().min_w(0));
      const settingsOpen = this.toolsOpen;
      const filtered = c.state.coreIds !== null || c.state.contextIds !== null;
      toolbar.child(button('tools:toggle', (settingsOpen ? 'Hide' : 'Show') + ' filters and Agents slot controls' + (filtered ? ' (filters active)' : ''),
        cx => { this.toolsOpen = !this.toolsOpen; cx.notify(); }, { active: settingsOpen || filtered, text: filtered ? 'Options •' : 'Options' }));
      root.child(toolbar);
      if (settingsOpen) {
        const tools = v().id('roster-options').flex_none().max_h(108).gap(2).overflow_y_scrollbar().track_scroll(this.optionsScroll);
        let optionIndex = 0;
        const option = (...args) => {
          tools.child(button(...args));
          this.controls.at(-1).optionIndex = optionIndex++;
        };
        for (const [field, title, getId] of [['coreIds', 'Machine', r => r.core.verified ? r.core.id : null], ['contextIds', 'Context', r => r.executionContext.id]]) {
          const ids = new Set(c.feed.reduced.rows.map(getId));
          const selected = c.state[field];
          // A singleton (including unknown) is equivalent to All unless a filter is already set.
          if (ids.size <= 1 && selected === null) continue;
          option('all:' + field, title + ': all', change({ type: 'filters', [field]: null }), { active: selected === null });
          for (const id of ids) option('filter:' + field + ':' + (id === null ? 'null' : 'value:' + id), title + ': ' + (id ?? 'unknown'),
            change({ type: 'filters', [field]: [id] }), { active: selected?.includes(id) });
        }
        option('layout:select', 'Choose an existing Agents slot…', cx => {
          if (app.checking()) return;
          try { this.selection = this.optIn.inspect(); this.message = this.selection.slots.length ? 'Select the Agents slot to replace in a new layout copy' : 'No existing Agents slot'; }
          catch (e) { this.message = e.message; } cx.notify();
        });
        for (const slot of this.selection?.slots ?? []) option('layout:enable:' + slot.id, 'Use Roster in ' + slot.id, cx => {
          const token = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
          cx.spawn(async cx => this.layoutAction(() => this.optIn.enable(this.selection, slot.id, token, p => timerDeadline(cx, p)), cx));
        });
        if (props?.rosterToken) option('layout:undo', 'Restore Agents in this slot', cx => {
          cx.spawn(async cx => this.layoutAction(() => this.optIn.undo(props.rosterToken, p => timerDeadline(cx, p)), cx));
        });
        root.child(tools);
      }
      const body = v().id('roster-rows').flex_1().min_h(0).gap(3).overflow_y_scrollbar().track_scroll(this.rowScroll);
      for (const [index, i] of projection.instances.entries()) {
        if (i.kind === 'section') {
          const count = i.label === 'Working' ? i.counts?.working : i.label === 'Needs you' ? i.counts?.needsYou : i.counts?.identities ?? i.count;
          const heading = (i.collapsed ? '▸ ' : '▾ ') + i.label + (count != null ? ' · ' + count : '');
          body.child(button(i.key, heading, change({ type: 'fold', key: i.key, collapsed: !i.collapsed })));
          this.controls.at(-1).rowIndex = index;
          continue;
        }
        const row = i.row, waiting = row.roster.state === 'waiting';
        const status = waiting ? i.display.compact ? '◈ Waiting' : i.display.label : i.display.error ?? i.status;
        const provider = row.providerBadge?.accessibleName;
        const host = row.core.hostLabel ?? (row.core.alias ? 'Route ' + row.core.alias + ' (unverified)' : 'Local route (unverified)');
        const context = host + ' / ' + row.executionContext.label;
        const brief = [row.core.hostLabel || row.core.alias || 'Local', row.executionContext.label,
          viewMode === 'status' && row.project.id ? row.project.displayName : null].filter(Boolean).join(' · ');
        const explanation = i.navigation.enabled ? 'Open terminal' : reasons[i.navigation.reason] ?? ('Open unavailable: ' + i.navigation.reason);
        const label = [row.displayLabel, row.project.displayName, waiting ? i.display.detail : status, provider, context,
          i.context.parent ? 'Parent ' + i.context.parent.displayLabel : null, ...i.outsideFilters, explanation].filter(Boolean).join(' · ');
        const element = click(i.key, label, () => { this.controller.activate(projection, i.key); }).flex_1()
          .h(38).gap(6).tooltip(waiting ? i.display.detail : label);
        const selected = this.controls[this.controls.length - 1];
        selected.rowIndex = index;
        selected.detail = [waiting ? i.display.detail : row.displayLabel + ' · ' + status, i.navigation.enabled ? null : explanation].filter(Boolean).join(' · ');
        // Persistent neutral monogram: production has no verified private image source.
        const monogram = h().w(18).h(18).flex_none().justify_center().rounded(4).bg(theme.raised)
          .accessibility_label(row.project.displayName + ' project icon fallback').child(labelText(Array.from(row.project.displayName)[0] ?? '?', 11));
        const copy = v().min_w(0).flex_1().gap(1)
          .child(labelText(row.displayLabel, 13).font_semibold())
          .child(labelText(brief, 10, muted));
        const stateColor = ({ Working: theme.working, 'Needs you': theme.blocked, 'Child needs you': theme.blocked,
          Done: theme.done, Idle: theme.idle })[status] ?? (waiting ? theme.accent : muted) ?? fg;
        const badge = (value, outline) => {
          const chip = h().h(18).max_w(104).min_w(0).flex_none().px(4).rounded(4).bg(theme.raised).child(labelText(value, 10));
          return outline ? chip.border(1).border_color(outline) : chip;
        };
        element.child(monogram).child(copy);
        if (provider === 'GitHub' || provider === 'Azure DevOps') {
          const providerChip = badge(provider === 'GitHub' ? 'GH' : 'ADO').accessibility_label(provider + ' provider badge').tooltip(provider);
          element.child(providerChip);
        }
        // Compact waiting stays textual (no color-only state); full detail remains in hover/focus.
        element.child(badge(status, stateColor));
        const line = h().h(38).flex_none().min_w(0).gap(2).pl(Math.min(i.depth, 3) * 8).child(element);
        if (parents.has(row.associationKey)) {
          const collapsed = c.state.folds[i.key] ?? false;
          line.child(button('fold:' + i.key, collapsed ? 'Show children' : 'Hide children',
            change({ type: 'fold', key: i.key, collapsed: !collapsed }), { text: collapsed ? '▸' : '▾' }).flex_none());
          this.controls.at(-1).rowIndex = index;
        }
        body.child(line);
      }
      if (!projection.instances.length) body.child(labelText('No observed terminals', 12, muted).p(6));
      root.child(body);
      if (this.message) root.child(labelText(this.message, 11, muted).id('roster-message').h(16).flex_none()
        .tooltip(this.message).accessibility_label(this.message));
      if (c.cursor !== null && !this.controls.some(control => control.key === c.cursor)) {
        c.cursor = this.controls[Math.min(Math.max(previousIndex, 0), this.controls.length - 1)]?.key ?? null;
        cx.notify();
      }
      // Focus detail stays one short line; the accessibility label and mouse tooltip retain the full label.
      const selected = this.controls.find(control => control.key === c.cursor);
      root.accessibility_label(selected?.label ?? 'Roster sidebar: Up and Down select, Enter activates');
      if (selected) root.child(labelText(selected.detail ?? selected.label, 11, muted).id('roster-focus-tooltip').h(16).flex_none()
        .tooltip(selected.label).accessibility_label(selected.label));
      if (!this.reading && this.controller.feed.evidence.admissions?.length) {
        this.reading = true;
        cx.spawn(async cx => { try { if (await this.controller.refresh(p => timerDeadline(cx, p))) cx.notify(); } finally { this.reading = false; } });
      }
      return root;
    }
  };
}
