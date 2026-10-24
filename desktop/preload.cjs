// Minimal, explicit bridge between the desktop shell and the web app.
// Only two capabilities are exposed: opening https links in the user's browser
// (used for Google sign-in) and receiving partyup:// sign-in callbacks.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('partyupDesktop', {
  platform: process.platform,
  openExternal: (url) => ipcRenderer.invoke('partyup:open-external', String(url)),
  onAuthCallback: (handler) => {
    const listener = (_event, url) => handler(url);
    ipcRenderer.on('partyup:auth-callback', listener);
    // Deliver a callback that arrived before the page was ready (app launched by the link).
    ipcRenderer.invoke('partyup:take-pending-callback').then((url) => { if (url) handler(url); });
    return () => ipcRenderer.removeListener('partyup:auth-callback', listener);
  },
});
