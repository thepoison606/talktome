#!/usr/bin/env node
// Isolated forwarding benchmark. Does not connect to or modify a Talktome server.
// Synthetic H.264-shaped RTP measures SFU/SRTP packet handling, not picture quality.
const mediasoup = require('mediasoup');
const dgram = require('node:dgram');
const crypto = require('node:crypto');
const os = require('node:os');
const fs = require('node:fs/promises');
const { performance } = require('node:perf_hooks');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
};
const counts = String(arg('subscribers', '1,10,50,100,200')).split(',').map(Number);
const seconds = Number(arg('seconds', 5));
const mbps = Number(arg('mbps', 2.4));
if (!counts.length || counts.some(n => !Number.isInteger(n) || n < 1 || n > 500)
  || !Number.isFinite(seconds) || seconds < 2 || seconds > 60
  || !Number.isFinite(mbps) || mbps < 0.1 || mbps > 20) {
  throw new Error('Use --subscribers 1,10,50,100,200 --seconds 5 --mbps 2.4 (max 500 subscribers)');
}
const fps = 30;
const codec = { kind: 'video', mimeType: 'video/H264', preferredPayloadType: 102, clockRate: 90000,
  parameters: { 'packetization-mode': 1, 'profile-level-id': '42e01f', 'level-asymmetry-allowed': 1 } };
const sink = dgram.createSocket({ type: 'udp4', recvBufferSize: 4 * 1024 * 1024 });
let receivedBytes = 0, receivedPackets = 0, receivedMediaPackets = 0;
sink.on('message', packet => {
  receivedBytes += packet.length; receivedPackets++;
  // Exclude RTCP and RTP padding/probing from the media delivery counter.
  if (packet.length >= 12 && (packet[1] & 127) === 102 && !(packet[0] & 0x20)) receivedMediaPackets++;
});
let worker, timer;
const metadata = { date: new Date().toISOString(), platform: `${os.platform()} ${os.arch()}`,
  cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, mediasoup: mediasoup.version,
  source: { mbps, fps, codec: 'H264', mode: 'synthetic RTP; source is not decoded' },
  transport: 'loopback UDP + independent AES_CM_128_HMAC_SHA1_80 SRTP context per subscriber',
  limitations: ['Not a WebRTC ICE/DTLS or WAN/TURN test', 'No decoding, browser rendering, audio or full server/admin workload',
    'No receiver NACK/PLI feedback, retransmission or congestion simulation', 'Local sink and source share the benchmark Node process'], results: [] };

async function run() {
  await new Promise(resolve => sink.bind(0, '127.0.0.1', resolve));
  worker = await mediasoup.createWorker({ logLevel: 'error' });
  const router = await worker.createRouter({ mediaCodecs: [codec] });
  const input = await router.createDirectTransport();
  const producer = await input.produce({ kind: 'video', rtpParameters: {
    codecs: [{ ...codec, payloadType: 102 }], encodings: [{ ssrc: 12345 }], rtcp: { cname: 'isolated-video-benchmark' },
  } });
  const payload = crypto.randomBytes(Math.ceil(mbps * 1e6 / 8 / fps));
  let sequence = 0, frame = 0, sentPackets = 0, sentRtpBytes = 0;
  let nextFrame = performance.now();
  const sendFrame = () => {
    const type = frame % fps === 0 ? 5 : 1;
    const timestamp = (frame * 90000 / fps) >>> 0;
    if (type === 5) {
      // mediasoup recognizes an H.264 random-access boundary at the SPS.
      const sps = Buffer.from([0x67, 0x42, 0xe0, 0x1f, 0x95, 0xa8, 0x14, 0x01, 0x6e, 0x40]);
      const packet = Buffer.alloc(12 + sps.length);
      packet[0] = 0x80; packet[1] = 102;
      packet.writeUInt16BE(sequence++ & 65535, 2);
      packet.writeUInt32BE(timestamp, 4); packet.writeUInt32BE(12345, 8); sps.copy(packet, 12);
      producer.send(packet); sentPackets++; sentRtpBytes += packet.length;
    }
    for (let offset = 0; offset < payload.length; offset += 1098) {
      const chunk = payload.subarray(offset, offset + 1098);
      const last = offset + chunk.length === payload.length;
      const packet = Buffer.allocUnsafe(14 + chunk.length);
      packet[0] = 0x80; packet[1] = 102 | (last ? 0x80 : 0);
      packet.writeUInt16BE(sequence++ & 65535, 2);
      packet.writeUInt32BE(timestamp, 4); packet.writeUInt32BE(12345, 8);
      packet[12] = 0x7c; // FU-A, NRI=3.
      packet[13] = type | (offset === 0 ? 0x80 : 0) | (last ? 0x40 : 0);
      chunk.copy(packet, 14);
      producer.send(packet); sentPackets++; sentRtpBytes += packet.length;
    }
    frame++; nextFrame += 1000 / fps;
    timer = setTimeout(sendFrame, Math.max(0, nextFrame - performance.now()));
  };
  sendFrame();
  console.log(`${metadata.cpu}: ${mbps} Mbit/s H264-shaped RTP, ${fps} fps, encrypted per receiver`);
  for (const subscribers of counts) {
    const outputs = [];
    const consumers = [];
    const mediaCount = async () => {
      const stats = (await Promise.all(consumers.map(consumer => consumer.getStats()))).flat();
      return stats.filter(stat => stat.type === 'outbound-rtp').reduce((sum, stat) => sum + stat.packetCount, 0);
    };
    try {
      for (let n = 0; n < subscribers; n++) {
        const transport = await router.createPlainTransport({ listenInfo: { protocol: 'udp', ip: '127.0.0.1' },
          rtcpMux: true, comedia: false, enableSrtp: true, srtpCryptoSuite: 'AES_CM_128_HMAC_SHA1_80' });
        outputs.push(transport);
        await transport.connect({ ip: '127.0.0.1', port: sink.address().port,
          srtpParameters: { cryptoSuite: 'AES_CM_128_HMAC_SHA1_80', keyBase64: crypto.randomBytes(30).toString('base64') } });
        consumers.push(await transport.consume({ producerId: producer.id, rtpCapabilities: router.rtpCapabilities }));
      }
      await wait(3250); // Allow an IDR and initial bandwidth probing before sampling.
      const mediaBefore = await mediaCount();
      const usage = await worker.getResourceUsage();
      const nodeUsage = process.cpuUsage();
      const start = performance.now();
      const before = { receivedBytes, receivedPackets, receivedMediaPackets, sentPackets, sentRtpBytes, frame };
      await wait(seconds * 1000);
      const duration = performance.now() - start;
      const end = { receivedBytes, receivedPackets, receivedMediaPackets, sentPackets, sentRtpBytes, frame };
      const after = await worker.getResourceUsage();
      const mediaAfter = await mediaCount();
      const node = process.cpuUsage(nodeUsage);
      let rssMiB = null;
      if (os.platform() !== 'win32') {
        const result = await execFile('ps', ['-p', String(worker.pid), '-o', 'rss=']);
        rssMiB = Number(result.stdout.trim()) / 1024;
      }
      const record = { subscribers, seconds: duration / 1000,
        sourceFps: (end.frame - before.frame) * 1000 / duration,
        sourceRtpMbps: (end.sentRtpBytes - before.sentRtpBytes) * 8 / duration / 1000,
        receivedSrtpMbps: (end.receivedBytes - before.receivedBytes) * 8 / duration / 1000,
        mediaDeliveryRatio: (end.receivedMediaPackets - before.receivedMediaPackets) / ((end.sentPackets - before.sentPackets) * subscribers),
        workerMediaForwardingRatio: (mediaAfter - mediaBefore) / ((end.sentPackets - before.sentPackets) * subscribers),
        workerCpuPercentOfOneCore: ((after.ru_utime - usage.ru_utime) + (after.ru_stime - usage.ru_stime)) / duration * 100,
        benchmarkNodeCpuPercentOfOneCore: (node.user + node.system) / duration / 10,
        workerRssMiB: rssMiB };
      if (record.mediaDeliveryRatio < 0.9) throw new Error(`Forwarding/sink incomplete: ${JSON.stringify(record)}`);
      metadata.results.push(record);
      console.log(`${subscribers} viewers: worker ${record.workerCpuPercentOfOneCore.toFixed(1)}% of one core, ${record.receivedSrtpMbps.toFixed(1)} Mbit/s, ${(record.mediaDeliveryRatio * 100).toFixed(2)}% media packets at sink, ${(record.workerMediaForwardingRatio * 100).toFixed(2)}% worker forwarding, ${record.sourceFps.toFixed(1)} source fps`);
    } finally { for (const transport of outputs) transport.close(); }
  }
  const path = arg('output', null);
  if (path) { await fs.writeFile(path, JSON.stringify(metadata, null, 2) + '\n'); console.log(`Saved ${path}`); }
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  clearTimeout(timer); worker?.close(); sink.close();
});
