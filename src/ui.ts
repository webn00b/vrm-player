// ── Library ───────────────────────────────────────────────────────────────────

export interface LibraryOptions {
  names: string[];
  onDragToQueue: (itemIndex: number) => void;
  /** Called when user renames an item in the library (double-click). */
  onRename?: (itemIndex: number, newDisplayName: string) => void;
  /** If provided, render a per-item download button. */
  onExport?: (itemIndex: number) => void;
}

const LIBRARY_ALIAS_KEY = 'vrm-player.library-aliases';

/** Return a user-chosen alias for the raw name, or undefined. */
export function readLibraryAlias(rawName: string): string | undefined {
  try {
    const raw = localStorage.getItem(LIBRARY_ALIAS_KEY);
    if (!raw) return undefined;
    return (JSON.parse(raw) as Record<string, string>)[rawName];
  } catch { return undefined; }
}

function writeLibraryAlias(rawName: string, alias: string | null): void {
  try {
    const raw = localStorage.getItem(LIBRARY_ALIAS_KEY);
    const obj = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    if (alias && alias.trim().length > 0) obj[rawName] = alias.trim();
    else delete obj[rawName];
    localStorage.setItem(LIBRARY_ALIAS_KEY, JSON.stringify(obj));
  } catch { /* quota / private mode — silently ignore */ }
}

/**
 * Render a friendly display name. If the user has set an alias, use it.
 * Otherwise, hash-like raw names (hex ≥ 16 chars) get truncated: `abc12345…defg`.
 */
export function formatLibraryName(rawName: string): string {
  const alias = readLibraryAlias(rawName);
  if (alias) return alias;
  if (/^[0-9a-f]{16,}$/i.test(rawName)) {
    return `${rawName.slice(0, 8)}…${rawName.slice(-4)}`;
  }
  return rawName;
}

/**
 * Mounts the animation library (read-only source list).
 * Items are draggable into the Queue panel. Double-click to rename.
 */
export function mountLibrary(opts: LibraryOptions): void {
  const root = document.getElementById('library-list');
  if (!root) throw new Error('#library-list not found');
  root.innerHTML = '';

  opts.names.forEach((name, i) => {
    const li = document.createElement('li');
    li.className = 'lib-item';
    li.setAttribute('draggable', 'true');
    li.title = `${name}\n(double-click to rename, drag to Queue to play)`;

    const label = document.createElement('span');
    label.className = 'lib-item-label';
    label.textContent = formatLibraryName(name);
    li.appendChild(label);

    if (opts.onExport) {
      const exportBtn = document.createElement('button');
      exportBtn.className = 'lib-item-export';
      exportBtn.textContent = '⬇';
      exportBtn.title = 'Download as VRMA';
      exportBtn.setAttribute('draggable', 'false');
      exportBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        opts.onExport!(i);
      });
      exportBtn.addEventListener('dragstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      li.appendChild(exportBtn);
    }

    li.addEventListener('dragstart', (e) => {
      li.classList.add('dragging');
      e.dataTransfer!.effectAllowed = 'copy';
      e.dataTransfer!.setData('text/plain', `library:${i}`);
    });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));

    // Double-click → inline rename
    li.addEventListener('dblclick', () => {
      const current = readLibraryAlias(name) ?? '';
      const input = document.createElement('input');
      input.type  = 'text';
      input.value = current;
      input.placeholder = name;
      input.style.cssText =
        'width:100%;font-family:inherit;font-size:12px;' +
        'background:#111;color:#fff;border:1px solid #3b5bdb;' +
        'border-radius:3px;padding:3px 6px;box-sizing:border-box';

      const commit = (save: boolean): void => {
        if (save) {
          const v = input.value.trim();
          writeLibraryAlias(name, v || null);
          opts.onRename?.(i, v || name);
        }
        input.replaceWith(label);
        label.textContent = formatLibraryName(name);
        li.setAttribute('draggable', 'true');
      };

      li.setAttribute('draggable', 'false');
      label.replaceWith(input);
      input.focus();
      input.select();
      input.addEventListener('blur',    () => commit(true));
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter')  { ev.preventDefault(); commit(true);  input.blur(); }
        if (ev.key === 'Escape') { ev.preventDefault(); commit(false); input.blur(); }
      });
    });

    root.appendChild(li);
  });
}

// ── Queue ─────────────────────────────────────────────────────────────────────

export interface QueueOptions {
  onJump?:    (queueIndex: number) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  onAdd?:     (itemIndex: number) => void;
  onRemove?:  (queueIndex: number) => void;
}

export interface QueueHandle {
  /** Add a new entry to the end of the list. */
  push(name: string): void;
  /** Remove entry at queueIndex. */
  remove(queueIndex: number): void;
  /** Mark entry at queueIndex as the active (playing) one. */
  setActive(queueIndex: number): void;
  /** Reorder DOM only (controller already updated). */
  reorder(fromIndex: number, toIndex: number): void;
}

/**
 * Mounts the playback Queue.
 * Accepts drops from Library, supports internal reorder drag-and-drop,
 * and per-item remove buttons.
 */
export function mountQueue(opts: QueueOptions): QueueHandle {
  const root = document.getElementById('queue-list');
  if (!root) throw new Error('#queue-list not found');

  const empty = document.getElementById('queue-empty');

  root.innerHTML = '';

  const items: HTMLLIElement[] = [];
  let activeIndex = -1;
  let draggedIndex = -1;  // -1 = no internal drag in progress
  let dropTarget = -1;

  // ── Empty state helper ────────────────────────────────────────────────────

  function syncEmpty(): void {
    if (!empty) return;
    empty.style.display = items.length === 0 ? 'flex' : 'none';
  }
  syncEmpty();

  // ── Root drop zone (accepts library drags onto empty area) ────────────────

  root.addEventListener('dragover', (e) => {
    // Only handle library drags here, not internal reorders
    if (draggedIndex >= 0) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
  });

  root.addEventListener('drop', (e) => {
    if (draggedIndex >= 0) return; // handled by item's own drop listener
    e.preventDefault();
    const data = e.dataTransfer?.getData('text/plain') ?? '';
    if (data.startsWith('library:')) {
      const idx = parseInt(data.slice(8), 10);
      if (!isNaN(idx)) opts.onAdd?.(idx);
    }
  });

  // Also wire the empty-state drop zone
  if (empty) {
    empty.addEventListener('dragenter', () => empty.classList.add('drag-over'));
    empty.addEventListener('dragleave', () => empty.classList.remove('drag-over'));
    empty.addEventListener('dragover',  (e) => { e.preventDefault(); e.dataTransfer!.dropEffect = 'copy'; });
    empty.addEventListener('drop', (e) => {
      e.preventDefault();
      empty.classList.remove('drag-over');
      const data = e.dataTransfer?.getData('text/plain') ?? '';
      if (data.startsWith('library:')) {
        const idx = parseInt(data.slice(8), 10);
        if (!isNaN(idx)) opts.onAdd?.(idx);
      }
    });
  }

  // ── Numbering ─────────────────────────────────────────────────────────────

  function refreshNumbers(): void {
    items.forEach((el, i) => {
      el.querySelector<HTMLSpanElement>('.q-num')!.textContent =
        `${String(i + 1).padStart(2, '0')}.`;
    });
  }

  function clearDropVisuals(): void {
    items.forEach((el) => el.classList.remove('drop-before', 'drop-after'));
  }

  // ── Render a queue item ───────────────────────────────────────────────────

  function renderItem(name: string): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'q-item';
    li.setAttribute('draggable', 'true');

    const num = document.createElement('span');
    num.className = 'q-num';
    li.appendChild(num);

    const label = document.createElement('span');
    label.className = 'q-label';
    label.textContent = formatLibraryName(name);
    label.title = name;
    li.appendChild(label);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'q-remove';
    removeBtn.textContent = '✕';
    removeBtn.title = 'Remove from queue';
    li.appendChild(removeBtn);

    return li;
  }

  function bindItemEvents(li: HTMLLIElement, getIndex: () => number): void {
    // Click to jump (only when not dragging)
    li.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('q-remove')) return;
      if (draggedIndex < 0) opts.onJump?.(getIndex());
    });

    // Remove button
    li.querySelector('.q-remove')!.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.onRemove?.(getIndex());
    });

    // ── Internal drag-and-drop reorder ──────────────────────────────────────

    li.addEventListener('dragstart', (e) => {
      draggedIndex = getIndex();
      li.classList.add('dragging');
      e.dataTransfer!.effectAllowed = 'move';
      e.dataTransfer!.setData('text/plain', `queue:${draggedIndex}`);
    });

    li.addEventListener('dragend', () => {
      draggedIndex = -1;
      dropTarget = -1;
      li.classList.remove('dragging');
      clearDropVisuals();
    });

    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      const data = e.dataTransfer?.getData('text/plain') ?? '';

      // If this is a library drag, show a "copy here" indicator
      if (data.startsWith('library:')) {
        e.dataTransfer!.dropEffect = 'copy';
        return;
      }

      // Internal reorder
      if (draggedIndex < 0) return;
      const i = getIndex();
      if (i === draggedIndex) return;

      const rect = li.getBoundingClientRect();
      const isTopHalf = e.clientY < rect.top + rect.height / 2;
      dropTarget = isTopHalf ? i : i + 1;

      clearDropVisuals();
      li.classList.add(isTopHalf ? 'drop-before' : 'drop-after');
    });

    li.addEventListener('drop', (e) => {
      e.preventDefault();
      clearDropVisuals();

      const data = e.dataTransfer?.getData('text/plain') ?? '';

      if (data.startsWith('library:')) {
        const idx = parseInt(data.slice(8), 10);
        if (!isNaN(idx)) opts.onAdd?.(idx);
        return;
      }

      // Internal reorder
      if (draggedIndex < 0 || dropTarget < 0) return;
      if (dropTarget === draggedIndex || dropTarget === draggedIndex + 1) return;
      const from = draggedIndex;
      const to = dropTarget;
      draggedIndex = -1;
      dropTarget = -1;
      handle.reorder(from, to);
      opts.onReorder?.(from, to);
    });
  }

  // ── Public handle ─────────────────────────────────────────────────────────

  const handle: QueueHandle = {
    push(name: string) {
      const li = renderItem(name);
      items.push(li);
      root.appendChild(li);
      bindItemEvents(li, () => items.indexOf(li));
      refreshNumbers();
      syncEmpty();
    },

    remove(queueIndex: number) {
      const li = items[queueIndex];
      if (!li) return;
      li.remove();
      items.splice(queueIndex, 1);
      if (activeIndex === queueIndex) activeIndex = -1;
      else if (activeIndex > queueIndex) activeIndex--;
      refreshNumbers();
      syncEmpty();
    },

    setActive(queueIndex: number) {
      if (activeIndex === queueIndex) return;
      if (activeIndex >= 0) items[activeIndex]?.classList.remove('active');
      items[queueIndex]?.classList.add('active');
      activeIndex = queueIndex;
    },

    reorder(fromIndex: number, toIndex: number) {
      const el = items[fromIndex];
      const refEl = items[toIndex] ?? null;
      root.insertBefore(el, refEl);
      items.splice(fromIndex, 1);
      items.splice(toIndex > fromIndex ? toIndex - 1 : toIndex, 0, el);
      refreshNumbers();
      activeIndex = items.findIndex((li) => li.classList.contains('active'));
    },
  };

  return handle;
}

// ── Status bar ────────────────────────────────────────────────────────────────

export function setStatus(text: string): void {
  const el = document.getElementById('status');
  if (el) el.textContent = text;
}
