// ─── Custom Select ─────────────────────────────────────────────────────────────
// Replaces every <select class="select-field"> with a styled dropdown that
// matches the application's dark theme. The original <select> is kept hidden
// and fully in sync so all existing JS (.value reads/writes, onchange handlers,
// innerHTML/appendChild mutations) continue to work without modification.

class CustomSelect {
  constructor(select) {
    this.select = select;
    this.isOpen = false;
    this._settingValue = false;

    this._build();
    this._interceptValueSetter();
    this._observeMutations();

    // Close on Escape
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isOpen) this._close();
    });

    // Close on page scroll — but ignore scroll events that originate from
    // within the panel itself (scrollIntoView and mousewheel on the list).
    window.addEventListener(
      "scroll",
      (e) => {
        if (this.isOpen && !this.panel.contains(e.target)) this._close();
      },
      { passive: true, capture: true },
    );
    window.addEventListener("resize", () => {
      if (this.isOpen) this._close();
    });
  }

  // ── Build DOM ──────────────────────────────────────────────────────────────

  _build() {
    const sel = this.select;

    // Detect size variant from the original select's classes
    this._isSmall = sel.classList.contains("text-xs");
    this._isAutoWidth = sel.classList.contains("w-auto");

    // Hide the native select but keep it in the DOM
    sel.style.display = "none";

    // Wrapper — carries hidden/width classes mirrored from the native select
    const wrapper = document.createElement("div");
    wrapper.className = "custom-select relative";
    if (sel.classList.contains("hidden")) wrapper.classList.add("hidden");
    if (sel.style.minWidth) wrapper.style.minWidth = sel.style.minWidth;
    if (this._isAutoWidth) {
      wrapper.style.display = "inline-block";
    }
    sel.after(wrapper);
    this.wrapper = wrapper;

    // Trigger button
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = this._btnClasses();
    wrapper.appendChild(btn);
    this.btn = btn;

    const labelSpan = document.createElement("span");
    labelSpan.className = "truncate";
    btn.appendChild(labelSpan);
    this.labelSpan = labelSpan;

    const chevronWrap = document.createElement("span");
    chevronWrap.className = "flex-shrink-0 text-neutral-400 transition-transform duration-150";
    chevronWrap.innerHTML = this._isSmall
      ? `<svg class="w-3 h-3" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd"/></svg>`
      : `<svg class="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd"/></svg>`;
    btn.appendChild(chevronWrap);
    this.chevronWrap = chevronWrap;

    // Floating panel — appended to document.body so it escapes overflow clipping
    const panel = document.createElement("div");
    panel.className =
      "custom-select-panel fixed z-[9998] hidden bg-neutral-800 border border-neutral-700 rounded-md shadow-2xl overflow-y-auto";
    panel.style.maxHeight = "260px";
    document.body.appendChild(panel);
    this.panel = panel;

    this._renderOptions();

    // Events
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      this._toggle();
    });

    document.addEventListener(
      "click",
      (this._onOutsideClick = (e) => {
        if (!wrapper.contains(e.target) && !panel.contains(e.target)) {
          // Also guard against scrollbar clicks where the event target resolves
          // to an ancestor element (e.g. document.body) rather than the panel.
          const r = this.panel.getBoundingClientRect();
          const inPanelBounds = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
          if (!inPanelBounds) this._close();
        }
      }),
      true,
    );
  }

  _btnClasses(open = false) {
    const base = [
      "custom-select-btn flex items-center justify-between gap-2",
      "bg-neutral-900 border rounded-md text-secondary",
      "focus:outline-none transition-colors duration-150 text-left",
      this._isSmall ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-sm",
      this._isAutoWidth ? "w-auto" : "w-full",
      open ? "border-accent-500" : "border-neutral-700 hover:border-neutral-600",
    ];
    return base.join(" ");
  }

  // ── Options rendering ──────────────────────────────────────────────────────

  _renderOptions() {
    const panel = this.panel;
    panel.innerHTML = "";
    const currentValue = this.select.value;
    const isSmall = this._isSmall;

    const makeItem = (opt, indented = false) => {
      const isSelected = opt.value === currentValue;
      const item = document.createElement("div");
      item.className = [
        "flex items-center justify-between cursor-pointer select-none",
        isSmall ? "px-3 py-1.5 text-xs" : "px-3 py-2 text-sm",
        indented ? "pl-5" : "",
        "text-secondary hover:bg-neutral-700 transition-colors duration-100",
      ]
        .filter(Boolean)
        .join(" ");
      item.dataset.value = opt.value;

      const textSpan = document.createElement("span");
      textSpan.className = "truncate";
      textSpan.textContent = opt.textContent.trim();
      item.appendChild(textSpan);

      if (isSelected) {
        const check = document.createElement("span");
        check.className = "flex-shrink-0 text-accent-500 ml-2";
        check.innerHTML = `<svg class="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clip-rule="evenodd"/></svg>`;
        item.appendChild(check);
      }

      item.addEventListener("click", (e) => {
        e.stopPropagation();
        this._pickValue(opt.value);
      });

      return item;
    };

    for (const child of this.select.children) {
      if (child.tagName === "OPTGROUP") {
        const header = document.createElement("div");
        header.className =
          "px-3 py-1.5 text-xs font-semibold text-neutral-500 uppercase tracking-wide border-t border-neutral-700/60 mt-0.5 first:border-t-0 first:mt-0";
        header.textContent = child.label;
        panel.appendChild(header);
        for (const opt of child.children) {
          panel.appendChild(makeItem(opt, true));
        }
      } else if (child.tagName === "OPTION") {
        panel.appendChild(makeItem(child, false));
      }
    }

    this._updateLabel();
  }

  _updateLabel() {
    const i = this.select.selectedIndex;
    const opt = i >= 0 ? this.select.options[i] : null;
    this.labelSpan.textContent = opt ? opt.textContent.trim() : "";
    const hasValue = opt && opt.value !== "";
    this.labelSpan.classList.toggle("text-neutral-500", !hasValue);
  }

  // ── Open / close ───────────────────────────────────────────────────────────

  _toggle() {
    this.isOpen ? this._close() : this._open();
  }

  _open() {
    // Close any other open panels first
    document.querySelectorAll(".custom-select-panel:not(.hidden)").forEach((p) => {
      if (p !== this.panel) p.classList.add("hidden");
    });
    // Update other buttons
    document.querySelectorAll(".custom-select-btn.border-accent-500").forEach((b) => {
      if (b !== this.btn) {
        b.className = b.className.replace("border-accent-500", "border-neutral-700");
      }
    });

    const rect = this.btn.getBoundingClientRect();
    this.panel.style.top = `${rect.bottom + 4}px`;
    this.panel.style.left = `${rect.left}px`;
    this.panel.style.width = "";
    this.panel.style.minWidth = `${Math.max(rect.width, 160)}px`;

    // Flip up if not enough space below
    const spaceBelow = window.innerHeight - rect.bottom - 4;
    const panelHeight = Math.min(260, this.panel.scrollHeight || 260);
    if (spaceBelow < panelHeight && rect.top > panelHeight) {
      this.panel.style.top = `${rect.top - panelHeight - 4}px`;
    }

    // Retrigger animation each open
    this.panel.classList.remove("hidden", "animate-fade-in");
    void this.panel.offsetWidth;
    this.panel.classList.add("animate-fade-in");
    this.isOpen = true;
    this.btn.className = this._btnClasses(true);
    this.chevronWrap.style.transform = "rotate(180deg)";

    // Scroll the selected option into view
    const selected = this.panel.querySelector(`[data-value="${CSS.escape(this.select.value)}"]`);
    if (selected) {
      requestAnimationFrame(() => selected.scrollIntoView({ block: "nearest" }));
    }
  }

  _close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.panel.classList.add("hidden");
    this.panel.classList.remove("animate-fade-in");
    this.btn.className = this._btnClasses(false);
    this.chevronWrap.style.transform = "";
  }

  // ── Value management ───────────────────────────────────────────────────────

  _pickValue(value) {
    // Set the native value via the original prototype setter (bypasses our interceptor)
    this._settingValue = true;
    CustomSelect._nativeValueSetter.call(this.select, value);
    this._settingValue = false;

    this._renderOptions(); // re-render checkmarks
    this._close();

    // Fire the change event so onchange handlers run
    this.select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Intercept programmatic `element.value = 'UK'` assignments
  _interceptValueSetter() {
    const self = this;

    Object.defineProperty(this.select, "value", {
      get() {
        return CustomSelect._nativeValueGetter.call(this);
      },
      set(val) {
        CustomSelect._nativeValueSetter.call(this, val);
        if (!self._settingValue) {
          self._updateLabel();
          // Re-render checkmarks on next microtask (options may still be loading)
          Promise.resolve().then(() => self._renderOptions());
        }
      },
      configurable: true,
    });
  }

  // ── Mutation observation ───────────────────────────────────────────────────

  _observeMutations() {
    // Watch for options being added/replaced (category tree, filter search list, etc.)
    const optionObserver = new MutationObserver(() => {
      this._renderOptions();
    });
    optionObserver.observe(this.select, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Mirror hidden/visible class changes (e.g. modal-category-l2)
    const classObserver = new MutationObserver(() => {
      const isHidden = this.select.classList.contains("hidden");
      this.wrapper.classList.toggle("hidden", isHidden);
      if (isHidden) this._close();
    });
    classObserver.observe(this.select, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  // ── Static helpers ─────────────────────────────────────────────────────────

  static get _nativeValueGetter() {
    return Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").get;
  }

  static get _nativeValueSetter() {
    return Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
  }

  static destroy(select) {
    // Restore the native select and remove custom UI
    const wrapper = select.nextElementSibling;
    if (wrapper && wrapper.classList.contains("custom-select")) {
      const panel = document.querySelector(`.custom-select-panel[data-for="${select.id}"]`);
      if (panel) panel.remove();
      wrapper.remove();
    }
    select.style.display = "";
    delete select.value; // remove own property to restore prototype setter
  }
}

// ─── Auto-initialise ──────────────────────────────────────────────────────────

function initCustomSelects(root = document) {
  root.querySelectorAll("select.select-field").forEach((sel) => {
    // Skip if already replaced
    if (sel.nextElementSibling && sel.nextElementSibling.classList.contains("custom-select")) return;
    new CustomSelect(sel);
  });
}

document.addEventListener("DOMContentLoaded", () => initCustomSelects());
