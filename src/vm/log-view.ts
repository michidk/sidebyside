// A capped, timestamped list that stays scrolled to the bottom unless the reader scrolled up.
// Rows go in once per frame: guest output comes in bursts of hundreds of lines, and the VM
// frames share one main thread with the compositors, so a layout per line would stall them.
export function logView(list: HTMLElement, maxRows: number) {
  const started = performance.now();
  const pending = document.createDocumentFragment();
  let scheduled = false;

  function flush() {
    scheduled = false;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 24;
    list.append(pending);
    for (let extra = list.childElementCount - maxRows; extra > 0; extra--) list.firstElementChild!.remove();
    if (atBottom) list.scrollTop = list.scrollHeight;
  }

  return {
    // A row of class `rowClass`: the time since start, then each [class, text] cell.
    add(rowClass: string, cells: [string, string][]) {
      const row = document.createElement("div");
      row.className = rowClass;
      const time = row.appendChild(document.createElement("span"));
      time.className = "time";
      time.textContent = `${((performance.now() - started) / 1000).toFixed(1)}s`;
      for (const [className, text] of cells) {
        const cell = row.appendChild(document.createElement("span"));
        cell.className = className;
        cell.textContent = text;
      }
      pending.append(row);
      if (pending.childElementCount > maxRows) pending.firstElementChild!.remove();
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(flush);
      }
    },
    clear() {
      pending.replaceChildren();
      list.replaceChildren();
    },
  };
}
