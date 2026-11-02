//! REST calls against the Talktome server: login and target lists.

use std::sync::Arc;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use url::Url;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginUser {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Production {
    pub id: Value,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginResponse {
    pub token: String,
    #[serde(default)]
    pub expires_in_ms: Option<u64>,
    pub user: LoginUser,
    #[serde(default)]
    pub productions: Vec<Production>,
}

/// One entry of `GET /users/:id/targets?includeMemberships=1`.
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TargetEntry {
    pub target_type: String,
    pub target_id: Value,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub can_talk: Option<Value>,
    #[serde(default)]
    pub members: Vec<Value>,
    #[serde(default)]
    pub position: Option<Value>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

impl TargetEntry {
    pub fn can_talk(&self) -> bool {
        match &self.can_talk {
            None => self.target_type != "feed",
            Some(Value::Bool(b)) => *b,
            Some(Value::Number(n)) => n.as_i64().unwrap_or(0) != 0,
            Some(_) => true,
        }
    }
}

#[derive(Clone)]
pub struct ServerApi {
    base: Url,
    client: reqwest::Client,
}

impl ServerApi {
    pub fn new(base: Url, tls: Arc<rustls::ClientConfig>) -> Result<Self> {
        let client = reqwest::Client::builder()
            .use_preconfigured_tls((*tls).clone())
            .timeout(Duration::from_secs(15))
            .user_agent(format!("talktome-headless/{}", crate::VERSION))
            .build()
            .context("building HTTP client")?;
        Ok(Self { base, client })
    }

    fn url(&self, path: &str) -> Result<Url> {
        self.base
            .join(path)
            .with_context(|| format!("building URL for {path}"))
    }

    /// `POST /api/v1/companion/auth/login` -> user-scoped token.
    pub async fn login(&self, name: &str, password: &str) -> Result<LoginResponse> {
        let response = self
            .client
            .post(self.url("/api/v1/companion/auth/login")?)
            .json(&json!({ "name": name, "password": password }))
            .send()
            .await
            .context("login request failed")?;
        let status = response.status();
        let body: Value = response.json().await.unwrap_or(Value::Null);
        if !status.is_success() {
            let message = body
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("login rejected");
            bail!("login failed ({status}): {message}");
        }
        serde_json::from_value(body).context("parsing login response")
    }

    /// `GET /login/options` — public; `appVersion` is the Talktome server version.
    pub async fn server_app_version(&self) -> Option<String> {
        let url = self.url("/login/options").ok()?;
        let response = self.client.get(url).send().await.ok()?;
        if !response.status().is_success() {
            return None;
        }
        let body: Value = response.json().await.ok()?;
        parse_server_app_version(&body)
    }

    /// `GET /users/:id/targets?includeMemberships=1[&productionId=..]`.
    pub async fn targets(
        &self,
        token: &str,
        user_id: i64,
        production_id: Option<&str>,
    ) -> Result<Vec<TargetEntry>> {
        let mut url = self.url(&format!("/users/{user_id}/targets"))?;
        {
            let mut query = url.query_pairs_mut();
            query.append_pair("includeMemberships", "1");
            if let Some(production) = production_id {
                query.append_pair("productionId", production);
            }
        }
        let response = self
            .client
            .get(url)
            .bearer_auth(token)
            .send()
            .await
            .context("targets request failed")?;
        let status = response.status();
        if !status.is_success() {
            let body: Value = response.json().await.unwrap_or(Value::Null);
            let message = body
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("request rejected");
            bail!("loading targets failed ({status}): {message}");
        }
        response.json().await.context("parsing targets response")
    }

    /// `GET /users/:id/productions` — the productions this user may join.
    pub async fn productions(&self, token: &str, user_id: i64) -> Result<Vec<Production>> {
        let response = self
            .client
            .get(self.url(&format!("/users/{user_id}/productions"))?)
            .bearer_auth(token)
            .send()
            .await
            .context("productions request failed")?;
        let status = response.status();
        if !status.is_success() {
            bail!("loading productions failed ({status})");
        }
        response
            .json()
            .await
            .context("parsing productions response")
    }
}

fn parse_server_app_version(body: &Value) -> Option<String> {
    body.get("appVersion")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToOwned::to_owned)
}

#[cfg(test)]
mod tests {
    use super::parse_server_app_version;
    use serde_json::json;

    #[test]
    fn parse_server_app_version_reads_app_version() {
        assert_eq!(
            parse_server_app_version(&json!({ "appVersion": "1.5.4" })),
            Some("1.5.4".into())
        );
        assert_eq!(
            parse_server_app_version(&json!({ "appVersion": "  v1.5.4  " })),
            Some("v1.5.4".into())
        );
        assert_eq!(
            parse_server_app_version(&json!({ "appVersion": "unknown" })),
            Some("unknown".into())
        );
        assert_eq!(
            parse_server_app_version(&json!({ "appVersion": "   " })),
            None
        );
        assert_eq!(parse_server_app_version(&json!({})), None);
    }
}
