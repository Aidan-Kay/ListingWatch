"use strict";

const { Notification } = require("electron");

// ─── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_NOTIFY_FORMATS = ["Auction", "Buy It Now"];

// How many listings a grouped notification names before it summarises the rest.
const GROUPED_PREVIEW_COUNT = 3;

// Minimum gap between custom-sound plays. A burst of new-listing events would
// otherwise restart the clip mid-playback, which sounds like stuttering.
const SOUND_THROTTLE_MS = 600;

let _lastSoundAt = 0;

/**
 * Whether a notification should be shown at all right now.
 * Notifications are suppressed while the window has focus, since the user can
 * already see the feed, unless they have opted out of that.
 */
function shouldNotify(settings, mainWindow) {
  if (!Notification.isSupported()) return false;
  if (settings.notifyWhenFocused) return true;
  return !(mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused());
}

/**
 * Keep only the listings the user has asked to be told about.
 *
 * Three rules, all per-search: the search's own notify toggle, the buying
 * formats selected in Settings, and the search's maximum notify price.
 */
function filterNotifiable(items, settings, searches) {
  const allowedFormats =
    settings.notifyFormats && settings.notifyFormats.length > 0 ? settings.notifyFormats : DEFAULT_NOTIFY_FORMATS;

  return items.filter((item) => {
    const search = searches.find((s) => s.id === item.searchId);
    if (search && search.notify === false) return false;
    if (!(item.buyingFormats || []).some((format) => allowedFormats.includes(format))) return false;
    if (search && search.maxNotifyPrice != null && item.priceNumeric != null && item.priceNumeric > search.maxNotifyPrice) {
      return false;
    }
    return true;
  });
}

/** One listing per line, truncated with a count once the list gets long. */
function buildNotificationContent(items) {
  if (items.length === 1) {
    const item = items[0];
    return {
      title: "New Listing",
      body: `${item.searchName}: ${item.title}${item.price ? `  ·  ${item.price}` : ""}`,
    };
  }

  const preview = items.slice(0, GROUPED_PREVIEW_COUNT).map((item) => `${item.title}${item.price ? ` · ${item.price}` : ""}`);
  const remainder = items.length - GROUPED_PREVIEW_COUNT;
  return {
    title: "New Listings",
    body: preview.join("\n") + (remainder > 0 ? `\n…and ${remainder} more` : ""),
  };
}

/**
 * Bring the app window forward and tell the renderer to scroll to the listings
 * the notification was about. Works from minimised and from the background.
 */
function focusAndScrollTo(itemIds, mainWindow) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  // Delay the IPC message so the renderer has time to wake from background
  // throttling before processing the scroll. window.show() is asynchronous on
  // Windows, and sending immediately can race the repaint and leave
  // scrollIntoView silently no-opping.
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("scroll-to-listing", itemIds);
    }
  }, 150);
}

/**
 * Show one OS notification. The chime is suppressed when sound is off, or when
 * a custom file is configured — the renderer plays that one itself.
 */
function showNotification({ title, body }, settings, onClick) {
  const notification = new Notification({
    title,
    body,
    silent: !settings.notificationSoundEnabled || Boolean(settings.notificationSoundFile),
  });
  notification.on("click", onClick);
  notification.show();
}

/** Ask the renderer to play the user's chosen sound file, at most so often. */
function maybePlayCustomSound(settings, mainWindow) {
  if (!settings.notificationSoundEnabled || !settings.notificationSoundFile) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const now = Date.now();
  if (now - _lastSoundAt < SOUND_THROTTLE_MS) return;
  _lastSoundAt = now;

  mainWindow.webContents.send("play-notification-sound", {
    soundFile: settings.notificationSoundFile,
    volume: settings.notificationVolume ?? 1.0,
  });
}

/**
 * Send desktop notifications for newly found listings.
 *
 * @param {Object[]} items       - New listing items.
 * @param {Object}   settings    - Current app settings.
 * @param {Object[]} searches    - All configured searches (to check per-search notify flag).
 * @param {Electron.BrowserWindow|null} mainWindow
 */
function sendNotifications(items, settings, searches, mainWindow) {
  if (!shouldNotify(settings, mainWindow)) return;

  const notifiable = filterNotifiable(items, settings, searches);
  if (notifiable.length === 0) return;

  showNotification(buildNotificationContent(notifiable), settings, () =>
    focusAndScrollTo(
      notifiable.map((item) => item.id),
      mainWindow,
    ),
  );
  maybePlayCustomSound(settings, mainWindow);
}

module.exports = {
  sendNotifications,
  shouldNotify,
  filterNotifiable,
  buildNotificationContent,
};
