//! Opus encode/decode wrappers (48 kHz, mono PCM on the application side).

use anyhow::{Context, Result};
use bytes::Bytes;

pub const SAMPLE_RATE: u32 = 48_000;

/// Speech complexity. 10 (libopus default) misses 5 ms deadlines on a
/// Cortex-A7 such as the NanoPi NEO Core LTS; 5 keeps speech quality and
/// finishes inside the frame.
const SPEECH_COMPLEXITY: i32 = 5;

pub struct OpusEncoder {
    inner: opus::Encoder,
    frame_samples: usize,
    buffer: Vec<u8>,
}

impl OpusEncoder {
    pub fn new(frame_ms: u32, bitrate: i32, fec: bool) -> Result<Self> {
        let mut inner =
            opus::Encoder::new(SAMPLE_RATE, opus::Channels::Mono, opus::Application::Voip)
                .context("creating opus encoder")?;
        inner
            .set_bitrate(opus::Bitrate::Bits(bitrate))
            .context("setting opus bitrate")?;
        inner.set_inband_fec(fec).context("setting opus fec")?;
        inner
            .set_packet_loss_perc(if fec { 10 } else { 0 })
            .context("setting expected packet loss")?;
        inner.set_vbr(true).context("setting vbr")?;
        inner
            .set_complexity(SPEECH_COMPLEXITY)
            .context("setting opus complexity")?;
        Ok(Self {
            inner,
            frame_samples: (SAMPLE_RATE * frame_ms / 1000) as usize,
            buffer: vec![0u8; 1500],
        })
    }

    pub fn frame_samples(&self) -> usize {
        self.frame_samples
    }

    /// Encodes exactly one frame of `frame_samples()` mono f32 samples.
    pub fn encode(&mut self, pcm: &[f32]) -> Result<Bytes> {
        debug_assert_eq!(pcm.len(), self.frame_samples);
        let written = self
            .inner
            .encode_float(pcm, &mut self.buffer)
            .context("opus encode")?;
        Ok(Bytes::copy_from_slice(&self.buffer[..written]))
    }
}

pub struct OpusDecoder {
    inner: opus::Decoder,
    buffer: Vec<f32>,
}

impl OpusDecoder {
    pub fn new() -> Result<Self> {
        Ok(Self {
            inner: opus::Decoder::new(SAMPLE_RATE, opus::Channels::Mono)
                .context("creating opus decoder")?,
            // 120 ms is the largest Opus frame.
            buffer: vec![0f32; (SAMPLE_RATE as usize * 120) / 1000],
        })
    }

    /// Decodes a packet into mono f32 samples. `fec` requests in-band FEC
    /// recovery of the *previous* lost frame from this packet.
    pub fn decode(&mut self, packet: &[u8], fec: bool) -> Result<&[f32]> {
        let samples = self
            .inner
            .decode_float(packet, &mut self.buffer, fec)
            .context("opus decode")?;
        Ok(&self.buffer[..samples])
    }

    /// Recovers the frame *before* `packet` from its in-band FEC data (or PLC
    /// when the packet carries none). `frame_samples` must be the size of the
    /// missing frame.
    pub fn decode_fec(&mut self, packet: &[u8], frame_samples: usize) -> Result<&[f32]> {
        let samples = self
            .inner
            .decode_float(packet, &mut self.buffer[..frame_samples], true)
            .context("opus fec decode")?;
        Ok(&self.buffer[..samples])
    }

    /// Packet-loss concealment for one missing frame of `frame_samples`.
    pub fn conceal(&mut self, frame_samples: usize) -> Result<&[f32]> {
        let samples = self
            .inner
            .decode_float(&[], &mut self.buffer[..frame_samples], false)
            .context("opus plc")?;
        Ok(&self.buffer[..samples])
    }

    /// Number of samples the packet will decode to, if parsable.
    pub fn packet_samples(&self, packet: &[u8]) -> Option<usize> {
        self.inner.get_nb_samples(packet).ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_a_tone() {
        let mut encoder = OpusEncoder::new(20, 64_000, true).unwrap();
        let mut decoder = OpusDecoder::new().unwrap();
        let frame: Vec<f32> = (0..960)
            .map(|i| (i as f32 * 440.0 * std::f32::consts::TAU / 48_000.0).sin() * 0.5)
            .collect();
        let mut decoded_energy = 0.0f32;
        for _ in 0..10 {
            let packet = encoder.encode(&frame).unwrap();
            assert!(!packet.is_empty());
            assert_eq!(decoder.packet_samples(&packet), Some(960));
            let pcm = decoder.decode(&packet, false).unwrap();
            assert_eq!(pcm.len(), 960);
            decoded_energy = pcm.iter().map(|s| s * s).sum::<f32>() / pcm.len() as f32;
        }
        assert!(decoded_energy > 0.05, "decoded energy {decoded_energy}");
        assert_eq!(decoder.conceal(960).unwrap().len(), 960);
        assert_eq!(encoder.inner.get_complexity().unwrap(), 5);
    }
}
