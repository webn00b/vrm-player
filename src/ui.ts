// ── Display name helpers ──────────────────────────────────────────────────────

const ALIAS_KEY = 'vrm-player.library-aliases';

export function readLibraryAlias(rawName: string): string | undefined {
  try {
    const raw = localStorage.getItem(ALIAS_KEY);
    if (!raw) return undefined;
    return (JSON.parse(raw) as Record<string, string>)[rawName];
  } catch { return undefined; }
}

function writeLibraryAlias(rawName: string, alias: string | null): void {
  try {
    const raw = localStorage.getItem(ALIAS_KEY);
    const obj = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    if (alias && alias.trim().length > 0) obj[rawName] = alias.trim();
    else delete obj[rawName];
    localStorage.setItem(ALIAS_KEY, JSON.stringify(obj));
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

// ── Queue ─────────────────────────────────────────────────────────────────────

export interface QueueOptions {
  onJump?:    (queueIndex: number) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  onRemove?:  (queueIndex: number) => void;
  /** If provided, render a per-item ⬇ download button (VRMA). */
  onExport?:  (queueIndex: number) => void;
  /**
   * If provided, render a per-item ⬇BVH button. Distinct from onExport so
   * the two can be wired independently — VRMA export only makes sense for
   * items whose source was BVH, while BVH export works for anything that
   * plays through the render loop.
   */
  onExportBvh?: (queueIndex: number) => void;
  /** If provided, double-click on the label opens an inline rename input. */
  onRename?:  (queueIndex: number, newDisplayName: string) => void;
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
 * Accepts external file drops (handled in main.ts), supports internal reorder
 * drag-and-drop, and per-item remove / export buttons.
 */
export function mountQueue(opts: QueueOptions): QueueHandle {
  const root = document.getElementById('queue-list');
  if (!root) throw new Error('#queue-list not found');

  const empty = document.getElementById('queue-empty');

  root.innerHTML = '';

  const items: Array<{ li: HTMLLIElement; rawName: string }> = [];
  let activeIndex = -1;
  let draggedIndex = -1;
  let dropTarget = -1;

  function syncEmpty(): void {
    if (!empty) return;
    empty.style.display = items.length === 0 ? 'flex' : 'none';
  }
  syncEmpty();

  function refreshNumbers(): void {
    items.forEach(({ li }, i) => {
      li.querySelector<HTMLSpanElement>('.q-num')!.textContent =
        `${String(i + 1).padStart(2, '0')}.`;
    });
  }

  function clearDropVisuals(): void {
    items.forEach(({ li }) => li.classList.remove('drop-before', 'drop-after'));
  }

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

    if (opts.onExportBvh) {
      const exportBvhBtn = document.createElement('button');
      exportBvhBtn.className = 'q-export-bvh';
      exportBvhBtn.textContent = '⬇bvh';
      exportBvhBtn.title = 'Record this clip as BVH (live playback)';
      exportBvhBtn.setAttribute('draggable', 'false');
      li.appendChild(exportBvhBtn);
    }
    if (opts.onExport) {
      const exportBtn = document.createElement('button');
      exportBtn.className = 'q-export';
      exportBtn.textContent = '⬇';
      exportBtn.title = 'Download as VRMA';
      exportBtn.setAttribute('draggable', 'false');
      li.appendChild(exportBtn);
    }

    const removeBtn = document.createElement('button');
    removeBtn.className = 'q-remove';
    removeBtn.textContent = '✕';
    removeBtn.title = 'Remove from queue';
    li.appendChild(removeBtn);

    return li;
  }

  function bindItemEvents(li: HTMLLIElement, getIndex: () => number, rawName: string): void {
    const label = li.querySelector<HTMLSpanElement>('.q-label')!;

    li.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.classList.contains('q-remove')
       || t.classList.contains('q-export')
       || t.classList.contains('q-export-bvh')) return;
      if (draggedIndex < 0) opts.onJump?.(getIndex());
    });

    li.querySelector('.q-remove')!.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.onRemove?.(getIndex());
    });

    li.querySelector('.q-export')?.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.onExport?.(getIndex());
    });

    li.querySelector('.q-export-bvh')?.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.onExportBvh?.(getIndex());
    });

    if (opts.onRename) {
      label.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const current = readLibraryAlias(rawName) ?? '';
        const input = document.createElement('input');
        input.type  = 'text';
        input.value = current;
        input.placeholder = rawName;
        input.style.cssText =
          'flex:1;min-width:0;font-family:inherit;font-size:11px;' +
          'background:#111;color:#fff;border:1px solid #3b5bdb;' +
          'border-radius:3px;padding:2px 5px;box-sizing:border-box';

        const commit = (save: boolean): void => {
          if (save) {
            const v = input.value.trim();
            writeLibraryAlias(rawName, v || null);
            opts.onRename?.(getIndex(), v || rawName);
          }
          input.replaceWith(label);
          label.textContent = formatLibraryName(rawName);
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
    }

    // ── Internal drag-and-drop reorder ─────────────────────────────────────
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
      if (draggedIndex < 0) return;
      e.preventDefault();
      const i = getIndex();
      if (i === draggedIndex) return;
      const rect = li.getBoundingClientRect();
      const isTopHalf = e.clientY < rect.top + rect.height / 2;
      dropTarget = isTopHalf ? i : i + 1;
      clearDropVisuals();
      li.classList.add(isTopHalf ? 'drop-before' : 'drop-after');
    });

    li.addEventListener('drop', (e) => {
      if (draggedIndex < 0 || dropTarget < 0) return;
      e.preventDefault();
      clearDropVisuals();
      if (dropTarget === draggedIndex || dropTarget === draggedIndex + 1) return;
      const from = draggedIndex;
      const to = dropTarget;
      draggedIndex = -1;
      dropTarget = -1;
      handle.reorder(from, to);
      opts.onReorder?.(from, to);
    });
  }

  const handle: QueueHandle = {
    push(name: string) {
      const li = renderItem(name);
      const entry = { li, rawName: name };
      items.push(entry);
      root.appendChild(li);
      bindItemEvents(li, () => items.findIndex((it) => it.li === li), name);
      refreshNumbers();
      syncEmpty();
    },

    remove(queueIndex: number) {
      const entry = items[queueIndex];
      if (!entry) return;
      entry.li.remove();
      items.splice(queueIndex, 1);
      if (activeIndex === queueIndex) activeIndex = -1;
      else if (activeIndex > queueIndex) activeIndex--;
      refreshNumbers();
      syncEmpty();
    },

    setActive(queueIndex: number) {
      if (activeIndex === queueIndex) return;
      if (activeIndex >= 0) items[activeIndex]?.li.classList.remove('active');
      items[queueIndex]?.li.classList.add('active');
      activeIndex = queueIndex;
    },

    reorder(fromIndex: number, toIndex: number) {
      const entry = items[fromIndex];
      const refEntry = items[toIndex] ?? null;
      root.insertBefore(entry.li, refEntry?.li ?? null);
      items.splice(fromIndex, 1);
      items.splice(toIndex > fromIndex ? toIndex - 1 : toIndex, 0, entry);
      refreshNumbers();
      activeIndex = items.findIndex(({ li }) => li.classList.contains('active'));
    },
  };

  return handle;
}

// ── Status bar ────────────────────────────────────────────────────────────────

export function setStatus(text: string): void {
  const el = document.getElementById('status');
  if (el) el.textContent = text;
}
