import { describe, it, expect, afterEach } from "vitest";
import { getTelegramWebApp, type TelegramWebApp } from "./telegram";

function setWebApp(wa: unknown) {
  (window as unknown as { Telegram?: { WebApp?: unknown } }).Telegram = {
    WebApp: wa,
  };
}

function clearWebApp() {
  delete (window as unknown as { Telegram?: unknown }).Telegram;
}

describe("getTelegramWebApp", () => {
  afterEach(() => {
    clearWebApp();
  });

  it("returns null when Telegram is not on window", () => {
    expect(getTelegramWebApp()).toBeNull();
  });

  it("returns null when WebApp is present but initData is empty and no user", () => {
    setWebApp({ initData: "", initDataUnsafe: {} });
    expect(getTelegramWebApp()).toBeNull();
  });

  it("returns the WebApp when initData is non-empty", () => {
    const wa = {
      initData: "user=%7B%22id%22%3A1%7D&hash=abc",
      initDataUnsafe: {},
    } as unknown as TelegramWebApp;
    setWebApp(wa);
    expect(getTelegramWebApp()).toBe(wa);
  });

  it("returns the WebApp when a user is present even without raw initData", () => {
    const wa = {
      initData: "",
      initDataUnsafe: { user: { id: 1, first_name: "x" } },
    } as unknown as TelegramWebApp;
    setWebApp(wa);
    expect(getTelegramWebApp()).toBe(wa);
  });
});
