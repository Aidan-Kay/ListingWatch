"use strict";

const { Notification } = require("electron");

// ─── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_NOTIFY_FORMATS = ["Auction", "Buy It Now"];

/**
 * Send desktop notifications for newly found listings.
 *
 * @param {Object[]} items       - New listing items.
 * @param {Object}   settings    - Current app settings.
 * @param {Object[]} searches    - All configured searches (to check per-search notify flag).
 * @param {Electron.BrowserWindow|null} mainWindow
 */
function sendNotifications(items, settings, searches, mainWindow) {
  if (!Notification.isSupported()) return;

  // Suppress notifications when the window is focused (unless setting is enabled)
  if (!settings.notifyWhenFocused && mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) return;

  const allowed = settings.notifyFormats && settings.notifyFormats.length > 0 ? settings.notifyFormats : DEFAULT_NOTIFY_FORMATS;

  const filtered = items.filter((item) => {
    const search = searches.find((s) => s.id === item.searchId);
    if (search && search.notify === false) return false;
    const formats = item.buyingFormats || [];
    if (!formats.some((f) => allowed.includes(f))) return false;
    if (search && search.maxNotifyPrice != null && item.priceNumeric != null && item.priceNumeric > search.maxNotifyPrice) return false;
    return true;
  });

  if (filtered.length === 0) return;

  /**
   * Bring the app window into focus and tell the renderer to scroll to the
   * relevant listing(s). Works for both minimized and background states.
   */
  function focusAndScrollTo(itemIds) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send("scroll-to-listing", itemIds);
  }

  if (filtered.length === 1) {
    const item = filtered[0];
    const notif = new Notification({
      title: "ListingWatch",
      body: `${item.searchName}: ${item.title}${item.price ? `  ·  ${item.price}` : ""}`,
      silent: false,
    });
    notif.on("click", () => focusAndScrollTo([item.id]));
    notif.show();
  } else {
    const notif = new Notification({
      title: "ListingWatch",
      body:
        filtered
          .map((i) => `${i.title}${i.price ? ` · ${i.price}` : ""}`)
          .slice(0, 3)
          .join("\n") + (filtered.length > 3 ? `\n…and ${filtered.length - 3} more` : ""),
      silent: false,
    });
    notif.on("click", () => focusAndScrollTo(filtered.map((i) => i.id)));
    notif.show();
  }
}

module.exports = { sendNotifications };
