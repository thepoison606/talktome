const fs = require("fs");
const http2 = require("http2");
const crypto = require("crypto");

class ApplePttPushService {
  constructor({ loadConfig, logger = console }) {
    this.loadConfig = loadConfig;
    this.logger = logger;
    this.cachedJwt = null;
    this.cachedJwtIssuedAt = 0;
  }

  isConfigured() {
    return Boolean(this.#resolvedConfig());
  }

  async sendActiveRemoteParticipant({ registrations, participantName, reason }) {
    if (!Array.isArray(registrations) || registrations.length === 0) {
      return;
    }

    await this.#sendPushes({
      registrations,
      priority: 10,
      payload: {
        ttm: {
          type: "active-remote-participant",
          participant: { name: participantName || "TalkToMe" },
          reason: reason || "incoming-audio",
        },
      },
    });
  }

  async sendServiceUpdate({ registrations, reason }) {
    if (!Array.isArray(registrations) || registrations.length === 0) {
      return;
    }

    await this.#sendPushes({
      registrations,
      priority: 5,
      payload: {
        ttm: {
          type: "service-update",
          reason: reason || "state-changed",
        },
      },
    });
  }

  async #sendPushes({ registrations, priority, payload }) {
    const config = this.#resolvedConfig();
    if (!config) {
      return;
    }

    const topic = `${config.bundleId}.voip-ptt`;
    const jwt = this.#authorizationToken(config);
    const authority = config.environment === "production"
      ? "api.push.apple.com"
      : "api.sandbox.push.apple.com";

    const client = http2.connect(`https://${authority}`);
    try {
      const tasks = registrations.map((registration) => this.#sendSinglePush({
        client,
        topic,
        jwt,
        priority,
        registration,
        payload,
      }));
      await Promise.all(tasks);
    } finally {
      client.close();
    }
  }

  async #sendSinglePush({ client, topic, jwt, priority, registration, payload }) {
    const request = client.request({
      ":method": "POST",
      ":path": `/3/device/${registration.push_token}`,
      "apns-topic": topic,
      "apns-push-type": "voip-ptt",
      "apns-priority": String(priority),
      authorization: `bearer ${jwt}`,
      "content-type": "application/json",
    });

    const body = JSON.stringify({
      aps: {
        timestamp: Math.floor(Date.now() / 1000),
        "content-available": 1,
      },
      ...payload,
    });

    return new Promise((resolve) => {
      let responseBody = "";
      let statusCode = 0;

      request.on("response", (headers) => {
        statusCode = Number(headers[":status"] || 0);
      });

      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        responseBody += chunk;
      });

      request.on("error", (error) => {
        this.logger.warn(`[APPLE-PTT] Push request failed for user ${registration.user_id}: ${error.message}`);
        resolve();
      });

      request.on("end", () => {
        if (statusCode < 200 || statusCode >= 300) {
          this.logger.warn(
            `[APPLE-PTT] Push rejected for user ${registration.user_id} with status ${statusCode}: ${responseBody || "no-body"}`
          );
        }
        resolve();
      });

      request.end(body);
    });
  }

  #authorizationToken(config) {
    const now = Math.floor(Date.now() / 1000);
    if (this.cachedJwt && now - this.cachedJwtIssuedAt < 45 * 60) {
      return this.cachedJwt;
    }

    const header = this.#base64Url(JSON.stringify({
      alg: "ES256",
      kid: config.keyId,
    }));
    const claims = this.#base64Url(JSON.stringify({
      iss: config.teamId,
      iat: now,
    }));
    const signer = crypto.createSign("sha256");
    signer.update(`${header}.${claims}`);
    signer.end();

    const signature = signer.sign(config.privateKey);
    const token = `${header}.${claims}.${this.#base64Url(signature)}`;
    this.cachedJwt = token;
    this.cachedJwtIssuedAt = now;
    return token;
  }

  #resolvedConfig() {
    const rawConfig = this.loadConfig()?.applePtt;
    if (!rawConfig || rawConfig.enabled !== true) {
      return null;
    }

    const privateKey = this.#loadPrivateKey(rawConfig);
    if (!rawConfig.teamId || !rawConfig.keyId || !rawConfig.bundleId || !privateKey) {
      return null;
    }

    return {
      teamId: String(rawConfig.teamId),
      keyId: String(rawConfig.keyId),
      bundleId: String(rawConfig.bundleId),
      privateKey,
      environment: rawConfig.environment === "production" ? "production" : "development",
    };
  }

  #loadPrivateKey(config) {
    if (typeof config.privateKey === "string" && config.privateKey.trim()) {
      return config.privateKey;
    }

    if (typeof config.privateKeyPath === "string" && config.privateKeyPath.trim()) {
      try {
        return fs.readFileSync(config.privateKeyPath, "utf8");
      } catch (error) {
        this.logger.warn(`[APPLE-PTT] Failed to read private key at ${config.privateKeyPath}: ${error.message}`);
      }
    }

    return null;
  }

  #base64Url(value) {
    const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
    return buffer
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }
}

module.exports = { ApplePttPushService };
