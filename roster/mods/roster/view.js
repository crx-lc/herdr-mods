import { Controller } from './controller.js';
import { LayoutOptIn } from './layout.js';
import { desktopHost, desktopLayoutHost } from './desktop.js';
import { actionReason, rowContext, detailFields, detailPages, detailLabel } from './detail.js';

export function timerDeadline(cx, promise) {
  return new Promise((resolve, reject) => {
    let settled = false;
    cx.timer.after(2000, () => { if (!settled) { settled = true; reject(Error('deadline')); } });
    promise.then(v => { if (!settled) { settled = true; resolve(v); } }, e => { if (!settled) { settled = true; reject(e); } });
  });
}
export function createRosterView(kit, app, options = {}) {
  const { View, div, h_flex, v_flex, ScrollHandle } = kit;
  return class Roster extends View {
    init(_props, cx) {
      this.handle = cx.focus_handle();
      this.rowScroll = ScrollHandle.new();
      this.optionsScroll = ScrollHandle.new();
      this.controller = new Controller(options.host ?? desktopHost(app));
      this.optIn = new LayoutOptIn(options.layoutHost ?? desktopLayoutHost(app));
      this.reader = null; this.readerControls = []; this.returnControl = null;
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
    reveal(control) {
      if (control?.rowIndex != null) this.rowScroll.scroll_to_item(control.rowIndex);
      if (control?.optionIndex != null) this.optionsScroll.scroll_to_item(control.optionIndex);
    }
    openDetails(control, cx) {
      if (!control?.instance) return;
      const fields = detailFields(control.instance);
      this.reader = { sourceKey: control.instance.key, returnKey: control.key, fields,
        pages: detailPages(fields), page: 0, state: JSON.stringify(this.controller.state), toolsOpen: this.toolsOpen };
      this.readerCursor = 'details:next';
      // Discard normal callbacks immediately, before the next render/key event.
      this.controls = []; this.readerControls = [];
      cx.notify();
    }
    closeDetails(cx) {
      if (!this.reader) return;
      this.returnControl = { key: this.reader.returnKey, sourceKey: this.reader.sourceKey };
      this.reader = null; this.readerControls = []; this.controls = [];
      cx.notify();
    }
    pageDetails(direction, cx) {
      const reader = this.reader;
      if (!reader) return;
      reader.page = direction === 'first' ? 0 : direction === 'last' ? reader.pages.length - 1
        : Math.max(0, Math.min(reader.pages.length - 1, reader.page + direction));
      cx.notify();
    }
    key(event, cx) {
      const chord = event.keystroke;
      if (this.reader) {
        if (chord === 'escape') this.closeDetails(cx);
        else if (['left', 'up', 'right', 'down', 'home', 'end'].includes(chord))
          this.pageDetails(chord === 'home' ? 'first' : chord === 'end' ? 'last' : ['left', 'up'].includes(chord) ? -1 : 1, cx);
        else if (chord === 'enter') this.readerControls.find(i => i.key === this.readerCursor)?.activate(cx);
        else return;
        cx.stop_propagation();
        return;
      }
      if (chord === 'd') {
        const selected = this.controls.find(i => i.key === this.controller.cursor);
        if (!selected?.instance) return;
        cx.stop_propagation(); this.openDetails(selected, cx); return;
      }
      if (!['up', 'down', 'enter'].includes(chord)) return;
      cx.stop_propagation();
      const c = this.controller;
      if (chord === 'enter') this.controls.find(i => i.key === c.cursor)?.activate(cx);
      else {
        const index = this.controls.findIndex(i => i.key === c.cursor), step = chord === 'up' ? -1 : 1;
        c.cursor = this.controls[index < 0 ? (step > 0 ? 0 : this.controls.length - 1)
          : (index + step + this.controls.length) % this.controls.length]?.key ?? null;
        this.reveal(this.controls.find(i => i.key === c.cursor));
      }
      cx.notify();
    }
    renderDetails(root, theme, cx) {
      const { div, h_flex, v_flex } = kit, reader = this.reader, page = reader.pages[reader.page];
      const fg = theme.foreground ?? theme.text;
      this.controls = []; this.readerControls = [];
      const button = (key, text, activate, disabled = false) => {
        this.readerControls.push({ key, activate: disabled ? () => {} : activate });
        return h_flex().id(key).h(24).flex_none().px(6).items_center().rounded(4)
          .bg(this.readerCursor === key ? theme.selected ?? theme.raised : theme.surface)
          .accessibility_label(text + (disabled ? ' (end reached)' : '')).on_click((_e, cx) => {
            this.readerCursor = key; this.focus(cx); if (!disabled) activate(cx);
          }).child(div().text_size(12).text_color(disabled ? theme.muted ?? fg : fg).child(text));
      };
      const readerView = v_flex().id('roster-details').flex_1().min_h(0).gap(4);
      readerView.child(h_flex().h(24).flex_none().gap(4)
        .child(button('details:back', 'Back (Esc)', cx => this.closeDetails(cx)))
        .child(div().text_size(12).child('Details at opening')));
      readerView.child(div().h(18).flex_none().text_size(12).child(page.label));
      readerView.child(div().h(18).flex_none().text_size(11)
        .child('Page ' + (reader.page + 1) + '/' + reader.pages.length + ' · field ' + page.fieldPage + '/' + page.fieldPages));
      // Fresh literal text, definite width from both sides of the stretch container.
      // No truncated helper or clipping ancestor: only the active bounded page exists.
      readerView.child(div().id('roster-detail-value').w_full().flex_none().whitespace_normal()
        .text_size(12).line_height(1.25).text_color(fg).child(page.text));
      readerView.child(h_flex().h(24).flex_none().gap(4)
        .child(button('details:previous', 'Previous', cx => this.pageDetails(-1, cx), reader.page === 0))
        .child(button('details:next', 'Next', cx => this.pageDetails(1, cx), reader.page === reader.pages.length - 1)));
      return root.child(readerView);
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
      const click = (key, label, activate, column = false) => {
        this.controls.push({ key, label, activate });
        return (column ? v() : h()).id(key).min_w(0).px(6).rounded(4).accessibility_label(label)
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
      const change = event => cx => { this.closeDetails(cx); c.change(event); cx.notify(); };
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
        cx => { this.closeDetails(cx); this.toolsOpen = !this.toolsOpen; cx.notify(); }, { active: settingsOpen || filtered, text: filtered ? 'Options •' : 'Options' }));
      root.child(toolbar);
      if (this.reader && (this.reader.state !== JSON.stringify(c.state) || this.reader.toolsOpen !== this.toolsOpen)) this.closeDetails(cx);
      if (!this.reading && this.controller.feed.evidence.admissions?.length) {
        this.reading = true;
        cx.spawn(async cx => { try { if (await this.controller.refresh(p => timerDeadline(cx, p))) cx.notify(); } finally { this.reading = false; } });
      }
      if (this.reader) return this.renderDetails(root, theme, cx);
      if (settingsOpen) {
        const tools = v().id('roster-options').min_h(0).flex_none().gap(2).overflow_y_scrollbar().track_scroll(this.optionsScroll);
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
        tools.h(Math.min(52, optionIndex * 24 + Math.max(0, optionIndex - 1) * 2));
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
        const context = rowContext(i), label = detailLabel(i), explanation = actionReason(i);
        const element = click(i.key, label, () => { if (!this.reader) this.controller.activate(projection, i.key); }, true)
          .flex_1().min_w(0).h(64).py(2).tooltip(label);
        const selected = this.controls.at(-1);
        Object.assign(selected, { rowIndex: index, instance: i, detail: label,
          disabledReason: i.navigation.enabled ? null : explanation });
        // Persistent neutral monogram: production has no verified private image source.
        const monogram = h().w(18).h(18).flex_none().justify_center().rounded(4).bg(theme.raised)
          .accessibility_label(context.project + ' project icon fallback').child(labelText(Array.from(context.project)[0] ?? '?', 11));
        const title = h().h(18).flex_none().gap(4).min_w(0).child(monogram)
          .child(labelText(row.displayLabel, 13).font_semibold().flex_1());
        const stateColor = ({ Working: theme.working, 'Needs you': theme.blocked, 'Child needs you': theme.blocked,
          Done: theme.done, Idle: theme.idle })[status] ?? (waiting ? theme.accent : muted) ?? fg;
        const badge = (value, outline) => {
          const chip = h().h(18).max_w(104).min_w(0).flex_none().px(4).rounded(4).bg(theme.raised).child(labelText(value, 10));
          return outline ? chip.border(1).border_color(outline) : chip;
        };
        if (provider === 'GitHub' || provider === 'Azure DevOps') {
          const providerChip = badge(provider === 'GitHub' ? 'GH' : 'ADO').accessibility_label(provider + ' provider badge').tooltip(provider);
          title.child(providerChip);
        }
        // Project, parent and machine/context span beneath the badges independently.
        title.child(badge(status, stateColor));
        element.child(title)
          .child(labelText('Project: ' + context.project, 10, muted).h(14).flex_none())
          .child(labelText('Parent: ' + context.parent, 10, muted).h(14).flex_none())
          .child(labelText(context.machine + ' / ' + context.context, 10, muted).h(14).flex_none());
        const line = h().h(64).flex_none().min_w(0).gap(2).pl(Math.min(i.depth, 3) * 8).child(element);
        const info = button('info:' + i.key, 'Details for ' + row.displayLabel,
          cx => this.openDetails({ key: 'info:' + i.key, instance: i }, cx), { text: 'Info' }).px(0).w(30);
        Object.assign(this.controls.at(-1), { rowIndex: index, instance: i, detail: label, disabledReason: selected.disabledReason });
        const siblings = v().w(30).flex_none().gap(2).child(info);
        if (parents.has(row.associationKey)) {
          const collapsed = c.state.folds[i.key] ?? false;
          siblings.child(button('fold:' + i.key, collapsed ? 'Show children' : 'Hide children',
            change({ type: 'fold', key: i.key, collapsed: !collapsed }), { text: collapsed ? '▸' : '▾' }).flex_none());
          Object.assign(this.controls.at(-1), { rowIndex: index, instance: i, detail: label, disabledReason: selected.disabledReason });
        }
        line.child(siblings);
        body.child(line);
      }
      if (!projection.instances.length) body.child(labelText('No observed terminals', 12, muted).p(6));
      root.child(body);
      if (this.message) root.child(labelText(this.message, 11, muted).id('roster-message').h(16).flex_none()
        .tooltip(this.message).accessibility_label(this.message));
      const footerOwner = this.controls.find(control => control.key === c.cursor)
        ?? (c.cursor === 'details:open' ? this.controls.find(control => control.key === this.footerSourceKey) : null);
      if (footerOwner?.instance) {
        this.footerSourceKey = footerOwner.instance.key;
        this.controls.push({ ...footerOwner, key: 'details:open',
          activate: cx => this.openDetails({ key: 'details:open', instance: footerOwner.instance }, cx) });
      }
      if (this.returnControl) {
        const origin = this.returnControl;
        const surviving = this.controls.find(control => control.key === origin.key && control.instance?.key === origin.sourceKey)
          ?? this.controls.find(control => control.key === origin.sourceKey);
        c.cursor = surviving?.key ?? 'mode:projects';
        this.reveal(surviving); this.returnControl = null;
      }
      if (c.cursor !== null && !this.controls.some(control => control.key === c.cursor)) {
        c.cursor = this.controls[Math.min(Math.max(previousIndex, 0), this.controls.length - 1)]?.key ?? null;
        cx.notify();
      }
      // Keep the disabled reason independent of long waiting/context text for keyboard selection.
      const selected = this.controls.find(control => control.key === c.cursor);
      root.accessibility_label(selected?.label ?? 'Roster sidebar: Up and Down select, Enter activates');
      if (selected) {
        const footer = v().id('roster-focus-tooltip').h(selected.disabledReason ? 32 : 16).flex_none().min_w(0)
          .tooltip(selected.label).accessibility_label(selected.label);
        if (selected.disabledReason) footer.child(labelText(selected.disabledReason, 11, muted)
          .id('roster-disabled-reason').h(16).flex_none());
        const summary = h().h(16).flex_none().min_w(0)
          .child(labelText(selected.detail ?? selected.label, 11, muted).flex_1());
        if (selected.instance) summary.child(h().id('details:open').h(16).flex_none().px(3)
          .bg(c.cursor === 'details:open' ? theme.selected ?? theme.raised : theme.surface)
          .accessibility_label('Details (D)').on_click((_e, cx) => {
            c.cursor = 'details:open'; this.focus(cx); this.controls.find(control => control.key === 'details:open')?.activate(cx);
          })
          .child(labelText('Details (D)', 11)));
        footer.child(summary);
        root.child(footer);
      }
      return root;
    }
  };
}
