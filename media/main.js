// @ts-nocheck
(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  const toolbar = document.getElementById('toolbar');
  const NS = 'http://www.w3.org/2000/svg';

  // A single, reused insertion line (fixed-positioned → never shifts layout).
  const dropline = document.createElement('div');
  dropline.className = 'dropline';
  dropline.hidden = true;
  document.body.appendChild(dropline);

  let forest = [];
  let expanded = new Set();
  let selectedKey = null;

  let byKey = new Map();
  let siblings = new Map(); // parentKey -> [node,...] display order

  const PATHS = {
    folder: [
      'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z',
    ],
    file: [
      'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z',
      'M14 2v5a1 1 0 0 0 1 1h5',
      'M10 9H8',
      'M16 13H8',
      'M16 17H8',
    ],
    newFile: [
      'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z',
      'M14 2v5a1 1 0 0 0 1 1h5',
      'M9 15h6',
      'M12 18v-6',
    ],
    newFolder: [
      'M12 10v6',
      'M9 13h6',
      'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z',
    ],
    expand: [
      'M12 22v-6', 'M12 8V2', 'M4 12H2', 'M10 12H8', 'M16 12h-2', 'M22 12h-2', 'm15 19-3 3-3-3', 'm15 5-3-3-3 3',
    ],
    collapse: [
      'M12 22v-6', 'M12 8V2', 'M4 12H2', 'M10 12H8', 'M16 12h-2', 'M22 12h-2', 'm15 19-3-3-3 3', 'm15 5-3 3-3-3',
    ],
  };

  function svgEl(spec) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    for (const d of spec.paths || []) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    }
    for (const [cx, cy] of spec.dots || []) {
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', cx);
      c.setAttribute('cy', cy);
      c.setAttribute('r', '1.5');
      c.setAttribute('fill', 'currentColor');
      c.setAttribute('stroke', 'none');
      svg.appendChild(c);
    }
    return svg;
  }

  function icon(name) {
    if (name === 'more') return svgEl({ dots: [[5, 12], [12, 12], [19, 12]] });
    return svgEl({ paths: PATHS[name] });
  }

  // ---- toolbar (centered) ----

  function renderToolbar() {
    toolbar.innerHTML = '';
    const buttons = [
      ['newFile', '新建文件', () => vscode.postMessage({ type: 'action', action: 'newFile', key: '' })],
      ['newFolder', '新建目录', () => vscode.postMessage({ type: 'action', action: 'newFolder', key: '' })],
      ['expand', '全部展开', expandAllLocal],
      ['collapse', '全部收起', collapseAllLocal],
      ['more', '更多', null],
    ];
    for (const [name, title, fn] of buttons) {
      const b = document.createElement('button');
      b.className = 'tbtn';
      b.title = title;
      b.appendChild(icon(name));
      if (name === 'more') {
        // Open VS Code's native menu: mark a context section and synthesise a
        // contextmenu event under the button on left-click.
        b.setAttribute(
          'data-vscode-context',
          JSON.stringify({ webviewSection: 'docsBarMore', preventDefaultContextMenuItems: true }),
        );
        b.addEventListener('click', () => {
          const r = b.getBoundingClientRect();
          b.dispatchEvent(
            new MouseEvent('contextmenu', {
              bubbles: true,
              clientX: Math.round(r.left),
              clientY: Math.round(r.bottom),
            }),
          );
        });
      } else {
        b.addEventListener('click', fn);
      }
      toolbar.appendChild(b);
    }
  }

  function expandAllLocal() {
    byKey.forEach((n) => n.isDir && expanded.add(n.key));
    persistExpanded();
    render();
  }
  function collapseAllLocal() {
    expanded.clear();
    persistExpanded();
    render();
  }

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'render') {
      forest = m.forest || [];
      expanded = new Set(m.expanded || []);
      render();
    } else if (m.type === 'expandAll') {
      expandAllLocal();
    } else if (m.type === 'collapseAll') {
      collapseAllLocal();
    }
  });

  function persistExpanded() {
    vscode.postMessage({ type: 'saveExpanded', expanded: [...expanded] });
  }

  function indexTree() {
    byKey = new Map();
    siblings = new Map();
    const walk = (nodes) => {
      for (const n of nodes) {
        byKey.set(n.key, n);
        if (!siblings.has(n.parentKey)) siblings.set(n.parentKey, []);
        siblings.get(n.parentKey).push(n);
        if (n.children) walk(n.children);
      }
    };
    walk(forest);
  }

  function render() {
    indexTree();
    app.innerHTML = '';
    if (!forest.length) {
      const d = document.createElement('div');
      d.className = 'empty';
      d.textContent = '这里还没有 Markdown 文档～\n右键新建，或在设置里调整根目录。';
      app.appendChild(d);
      return;
    }
    const frag = document.createDocumentFragment();
    const walk = (nodes, depth) => {
      for (const n of nodes) {
        frag.appendChild(rowEl(n, depth));
        if (n.isDir && expanded.has(n.key) && n.children) walk(n.children, depth + 1);
      }
    };
    walk(forest, 0);
    app.appendChild(frag);
  }

  function rowEl(n, depth) {
    const row = document.createElement('div');
    row.style.setProperty('--d', depth);
    row.dataset.key = n.key;
    row.draggable = true;

    if (n.isDivider) {
      row.className = 'row divider';
      row.setAttribute(
        'data-vscode-context',
        JSON.stringify({
          webviewSection: 'docsBarDivider',
          docKey: n.key,
          docParentKey: n.parentKey,
          preventDefaultContextMenuItems: true,
        }),
      );
      const line = document.createElement('div');
      line.className = 'divider-line';
      row.appendChild(line);
      row.addEventListener('dragstart', (ev) => {
        ev.dataTransfer.setData('text/plain', n.key);
        ev.dataTransfer.effectAllowed = 'move';
      });
      row.addEventListener('dragover', (ev) => onDragOver(ev, row, n));
      row.addEventListener('drop', (ev) => onDrop(ev, row, n));
      return row;
    }

    row.className = 'row' + (n.isDir && expanded.has(n.key) ? ' expanded' : '');
    if (n.key === selectedKey) row.classList.add('selected');
    row.setAttribute(
      'data-vscode-context',
      JSON.stringify({
        webviewSection: 'docsBarItem',
        docKey: n.key,
        docIsDir: n.isDir,
        preventDefaultContextMenuItems: true,
      }),
    );

    const ico = document.createElement('span');
    ico.className = 'icon';
    if (n.emoji) {
      ico.classList.add('emoji');
      ico.textContent = n.emoji;
    } else {
      ico.appendChild(icon(n.isDir ? 'folder' : 'file'));
    }
    row.appendChild(ico);

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = n.label;
    row.appendChild(label);

    if (n.git) {
      const g = document.createElement('span');
      g.className = 'git ' + n.git;
      g.textContent = n.git;
      row.appendChild(g);
    }

    row.addEventListener('click', () => {
      selectedKey = n.key;
      if (n.isDir) toggle(n);
      else vscode.postMessage({ type: 'open', key: n.key });
      markSelection();
    });
    row.addEventListener('contextmenu', () => {
      selectedKey = n.key;
      markSelection();
    });

    row.addEventListener('dragstart', (ev) => {
      ev.dataTransfer.setData('text/plain', n.key);
      ev.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragover', (ev) => onDragOver(ev, row, n));
    row.addEventListener('drop', (ev) => onDrop(ev, row, n));

    return row;
  }

  function markSelection() {
    for (const r of app.querySelectorAll('.row')) {
      r.classList.toggle('selected', r.dataset.key === selectedKey);
    }
  }

  function toggle(n) {
    if (!n.isDir) return;
    if (expanded.has(n.key)) expanded.delete(n.key);
    else expanded.add(n.key);
    persistExpanded();
    render();
  }

  // ---- drag & drop (box-shadow hints, no layout shift) ----

  function clearHints() {
    for (const r of app.querySelectorAll('.drop-into')) r.classList.remove('drop-into');
    dropline.hidden = true;
  }

  function onDragOver(ev, row, n) {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
    clearHints();
    const rect = row.getBoundingClientRect();
    const y = ev.clientY - rect.top;
    let zone;
    if (n.isDir) {
      zone = y < rect.height * 0.25 ? 'before' : y > rect.height * 0.75 ? 'after' : 'into';
    } else {
      zone = y < rect.height * 0.5 ? 'before' : 'after';
    }
    row.dataset.zone = zone;
    if (zone === 'into') {
      row.classList.add('drop-into');
      return;
    }
    const depth = parseInt(row.style.getPropertyValue('--d') || '0', 10);
    const indent = 8 + depth * 14;
    dropline.style.top = (zone === 'before' ? rect.top : rect.bottom) - 1 + 'px';
    dropline.style.left = rect.left + indent + 'px';
    dropline.style.width = Math.max(0, rect.width - indent - 8) + 'px';
    dropline.hidden = false;
  }

  function onDrop(ev, row, n) {
    ev.preventDefault();
    const movedKey = ev.dataTransfer.getData('text/plain');
    const zone = row.dataset.zone || 'before';
    clearHints();
    if (!movedKey || movedKey === n.key) return;

    let parentKey;
    let beforeKey;
    if (zone === 'into' && n.isDir) {
      parentKey = n.key;
      beforeKey = null;
    } else {
      parentKey = n.parentKey;
      if (zone === 'before') {
        beforeKey = n.key;
      } else {
        const sibs = siblings.get(n.parentKey) || [];
        const i = sibs.findIndex((s) => s.key === n.key);
        beforeKey = i >= 0 && i + 1 < sibs.length ? sibs[i + 1].key : null;
      }
    }
    const movedNode = byKey.get(movedKey);
    const movedParentKey = movedNode ? movedNode.parentKey : '';
    vscode.postMessage({ type: 'reorder', moved: [movedKey], parentKey, beforeKey, movedParentKey });
  }

  app.addEventListener('dragend', clearHints);
  app.addEventListener('dragleave', (ev) => {
    if (ev.target === app) clearHints();
  });

  // ---- keyboard (view focused) ----

  window.addEventListener('keydown', (ev) => {
    if (!selectedKey || !byKey.has(selectedKey)) return;
    const n = byKey.get(selectedKey);
    const meta = ev.metaKey || ev.ctrlKey;
    if (ev.key === 'F2') act('rename');
    else if (ev.key === 'Enter') n.isDir ? toggle(n) : vscode.postMessage({ type: 'open', key: n.key });
    else if (ev.key === 'Delete' || (ev.key === 'Backspace' && meta)) act('delete');
    else if (meta && ev.key === 'c') act('copy');
    else if (meta && ev.key === 'v') act('paste');
    else if (meta && ev.key === 'd') act('duplicate');
    else return;
    ev.preventDefault();
  });

  function act(action) {
    if (selectedKey) vscode.postMessage({ type: 'action', action, key: selectedKey });
  }

  renderToolbar();
  vscode.postMessage({ type: 'ready' });
})();
