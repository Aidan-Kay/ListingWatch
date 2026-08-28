"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { withRetry, isTransientError, isNoInternetError } = require("../src/main/shared/retry");

/** An error carrying whatever fields the classifier looks at. */
function errorWith(fields) {
  return Object.assign(new Error(fields.message || "boom"), fields);
}

/** Silence withRetry's per-attempt warnings for the duration of a test. */
async function quietly(fn) {
  const original = console.warn;
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.warn = original;
  }
}

test("a successful call is not retried", async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls++;
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(calls, 1);
});

test("a transient failure is retried up to the limit, then rethrown", async () => {
  let calls = 0;
  await assert.rejects(
    quietly(() =>
      withRetry(
        async () => {
          calls++;
          throw errorWith({ code: "ECONNRESET" });
        },
        { retries: 2, baseDelay: 1 },
      ),
    ),
    /boom/,
  );
  assert.equal(calls, 3, "total calls should be retries + 1");
});

test("a retry that succeeds returns its value", async () => {
  let calls = 0;
  const result = await quietly(() =>
    withRetry(
      async () => {
        calls++;
        if (calls < 3) throw errorWith({ code: "ETIMEDOUT" });
        return "recovered";
      },
      { retries: 3, baseDelay: 1 },
    ),
  );
  assert.equal(result, "recovered");
  assert.equal(calls, 3);
});

test("backoff doubles between attempts", async () => {
  const delays = [];
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (fn, ms) => {
    delays.push(ms);
    return realSetTimeout(fn, 0);
  };
  try {
    await assert.rejects(
      quietly(() =>
        withRetry(async () => { throw errorWith({ code: "ECONNRESET" }); }, { retries: 3, baseDelay: 100 }),
      ),
    );
  } finally {
    global.setTimeout = realSetTimeout;
  }
  assert.deepEqual(delays, [100, 200, 400]);
});

test("a non-transient error throws immediately without sleeping", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw new TypeError("Cannot read properties of undefined");
      },
      { retries: 3, baseDelay: 10_000 },
    ),
    /Cannot read properties/,
  );
  assert.equal(calls, 1, "a programming error must not be retried");
});

test("shouldRetry can short-circuit an otherwise transient error", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw errorWith({ code: "ECONNRESET" });
      },
      { retries: 3, baseDelay: 1, shouldRetry: () => false },
    ),
  );
  assert.equal(calls, 1);
});

test("isTransientError covers network, abort, and retryable HTTP statuses", () => {
  assert.ok(isTransientError(errorWith({ code: "ECONNRESET" })));
  assert.ok(isTransientError(errorWith({ code: "UND_ERR_CONNECT_TIMEOUT" })));
  assert.ok(isTransientError(errorWith({ name: "AbortError" })));
  assert.ok(isTransientError(errorWith({ status: 429 })));
  assert.ok(isTransientError(errorWith({ status: 503 })));
  assert.ok(isTransientError(errorWith({ message: "Render frame was disposed" })));
  assert.ok(isTransientError(new TypeError("Failed to fetch")));
});

test("isTransientError does not treat every TypeError as retryable", () => {
  assert.equal(isTransientError(new TypeError("x.map is not a function")), false);
  assert.equal(isTransientError(errorWith({ status: 404 })), false);
});

test("a connectivity failure is not transient — the poll interval is the retry", () => {
  for (const code of ["ENOTFOUND", "ENETUNREACH", "EAI_AGAIN", "ENETDOWN", "EHOSTUNREACH"]) {
    const err = errorWith({ code });
    assert.ok(isNoInternetError(err), `${code} should read as no-internet`);
    assert.equal(isTransientError(err), false, `${code} should not also be retried inside withRetry`);
  }
});

test("a no-internet error is thrown on the first attempt", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw errorWith({ code: "ENOTFOUND" });
      },
      { retries: 3, baseDelay: 10_000 },
    ),
  );
  assert.equal(calls, 1);
});
