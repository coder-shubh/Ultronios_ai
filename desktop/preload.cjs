const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('ultroniosDesktop', {
  /** Reserved for future native features (file pickers, tray, etc.) */
  version: '1.0.0',
});
