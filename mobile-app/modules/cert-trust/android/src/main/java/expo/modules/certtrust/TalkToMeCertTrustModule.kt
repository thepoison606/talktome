package expo.modules.certtrust

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.URL
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

class TalkToMeCertTrustModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TalkToMeCertTrust")

    OnCreate {
      TalkToMeTrust.install()
    }

    Function("isAvailable") {
      true
    }

    Function("setPins") { pins: List<Map<String, String>> ->
      TalkToMeTrust.replacePins(pins)
    }

    AsyncFunction("probe") { url: String ->
      probeCertificate(url)
    }
  }
}

private fun probeCertificate(url: String): Map<String, String> {
  val target = URL(url)
  val connection = target.openConnection() as HttpsURLConnection
  val capturing = CapturingTrustManager()
  val context = SSLContext.getInstance("TLS")
  context.init(null, arrayOf(capturing), null)
  connection.sslSocketFactory = context.socketFactory
  connection.requestMethod = "GET"
  connection.connectTimeout = 8000
  connection.readTimeout = 8000
  try {
    connection.connect()
  } catch (_: Exception) {
    // Certificate is captured in the handshake even when the request fails.
  } finally {
    connection.disconnect()
  }
  val sha256 = capturing.sha256 ?: throw IllegalStateException("The server did not present a certificate.")
  return buildMap {
    put("hostname", target.host)
    put("sha256", sha256)
    capturing.issuer?.let { put("issuer", it) }
  }
}

private class CapturingTrustManager : X509TrustManager {
  var sha256: String? = null
  var issuer: String? = null

  override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) = Unit

  override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
    val leaf = chain.firstOrNull() ?: throw CertificateException("The server did not present a certificate.")
    sha256 = sha256Hex(leaf.encoded)
    issuer = leaf.issuerX500Principal?.name
    throw CertificateException("Certificate probe complete.")
  }

  override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}
