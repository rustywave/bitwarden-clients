import { MessagingService } from "@bitwarden/common/abstractions/messaging.service";
import { PlatformUtilsService } from "@bitwarden/common/abstractions/platformUtils.service";
import { ClientType } from "@bitwarden/common/enums/clientType";
import { DeviceType } from "@bitwarden/common/enums/deviceType";

import { BrowserApi } from "../browser/browserApi";
import { SafariApp } from "../browser/safariApp";
import { StateService } from "../services/abstractions/state.service";

const DialogPromiseExpiration = 600000; // 10 minutes

export default class BrowserPlatformUtilsService implements PlatformUtilsService {
  private showDialogResolves = new Map<number, { resolve: (value: boolean) => void; date: Date }>();
  private passwordDialogResolves = new Map<
    number,
    { tryResolve: (canceled: boolean, password: string) => Promise<boolean>; date: Date }
  >();
  private deviceCache: DeviceType = null;

  constructor(
    private messagingService: MessagingService,
    private stateService: StateService,
    private clipboardWriteCallback: (clipboardValue: string, clearMs: number) => void,
    private biometricCallback: () => Promise<boolean>
  ) {}

  getDevice(): DeviceType {
    if (this.deviceCache) {
      return this.deviceCache;
    }

    if (
      navigator.userAgent.indexOf(" Firefox/") !== -1 ||
      navigator.userAgent.indexOf(" Gecko/") !== -1
    ) {
      this.deviceCache = DeviceType.FirefoxExtension;
    } else if (
      (!!(window as any).opr && !!opr.addons) ||
      !!(window as any).opera ||
      navigator.userAgent.indexOf(" OPR/") >= 0
    ) {
      this.deviceCache = DeviceType.OperaExtension;
    } else if (navigator.userAgent.indexOf(" Edg/") !== -1) {
      this.deviceCache = DeviceType.EdgeExtension;
    } else if (navigator.userAgent.indexOf(" Vivaldi/") !== -1) {
      this.deviceCache = DeviceType.VivaldiExtension;
    } else if ((window as any).chrome && navigator.userAgent.indexOf(" Chrome/") !== -1) {
      this.deviceCache = DeviceType.ChromeExtension;
    } else if (navigator.userAgent.indexOf(" Safari/") !== -1) {
      this.deviceCache = DeviceType.SafariExtension;
    }

    return this.deviceCache;
  }

  getDeviceString(): string {
    const device = DeviceType[this.getDevice()].toLowerCase();
    return device.replace("extension", "");
  }

  getClientType(): ClientType {
    return ClientType.Browser;
  }

  isFirefox(): boolean {
    return this.getDevice() === DeviceType.FirefoxExtension;
  }

  isChrome(): boolean {
    return this.getDevice() === DeviceType.ChromeExtension;
  }

  isEdge(): boolean {
    return this.getDevice() === DeviceType.EdgeExtension;
  }

  isOpera(): boolean {
    return this.getDevice() === DeviceType.OperaExtension;
  }

  isVivaldi(): boolean {
    return this.getDevice() === DeviceType.VivaldiExtension;
  }

  isSafari(): boolean {
    return this.getDevice() === DeviceType.SafariExtension;
  }

  isIE(): boolean {
    return false;
  }

  isMacAppStore(): boolean {
    return false;
  }

  async isViewOpen(): Promise<boolean> {
    if (await BrowserApi.isPopupOpen()) {
      return true;
    }

    if (this.isSafari()) {
      return false;
    }

    const sidebarView = this.sidebarViewName();
    const sidebarOpen =
      sidebarView != null && chrome.extension.getViews({ type: sidebarView }).length > 0;
    if (sidebarOpen) {
      return true;
    }

    const tabOpen = chrome.extension.getViews({ type: "tab" }).length > 0;
    return tabOpen;
  }

  lockTimeout(): number {
    return null;
  }

  launchUri(uri: string, options?: any): void {
    BrowserApi.createNewTab(uri, options && options.extensionPage === true);
  }

  getApplicationVersion(): Promise<string> {
    return Promise.resolve(BrowserApi.getApplicationVersion());
  }

  supportsWebAuthn(win: Window): boolean {
    return typeof PublicKeyCredential !== "undefined";
  }

  supportsDuo(): boolean {
    return true;
  }

  showToast(
    type: "error" | "success" | "warning" | "info",
    title: string,
    text: string | string[],
    options?: any
  ): void {
    this.messagingService.send("showToast", {
      text: text,
      title: title,
      type: type,
      options: options,
    });
  }

  showDialog(
    body: string,
    title?: string,
    confirmText?: string,
    cancelText?: string,
    type?: string,
    bodyIsHtml = false
  ) {
    const dialogId = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    this.messagingService.send("showDialog", {
      text: bodyIsHtml ? null : body,
      html: bodyIsHtml ? body : null,
      title: title,
      confirmText: confirmText,
      cancelText: cancelText,
      type: type,
      dialogId: dialogId,
    });
    return new Promise<boolean>((resolve) => {
      this.showDialogResolves.set(dialogId, { resolve: resolve, date: new Date() });
    });
  }

  isDev(): boolean {
    return process.env.ENV === "development";
  }

  isSelfHost(): boolean {
    return false;
  }

  copyToClipboard(text: string, options?: any): void {
    let win = window;
    let doc = window.document;
    if (options && (options.window || options.win)) {
      win = options.window || options.win;
      doc = win.document;
    } else if (options && options.doc) {
      doc = options.doc;
    }
    const clearing = options ? !!options.clearing : false;
    const clearMs: number = options && options.clearMs ? options.clearMs : null;

    if (this.isSafari()) {
      SafariApp.sendMessageToApp("copyToClipboard", text).then(() => {
        if (!clearing && this.clipboardWriteCallback != null) {
          this.clipboardWriteCallback(text, clearMs);
        }
      });
    } else if (
      this.isFirefox() &&
      (win as any).navigator.clipboard &&
      (win as any).navigator.clipboard.writeText
    ) {
      (win as any).navigator.clipboard.writeText(text).then(() => {
        if (!clearing && this.clipboardWriteCallback != null) {
          this.clipboardWriteCallback(text, clearMs);
        }
      });
    } else if ((win as any).clipboardData && (win as any).clipboardData.setData) {
      // IE specific code path to prevent textarea being shown while dialog is visible.
      (win as any).clipboardData.setData("Text", text);
      if (!clearing && this.clipboardWriteCallback != null) {
        this.clipboardWriteCallback(text, clearMs);
      }
    } else if (doc.queryCommandSupported && doc.queryCommandSupported("copy")) {
      if (this.isChrome() && text === "") {
        text = "\u0000";
      }

      const textarea = doc.createElement("textarea");
      textarea.textContent = text == null || text === "" ? " " : text;
      // Prevent scrolling to bottom of page in MS Edge.
      textarea.style.position = "fixed";
      doc.body.appendChild(textarea);
      textarea.select();

      try {
        // Security exception may be thrown by some browsers.
        if (doc.execCommand("copy") && !clearing && this.clipboardWriteCallback != null) {
          this.clipboardWriteCallback(text, clearMs);
        }
      } catch (e) {
        // eslint-disable-next-line
        console.warn("Copy to clipboard failed.", e);
      } finally {
        doc.body.removeChild(textarea);
      }
    }
  }

  async readFromClipboard(options?: any): Promise<string> {
    let win = window;
    let doc = window.document;
    if (options && (options.window || options.win)) {
      win = options.window || options.win;
      doc = win.document;
    } else if (options && options.doc) {
      doc = options.doc;
    }

    if (this.isSafari()) {
      return await SafariApp.sendMessageToApp("readFromClipboard");
    } else if (
      this.isFirefox() &&
      (win as any).navigator.clipboard &&
      (win as any).navigator.clipboard.readText
    ) {
      return await (win as any).navigator.clipboard.readText();
    } else if (doc.queryCommandSupported && doc.queryCommandSupported("paste")) {
      const textarea = doc.createElement("textarea");
      // Prevent scrolling to bottom of page in MS Edge.
      textarea.style.position = "fixed";
      doc.body.appendChild(textarea);
      textarea.focus();
      try {
        // Security exception may be thrown by some browsers.
        if (doc.execCommand("paste")) {
          return textarea.value;
        }
      } catch (e) {
        // eslint-disable-next-line
        console.warn("Read from clipboard failed.", e);
      } finally {
        doc.body.removeChild(textarea);
      }
    }
    return null;
  }

  resolveDialogPromise(dialogId: number, confirmed: boolean) {
    if (this.showDialogResolves.has(dialogId)) {
      const resolveObj = this.showDialogResolves.get(dialogId);
      resolveObj.resolve(confirmed);
      this.showDialogResolves.delete(dialogId);
    }

    // Clean up old promises
    this.showDialogResolves.forEach((val, key) => {
      const age = new Date().getTime() - val.date.getTime();
      if (age > DialogPromiseExpiration) {
        this.showDialogResolves.delete(key);
      }
    });
  }

  async resolvePasswordDialogPromise(
    dialogId: number,
    canceled: boolean,
    password: string
  ): Promise<boolean> {
    let result = false;
    if (this.passwordDialogResolves.has(dialogId)) {
      const resolveObj = this.passwordDialogResolves.get(dialogId);
      if (await resolveObj.tryResolve(canceled, password)) {
        this.passwordDialogResolves.delete(dialogId);
        result = true;
      }
    }

    // Clean up old promises
    this.passwordDialogResolves.forEach((val, key) => {
      const age = new Date().getTime() - val.date.getTime();
      if (age > DialogPromiseExpiration) {
        this.passwordDialogResolves.delete(key);
      }
    });

    return result;
  }

  async supportsBiometric() {
    const platformInfo = await BrowserApi.getPlatformInfo();
    if (platformInfo.os === "android") {
      return false;
    }

    if (this.isFirefox()) {
      return parseInt((await browser.runtime.getBrowserInfo()).version.split(".")[0], 10) >= 87;
    }

    return true;
  }

  authenticateBiometric() {
    return this.biometricCallback();
  }

  sidebarViewName(): string {
    if ((window as any).chrome.sidebarAction && this.isFirefox()) {
      return "sidebar";
    } else if (this.isOpera() && typeof opr !== "undefined" && opr.sidebarAction) {
      return "sidebar_panel";
    }

    return null;
  }

  supportsSecureStorage(): boolean {
    return false;
  }
}
