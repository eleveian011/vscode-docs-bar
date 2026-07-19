// @ts-nocheck
(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  const menuEl = document.getElementById('menu');

  let forest = [];
  let expanded = new Set();
  let selectedKey = null;

  // lookup maps rebuilt each render
  let byKey = new Map();
  let siblings = new Map(); // parentKey -> [node,...] in display order

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'render') {
      forest = m.forest || [];
      expanded = new Set(m.expanded || []);
      render();
    } else if (m.type === 'expandAll') {
      byKey.forEach((n) => n.isDir && expanded.add(n.key));
      persistExpanded();
      render();
    } else if (m.type === 'collapseAll') {
      expanded.clear();
      persistExpanded();
      render();
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
    menuEl.hidden = true;
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
    row.className = 'row' + (n.isDir && expanded.has(n.key) ? ' expanded' : '');
    if (n.key === selectedKey) row.classList.add('selected');
    row.style.setProperty('--d', depth);
    row.dataset.key = n.key;
    row.draggable = true;

    const twist = document.createElement('span');
    twist.className = 'twist' + (n.isDir ? '' : ' leaf');
    twist.textContent = '▶';
    row.appendChild(twist);

    const icon = document.createElement('span');
    icon.className = 'icon' + (n.emoji ? '' : ' default');
    icon.textContent = n.emoji || (n.isDir ? '📁' : '📄');
    row.appendChild(icon);

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

    twist.addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggle(n);
    });
    row.addEventListener('click', () => {
      selectedKey = n.key;
      if (n.isDir) toggle(n);
      else vscode.postMessage({ type: 'open', key: n.key });
      markSelection();
    });
    row.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      selectedKey = n.key;
      markSelection();
      showMenu(n, ev.clientX, ev.clientY);
    });

    // drag & drop
    row.addEventListener('dragstart', (ev) => {
      ev.dataTransfer.setData('text/plain', n.key);
      ev.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragover', (ev) => onDragOver(ev, row, n));
    row.addEventListener('dragleave', () => clearDropHints(row));
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

  // ---- drag & drop ----

  let dropLine = null;

  function clearDropHints(row) {
    if (row) row.classList.remove('drop-into');
    if (dropLine && dropLine.parentNode) dropLine.parentNode.removeChild(dropLine);
    dropLine = null;
  }

  function clearAllDropHints() {
    for (const r of app.querySelectorAll('.drop-into')) r.classList.remove('drop-into');
    if (dropLine && dropLine.parentNode) dropLine.parentNode.removeChild(dropLine);
    dropLine = null;
  }

  function onDragOver(ev, row, n) {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
    clearAllDropHints();
    const rect = row.getBoundingClientRect();
    const y = ev.clientY - rect.top;
    const zone = n.isDir
      ? y < rect.height * 0.25
        ? 'before'
        : y > rect.height * 0.75
        ? 'after'
        : 'into'
      : y < rect.height * 0.5
      ? 'before'
      : 'after';
    row.dataset.zone = zone;
    if (zone === 'into') {
      row.classList.add('drop-into');
    } else {
      dropLine = document.createElement('div');
      dropLine.className = 'drop-line';
      dropLine.style.setProperty('--d', row.style.getPropertyValue('--d') || 0);
      if (zone === 'before') row.parentNode.insertBefore(dropLine, row);
      else row.parentNode.insertBefore(dropLine, row.nextSibling);
    }
  }

  function onDrop(ev, row, n) {
    ev.preventDefault();
    const movedKey = ev.dataTransfer.getData('text/plain');
    const zone = row.dataset.zone || 'before';
    clearAllDropHints();
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
    vscode.postMessage({ type: 'reorder', moved: [movedKey], parentKey, beforeKey });
  }

  // ---- context menu ----

  const SEP = { sep: true };

  function menuItems(n) {
    if (n.isDir) {
      return [
        { label: '新建文件', action: 'newFile' },
        { label: '新建目录', action: 'newFolder' },
        SEP,
        { label: '设置图标', action: 'setIcon' },
        { label: '设置显示名', action: 'setAlias' },
        SEP,
        { label: '重命名', action: 'rename', kbd: 'F2' },
        { label: '创建副本', action: 'duplicate' },
        { label: '复制', action: 'copy' },
        { label: '粘贴', action: 'paste' },
        SEP,
        { label: '复制路径', action: 'copyPath' },
        { label: '复制相对路径', action: 'copyRelativePath' },
        SEP,
        { label: '在 Docs Bar 中隐藏', action: 'hide' },
        { label: '在 Finder 中显示', action: 'reveal' },
        SEP,
        { label: '删除', action: 'delete', danger: true },
      ];
    }
    return [
      { label: '打开', action: 'open' },
      SEP,
      { label: '设置图标', action: 'setIcon' },
      { label: '设置显示名', action: 'setAlias' },
      SEP,
      { label: '重命名', action: 'rename', kbd: 'F2' },
      { label: '创建副本', action: 'duplicate' },
      { label: '复制', action: 'copy' },
      SEP,
      { label: '复制路径', action: 'copyPath' },
      { label: '复制相对路径', action: 'copyRelativePath' },
      SEP,
      { label: '在 Docs Bar 中隐藏', action: 'hide' },
      { label: '在 Finder 中显示', action: 'reveal' },
      SEP,
      { label: '删除', action: 'delete', danger: true },
    ];
  }

  function showMenu(n, x, y) {
    menuEl.innerHTML = '';
    for (const item of menuItems(n)) {
      if (item.sep) {
        const s = document.createElement('div');
        s.className = 'sep';
        menuEl.appendChild(s);
        continue;
      }
      const mi = document.createElement('div');
      mi.className = 'mi' + (item.danger ? ' danger' : '');
      const t = document.createElement('span');
      t.textContent = item.label;
      mi.appendChild(t);
      if (item.kbd) {
        const k = document.createElement('span');
        k.className = 'kbd';
        k.textContent = item.kbd;
        mi.appendChild(k);
      }
      mi.addEventListener('click', () => {
        menuEl.hidden = true;
        vscode.postMessage({ type: 'action', action: item.action, key: n.key });
      });
      menuEl.appendChild(mi);
    }
    menuEl.hidden = false;
    // position, clamped to viewport
    const mw = menuEl.offsetWidth;
    const mh = menuEl.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    menuEl.style.left = Math.min(x, vw - mw - 6) + 'px';
    menuEl.style.top = Math.min(y, vh - mh - 6) + 'px';
  }

  window.addEventListener('click', (ev) => {
    if (!menuEl.hidden && !menuEl.contains(ev.target)) menuEl.hidden = true;
  });
  window.addEventListener('blur', () => (menuEl.hidden = true));
  window.addEventListener('scroll', () => (menuEl.hidden = true), true);

  // ---- keyboard ----

  window.addEventListener('keydown', (ev) => {
    if (!menuEl.hidden && ev.key === 'Escape') {
      menuEl.hidden = true;
      return;
    }
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

  vscode.postMessage({ type: 'ready' });
})();
