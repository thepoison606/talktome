import * as flatbuffers from 'flatbuffers';
import { DominantSpeakerNotificationT } from '../../fbs/active-speaker-observer/dominant-speaker-notification';
import { VolumesNotificationT } from '../../fbs/audio-level-observer/volumes-notification';
import { LayersChangeNotificationT } from '../../fbs/consumer/layers-change-notification';
import { RtpNotificationT } from '../../fbs/consumer/rtp-notification';
import { ScoreNotificationT as FBS_Consumer_ScoreNotificationT } from '../../fbs/consumer/score-notification';
import { TraceNotificationT as FBS_Consumer_TraceNotificationT } from '../../fbs/consumer/trace-notification';
import { BufferedAmountLowNotificationT } from '../../fbs/data-consumer/buffered-amount-low-notification';
import { MessageNotificationT } from '../../fbs/data-consumer/message-notification';
import { SendNotificationT as FBS_DataProducer_SendNotificationT } from '../../fbs/data-producer/send-notification';
import { RtcpNotificationT } from '../../fbs/direct-transport/rtcp-notification';
import { Body } from '../../fbs/notification/body';
import { Event } from '../../fbs/notification/event';
import { RtcpTupleNotificationT } from '../../fbs/plain-transport/rtcp-tuple-notification';
import { TupleNotificationT } from '../../fbs/plain-transport/tuple-notification';
import { ScoreNotificationT } from '../../fbs/producer/score-notification';
import { SendNotificationT } from '../../fbs/producer/send-notification';
import { TraceNotificationT as FBS_Producer_TraceNotificationT } from '../../fbs/producer/trace-notification';
import { VideoOrientationChangeNotificationT } from '../../fbs/producer/video-orientation-change-notification';
import { SctpStateChangeNotificationT } from '../../fbs/transport/sctp-state-change-notification';
import { SendRtcpNotificationT } from '../../fbs/transport/send-rtcp-notification';
import { TraceNotificationT } from '../../fbs/transport/trace-notification';
import { DtlsStateChangeNotificationT } from '../../fbs/web-rtc-transport/dtls-state-change-notification';
import { IceSelectedTupleChangeNotificationT } from '../../fbs/web-rtc-transport/ice-selected-tuple-change-notification';
import { IceStateChangeNotificationT } from '../../fbs/web-rtc-transport/ice-state-change-notification';
export declare class Notification implements flatbuffers.IUnpackableObject<NotificationT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): Notification;
    static getRootAsNotification(bb: flatbuffers.ByteBuffer, obj?: Notification): Notification;
    static getSizePrefixedRootAsNotification(bb: flatbuffers.ByteBuffer, obj?: Notification): Notification;
    handlerId(): string | null;
    handlerId(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    event(): Event;
    bodyType(): Body;
    body<T extends flatbuffers.Table>(obj: any): any | null;
    static startNotification(builder: flatbuffers.Builder): void;
    static addHandlerId(builder: flatbuffers.Builder, handlerIdOffset: flatbuffers.Offset): void;
    static addEvent(builder: flatbuffers.Builder, event: Event): void;
    static addBodyType(builder: flatbuffers.Builder, bodyType: Body): void;
    static addBody(builder: flatbuffers.Builder, bodyOffset: flatbuffers.Offset): void;
    static endNotification(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createNotification(builder: flatbuffers.Builder, handlerIdOffset: flatbuffers.Offset, event: Event, bodyType: Body, bodyOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): NotificationT;
    unpackTo(_o: NotificationT): void;
}
export declare class NotificationT implements flatbuffers.IGeneratedObject {
    handlerId: string | Uint8Array | null;
    event: Event;
    bodyType: Body;
    body: BufferedAmountLowNotificationT | DominantSpeakerNotificationT | DtlsStateChangeNotificationT | FBS_Consumer_ScoreNotificationT | FBS_Consumer_TraceNotificationT | FBS_DataProducer_SendNotificationT | FBS_Producer_TraceNotificationT | IceSelectedTupleChangeNotificationT | IceStateChangeNotificationT | LayersChangeNotificationT | MessageNotificationT | RtcpNotificationT | RtcpTupleNotificationT | RtpNotificationT | ScoreNotificationT | SctpStateChangeNotificationT | SendNotificationT | SendRtcpNotificationT | TraceNotificationT | TupleNotificationT | VideoOrientationChangeNotificationT | VolumesNotificationT | null;
    constructor(handlerId?: string | Uint8Array | null, event?: Event, bodyType?: Body, body?: BufferedAmountLowNotificationT | DominantSpeakerNotificationT | DtlsStateChangeNotificationT | FBS_Consumer_ScoreNotificationT | FBS_Consumer_TraceNotificationT | FBS_DataProducer_SendNotificationT | FBS_Producer_TraceNotificationT | IceSelectedTupleChangeNotificationT | IceStateChangeNotificationT | LayersChangeNotificationT | MessageNotificationT | RtcpNotificationT | RtcpTupleNotificationT | RtpNotificationT | ScoreNotificationT | SctpStateChangeNotificationT | SendNotificationT | SendRtcpNotificationT | TraceNotificationT | TupleNotificationT | VideoOrientationChangeNotificationT | VolumesNotificationT | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=notification.d.ts.map