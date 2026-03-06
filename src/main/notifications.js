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
    // Delay the IPC message so the renderer has time to wake up from background
    // throttling before processing the scroll. The window.show() call is
    // asynchronous on Windows — sending immediately can race the renderer's
    // repaint cycle and cause scrollIntoView to silently no-op.
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("scroll-to-listing", itemIds);
      }
    }, 150);
  }

  if (filtered.length === 1) {
    const item = filtered[0];
    // Suppress the OS chime when sound is disabled, or when a custom file is set
    // (the renderer plays it directly via HTML5 Audio instead).
    const suppressOsChime = !settings.notificationSoundEnabled || Boolean(settings.notificationSoundFile);
    const notif = new Notification({
      title: "New Listing",
      body: `${item.searchName}: ${item.title}${item.price ? `  ·  ${item.price}` : ""}`,
      silent: suppressOsChime,
    });
    notif.on("click", () => focusAndScrollTo([item.id]));
    notif.show();
  } else {
    const suppressOsChime = !settings.notificationSoundEnabled || Boolean(settings.notificationSoundFile);
    const notif = new Notification({
      title: "New Listings",
      body:
        filtered
          .map((i) => `${i.title}${i.price ? ` · ${i.price}` : ""}`)
          .slice(0, 3)
          .join("\n") + (filtered.length > 3 ? `\n…and ${filtered.length - 3} more` : ""),
      silent: suppressOsChime,
    });
    notif.on("click", () => focusAndScrollTo(filtered.map((i) => i.id)));
    notif.show();
  }

  // If a custom sound file is configured, play it from the renderer (HTML5 Audio)
  if (settings.notificationSoundEnabled && settings.notificationSoundFile && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("play-notification-sound", {
      soundFile: settings.notificationSoundFile,
      volume: settings.notificationVolume ?? 1.0,
    });
  }
}

module.exports = { sendNotifications };
