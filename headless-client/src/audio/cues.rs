//! Loss and recovery tones from the v1.5.6 web client (`public/audio/*.mp3`),
//! converted to 48 kHz mono PCM so the playback device can mix them directly.

use std::io::Cursor;
use std::sync::OnceLock;

use super::codec::SAMPLE_RATE;

fn decode(bytes: &[u8]) -> Vec<f32> {
    let reader = hound::WavReader::new(Cursor::new(bytes)).expect("connection cue wav");
    let spec = reader.spec();
    assert_eq!(spec.sample_rate, SAMPLE_RATE, "cue wav sample rate");
    assert_eq!(spec.channels, 1, "cue wav channels");
    reader
        .into_samples::<i16>()
        .map(|sample| sample.expect("cue sample") as f32 / 32768.0)
        .collect()
}

pub fn disconnected() -> &'static [f32] {
    static CUE: OnceLock<Vec<f32>> = OnceLock::new();
    CUE.get_or_init(|| decode(include_bytes!("../../assets/disconnected.wav")))
}

pub fn reconnected() -> &'static [f32] {
    static CUE: OnceLock<Vec<f32>> = OnceLock::new();
    CUE.get_or_init(|| decode(include_bytes!("../../assets/reconnected.wav")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cues_match_the_web_client_clips() {
        assert!(
            disconnected().len() > 48_000,
            "disconnect tone is about 1.8 s"
        );
        assert!(
            reconnected().len() > 48_000,
            "reconnect tone is about 1.6 s"
        );
    }
}
