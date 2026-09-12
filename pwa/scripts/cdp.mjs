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

/**
 * True once a screen has finished loading, not merely once the URL changed.
 *
 * loading.tsx introduced a Suspense boundary, so a route can be at its final
 * path while still showing a skeleton. Waiting on the path alone reads the
 * skeleton and reports that a link or a button is missing.
 */
export const settled = (path) =>
  `location.pathname === '${path}' && !document.querySelector('[aria-busy="true"]')`;

/**
 * Liveness gate. Nothing may assert the ABSENCE of something until this passes.
 *
 * The bug this exists for: a queue test reported "no records in the queue"
 * while the page was returning 500. To a selector that counts links, an empty
 * list and a crashed page are the same observation — and between "the feature
 * is empty" and "the server is broken", the comforting reading won. Every
 * negative assertion in this suite has that failure mode, because a page that
 * did not render contains no forbidden string either. A copy guard on a 500 is
 * a guard that reports PASS for a page nobody can read.
 *
 * So it checks two independent things:
 *   - the document's real HTTP status, via PerformanceNavigationTiming, which
 *     is the response status of the actual navigation rather than anything the
 *     page can claim about itself;
 *   - a root element the page only renders on its success path.
 *
 * `responseStatus` is unavailable after a client-side route change, because the
 * navigation entry still describes the original document. That is reported
 * honestly rather than treated as a pass: the root element carries the check,
 * and the detail line says the status could not be read.
 */
export async function assertRendered(cdp, testId) {
  const seen = await cdp.evaluate(`
    const nav = performance.getEntriesByType('navigation')[0];
    const status =
      nav && typeof nav.responseStatus === 'number' && nav.responseStatus > 0
        ? nav.responseStatus
        : null;
    const root = document.querySelector('[data-testid="${testId}"]');
    // Existing in the DOM is not the same as being on screen. innerText
    // reports only LAID-OUT text, so a document that has parsed but not yet
    // had layout run returns a near-empty string — and every "does not
    // contain" assertion downstream passes on it. One suite was reading 42
    // characters of a 1,600-character page and reporting that it contained no
    // forbidden term, which was true and meaningless.
    const box = root?.getBoundingClientRect();
    return {
      status,
      found: Boolean(root),
      height: box ? Math.round(box.height) : 0,
      textLength: document.body.innerText.length,
      path: location.pathname,
      heading: (document.querySelector('h1')?.textContent ?? '').trim().slice(0, 48),
    };
  `);

  const statusOk = seen.status === null || seen.status === 200;
  const laidOut = seen.height > 0;
  const detail = !seen.found
    ? `[data-testid="${testId}"] absent at ${seen.path} (status ${seen.status ?? "unknown"})`
    : !laidOut
      ? `[data-testid="${testId}"] present but has no layout box at ${seen.path}`
      : `${seen.path} ${seen.status ?? "client-nav"} ${seen.textLength}ch${seen.heading ? ` — "${seen.heading}"` : ""}`;

  return { ok: seen.found && statusOk && laidOut, detail, ...seen };
}

/**
 * Records the liveness gate and returns whether it passed.
 *
 * Call this — not assertRendered directly — at the top of any block that goes
 * on to assert an absence, so a dead page fails loudly on its own line instead
 * of silently satisfying every "does not contain" check that follows.
 */
export async function gate(cdp, record, testId, label) {
  const shell = await assertRendered(cdp, testId);
  record(label ?? `${testId} rendered`, shell.ok, shell.detail);
  return shell.ok;
}
