"use strict";

/*
 * VO Login / VO accounting mode definition.
 * No behavior is implemented here; this file only owns VO-specific labels
 * and storage configuration.
 */
const VO_MODE_CONFIG = Object.freeze({
  parent: "VO",
  child: "SHG",
  parentPlural: "VO",
  childPlural: "SHGs",
  storageKey: "vo_shg_accounting_v18"
});
