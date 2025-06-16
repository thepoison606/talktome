import { EnableTraceEventRequest as FBS_Consumer_EnableTraceEventRequest } from '../../fbs/consumer/enable-trace-event-request';
import { SetPreferredLayersRequest } from '../../fbs/consumer/set-preferred-layers-request';
import { SetPriorityRequest } from '../../fbs/consumer/set-priority-request';
import { AddSubchannelRequest } from '../../fbs/data-consumer/add-subchannel-request';
import { RemoveSubchannelRequest } from '../../fbs/data-consumer/remove-subchannel-request';
import { SendRequest } from '../../fbs/data-consumer/send-request';
import { SetBufferedAmountLowThresholdRequest } from '../../fbs/data-consumer/set-buffered-amount-low-threshold-request';
import { SetSubchannelsRequest } from '../../fbs/data-consumer/set-subchannels-request';
import { ConnectRequest as FBS_PipeTransport_ConnectRequest } from '../../fbs/pipe-transport/connect-request';
import { ConnectRequest } from '../../fbs/plain-transport/connect-request';
import { EnableTraceEventRequest as FBS_Producer_EnableTraceEventRequest } from '../../fbs/producer/enable-trace-event-request';
import { CloseRtpObserverRequest } from '../../fbs/router/close-rtp-observer-request';
import { CloseTransportRequest } from '../../fbs/router/close-transport-request';
import { CreateActiveSpeakerObserverRequest } from '../../fbs/router/create-active-speaker-observer-request';
import { CreateAudioLevelObserverRequest } from '../../fbs/router/create-audio-level-observer-request';
import { CreateDirectTransportRequest } from '../../fbs/router/create-direct-transport-request';
import { CreatePipeTransportRequest } from '../../fbs/router/create-pipe-transport-request';
import { CreatePlainTransportRequest } from '../../fbs/router/create-plain-transport-request';
import { CreateWebRtcTransportRequest } from '../../fbs/router/create-web-rtc-transport-request';
import { AddProducerRequest } from '../../fbs/rtp-observer/add-producer-request';
import { RemoveProducerRequest } from '../../fbs/rtp-observer/remove-producer-request';
import { CloseConsumerRequest } from '../../fbs/transport/close-consumer-request';
import { CloseDataConsumerRequest } from '../../fbs/transport/close-data-consumer-request';
import { CloseDataProducerRequest } from '../../fbs/transport/close-data-producer-request';
import { CloseProducerRequest } from '../../fbs/transport/close-producer-request';
import { ConsumeDataRequest } from '../../fbs/transport/consume-data-request';
import { ConsumeRequest } from '../../fbs/transport/consume-request';
import { EnableTraceEventRequest } from '../../fbs/transport/enable-trace-event-request';
import { ProduceDataRequest } from '../../fbs/transport/produce-data-request';
import { ProduceRequest } from '../../fbs/transport/produce-request';
import { SetMaxIncomingBitrateRequest } from '../../fbs/transport/set-max-incoming-bitrate-request';
import { SetMaxOutgoingBitrateRequest } from '../../fbs/transport/set-max-outgoing-bitrate-request';
import { SetMinOutgoingBitrateRequest } from '../../fbs/transport/set-min-outgoing-bitrate-request';
import { ConnectRequest as FBS_WebRtcTransport_ConnectRequest } from '../../fbs/web-rtc-transport/connect-request';
import { CloseRouterRequest } from '../../fbs/worker/close-router-request';
import { CloseWebRtcServerRequest } from '../../fbs/worker/close-web-rtc-server-request';
import { CreateRouterRequest } from '../../fbs/worker/create-router-request';
import { CreateWebRtcServerRequest } from '../../fbs/worker/create-web-rtc-server-request';
import { UpdateSettingsRequest } from '../../fbs/worker/update-settings-request';
export declare enum Body {
    NONE = 0,
    Worker_UpdateSettingsRequest = 1,
    Worker_CreateWebRtcServerRequest = 2,
    Worker_CloseWebRtcServerRequest = 3,
    Worker_CreateRouterRequest = 4,
    Worker_CloseRouterRequest = 5,
    Router_CreateWebRtcTransportRequest = 6,
    Router_CreatePlainTransportRequest = 7,
    Router_CreatePipeTransportRequest = 8,
    Router_CreateDirectTransportRequest = 9,
    Router_CreateActiveSpeakerObserverRequest = 10,
    Router_CreateAudioLevelObserverRequest = 11,
    Router_CloseTransportRequest = 12,
    Router_CloseRtpObserverRequest = 13,
    Transport_SetMaxIncomingBitrateRequest = 14,
    Transport_SetMaxOutgoingBitrateRequest = 15,
    Transport_SetMinOutgoingBitrateRequest = 16,
    Transport_ProduceRequest = 17,
    Transport_ConsumeRequest = 18,
    Transport_ProduceDataRequest = 19,
    Transport_ConsumeDataRequest = 20,
    Transport_EnableTraceEventRequest = 21,
    Transport_CloseProducerRequest = 22,
    Transport_CloseConsumerRequest = 23,
    Transport_CloseDataProducerRequest = 24,
    Transport_CloseDataConsumerRequest = 25,
    PlainTransport_ConnectRequest = 26,
    PipeTransport_ConnectRequest = 27,
    WebRtcTransport_ConnectRequest = 28,
    Producer_EnableTraceEventRequest = 29,
    Consumer_SetPreferredLayersRequest = 30,
    Consumer_SetPriorityRequest = 31,
    Consumer_EnableTraceEventRequest = 32,
    DataConsumer_SetBufferedAmountLowThresholdRequest = 33,
    DataConsumer_SendRequest = 34,
    DataConsumer_SetSubchannelsRequest = 35,
    DataConsumer_AddSubchannelRequest = 36,
    DataConsumer_RemoveSubchannelRequest = 37,
    RtpObserver_AddProducerRequest = 38,
    RtpObserver_RemoveProducerRequest = 39
}
export declare function unionToBody(type: Body, accessor: (obj: AddProducerRequest | AddSubchannelRequest | CloseConsumerRequest | CloseDataConsumerRequest | CloseDataProducerRequest | CloseProducerRequest | CloseRouterRequest | CloseRtpObserverRequest | CloseTransportRequest | CloseWebRtcServerRequest | ConnectRequest | ConsumeDataRequest | ConsumeRequest | CreateActiveSpeakerObserverRequest | CreateAudioLevelObserverRequest | CreateDirectTransportRequest | CreatePipeTransportRequest | CreatePlainTransportRequest | CreateRouterRequest | CreateWebRtcServerRequest | CreateWebRtcTransportRequest | EnableTraceEventRequest | FBS_Consumer_EnableTraceEventRequest | FBS_PipeTransport_ConnectRequest | FBS_Producer_EnableTraceEventRequest | FBS_WebRtcTransport_ConnectRequest | ProduceDataRequest | ProduceRequest | RemoveProducerRequest | RemoveSubchannelRequest | SendRequest | SetBufferedAmountLowThresholdRequest | SetMaxIncomingBitrateRequest | SetMaxOutgoingBitrateRequest | SetMinOutgoingBitrateRequest | SetPreferredLayersRequest | SetPriorityRequest | SetSubchannelsRequest | UpdateSettingsRequest) => AddProducerRequest | AddSubchannelRequest | CloseConsumerRequest | CloseDataConsumerRequest | CloseDataProducerRequest | CloseProducerRequest | CloseRouterRequest | CloseRtpObserverRequest | CloseTransportRequest | CloseWebRtcServerRequest | ConnectRequest | ConsumeDataRequest | ConsumeRequest | CreateActiveSpeakerObserverRequest | CreateAudioLevelObserverRequest | CreateDirectTransportRequest | CreatePipeTransportRequest | CreatePlainTransportRequest | CreateRouterRequest | CreateWebRtcServerRequest | CreateWebRtcTransportRequest | EnableTraceEventRequest | FBS_Consumer_EnableTraceEventRequest | FBS_PipeTransport_ConnectRequest | FBS_Producer_EnableTraceEventRequest | FBS_WebRtcTransport_ConnectRequest | ProduceDataRequest | ProduceRequest | RemoveProducerRequest | RemoveSubchannelRequest | SendRequest | SetBufferedAmountLowThresholdRequest | SetMaxIncomingBitrateRequest | SetMaxOutgoingBitrateRequest | SetMinOutgoingBitrateRequest | SetPreferredLayersRequest | SetPriorityRequest | SetSubchannelsRequest | UpdateSettingsRequest | null): AddProducerRequest | AddSubchannelRequest | CloseConsumerRequest | CloseDataConsumerRequest | CloseDataProducerRequest | CloseProducerRequest | CloseRouterRequest | CloseRtpObserverRequest | CloseTransportRequest | CloseWebRtcServerRequest | ConnectRequest | ConsumeDataRequest | ConsumeRequest | CreateActiveSpeakerObserverRequest | CreateAudioLevelObserverRequest | CreateDirectTransportRequest | CreatePipeTransportRequest | CreatePlainTransportRequest | CreateRouterRequest | CreateWebRtcServerRequest | CreateWebRtcTransportRequest | EnableTraceEventRequest | FBS_Consumer_EnableTraceEventRequest | FBS_PipeTransport_ConnectRequest | FBS_Producer_EnableTraceEventRequest | FBS_WebRtcTransport_ConnectRequest | ProduceDataRequest | ProduceRequest | RemoveProducerRequest | RemoveSubchannelRequest | SendRequest | SetBufferedAmountLowThresholdRequest | SetMaxIncomingBitrateRequest | SetMaxOutgoingBitrateRequest | SetMinOutgoingBitrateRequest | SetPreferredLayersRequest | SetPriorityRequest | SetSubchannelsRequest | UpdateSettingsRequest | null;
export declare function unionListToBody(type: Body, accessor: (index: number, obj: AddProducerRequest | AddSubchannelRequest | CloseConsumerRequest | CloseDataConsumerRequest | CloseDataProducerRequest | CloseProducerRequest | CloseRouterRequest | CloseRtpObserverRequest | CloseTransportRequest | CloseWebRtcServerRequest | ConnectRequest | ConsumeDataRequest | ConsumeRequest | CreateActiveSpeakerObserverRequest | CreateAudioLevelObserverRequest | CreateDirectTransportRequest | CreatePipeTransportRequest | CreatePlainTransportRequest | CreateRouterRequest | CreateWebRtcServerRequest | CreateWebRtcTransportRequest | EnableTraceEventRequest | FBS_Consumer_EnableTraceEventRequest | FBS_PipeTransport_ConnectRequest | FBS_Producer_EnableTraceEventRequest | FBS_WebRtcTransport_ConnectRequest | ProduceDataRequest | ProduceRequest | RemoveProducerRequest | RemoveSubchannelRequest | SendRequest | SetBufferedAmountLowThresholdRequest | SetMaxIncomingBitrateRequest | SetMaxOutgoingBitrateRequest | SetMinOutgoingBitrateRequest | SetPreferredLayersRequest | SetPriorityRequest | SetSubchannelsRequest | UpdateSettingsRequest) => AddProducerRequest | AddSubchannelRequest | CloseConsumerRequest | CloseDataConsumerRequest | CloseDataProducerRequest | CloseProducerRequest | CloseRouterRequest | CloseRtpObserverRequest | CloseTransportRequest | CloseWebRtcServerRequest | ConnectRequest | ConsumeDataRequest | ConsumeRequest | CreateActiveSpeakerObserverRequest | CreateAudioLevelObserverRequest | CreateDirectTransportRequest | CreatePipeTransportRequest | CreatePlainTransportRequest | CreateRouterRequest | CreateWebRtcServerRequest | CreateWebRtcTransportRequest | EnableTraceEventRequest | FBS_Consumer_EnableTraceEventRequest | FBS_PipeTransport_ConnectRequest | FBS_Producer_EnableTraceEventRequest | FBS_WebRtcTransport_ConnectRequest | ProduceDataRequest | ProduceRequest | RemoveProducerRequest | RemoveSubchannelRequest | SendRequest | SetBufferedAmountLowThresholdRequest | SetMaxIncomingBitrateRequest | SetMaxOutgoingBitrateRequest | SetMinOutgoingBitrateRequest | SetPreferredLayersRequest | SetPriorityRequest | SetSubchannelsRequest | UpdateSettingsRequest | null, index: number): AddProducerRequest | AddSubchannelRequest | CloseConsumerRequest | CloseDataConsumerRequest | CloseDataProducerRequest | CloseProducerRequest | CloseRouterRequest | CloseRtpObserverRequest | CloseTransportRequest | CloseWebRtcServerRequest | ConnectRequest | ConsumeDataRequest | ConsumeRequest | CreateActiveSpeakerObserverRequest | CreateAudioLevelObserverRequest | CreateDirectTransportRequest | CreatePipeTransportRequest | CreatePlainTransportRequest | CreateRouterRequest | CreateWebRtcServerRequest | CreateWebRtcTransportRequest | EnableTraceEventRequest | FBS_Consumer_EnableTraceEventRequest | FBS_PipeTransport_ConnectRequest | FBS_Producer_EnableTraceEventRequest | FBS_WebRtcTransport_ConnectRequest | ProduceDataRequest | ProduceRequest | RemoveProducerRequest | RemoveSubchannelRequest | SendRequest | SetBufferedAmountLowThresholdRequest | SetMaxIncomingBitrateRequest | SetMaxOutgoingBitrateRequest | SetMinOutgoingBitrateRequest | SetPreferredLayersRequest | SetPriorityRequest | SetSubchannelsRequest | UpdateSettingsRequest | null;
//# sourceMappingURL=body.d.ts.map