const fs = require("fs");
const path = require("path");
const net = require("net");
const os = require("os");
const readline = require("readline");
const { getDataDir } = require("./dataPaths");

const execDir = path.dirname(process.execPath);
const dataDir = getDataDir();
const dataConfigPath = path.join(dataDir, "config.json");
const legacyConfigPath = path.join(__dirname, "config.json");
const legacyPkgConfigPath = path.join(execDir, "config.json");
let configPath = dataConfigPath;

if (!process.pkg && fs.existsSync(legacyConfigPath)) {
  configPath = legacyConfigPath;
} else if (
  process.pkg &&
  fs.existsSync(legacyPkgConfigPath) &&
  !fs.existsSync(dataConfigPath)
) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.copyFileSync(legacyPkgConfigPath, dataConfigPath);
    console.log(`[CONFIG] Migrated ${legacyPkgConfigPath} → ${dataConfigPath}`);
  } catch (error) {
    console.warn(
      `[CONFIG] Failed to migrate ${legacyPkgConfigPath}: ${error.message}`
    );
  }
}

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
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
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

function normalizeMediaNetworkMode(value) {
  const trimmed = String(value ?? "").trim().toLowerCase();
  if (!trimmed || trimmed === "auto") return "auto";
  if (trimmed === "interface") return "interface";
  if (trimmed === "manual") return "manual";
  return null;
}

function normalizeMediaInterfaceName(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed || "";
}

function normalizeMediaAnnouncedAddress(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed || "";
}

function getAvailableMediaNetworkInterfaces() {
  const interfaces = os.networkInterfaces();
  const entries = [];
  for (const [name, candidates] of Object.entries(interfaces)) {
    for (const iface of candidates || []) {
      if (!iface || iface.internal || iface.family !== "IPv4") continue;
      entries.push({
        name,
        address: iface.address,
        label: `${name} - ${iface.address}`,
      });
    }
  }
  return entries;
}

function resolveSavedMediaNetworkConfig(config) {
  const mode = normalizeMediaNetworkMode(config?.mediaNetworkMode)
    || (normalizeMediaInterfaceName(config?.mediaInterfaceName) ? "interface" : null)
    || (normalizeMediaAnnouncedAddress(config?.mediaAnnouncedAddress) ? "manual" : null)
    || "auto";

  return {
    mode,
    interfaceName: mode === "interface" ? normalizeMediaInterfaceName(config?.mediaInterfaceName) : "",
    announcedAddress: mode === "manual" ? normalizeMediaAnnouncedAddress(config?.mediaAnnouncedAddress) : "",
  };
}

function describeMediaNetworkSelection(selection, availableInterfaces) {
  if (!selection || selection.mode === "auto") {
    return "automatic";
  }
  if (selection.mode === "interface") {
    const match = availableInterfaces.find((entry) => entry.name === selection.interfaceName);
    return match?.label || selection.interfaceName || "selected interface";
  }
  if (selection.mode === "manual") {
    return selection.announcedAddress || "manual address";
  }
  return "automatic";
}

function hasEnvConfig() {
  return Boolean(
    process.env.PORT ||
      process.env.HTTPS_PORT ||
      process.env.MDNS_HOST ||
      process.env.MDNS_NAME ||
      process.env.INTERCOM_HOSTNAME ||
      process.env.HTTP_PORT ||
      process.env.PUBLIC_IP ||
      process.env.TALKTOME_MEDIA_INTERFACE
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

async function promptForMediaNetwork(rl, existingConfig = null) {
  const availableInterfaces = getAvailableMediaNetworkInterfaces();
  const savedSelection = resolveSavedMediaNetworkConfig(existingConfig);
  const defaultLabel = describeMediaNetworkSelection(savedSelection, availableInterfaces);

  console.log("");
  console.log("Media network for WebRTC audio/video:");
  console.log("  0) Automatic");
  availableInterfaces.forEach((entry, index) => {
    console.log(`  ${index + 1}) ${entry.label}`);
  });
  console.log("  m) Manual IP or hostname");

  while (true) {
    const answer = await new Promise((resolve) =>
      rl.question(`Selection [press Enter to use ${defaultLabel}]: `, resolve)
    );
    const trimmed = answer.trim();

    if (!trimmed) {
      return savedSelection;
    }

    if (trimmed === "0" || trimmed.toLowerCase() === "auto") {
      return { mode: "auto", interfaceName: "", announcedAddress: "" };
    }

    if (trimmed.toLowerCase() === "m" || trimmed.toLowerCase() === "manual") {
      const manualDefault = savedSelection.mode === "manual" ? savedSelection.announcedAddress : "";
      const manualInput = await new Promise((resolve) =>
        rl.question(
          `Manual announced IP or hostname${manualDefault ? ` [press Enter to use ${manualDefault}]` : ""}: `,
          resolve
        )
      );
      const announcedAddress = normalizeMediaAnnouncedAddress(manualInput || manualDefault);
      if (!announcedAddress) {
        console.log("Please enter an IP address or hostname.");
        continue;
      }
      return { mode: "manual", interfaceName: "", announcedAddress };
    }

    const numericChoice = Number(trimmed);
    if (Number.isInteger(numericChoice) && numericChoice >= 1 && numericChoice <= availableInterfaces.length) {
      const selected = availableInterfaces[numericChoice - 1];
      return { mode: "interface", interfaceName: selected.name, announcedAddress: "" };
    }

    console.log("Invalid selection. Choose 0, one of the listed interface numbers, or m for manual.");
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

    const mediaNetwork = await promptForMediaNetwork(rl, existingConfig);

    const config = {
      httpsPort,
      mdnsHost,
      mediaNetworkMode: mediaNetwork.mode,
    };
    if (httpPort !== undefined) {
      config.httpPort = httpPort;
    }
    if (mediaNetwork.mode === "interface" && mediaNetwork.interfaceName) {
      config.mediaInterfaceName = mediaNetwork.interfaceName;
      delete config.mediaAnnouncedAddress;
    } else if (mediaNetwork.mode === "manual" && mediaNetwork.announcedAddress) {
      config.mediaAnnouncedAddress = mediaNetwork.announcedAddress;
      delete config.mediaInterfaceName;
    } else {
      delete config.mediaInterfaceName;
      delete config.mediaAnnouncedAddress;
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

  const explicitPublicIp = typeof process.env.PUBLIC_IP === "string" && process.env.PUBLIC_IP.trim();
  const explicitMediaInterface = typeof process.env.TALKTOME_MEDIA_INTERFACE === "string" && process.env.TALKTOME_MEDIA_INTERFACE.trim();
  if (explicitPublicIp || explicitMediaInterface) {
    process.env.TALKTOME_MEDIA_NETWORK_SOURCE = "env";
    return;
  }

  const mediaConfig = resolveSavedMediaNetworkConfig(config);
  if (mediaConfig.mode === "manual" && mediaConfig.announcedAddress) {
    process.env.PUBLIC_IP = mediaConfig.announcedAddress;
    process.env.TALKTOME_MEDIA_NETWORK_SOURCE = "config";
    return;
  }

  if (mediaConfig.mode === "interface" && mediaConfig.interfaceName) {
    process.env.TALKTOME_MEDIA_INTERFACE = mediaConfig.interfaceName;
    process.env.TALKTOME_MEDIA_NETWORK_SOURCE = "config";
    return;
  }

  process.env.TALKTOME_MEDIA_NETWORK_SOURCE = "auto";
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
