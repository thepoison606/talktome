const fs = require("fs");
const path = require("path");
const net = require("net");
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

function parseOptionalPort(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = String(value).trim().toLowerCase();
  if (!trimmed || ["false", "off", "no", "none", "disable", "disabled"].includes(trimmed)) {
    return null;
  }

  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }

  return port;
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

function hasEnvConfig() {
  return Boolean(
    process.env.PORT ||
      process.env.HTTPS_PORT ||
      process.env.MDNS_HOST ||
      process.env.MDNS_NAME ||
      process.env.INTERCOM_HOSTNAME ||
      process.env.HTTP_PORT
  );
}

function resolveEffectiveMdnsHost(config) {
  const raw = config?.mdnsHost ?? "intercom.local";
  return normalizeMdnsInput(raw);
}

function resolveEffectiveHttpPort(config, mdnsHost) {
  if (config && Object.prototype.hasOwnProperty.call(config, "httpPort")) {
    return parseOptionalPort(config.httpPort);
  }
  if (mdnsHost && mdnsHost !== "off") {
    return 80;
  }
  return null;
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once("error", () => resolve(false))
      .once("listening", () => {
        tester.close(() => resolve(true));
      })
      .listen(port, "0.0.0.0");
  });
}

async function promptForHttpsPort(rl, defaultValue) {
  while (true) {
    const answer = await new Promise((resolve) =>
      rl.question(`HTTPS port [press Enter to use ${defaultValue}]: `, resolve)
    );
    const port = parsePort(answer.trim() || String(defaultValue), null);
    if (!port) {
      console.log("Invalid HTTPS port. Please enter a number between 1 and 65535.");
      continue;
    }
    const available = await isPortAvailable(port);
    if (!available) {
      console.log(`Port ${port} is already in use or not permitted. Choose another.`);
      continue;
    }
    return port;
  }
}

async function promptForHttpPort(rl, defaultValue, httpsPort) {
  const defaultLabel = defaultValue === null ? "off" : String(defaultValue);
  while (true) {
    const answer = await new Promise((resolve) =>
      rl.question(
        `HTTP redirect port [press Enter for ${defaultLabel}, use 'off' to disable]: `,
        resolve
      )
    );
    const trimmed = answer.trim();
    if (!trimmed) {
      if (defaultValue === null) return "off";
      if (defaultValue === httpsPort) {
        console.log("HTTP redirect port cannot be the same as HTTPS port.");
        continue;
      }
      const available = await isPortAvailable(defaultValue);
      if (!available) {
        console.log(`Port ${defaultValue} is already in use or not permitted. Choose another or use 'off'.`);
        continue;
      }
      return defaultValue;
    }

    if (["off", "false", "no", "none", "disable", "disabled"].includes(trimmed.toLowerCase())) {
      return "off";
    }

    const port = parsePort(trimmed, null);
    if (!port) {
      console.log("Invalid HTTP port. Please enter a number between 1 and 65535, or 'off'.");
      continue;
    }
    if (port === httpsPort) {
      console.log("HTTP redirect port cannot be the same as HTTPS port.");
      continue;
    }
    const available = await isPortAvailable(port);
    if (!available) {
      console.log(`Port ${port} is already in use or not permitted. Choose another or use 'off'.`);
      continue;
    }
    return port;
  }
}

async function runWizard(existingConfig = null) {
  console.log("\nTalk To Me - first-time setup\n");
  console.log(`Hint: delete ${configPath} to run this setup again.\n`);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const defaultHttpsPort = existingConfig?.httpsPort ?? 443;
    const defaultMdnsHost = resolveEffectiveMdnsHost(existingConfig);
    const httpsPort = await promptForHttpsPort(rl, defaultHttpsPort);

    const mdnsInput = await new Promise((resolve) =>
      rl.question(
        `mDNS name [press Enter to use ${defaultMdnsHost}, use 'off' to disable]: `,
        resolve
      )
    );
    const mdnsHost = normalizeMdnsInput(mdnsInput || defaultMdnsHost);

    let httpPort = undefined;
    if (mdnsHost !== "off") {
      const defaultHttpPort = resolveEffectiveHttpPort(existingConfig, mdnsHost);
      const selection = await promptForHttpPort(rl, defaultHttpPort, httpsPort);
      httpPort = selection;
    }

    const config = { httpsPort, mdnsHost };
    if (httpPort !== undefined) {
      config.httpPort = httpPort;
    }

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

  return !hasEnvConfig();
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
  if (!process.env.HTTP_PORT && Object.prototype.hasOwnProperty.call(config, "httpPort")) {
    process.env.HTTP_PORT = String(config.httpPort);
  }
}

(async () => {
  const existingConfig = loadConfig();
  let config = existingConfig;
  if (shouldRunWizard(existingConfig)) {
    config = await runWizard(existingConfig);
  } else if (config && isInteractive() && !hasEnvConfig()) {
    const mdnsHost = resolveEffectiveMdnsHost(config);
    const httpPort = resolveEffectiveHttpPort(config, mdnsHost);
    const httpsPort = config.httpsPort ?? 443;
    const conflicts = [];

    if (!(await isPortAvailable(httpsPort))) {
      conflicts.push(`HTTPS port ${httpsPort}`);
    }
    if (httpPort !== null) {
      if (httpPort === httpsPort) {
        conflicts.push("HTTP redirect port matches HTTPS port");
      } else if (!(await isPortAvailable(httpPort))) {
        conflicts.push(`HTTP port ${httpPort}`);
      }
    }

    if (conflicts.length > 0) {
      console.warn(`[CONFIG] ${conflicts.join(", ")} not available. Re-running setup.`);
      config = await runWizard(config);
    }
  }

  applyConfig(config);
  require("./serverCore");
})().catch((error) => {
  console.error(`[BOOT] ${error.stack || error.message}`);
  process.exit(1);
});
