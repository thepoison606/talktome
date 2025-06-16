import { RtpStreamRecvStats, RtpStreamSendStats } from './rtpStreamStatsTypes';
import * as FbsRtpStream from './fbs/rtp-stream';
export declare function parseRtpStreamStats(binary: FbsRtpStream.Stats): RtpStreamRecvStats | RtpStreamSendStats;
export declare function parseRtpStreamRecvStats(binary: FbsRtpStream.Stats): RtpStreamRecvStats;
export declare function parseSendStreamStats(binary: FbsRtpStream.Stats): RtpStreamSendStats;
//# sourceMappingURL=rtpStreamStatsFbsUtils.d.ts.map