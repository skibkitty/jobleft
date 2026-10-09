// Strips the launch token out of anything QA prints, so a failing scenario's output can be echoed
// into a CI log without handing out full access to the loopback API. Usage: redact(text).
const URL_TOKEN = /#token=[^\s"'&)]+/g;
// Too short to match on: replacing a 1-3 character value would mangle unrelated output.
const MIN_TOKEN_LENGTH = 8;

export function redact(text) {
  if (typeof text !== "string" || text === "") return text;
  let out = text.replace(URL_TOKEN, "#token=<REDACTED>");
  const token = process.env.JOBLEFT_QA_TOKEN ?? "";
  if (token.length >= MIN_TOKEN_LENGTH) out = out.split(token).join("<REDACTED>");
  return out;
}