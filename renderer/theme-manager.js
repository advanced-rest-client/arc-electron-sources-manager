const {ipcRenderer: ipc} = require('electron');
const log = require('electron-log');
/**
 * Theme manager class for renderer process.
 *
 * It listens for web and ipc events to manage themes.
 */
class ThemeManager {
  constructor() {
    this._listThemesHandler = this._listThemesHandler.bind(this);
    this._activeThemeHandler = this._activeThemeHandler.bind(this);
    this._activateHandler = this._activateHandler.bind(this);
    this._errorHandler = this._errorHandler.bind(this);
    this._ipcThemesListHandler = this._ipcThemesListHandler.bind(this);
    this._ipcInfoHandler = this._ipcInfoHandler.bind(this);
    this._ipcActivatedHandler = this._ipcActivatedHandler.bind(this);
    this._promises = {};
    this._lastId = 0;
  }
  /**
   * Listens for the ipc events to suppot theme changes
   */
  listen() {
    window.addEventListener('themes-list', this._listThemesHandler);
    window.addEventListener('theme-active-info', this._activeThemeHandler);
    window.addEventListener('theme-activate', this._activateHandler);
    ipc.on('theme-manager-error', this._errorHandler);
    ipc.on('theme-manager-themes-list', this._ipcThemesListHandler);
    ipc.on('theme-manager-active-theme-info', this._ipcInfoHandler);
    ipc.on('theme-manager-theme-activated', this._ipcActivatedHandler);
  }
  /**
   * Removes event listeners
   */
  unlisten() {
    window.removeEventListener('themes-list', this._listThemesHandler);
    window.removeEventListener('theme-active-info', this._activeThemeHandler);
    window.removeEventListener('theme-activate', this._activateHandler);
    ipc.removeListener('theme-manager-error', this._errorHandler);
    ipc.removeListener('theme-manager-themes-list', this._ipcThemesListHandler);
    ipc.removeListener('theme-manager-active-theme-info', this._ipcInfoHandler);
    ipc.removeListener('theme-manager-theme-activated', this._ipcActivatedHandler);
  }
  /**
   * Handler for the `themes-list` custom event from theme panel.
   *
   * @param {CustomEvent} e
   */
  _listThemesHandler(e) {
    e.preventDefault();
    e.detail.result = this.listThemes();
  }
  /**
   * Lists installed themes in the application.
   * @return {Promise<Array>} A promise resolved to the theme info array
   */
  listThemes() {
    const id = (++this._lastId);
    ipc.send('theme-manager-list-themes', id);
    return new Promise((resolve, reject) => {
      this._promises[id] = {resolve, reject};
    });
  }
  /**
   * Handler for the `theme-active-info` custom event from theme panel.
   *
   * @param {CustomEvent} e
   */
  _activeThemeHandler(e) {
    e.preventDefault();
    e.detail.result = this.readActiveThemeInfo();
  }
  /**
   * Reads information about current theme.
   * @return {Promise<Object>} A promise resolved to the theme info
   */
  readActiveThemeInfo() {
    const id = (++this._lastId);
    ipc.send('theme-manager-active-theme-info', id);
    return new Promise((resolve, reject) => {
      this._promises[id] = {resolve, reject};
    });
  }

  /**
   * Activates the theme selected by the user.
   *
   * @param {CustomEvent} e
   */
  _activateHandler(e) {
    e.preventDefault();
    const id = e.detail.theme;
    e.detail.result = this.activate(id);
  }
  /**
   * Activates the theme. It stores theme id in user preferences and loads the
   * theme.
   * @param {String} id Theme ID to activate
   * @return {Promise} Promise resolved when theme is avtivated
   */
  activate(id) {
    const requestid = (++this._lastId);
    ipc.send('theme-manager-activate-theme', requestid, id);
    return new Promise((resolve, reject) => {
      this._promises[id] = {resolve, reject};
    });
  }
  /**
   * Loads theme file and activates it.
   * @param {String} themeId ID of installed theme of location of theme file.
   * @return {Promise}
   */
  loadTheme(themeId) {
    return new Promise((resolve) => {
      // Apparently Polymer handles imports with `<custom-styles>`
      // automatically and inserts it into the head section
      const nodes = document.head.children;
      let removeNextCustomStyle = false;
      for (let i = 0, len = nodes.length; i < len; i++) {
        const node = nodes[i];
        if (node.nodeName === 'LINK' && node.rel === 'import' &&
          node.href && node.href.indexOf('themes:') === 0) {
          removeNextCustomStyle = true;
          continue;
        }
        if (removeNextCustomStyle && node.nodeName === 'CUSTOM-STYLE') {
          node.parentNode.removeChild(node);
          break;
        }
      }
      Polymer.importHref('themes://' + themeId, () => {
        Polymer.RenderStatus.afterNextRender(this, () => {
          Polymer.updateStyles({});
          resolve();
        });
      }, () => {
        console.error(`Unable to load theme definition for ${themeId}.`);
        resolve();
      }, true);
    });
  }
  /**
   * Gets and removes promise from the pending list.
   * @param {String} id Request ID.
   * @return {Object|undefined}
   */
  _getPromise(id) {
    const p = this._promises[id];
    if (!p) {
      return;
    }
    delete this._promises[id];
    return p;
  }
  /**
   * Handler for the error message from the main IPC.
   * @param {Object} e
   * @param {String} id Request id
   * @param {Object} cause Error object with "message".
   */
  _errorHandler(e, id, cause) {
    const p = this._getPromise(id);
    if (!p) {
      log.error(cause);
      return;
    }
    p.reject(cause);
  }
  /**
   * Handler for `theme-manager-themes-list` event from the main IPC.
   * @param {Object} e
   * @param {String} id Request id
   * @param {Array<Object>} list List of installed themes
   */
  _ipcThemesListHandler(e, id, list) {
    const p = this._getPromise(id);
    if (!p) {
      log.error(`ThemeManager: Pending request ${id} do not exist.`);
      return;
    }
    p.resolve(list);
  }
  /**
   * Handler for `theme-manager-active-theme-info` event from the main IPC.
   * @param {Object} e
   * @param {String} id Request id
   * @param {Object} info Theme meta data
   */
  _ipcInfoHandler(e, id, info) {
    const p = this._getPromise(id);
    if (!p) {
      log.error(`ThemeManager: Pending request ${id} do not exist.`);
      return;
    }
    p.resolve(info);
  }
  /**
   * Handler for `theme-manager-theme-activated` event from the main IPC.
   * @param {Object} e
   * @param {String} id Request id
   * @param {Object} appPaths Updated application base paths. Additionally this
   * object contains `reload` property. It it's true then the app has to be
   * reloaded to activate the theme.
   */
  _ipcActivatedHandler(e, id, appPaths) {
    const p = this._getPromise(id);
    if (!p) {
      log.error(`ThemeManager: Pending request ${id} do not exist.`);
      return;
    }
    if (appPaths.reload) {
      this.requireReload();
    } else {
      this.loadTheme(appPaths.themeFile);
    }
  }
  /**
   * Dispatches `reload-app-required` event to the main process.
   */
  requireReload() {
    const message = 'Theme change requires application reload.';
    ipc.send('reload-app-required', message);
  }
}
module.exports.ThemeManager = ThemeManager;
