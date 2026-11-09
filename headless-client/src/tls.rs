//! rustls client configuration shared by the WebSocket and HTTP clients:
//! system roots plus an optional CA file, or a pinned leaf fingerprint, or
//! (development only) no verification at all.

use std::sync::Arc;

use anyhow::{Context, Result};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{ring, verify_tls12_signature, verify_tls13_signature, CryptoProvider};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, RootCertStore, SignatureScheme};
use rustls_pki_types::pem::PemObject;
use sha2::{Digest, Sha256};

use crate::config::TlsConfig;

pub fn provider() -> Arc<CryptoProvider> {
    Arc::new(ring::default_provider())
}

/// Parses `AB:CD:..` or plain hex into 32 bytes.
pub fn parse_fingerprint(text: &str) -> Option<[u8; 32]> {
    let hex: String = text
        .chars()
        .filter(|c| c.is_ascii_hexdigit())
        .collect::<String>()
        .to_ascii_lowercase();
    if hex.len() != 64 {
        return None;
    }
    let mut out = [0u8; 32];
    for (index, chunk) in hex.as_bytes().chunks(2).enumerate() {
        let byte = u8::from_str_radix(std::str::from_utf8(chunk).ok()?, 16).ok()?;
        out[index] = byte;
    }
    Some(out)
}

pub fn format_fingerprint(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}

pub fn build_client_config(tls: &TlsConfig) -> Result<Arc<ClientConfig>> {
    let provider = provider();
    let builder = ClientConfig::builder_with_provider(provider.clone())
        .with_safe_default_protocol_versions()
        .context("rustls protocol configuration")?;

    if tls.insecure {
        tracing::warn!(
            event = "tls-insecure",
            "TLS certificate verification is disabled"
        );
        let config = builder
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(InsecureVerifier { provider }))
            .with_no_client_auth();
        return Ok(Arc::new(config));
    }

    if let Some(fingerprint) = &tls.fingerprint_sha256 {
        let expected = parse_fingerprint(fingerprint).context("invalid tls.fingerprint_sha256")?;
        let config = builder
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(FingerprintVerifier { expected, provider }))
            .with_no_client_auth();
        return Ok(Arc::new(config));
    }

    let mut roots = RootCertStore::empty();
    let native = rustls_native_certs::load_native_certs();
    for cert in native.certs {
        let _ = roots.add(cert);
    }
    for error in native.errors {
        tracing::debug!(event = "tls-native-roots", error = %error, "skipping native root");
    }
    if let Some(path) = &tls.ca_file {
        let mut added = 0usize;
        for cert in CertificateDer::pem_file_iter(path)
            .with_context(|| format!("cannot read tls.ca_file {}", path.display()))?
        {
            let cert =
                cert.with_context(|| format!("invalid certificate in {}", path.display()))?;
            roots
                .add(cert)
                .with_context(|| format!("cannot add certificate from {}", path.display()))?;
            added += 1;
        }
        if added == 0 {
            anyhow::bail!("tls.ca_file {} contains no certificates", path.display());
        }
    }
    let config = builder.with_root_certificates(roots).with_no_client_auth();
    Ok(Arc::new(config))
}

/// TLS config used to reach TURNS (`turns:` / TURN-over-TLS) servers.
///
/// Fingerprint pinning is the Talktome HTTPS leaf, which is the wrong
/// certificate for the TURN host, so TURNS always uses system roots plus
/// `tls.ca_file`. `tls.insecure` still disables verification.
pub fn build_turn_client_config(tls: &TlsConfig) -> Result<Arc<ClientConfig>> {
    if tls.insecure {
        return build_client_config(tls);
    }
    let mut turn = tls.clone();
    turn.fingerprint_sha256 = None;
    build_client_config(&turn)
}

#[derive(Debug)]
struct InsecureVerifier {
    provider: Arc<CryptoProvider>,
}

impl ServerCertVerifier for InsecureVerifier {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

#[derive(Debug)]
struct FingerprintVerifier {
    expected: [u8; 32],
    provider: Arc<CryptoProvider>,
}

impl ServerCertVerifier for FingerprintVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let actual = Sha256::digest(end_entity.as_ref());
        if actual.as_slice() == self.expected {
            Ok(ServerCertVerified::assertion())
        } else {
            Err(rustls::Error::General(format!(
                "server certificate fingerprint {} does not match pinned {}",
                format_fingerprint(actual.as_slice()),
                format_fingerprint(&self.expected)
            )))
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_colon_and_plain_hex_fingerprints() {
        let plain = "ab".repeat(32);
        let colon = (0..32).map(|_| "AB").collect::<Vec<_>>().join(":");
        assert_eq!(parse_fingerprint(&plain).unwrap(), [0xab; 32]);
        assert_eq!(parse_fingerprint(&colon).unwrap(), [0xab; 32]);
        assert!(parse_fingerprint("abcd").is_none());
    }

    #[test]
    fn builds_default_and_pinned_configs() {
        build_client_config(&TlsConfig::default()).unwrap();
        build_client_config(&TlsConfig {
            fingerprint_sha256: Some("ab".repeat(32)),
            ..TlsConfig::default()
        })
        .unwrap();
        build_client_config(&TlsConfig {
            insecure: true,
            ..TlsConfig::default()
        })
        .unwrap();
        build_turn_client_config(&TlsConfig {
            fingerprint_sha256: Some("ab".repeat(32)),
            ..TlsConfig::default()
        })
        .unwrap();
    }
}
