const fs = require("fs");
const path = require("path");
const readline = require("readline");

const execDir = path.dirname(process.execPath);
const configPath = process.pkg
  ? path.join(execDir, "config.json")
  : path.join(__dirname, "config.json");

function isInteractive() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function loadConfig() {
  if (!fs.existsSync(configPath)) return null;
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    console.warn(`[CONFIG] Failed to read ${configPath}: ${error.message}`);
    return null;
  }
}

function saveConfig(config) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(`[CONFIG] Saved ${configPath}`);
  } catch (error) {
    console.warn(`[CONFIG] Failed to save ${configPath}: ${error.message}`);
  }
}

function parsePort(value, fallback) {
  const port = Number(value);
  if (Number.isInteger(port) && port > 0 && port < 65536) return port;
  return fallback;
}

function normalizeMdnsInput(value) {
  const trimmed = String(value).trim();
  if (!trimmed) return "intercom.local";
  const lowered = trimmed.toLowerCase();
  if (["off", "false", "no", "none", "disable", "disabled"].includes(lowered)) {
    return "off";
  }
  return trimmed;
}

async function runWizard() {
  console.log("\nTalk To Me - first-time setup\n");
  console.log(`Hint: delete ${configPath} to run this setup again.\n`);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question) =>
    new Promise((resolve) => rl.question(question, (answer) => resolve(answer)));

  try {
    const httpsPortInput = await ask("HTTPS port [press Enter to use default 443]: ");
    const mdnsInput = await ask("mDNS name [press Enter to use default intercom.local, use 'off' to disable]: ");

    const httpsPort = parsePort(httpsPortInput.trim() || "443", 443);
    const mdnsHost = normalizeMdnsInput(mdnsInput);

    const config = {
      httpsPort,
      mdnsHost,
    };

    saveConfig(config);
    return config;
  } finally {
    rl.close();
  }
}

function shouldRunWizard(config) {
  if (process.env.TALKTOME_NO_WIZARD === "1") return false;
  if (process.env.TALKTOME_WIZARD === "1") return true;
  if (config) return false;
  if (!isInteractive()) return false;

  const hasEnvConfig = Boolean(
    process.env.PORT ||
      process.env.HTTPS_PORT ||
      process.env.MDNS_HOST ||
      process.env.MDNS_NAME ||
      process.env.INTERCOM_HOSTNAME
  );
  return !hasEnvConfig;
}

function applyConfig(config) {
  if (!config) return;
  if (!process.env.PORT && !process.env.HTTPS_PORT && config.httpsPort) {
    process.env.HTTPS_PORT = String(config.httpsPort);
  }
  if (
    !process.env.MDNS_HOST &&
    !process.env.MDNS_NAME &&
    !process.env.INTERCOM_HOSTNAME &&
    config.mdnsHost
  ) {
    process.env.MDNS_HOST = config.mdnsHost;
  }
}

(async () => {
  const existingConfig = loadConfig();
  const config = shouldRunWizard(existingConfig)
    ? await runWizard()
    : existingConfig;

  applyConfig(config);
  require("./serverCore");
})().catch((error) => {
  console.error(`[BOOT] ${error.stack || error.message}`);
  process.exit(1);
});
