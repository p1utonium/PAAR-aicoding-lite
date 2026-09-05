(function (global) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg', W = 218, H = 82, DX = 286, DY = 108;
  var statusClass = { completed: 'is-completed', closed: 'is-closed', review_failed: 'is-review-failed', developing: 'is-active' };
  function svg(name, attrs) { var n = document.createElementNS(NS, name); Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); }); return n; }
  function elideTextNode(node, value, maxWidth) { var text = String(value || ''), low = 0, high = text.length, mid; node.textContent = text; if (!node.getComputedTextLength || node.getComputedTextLength() <= maxWidth) return; while (low < high) { mid = Math.ceil((low + high) / 2); node.textContent = text.slice(0, mid) + '…'; if (node.getComputedTextLength() <= maxWidth) low = mid; else high = mid - 1; } node.textContent = text.slice(0, low) + '…'; }
  function result(ok, code, message) { return { ok: ok, code: code, message: message || null }; }
  function byId(tasks) { var map = Object.create(null); tasks.forEach(function (t) { if (!t || typeof t.task_id !== 'string' || !t.task_id || map[t.task_id]) throw Error('Each task must have a unique task_id.'); map[t.task_id] = t; }); return map; }
  function model(snapshot) {
    if (!snapshot || snapshot.snapshot_schema_version !== 1 || !Array.isArray(snapshot.tasks) || !Array.isArray(snapshot.relations)) return result(false, 'invalid_snapshot', 'Snapshot must provide V1 tasks and relations arrays.');
    var all = byId(snapshot.tasks), confirmed = snapshot.tasks.filter(function (t) { return t.membership === 'confirmed' && t.relation_confirmed !== false; });
    var pending = snapshot.tasks.filter(function (t) { return !confirmed.includes(t); });
    confirmed.sort(order); pending.sort(order);
    var deps = snapshot.relations.filter(function (r) { return r && r.kind === 'depends_on' && all[r.source_task_id] && all[r.target_task_id]; });
    var visible = Object.create(null); confirmed.forEach(function (t) { visible[t.task_id] = t; });
    var graphDeps = deps.filter(function (r) { return visible[r.source_task_id] && visible[r.target_task_id]; });
    var extras = snapshot.relations.filter(function (r) { return r && (r.kind === 'confirmed_independent' || r.kind === 'confirmed_parallel' || r.kind === 'replaces') && visible[r.source_task_id] && visible[r.target_task_id]; });
    var insertion = snapshot.latest_insertion_diff && Array.isArray(snapshot.latest_insertion_diff.affected_task_ids) ? snapshot.latest_insertion_diff.affected_task_ids : [], searchTextById = Object.create(null);
    confirmed.forEach(function (t) { searchTextById[t.task_id] = [t.task_id, t.title, t.summary, t.business_status, t.operational_status, t.milestone, t.lane, t.next_action, t.blocker].filter(function (value) { return value !== null && value !== undefined; }).join(' ').toLowerCase(); });
    return { ok: true, all: all, tasks: confirmed, pending: pending, deps: graphDeps, extras: extras, insertion: insertion, searchTextById: searchTextById };
  }
  function order(a, b) { return String(a.lane || a.milestone || '').localeCompare(String(b.lane || b.milestone || '')) || (a.display_order || 0) - (b.display_order || 0) || a.task_id.localeCompare(b.task_id); }
  function positions(m) {
    var incoming = Object.create(null), rank = Object.create(null), lanes = Object.create(null), laneTops = Object.create(null), pos = Object.create(null), cycle = false, nextLaneTop = 72;
    m.tasks.forEach(function (t) { incoming[t.task_id] = []; rank[t.task_id] = 0; });
    m.deps.forEach(function (r) { incoming[r.target_task_id].push(r.source_task_id); });
    for (var step = 0; step < m.tasks.length; step++) { var changed = false; m.tasks.forEach(function (t) { incoming[t.task_id].forEach(function (source) { if (rank[t.task_id] < rank[source] + 1) { rank[t.task_id] = rank[source] + 1; changed = true; } }); }); if (!changed) break; if (step === m.tasks.length - 1) cycle = true; }
    if (cycle) return { positions: pos, lanes: lanes, cycle: true };
    // Use the existing deterministic dependency ranks; no external layout engine.
    m.tasks.forEach(function (t) { var lane = String(t.lane || t.milestone || '未分组'); (lanes[lane] || (lanes[lane] = [])).push(t); });
    Object.keys(lanes).sort().forEach(function (lane) {
      var rows = Object.create(null), maxRows = 1;
      lanes[lane].forEach(function (t) { (rows[rank[t.task_id]] || (rows[rank[t.task_id]] = [])).push(t); });
      Object.keys(rows).forEach(function (r) {
        rows[r].sort(order);
        maxRows = Math.max(maxRows, rows[r].length);
        rows[r].forEach(function (t, index) { pos[t.task_id] = { x: 90 + rank[t.task_id] * DX, y: nextLaneTop + index * DY, lane: lane, rank: rank[t.task_id] }; });
      });
      laneTops[lane] = nextLaneTop;
      nextLaneTop += Math.max(270, maxRows * DY + 54);
    });
    return { positions: pos, lanes: lanes, laneTops: laneTops, contentBottom: nextLaneTop, cycle: cycle };
  }
  function mount(container, options) {
    if (!container || container.nodeType !== 1) throw Error('TaskMonitorGraph.mount requires one container element.');
    options = options || {}; var state = { m: null, p: null, folded: Object.create(null), selected: null, transform: { x: 28, y: 28, scale: 1 }, hasRendered: false };
    var root = document.createElement('div'), toolbar = document.createElement('div'), input = document.createElement('input'), status = document.createElement('select'), clearButton = document.createElement('button'), centerButton = document.createElement('button'), svgRoot = svg('svg', { class: 'task-monitor-graph__svg', role: 'img', 'aria-label': '业务闭环关系图' }), view = svg('g', { class: 'task-monitor-graph__viewport' });
    root.className = 'task-monitor-graph'; toolbar.className = 'task-monitor-graph__tools'; input.type = 'search'; input.placeholder = '搜索任务或关键词'; input.setAttribute('aria-label', '搜索任务或关键词'); status.innerHTML = '<option value="">定位状态</option><option value="queued">待开始</option><option value="developing">进行中</option><option value="reviewing">验证中</option><option value="review_failed">已阻塞</option><option value="completed">待业务验收</option><option value="closed">已验收</option>'; clearButton.type = 'button'; clearButton.className = 'task-monitor-graph__command'; clearButton.textContent = '取消选择'; clearButton.disabled = true; centerButton.type = 'button'; centerButton.className = 'task-monitor-graph__command'; centerButton.textContent = '居中所选'; centerButton.disabled = true;
    toolbar.appendChild(input); toolbar.appendChild(status); toolbar.appendChild(clearButton); toolbar.appendChild(centerButton); root.appendChild(toolbar); svgRoot.appendChild(view); root.appendChild(svgRoot); container.replaceChildren(root);
    function apply() { view.setAttribute('transform', 'translate(' + state.transform.x + ' ' + state.transform.y + ') scale(' + state.transform.scale + ')'); }
    function updateCommands() { clearButton.disabled = !state.selected; centerButton.disabled = !state.selected; }
    function emitSelection() { updateCommands(); if (options.onSelect) options.onSelect(state.selected); }
    function clearSelection() { if (!state.selected) return false; state.selected = null; draw(); emitSelection(); return true; }
    function edgeKey(r) { return r.source_task_id + '>' + r.target_task_id; }
    function highlighted() {
      var nodes = Object.create(null), edges = Object.create(null);
      if (!state.selected || !state.m) return { nodes: nodes, edges: edges };
      nodes[state.selected] = true;
      state.m.deps.forEach(function (r) {
        if (r.source_task_id === state.selected || r.target_task_id === state.selected) {
          nodes[r.source_task_id] = true;
          nodes[r.target_task_id] = true;
          edges[edgeKey(r)] = true;
        }
      });
      return { nodes: nodes, edges: edges };
    }
    function draw() {
      if (!state.m) return; var visibleTasks = state.m.tasks.filter(function (t) { return !state.folded[state.p.positions[t.task_id].lane]; }), highlight = highlighted(); view.replaceChildren();
      var defs = svg('defs'), marker = svg('marker', { id: 'task-monitor-arrow', markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: 'auto' }); marker.appendChild(svg('path', { d: 'M0,0 L8,4 L0,8z' })); defs.appendChild(marker); view.appendChild(defs);
      Object.keys(state.p.lanes).sort().forEach(function (lane) { var label = svg('text', { class: 'task-monitor-graph__lane', x: 90, y: state.p.laneTops[lane] - 24 }); label.textContent = lane + ' · ' + state.p.lanes[lane].length + ' 个任务'; view.appendChild(label); });
      state.m.deps.forEach(function (r) { var a = state.p.positions[r.source_task_id], b = state.p.positions[r.target_task_id], direct = highlight.edges[edgeKey(r)]; if (!a || !b || state.folded[a.lane] || state.folded[b.lane]) return; view.appendChild(svg('path', { class: 'task-monitor-graph__edge ' + (direct ? 'is-path' : (state.selected ? 'is-muted' : '')), d: 'M ' + (a.x + W) + ' ' + (a.y + H / 2) + ' L ' + b.x + ' ' + (b.y + H / 2), 'marker-end': 'url(#task-monitor-arrow)' })); });
      state.m.extras.forEach(function (r) { var a = state.p.positions[r.source_task_id], b = state.p.positions[r.target_task_id]; if (!a || !b || state.folded[a.lane] || state.folded[b.lane]) return; var attrs = { class: 'task-monitor-graph__edge is-' + r.kind + (state.selected ? ' is-muted' : ''), d: 'M ' + (a.x + W / 2) + ' ' + (a.y + H / 2) + ' L ' + (b.x + W / 2) + ' ' + (b.y + H / 2) }; if (r.kind === 'replaces') attrs['marker-end'] = 'url(#task-monitor-arrow)'; view.appendChild(svg('path', attrs)); });
      Object.keys(state.p.lanes).sort().forEach(function (lane) { if (state.folded[lane]) { var fold = svg('g', { class: 'task-monitor-graph__fold', transform: 'translate(30 ' + state.p.laneTops[lane] + ')', tabindex: 0, role: 'button' }); var text = svg('text', { x: 0, y: 0 }); text.textContent = '+ ' + lane + ' (' + state.p.lanes[lane].length + ' 个任务)'; fold.appendChild(text); function restoreFold(e) { if (e && e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return; if (e) e.preventDefault(); state.folded[lane] = false; draw(); } fold.addEventListener('click', restoreFold); fold.addEventListener('keydown', restoreFold); view.appendChild(fold); } });
      visibleTasks.forEach(function (t) { var p = state.p.positions[t.task_id], related = highlight.nodes[t.task_id], cls = 'task-monitor-graph__node ' + (statusClass[t.business_status] || '') + (state.selected === t.task_id ? ' is-selected' : '') + (related ? ' is-path' : (state.selected ? ' is-muted' : '')) + (state.m.insertion.indexOf(t.task_id) >= 0 ? ' is-inserted' : '') + (t.blocker || t.status_reason ? ' is-attention' : ''); var g = svg('g', { class: cls, transform: 'translate(' + p.x + ' ' + p.y + ')', tabindex: 0, role: 'button', 'aria-label': t.task_id + ' ' + t.title }); g.appendChild(svg('rect', { width: W, height: H, rx: 9 })); var tooltip = svg('title'); tooltip.textContent = t.title; g.appendChild(tooltip); view.appendChild(g); [['id', t.task_id, 20], ['title', t.title, 42], ['status', t.operational_status + ' · ' + p.lane, 63]].forEach(function (row) { var text = svg('text', { x: 12, y: row[2], class: 'task-monitor-graph__' + row[0] }); g.appendChild(text); elideTextNode(text, row[1], W - 24); }); function select() { if (state.selected === t.task_id) { clearSelection(); return; } state.selected = t.task_id; draw(); emitSelection(); } g.addEventListener('click', select); g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } }); });
      state.m.pending.forEach(function (t, index) { var g = svg('g', { class: 'task-monitor-graph__pending', transform: 'translate(90 ' + (state.p.contentBottom + index * 72) + ')' }); g.appendChild(svg('rect', { width: W, height: 54, rx: 8 })); var tooltip = svg('title'); tooltip.textContent = t.title; g.appendChild(tooltip); view.appendChild(g); var tx = svg('text', { x: 12, y: 22, class: 'task-monitor-graph__id' }); g.appendChild(tx); elideTextNode(tx, t.task_id + ' · 关系待明确', W - 24); var title = svg('text', { x: 12, y: 42, class: 'task-monitor-graph__title' }); g.appendChild(title); elideTextNode(title, t.title, W - 24); }); apply();
    }
    function render(snapshot) { var m; try { m = model(snapshot); } catch (e) { return result(false, 'invalid_snapshot', e.message); } if (!m.ok) return m; var p = positions(m); if (p.cycle) return result(false, 'cyclic_dependency', 'Confirmed dependency graph contains a cycle.'); state.m = m; state.p = p; state.selected = null; draw(); if (!state.hasRendered) { fit(); state.hasRendered = true; } updateCommands(); return { ok: true, taskCount: m.tasks.length, relationCount: m.deps.length, pendingCount: m.pending.length }; }
    function centerTask(id) { var p = state.p && state.p.positions[id], box; if (!p) return false; box = svgRoot.getBoundingClientRect(); state.transform.x = box.width / 2 - (p.x + W / 2) * state.transform.scale; state.transform.y = box.height / 2 - (p.y + H / 2) * state.transform.scale; apply(); return true; }
    function focusTask(id) { if (!state.p || !state.p.positions[id]) return false; var p = state.p.positions[id]; state.folded[p.lane] = false; state.selected = id; draw(); updateCommands(); return true; }
    function locateStatus(value) { if (!state.m) return []; return state.m.tasks.filter(function (t) { return t.business_status === value || t.operational_status === value; }).map(function (t) { return t.task_id; }); }
    function fit() { if (!state.p) return; var maxX = 0, maxY = 0; Object.keys(state.p.positions).forEach(function (id) { var p = state.p.positions[id]; maxX = Math.max(maxX, p.x + W); maxY = Math.max(maxY, p.y + H); }); var box = svgRoot.getBoundingClientRect(); state.transform.scale = Math.max(.05, Math.min(1, (box.width - 50) / maxX, (box.height - 58) / maxY)); state.transform.x = 25; state.transform.y = 30; apply(); }
    function foldStage(lane) { if (!state.p || !state.p.lanes[lane]) return false; state.folded[lane] = !state.folded[lane]; draw(); return state.folded[lane]; }
    function searchTask(query) { var normalized = String(query || '').trim().toLowerCase(); if (!state.m || !normalized) return []; return state.m.tasks.filter(function (t) { return state.m.searchTextById[t.task_id].indexOf(normalized) >= 0; }).map(function (t) { return t.task_id; }); }
    input.addEventListener('input', function () { var ids = searchTask(input.value); if (ids.length === 1 && focusTask(ids[0])) emitSelection(); }); status.addEventListener('change', function () { var ids = locateStatus(status.value); if (ids.length && focusTask(ids[0])) emitSelection(); }); clearButton.addEventListener('click', clearSelection); centerButton.addEventListener('click', function () { if (state.selected) centerTask(state.selected); });
    var drag = null; svgRoot.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y: e.clientY, tx: state.transform.x, ty: state.transform.y }; }); svgRoot.addEventListener('pointermove', function (e) { if (!drag) return; state.transform.x = drag.tx + e.clientX - drag.x; state.transform.y = drag.ty + e.clientY - drag.y; apply(); }); ['pointerup', 'pointerleave'].forEach(function (n) { svgRoot.addEventListener(n, function () { drag = null; }); }); svgRoot.addEventListener('wheel', function (e) { e.preventDefault(); state.transform.scale = Math.max(.3, Math.min(2.5, state.transform.scale * (e.deltaY > 0 ? .9 : 1.1))); apply(); }, { passive: false });
    return { render: render, focusTask: focusTask, locateStatus: locateStatus, fit: fit, foldStage: foldStage, searchTask: searchTask, destroy: function () { container.replaceChildren(); state.m = null; } };
  }
  global.TaskMonitorGraph = { mount: mount };
}(window));
