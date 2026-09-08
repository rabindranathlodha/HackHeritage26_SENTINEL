// A minimal Chrome DevTools Protocol client.
//
// Chrome speaks CDP over one WebSocket and Node has had a WebSocket client
// since 22, so driving a real browser needs no dependency beyond launching one.
// Shared by the acceptance scripts so there is one implementation to fix.

import { launch } from "chrome-launcher";

export class CDP {
  #ws;
  #id = 0;
  #pending = new Map();

  static async attach(port, url) {
    const res = await fetch(
      `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`,
      { method: "PUT" },
    );
    const target = await res.json();
    const client = new CDP();
    await client.#connect(target.webSocketDebuggerUrl);
    return client;
  }

  #connect(wsUrl) {
    this.#ws = new WebSocket(wsUrl);
    this.#ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const resolver = this.#pending.get(message.id);
      if (!resolver) return;
      this.#pending.delete(message.id);
      if (message.error) {
        resolver.reject(new Error(message.error.message));
      } else {
        resolver.resolve(message.result);
      }
    });
    return new Promise((resolve, reject) => {
      this.#ws.addEventListener("open", resolve, { once: true });
      this.#ws.addEventListener("error", reject, { once: true });
    });
  }

  send(method, params = {}) {
    const id = ++this.#id;
    this.#ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) =>
      this.#pending.set(id, { resolve, reject }),
    );
  }

  /** Evaluate in the page and return the JSON value, not a remote handle. */
  async evaluate(expression) {
    const { result, exceptionDetails } = await this.send("Runtime.evaluate", {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description ?? "evaluate failed");
    }
    return result.value;
  }

  close() {
    this.#ws.close();
  }
}

export async function launchChrome() {
  return launch({ chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"] });
}

export async function killChrome(chrome) {
  try {
    // chrome-launcher's temp-dir cleanup throws EPERM on Windows after the
    // browser has exited, and it throws SYNCHRONOUSLY — a .catch() on the
    // returned promise never sees it. Cleanup must not fail a passing run.
    await chrome.kill();
  } catch (error) {
    if (error?.code !== "EPERM") throw error;
  }
}

export function reporter() {
  const checks = [];
  return {
    checks,
    record(name, pass, detail) {
      checks.push({ name, pass, detail });
      console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
    },
    finish() {
      const failed = checks.filter((c) => !c.pass);
      console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
      if (failed.length) {
        console.log(`FAILED: ${failed.map((c) => c.name).join(", ")}`);
        process.exit(1);
      }
    },
  };
}
