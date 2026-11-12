// Decides where a set of notes is processed and explains why, in plain words.
// Pure function, tested in test/route.test.js.

/** Words Gemini Nano reads comfortably in one call (prompt + notes + JSON answer). */
export const LOCAL_WORD_LIMIT = 900;
/** Chunk size when long notes must stay on the device. */
export const LOCAL_CHUNK_WORDS = 700;

const fmt = (n) => n.toLocaleString("en-US");

/**
 * @param {object} p
 * @param {"private"|"auto"|"cloud"} p.mode   what the user picked
 * @param {number} p.words                    length of the notes
 * @param {string} p.device                   LanguageModel.availability(): "available", "downloadable", ...
 * @param {boolean} p.online                  navigator.onLine
 * @param {boolean} p.cloudConfigured         Firebase config present
 * @param {boolean} p.mask                    user wants masking before the cloud (Cloud mode only; Auto always masks)
 * @returns {{engine: "device"|"device-chunks"|"cloud"|null, mask: boolean, findNamesOnDevice: boolean, reason: string}}
 */
export function planRoute({ mode, words, device, online, cloudConfigured, mask = true }) {
  const local = device === "available";
  const long = words > LOCAL_WORD_LIMIT;
  const onDevice = (why) => ({
    engine: long ? "device-chunks" : "device",
    mask: false,
    findNamesOnDevice: false,
    reason: long
      ? `${why} ${fmt(words)} words is more than the local model reads at once, so the notes are read in parts on this device.`
      : `${why} Nothing leaves this computer.`,
  });
  const fail = (reason) => ({ engine: null, mask: false, findNamesOnDevice: false, reason });

  if (mode === "private") {
    if (!local) return fail("Private mode needs the on-device model, and it is not ready on this computer.");
    return onDevice("Private mode.");
  }

  if (mode === "cloud") {
    if (!online) return fail("You are offline, and Cloud mode needs the network. Switch to Auto or Private.");
    if (!cloudConfigured) return fail("Cloud mode needs a Firebase config.");
    return {
      engine: "cloud",
      mask,
      findNamesOnDevice: mask && local,
      reason: mask
        ? `Cloud mode. Sensitive values are masked on this computer first${local ? " (names found by the local model, the rest by rules)" : " (by rules: e-mails, phone numbers, amounts, links)"}.`
        : "Cloud mode, masking turned off: the notes are sent as they are.",
    };
  }

  // Auto
  if (!online) {
    if (local) return onDevice("You are offline, so the local model does the work.");
    return fail("You are offline and this computer cannot run the local model.");
  }
  if (local && !long) return onDevice("Short notes and the local model is ready.");
  if (!cloudConfigured) {
    if (local) return onDevice("Cloud is not configured.");
    return fail("This computer cannot run the local model and the cloud is not configured.");
  }
  if (local) {
    return {
      engine: "cloud",
      mask: true,
      findNamesOnDevice: true,
      reason: `${fmt(words)} words is more than the local model reads at once (${fmt(LOCAL_WORD_LIMIT)}). The local model found the names, they were masked on this computer, then the masked notes went to the cloud.`,
    };
  }
  return {
    engine: "cloud",
    mask: true,
    findNamesOnDevice: false,
    reason:
      "This computer cannot run the local model. E-mails, phone numbers, amounts and links were masked on this computer, then the notes went to the cloud. Names stay visible: add them to the masking list to hide them.",
  };
}
