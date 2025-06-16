import { DumpResponse as FBS_Consumer_DumpResponse } from '../../fbs/consumer/dump-response';
import { GetStatsResponse as FBS_Consumer_GetStatsResponse } from '../../fbs/consumer/get-stats-response';
import { SetPreferredLayersResponse } from '../../fbs/consumer/set-preferred-layers-response';
import { SetPriorityResponse } from '../../fbs/consumer/set-priority-response';
import { AddSubchannelResponse } from '../../fbs/data-consumer/add-subchannel-response';
import { DumpResponse as FBS_DataConsumer_DumpResponse } from '../../fbs/data-consumer/dump-response';
import { GetBufferedAmountResponse } from '../../fbs/data-consumer/get-buffered-amount-response';
import { GetStatsResponse as FBS_DataConsumer_GetStatsResponse } from '../../fbs/data-consumer/get-stats-response';
import { RemoveSubchannelResponse } from '../../fbs/data-consumer/remove-subchannel-response';
import { SetSubchannelsResponse } from '../../fbs/data-consumer/set-subchannels-response';
import { DumpResponse as FBS_DataProducer_DumpResponse } from '../../fbs/data-producer/dump-response';
import { GetStatsResponse as FBS_DataProducer_GetStatsResponse } from '../../fbs/data-producer/get-stats-response';
import { DumpResponse as FBS_DirectTransport_DumpResponse } from '../../fbs/direct-transport/dump-response';
import { GetStatsResponse as FBS_DirectTransport_GetStatsResponse } from '../../fbs/direct-transport/get-stats-response';
import { ConnectResponse as FBS_PipeTransport_ConnectResponse } from '../../fbs/pipe-transport/connect-response';
import { DumpResponse as FBS_PipeTransport_DumpResponse } from '../../fbs/pipe-transport/dump-response';
import { GetStatsResponse as FBS_PipeTransport_GetStatsResponse } from '../../fbs/pipe-transport/get-stats-response';
import { ConnectResponse } from '../../fbs/plain-transport/connect-response';
import { DumpResponse as FBS_PlainTransport_DumpResponse } from '../../fbs/plain-transport/dump-response';
import { GetStatsResponse } from '../../fbs/plain-transport/get-stats-response';
import { DumpResponse as FBS_Producer_DumpResponse } from '../../fbs/producer/dump-response';
import { GetStatsResponse as FBS_Producer_GetStatsResponse } from '../../fbs/producer/get-stats-response';
import { DumpResponse as FBS_Router_DumpResponse } from '../../fbs/router/dump-response';
import { ConsumeResponse } from '../../fbs/transport/consume-response';
import { ProduceResponse } from '../../fbs/transport/produce-response';
import { RestartIceResponse } from '../../fbs/transport/restart-ice-response';
import { DumpResponse as FBS_WebRtcServer_DumpResponse } from '../../fbs/web-rtc-server/dump-response';
import { ConnectResponse as FBS_WebRtcTransport_ConnectResponse } from '../../fbs/web-rtc-transport/connect-response';
import { DumpResponse as FBS_WebRtcTransport_DumpResponse } from '../../fbs/web-rtc-transport/dump-response';
import { GetStatsResponse as FBS_WebRtcTransport_GetStatsResponse } from '../../fbs/web-rtc-transport/get-stats-response';
import { DumpResponse } from '../../fbs/worker/dump-response';
import { ResourceUsageResponse } from '../../fbs/worker/resource-usage-response';
export declare enum Body {
    NONE = 0,
    Worker_DumpResponse = 1,
    Worker_ResourceUsageResponse = 2,
    WebRtcServer_DumpResponse = 3,
    Router_DumpResponse = 4,
    Transport_ProduceResponse = 5,
    Transport_ConsumeResponse = 6,
    Transport_RestartIceResponse = 7,
    PlainTransport_ConnectResponse = 8,
    PlainTransport_DumpResponse = 9,
    PlainTransport_GetStatsResponse = 10,
    PipeTransport_ConnectResponse = 11,
    PipeTransport_DumpResponse = 12,
    PipeTransport_GetStatsResponse = 13,
    DirectTransport_DumpResponse = 14,
    DirectTransport_GetStatsResponse = 15,
    WebRtcTransport_ConnectResponse = 16,
    WebRtcTransport_DumpResponse = 17,
    WebRtcTransport_GetStatsResponse = 18,
    Producer_DumpResponse = 19,
    Producer_GetStatsResponse = 20,
    Consumer_DumpResponse = 21,
    Consumer_GetStatsResponse = 22,
    Consumer_SetPreferredLayersResponse = 23,
    Consumer_SetPriorityResponse = 24,
    DataProducer_DumpResponse = 25,
    DataProducer_GetStatsResponse = 26,
    DataConsumer_GetBufferedAmountResponse = 27,
    DataConsumer_DumpResponse = 28,
    DataConsumer_GetStatsResponse = 29,
    DataConsumer_SetSubchannelsResponse = 30,
    DataConsumer_AddSubchannelResponse = 31,
    DataConsumer_RemoveSubchannelResponse = 32
}
export declare function unionToBody(type: Body, accessor: (obj: AddSubchannelResponse | ConnectResponse | ConsumeResponse | DumpResponse | FBS_Consumer_DumpResponse | FBS_Consumer_GetStatsResponse | FBS_DataConsumer_DumpResponse | FBS_DataConsumer_GetStatsResponse | FBS_DataProducer_DumpResponse | FBS_DataProducer_GetStatsResponse | FBS_DirectTransport_DumpResponse | FBS_DirectTransport_GetStatsResponse | FBS_PipeTransport_ConnectResponse | FBS_PipeTransport_DumpResponse | FBS_PipeTransport_GetStatsResponse | FBS_PlainTransport_DumpResponse | FBS_Producer_DumpResponse | FBS_Producer_GetStatsResponse | FBS_Router_DumpResponse | FBS_WebRtcServer_DumpResponse | FBS_WebRtcTransport_ConnectResponse | FBS_WebRtcTransport_DumpResponse | FBS_WebRtcTransport_GetStatsResponse | GetBufferedAmountResponse | GetStatsResponse | ProduceResponse | RemoveSubchannelResponse | ResourceUsageResponse | RestartIceResponse | SetPreferredLayersResponse | SetPriorityResponse | SetSubchannelsResponse) => AddSubchannelResponse | ConnectResponse | ConsumeResponse | DumpResponse | FBS_Consumer_DumpResponse | FBS_Consumer_GetStatsResponse | FBS_DataConsumer_DumpResponse | FBS_DataConsumer_GetStatsResponse | FBS_DataProducer_DumpResponse | FBS_DataProducer_GetStatsResponse | FBS_DirectTransport_DumpResponse | FBS_DirectTransport_GetStatsResponse | FBS_PipeTransport_ConnectResponse | FBS_PipeTransport_DumpResponse | FBS_PipeTransport_GetStatsResponse | FBS_PlainTransport_DumpResponse | FBS_Producer_DumpResponse | FBS_Producer_GetStatsResponse | FBS_Router_DumpResponse | FBS_WebRtcServer_DumpResponse | FBS_WebRtcTransport_ConnectResponse | FBS_WebRtcTransport_DumpResponse | FBS_WebRtcTransport_GetStatsResponse | GetBufferedAmountResponse | GetStatsResponse | ProduceResponse | RemoveSubchannelResponse | ResourceUsageResponse | RestartIceResponse | SetPreferredLayersResponse | SetPriorityResponse | SetSubchannelsResponse | null): AddSubchannelResponse | ConnectResponse | ConsumeResponse | DumpResponse | FBS_Consumer_DumpResponse | FBS_Consumer_GetStatsResponse | FBS_DataConsumer_DumpResponse | FBS_DataConsumer_GetStatsResponse | FBS_DataProducer_DumpResponse | FBS_DataProducer_GetStatsResponse | FBS_DirectTransport_DumpResponse | FBS_DirectTransport_GetStatsResponse | FBS_PipeTransport_ConnectResponse | FBS_PipeTransport_DumpResponse | FBS_PipeTransport_GetStatsResponse | FBS_PlainTransport_DumpResponse | FBS_Producer_DumpResponse | FBS_Producer_GetStatsResponse | FBS_Router_DumpResponse | FBS_WebRtcServer_DumpResponse | FBS_WebRtcTransport_ConnectResponse | FBS_WebRtcTransport_DumpResponse | FBS_WebRtcTransport_GetStatsResponse | GetBufferedAmountResponse | GetStatsResponse | ProduceResponse | RemoveSubchannelResponse | ResourceUsageResponse | RestartIceResponse | SetPreferredLayersResponse | SetPriorityResponse | SetSubchannelsResponse | null;
export declare function unionListToBody(type: Body, accessor: (index: number, obj: AddSubchannelResponse | ConnectResponse | ConsumeResponse | DumpResponse | FBS_Consumer_DumpResponse | FBS_Consumer_GetStatsResponse | FBS_DataConsumer_DumpResponse | FBS_DataConsumer_GetStatsResponse | FBS_DataProducer_DumpResponse | FBS_DataProducer_GetStatsResponse | FBS_DirectTransport_DumpResponse | FBS_DirectTransport_GetStatsResponse | FBS_PipeTransport_ConnectResponse | FBS_PipeTransport_DumpResponse | FBS_PipeTransport_GetStatsResponse | FBS_PlainTransport_DumpResponse | FBS_Producer_DumpResponse | FBS_Producer_GetStatsResponse | FBS_Router_DumpResponse | FBS_WebRtcServer_DumpResponse | FBS_WebRtcTransport_ConnectResponse | FBS_WebRtcTransport_DumpResponse | FBS_WebRtcTransport_GetStatsResponse | GetBufferedAmountResponse | GetStatsResponse | ProduceResponse | RemoveSubchannelResponse | ResourceUsageResponse | RestartIceResponse | SetPreferredLayersResponse | SetPriorityResponse | SetSubchannelsResponse) => AddSubchannelResponse | ConnectResponse | ConsumeResponse | DumpResponse | FBS_Consumer_DumpResponse | FBS_Consumer_GetStatsResponse | FBS_DataConsumer_DumpResponse | FBS_DataConsumer_GetStatsResponse | FBS_DataProducer_DumpResponse | FBS_DataProducer_GetStatsResponse | FBS_DirectTransport_DumpResponse | FBS_DirectTransport_GetStatsResponse | FBS_PipeTransport_ConnectResponse | FBS_PipeTransport_DumpResponse | FBS_PipeTransport_GetStatsResponse | FBS_PlainTransport_DumpResponse | FBS_Producer_DumpResponse | FBS_Producer_GetStatsResponse | FBS_Router_DumpResponse | FBS_WebRtcServer_DumpResponse | FBS_WebRtcTransport_ConnectResponse | FBS_WebRtcTransport_DumpResponse | FBS_WebRtcTransport_GetStatsResponse | GetBufferedAmountResponse | GetStatsResponse | ProduceResponse | RemoveSubchannelResponse | ResourceUsageResponse | RestartIceResponse | SetPreferredLayersResponse | SetPriorityResponse | SetSubchannelsResponse | null, index: number): AddSubchannelResponse | ConnectResponse | ConsumeResponse | DumpResponse | FBS_Consumer_DumpResponse | FBS_Consumer_GetStatsResponse | FBS_DataConsumer_DumpResponse | FBS_DataConsumer_GetStatsResponse | FBS_DataProducer_DumpResponse | FBS_DataProducer_GetStatsResponse | FBS_DirectTransport_DumpResponse | FBS_DirectTransport_GetStatsResponse | FBS_PipeTransport_ConnectResponse | FBS_PipeTransport_DumpResponse | FBS_PipeTransport_GetStatsResponse | FBS_PlainTransport_DumpResponse | FBS_Producer_DumpResponse | FBS_Producer_GetStatsResponse | FBS_Router_DumpResponse | FBS_WebRtcServer_DumpResponse | FBS_WebRtcTransport_ConnectResponse | FBS_WebRtcTransport_DumpResponse | FBS_WebRtcTransport_GetStatsResponse | GetBufferedAmountResponse | GetStatsResponse | ProduceResponse | RemoveSubchannelResponse | ResourceUsageResponse | RestartIceResponse | SetPreferredLayersResponse | SetPriorityResponse | SetSubchannelsResponse | null;
//# sourceMappingURL=body.d.ts.map