// Run by the otherLivePid test in test/helpers.test.js. It starts the
// sleeper and waits past its first check with the event loop running, so a
// sleeper that has already exited is reaped. Then it writes the sleeper's
// pid, and whether it still runs, to the file named by its argument, and
// kills itself, as bun test ends without running exit handlers.
import fs from "node:fs";
import { otherLivePid, processRunning } from "../helpers.js";

const pid = otherLivePid();
setTimeout(() => {
  fs.writeFileSync(process.argv[2], JSON.stringify({ pid, running: processRunning(pid) }), { flag: "wx" });
  process.kill(process.pid, "SIGKILL");
}, 1500);
