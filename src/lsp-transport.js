import { Buffer } from "node:buffer";

// The base protocol of the Language Server Protocol: each message is a
// JSON-RPC object in UTF-8, after a `Content-Length` header giving its size
// in bytes and a blank line.

const HEADER_END = Buffer.from("\r\n\r\n", "ascii");
const CONTENT_LENGTH = /^content-length:[ \t]*(\d+)[ \t]*$/im;

export function encodeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]);
}

// A function to call with each chunk of input as it arrives. It calls
// onMessage with each whole message the chunks complete, and onProblem with
// a description of a header or body it cannot read, which it skips.
export function messageReader(onMessage, onProblem) {
  let pending = Buffer.alloc(0);
  return (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    for (let headerEnd = pending.indexOf(HEADER_END); headerEnd !== -1; headerEnd = pending.indexOf(HEADER_END)) {
      const header = pending.subarray(0, headerEnd).toString("ascii");
      const length = CONTENT_LENGTH.exec(header);
      const bodyStart = headerEnd + HEADER_END.length;
      if (length === null) {
        pending = pending.subarray(bodyStart);
        onProblem(`Skipped a message header with no Content-Length: ${JSON.stringify(header)}`);
        continue;
      }
      const bodyEnd = bodyStart + Number(length[1]);
      if (pending.length < bodyEnd) {
        return;
      }
      const body = pending.subarray(bodyStart, bodyEnd).toString("utf8");
      pending = pending.subarray(bodyEnd);
      let message;
      try {
        message = JSON.parse(body);
      } catch (error) {
        onProblem(`Skipped a message that is not JSON: ${error.message}`);
        continue;
      }
      onMessage(message);
    }
  };
}
