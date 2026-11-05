/**
 * Plain-language wording for a failed write to a file on disk. Browsers don't report "open
 * in another program" as its own error, so that is the answer for anything not named here.
 */
export function describeWriteFailure(
  fileName: string,
  error: unknown,
): { text: string; hint: string } {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotFoundError") {
    return {
      text: `Couldn't find ${fileName}.`,
      hint: "It may have been moved or deleted. Use Save as to choose where to save it.",
    };
  }
  if (name === "QuotaExceededError") {
    return {
      text: `Not enough disk space to save ${fileName}.`,
      hint: "Free up some space and save again, or use Save as to save it somewhere else.",
    };
  }
  return {
    text: `Couldn't save ${fileName}. It may be open in another program.`,
    hint: "Close it there (like Foxit or Acrobat) and save again, or use Save as to make a copy.",
  };
}
