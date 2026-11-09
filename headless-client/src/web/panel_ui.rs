//! The same UI assets used by the server's /panel; no copied renderer.
use axum::{
    extract::Path,
    http::{header, StatusCode},
    response::{Html, IntoResponse, Response},
};

pub async fn page() -> Html<String> {
    let html = include_str!("../../../public/index.html")
        .replace("src=\"/", "src=\"/panel-assets/")
        .replace("href=\"/", "href=\"/panel-assets/")
        .replace("<script src=\"/panel-assets/socket.io.js\"></script>",
            "<script src=\"/local-panel.js\"></script>")
        .replace("</head>", "<style>body.remote-panel .container { margin-top: 0; margin-bottom: 0; height: 100%; } #logout-btn { display:none; }</style></head>");
    Html(html)
}

pub async fn local_transport() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "application/javascript")],
        include_str!("assets/local-panel.js"),
    )
}

pub async fn image(Path(path): Path<String>) -> Response {
    asset(Path(format!("images/{path}"))).await
}

pub async fn asset(Path(path): Path<String>) -> Response {
    if path == "default-client-settings.js" {
        return (
            [(header::CONTENT_TYPE, "application/javascript")],
            "window.TALKTOME_DEFAULT_CLIENT_SETTINGS = {};",
        )
            .into_response();
    }
    let content: Option<&'static [u8]> = match path.as_str() {
        "audioMeter.js" => Some(include_bytes!("../../../public/audioMeter.js")),
        "bridgeAudioLevels.js" => Some(include_bytes!("../../../public/bridgeAudioLevels.js")),
        "bridgeTalkTrigger.js" => Some(include_bytes!("../../../public/bridgeTalkTrigger.js")),
        "client.js" => Some(include_bytes!("../../../public/client.js")),
        "clientDeviceStatus.js" => Some(include_bytes!("../../../public/clientDeviceStatus.js")),
        "connectionHealth.js" => Some(include_bytes!("../../../public/connectionHealth.js")),
        "connectionSounds.js" => Some(include_bytes!("../../../public/connectionSounds.js")),
        "feedVideo.css" => Some(include_bytes!("../../../public/feedVideo.css")),
        "feedVideo.js" => Some(include_bytes!("../../../public/feedVideo.js")),
        "images/Discord-Logo-Blurple.png" => Some(include_bytes!(
            "../../../public/images/Discord-Logo-Blurple.png"
        )),
        "images/Discord-Logo-Blurple.svg" => Some(include_bytes!(
            "../../../public/images/Discord-Logo-Blurple.svg"
        )),
        "images/iphone_browser.png" => {
            Some(include_bytes!("../../../public/images/iphone_browser.png"))
        }
        "images/iphone_ipad.png" => Some(include_bytes!("../../../public/images/iphone_ipad.png")),
        "images/mute_mic.png" => Some(include_bytes!("../../../public/images/mute_mic.png")),
        "images/speaker-muted Kopie.png" => Some(include_bytes!(
            "../../../public/images/speaker-muted Kopie.png"
        )),
        "images/speaker-muted.png" => {
            Some(include_bytes!("../../../public/images/speaker-muted.png"))
        }
        "images/speaker-white.png" => {
            Some(include_bytes!("../../../public/images/speaker-white.png"))
        }
        "images/talktome-icon.png" => {
            Some(include_bytes!("../../../public/images/talktome-icon.png"))
        }
        "images/talktome-mark.png" => {
            Some(include_bytes!("../../../public/images/talktome-mark.png"))
        }
        "images/walkie-talkies-white.png" => Some(include_bytes!(
            "../../../public/images/walkie-talkies-white.png"
        )),
        "incomingAudioLevels.js" => Some(include_bytes!("../../../public/incomingAudioLevels.js")),
        "login.css" => Some(include_bytes!("../../../public/login.css")),
        "mediasoup-client.js" => Some(include_bytes!("../../../public/mediasoup-client.js")),
        "receivePlaybackPolicy.js" => {
            Some(include_bytes!("../../../public/receivePlaybackPolicy.js"))
        }
        "remotePanel.js" => Some(include_bytes!("../../../public/remotePanel.js")),
        "remotePanelState.js" => Some(include_bytes!("../../../public/remotePanelState.js")),
        "targetIdentity.js" => Some(include_bytes!("../../../public/targetIdentity.js")),
        "targetLayers.js" => Some(include_bytes!("../../../public/targetLayers.js")),
        "targetPicker.css" => Some(include_bytes!("../../../public/targetPicker.css")),
        "targetPicker.js" => Some(include_bytes!("../../../public/targetPicker.js")),
        "userAudioSettings.js" => Some(include_bytes!("../../../public/userAudioSettings.js")),
        _ => None,
    };
    let Some(content) = content else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mime = if path.ends_with(".js") {
        "application/javascript"
    } else if path.ends_with(".css") {
        "text/css"
    } else if path.ends_with(".svg") {
        "image/svg+xml"
    } else {
        "image/png"
    };
    ([(header::CONTENT_TYPE, mime)], content).into_response()
}
