import { DominantSpeakerNotification } from '../../fbs/active-speaker-observer/dominant-speaker-notification';
import { VolumesNotification } from '../../fbs/audio-level-observer/volumes-notification';
import { LayersChangeNotification } from '../../fbs/consumer/layers-change-notification';
import { RtpNotification } from '../../fbs/consumer/rtp-notification';
import { ScoreNotification as FBS_Consumer_ScoreNotification } from '../../fbs/consumer/score-notification';
import { TraceNotification as FBS_Consumer_TraceNotification } from '../../fbs/consumer/trace-notification';
import { BufferedAmountLowNotification } from '../../fbs/data-consumer/buffered-amount-low-notification';
import { MessageNotification } from '../../fbs/data-consumer/message-notification';
import { SendNotification as FBS_DataProducer_SendNotification } from '../../fbs/data-producer/send-notification';
import { RtcpNotification } from '../../fbs/direct-transport/rtcp-notification';
import { RtcpTupleNotification } from '../../fbs/plain-transport/rtcp-tuple-notification';
import { TupleNotification } from '../../fbs/plain-transport/tuple-notification';
import { ScoreNotification } from '../../fbs/producer/score-notification';
import { SendNotification } from '../../fbs/producer/send-notification';
import { TraceNotification as FBS_Producer_TraceNotification } from '../../fbs/producer/trace-notification';
import { VideoOrientationChangeNotification } from '../../fbs/producer/video-orientation-change-notification';
import { SctpStateChangeNotification } from '../../fbs/transport/sctp-state-change-notification';
import { SendRtcpNotification } from '../../fbs/transport/send-rtcp-notification';
import { TraceNotification } from '../../fbs/transport/trace-notification';
import { DtlsStateChangeNotification } from '../../fbs/web-rtc-transport/dtls-state-change-notification';
import { IceSelectedTupleChangeNotification } from '../../fbs/web-rtc-transport/ice-selected-tuple-change-notification';
import { IceStateChangeNotification } from '../../fbs/web-rtc-transport/ice-state-change-notification';
export declare enum Body {
    NONE = 0,
    Transport_SendRtcpNotification = 1,
    Transport_SctpStateChangeNotification = 2,
    Producer_SendNotification = 3,
    DataProducer_SendNotification = 4,
    Transport_TraceNotification = 5,
    WebRtcTransport_IceSelectedTupleChangeNotification = 6,
    WebRtcTransport_IceStateChangeNotification = 7,
    WebRtcTransport_DtlsStateChangeNotification = 8,
    PlainTransport_TupleNotification = 9,
    PlainTransport_RtcpTupleNotification = 10,
    DirectTransport_RtcpNotification = 11,
    Producer_ScoreNotification = 12,
    Producer_TraceNotification = 13,
    Producer_VideoOrientationChangeNotification = 14,
    Consumer_LayersChangeNotification = 15,
    Consumer_RtpNotification = 16,
    Consumer_ScoreNotification = 17,
    Consumer_TraceNotification = 18,
    DataConsumer_MessageNotification = 19,
    DataConsumer_BufferedAmountLowNotification = 20,
    ActiveSpeakerObserver_DominantSpeakerNotification = 21,
    AudioLevelObserver_VolumesNotification = 22
}
export declare function unionToBody(type: Body, accessor: (obj: BufferedAmountLowNotification | DominantSpeakerNotification | DtlsStateChangeNotification | FBS_Consumer_ScoreNotification | FBS_Consumer_TraceNotification | FBS_DataProducer_SendNotification | FBS_Producer_TraceNotification | IceSelectedTupleChangeNotification | IceStateChangeNotification | LayersChangeNotification | MessageNotification | RtcpNotification | RtcpTupleNotification | RtpNotification | ScoreNotification | SctpStateChangeNotification | SendNotification | SendRtcpNotification | TraceNotification | TupleNotification | VideoOrientationChangeNotification | VolumesNotification) => BufferedAmountLowNotification | DominantSpeakerNotification | DtlsStateChangeNotification | FBS_Consumer_ScoreNotification | FBS_Consumer_TraceNotification | FBS_DataProducer_SendNotification | FBS_Producer_TraceNotification | IceSelectedTupleChangeNotification | IceStateChangeNotification | LayersChangeNotification | MessageNotification | RtcpNotification | RtcpTupleNotification | RtpNotification | ScoreNotification | SctpStateChangeNotification | SendNotification | SendRtcpNotification | TraceNotification | TupleNotification | VideoOrientationChangeNotification | VolumesNotification | null): BufferedAmountLowNotification | DominantSpeakerNotification | DtlsStateChangeNotification | FBS_Consumer_ScoreNotification | FBS_Consumer_TraceNotification | FBS_DataProducer_SendNotification | FBS_Producer_TraceNotification | IceSelectedTupleChangeNotification | IceStateChangeNotification | LayersChangeNotification | MessageNotification | RtcpNotification | RtcpTupleNotification | RtpNotification | ScoreNotification | SctpStateChangeNotification | SendNotification | SendRtcpNotification | TraceNotification | TupleNotification | VideoOrientationChangeNotification | VolumesNotification | null;
export declare function unionListToBody(type: Body, accessor: (index: number, obj: BufferedAmountLowNotification | DominantSpeakerNotification | DtlsStateChangeNotification | FBS_Consumer_ScoreNotification | FBS_Consumer_TraceNotification | FBS_DataProducer_SendNotification | FBS_Producer_TraceNotification | IceSelectedTupleChangeNotification | IceStateChangeNotification | LayersChangeNotification | MessageNotification | RtcpNotification | RtcpTupleNotification | RtpNotification | ScoreNotification | SctpStateChangeNotification | SendNotification | SendRtcpNotification | TraceNotification | TupleNotification | VideoOrientationChangeNotification | VolumesNotification) => BufferedAmountLowNotification | DominantSpeakerNotification | DtlsStateChangeNotification | FBS_Consumer_ScoreNotification | FBS_Consumer_TraceNotification | FBS_DataProducer_SendNotification | FBS_Producer_TraceNotification | IceSelectedTupleChangeNotification | IceStateChangeNotification | LayersChangeNotification | MessageNotification | RtcpNotification | RtcpTupleNotification | RtpNotification | ScoreNotification | SctpStateChangeNotification | SendNotification | SendRtcpNotification | TraceNotification | TupleNotification | VideoOrientationChangeNotification | VolumesNotification | null, index: number): BufferedAmountLowNotification | DominantSpeakerNotification | DtlsStateChangeNotification | FBS_Consumer_ScoreNotification | FBS_Consumer_TraceNotification | FBS_DataProducer_SendNotification | FBS_Producer_TraceNotification | IceSelectedTupleChangeNotification | IceStateChangeNotification | LayersChangeNotification | MessageNotification | RtcpNotification | RtcpTupleNotification | RtpNotification | ScoreNotification | SctpStateChangeNotification | SendNotification | SendRtcpNotification | TraceNotification | TupleNotification | VideoOrientationChangeNotification | VolumesNotification | null;
//# sourceMappingURL=body.d.ts.map