const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function findAppInDir(dir) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const app = entries.find((e) => e.isDirectory() && e.name.endsWith(".app"));
    return app ? path.join(dir, app.name) : null;
  } catch {
    return null;
  }
}

module.exports = async function notarizeAfterSign(context) {
  if (context.electronPlatformName !== "darwin") return;

  const isCi = Boolean(process.env.GITHUB_ACTIONS || process.env.CI);
  if (!isCi) return;

  const appleId = (process.env.APPLE_ID || "").trim();
  const appleIdPassword = (process.env.APPLE_APP_SPECIFIC_PASSWORD || "").trim();
  const teamId = (process.env.APPLE_TEAM_ID || "").trim();
  if (!appleId || !appleIdPassword || !teamId) {
    console.log(
      "[notarize] Skipped (missing APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID).",
    );
    return;
  }

  const appPath = findAppInDir(context.appOutDir);
  if (!appPath) {
    throw new Error(`[notarize] No .app found under ${context.appOutDir}`);
  }

  const zipPath = path.join(
    os.tmpdir(),
    `notarize-${path.basename(appPath, ".app")}-${Date.now()}.zip`,
  );

  try {
    console.log(`[notarize] Zipping app for submission: ${zipPath}`);
    await run("ditto", ["-c", "-k", "--keepParent", appPath, zipPath]);

    console.log("[notarize] Submitting to Apple notary service...");
    await run("xcrun", [
      "notarytool",
      "submit",
      zipPath,
      "--apple-id",
      appleId,
      "--password",
      appleIdPassword,
      "--team-id",
      teamId,
      "--wait",
    ]);

    console.log("[notarize] Stapling ticket...");
    await run("xcrun", ["stapler", "staple", "-v", appPath]);
    await run("xcrun", ["stapler", "validate", "-v", appPath]);
  } finally {
    try {
      fs.rmSync(zipPath, { force: true });
    } catch {
      // ignore cleanup errors
    }
  }
};
