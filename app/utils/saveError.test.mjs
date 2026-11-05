// Run: node app/utils/saveError.test.mjs
import assert from "node:assert/strict";
import { describeWriteFailure } from "./saveError.ts";

const failure = (name) => new DOMException("raw browser text", name);

// A locked file: the browser's error name varies, so each one gets the same advice.
for (const name of ["NoModificationAllowedError", "InvalidStateError", "NotReadableError", "AbortError"]) {
  const { text, hint } = describeWriteFailure("plan.pdf", failure(name));
  assert.match(text, /plan\.pdf/);
  assert.match(text, /open in another program/);
  assert.match(hint, /Foxit/);
}
assert.match(describeWriteFailure("plan.pdf", "not an error").text, /open in another program/);

// Causes we can name don't blame another program.
assert.match(describeWriteFailure("plan.pdf", failure("NotFoundError")).hint, /moved or deleted/);
assert.match(describeWriteFailure("plan.pdf", failure("QuotaExceededError")).text, /disk space/);

// The browser's wording never reaches the user.
for (const name of ["NoModificationAllowedError", "NotFoundError", "QuotaExceededError"]) {
  const { text, hint } = describeWriteFailure("plan.pdf", failure(name));
  assert.doesNotMatch(`${text} ${hint}`, /raw browser text/);
}
