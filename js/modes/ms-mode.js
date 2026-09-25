"use strict";

/*
 * MS Login / MS accounting mode definition.
 * MS-specific UI/PDF behavior is selected through currentMode === "MS".
 */
const MS_MODE_CONFIG = Object.freeze({
  parent: "MS",
  child: "VO",
  parentPlural: "MS",
  childPlural: "VO",
  storageKey: "ms_shg_accounting_v18"
});
