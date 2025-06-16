import * as flatbuffers from 'flatbuffers';
import { TraceEventType } from '../../fbs/producer/trace-event-type';
export declare class EnableTraceEventRequest implements flatbuffers.IUnpackableObject<EnableTraceEventRequestT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): EnableTraceEventRequest;
    static getRootAsEnableTraceEventRequest(bb: flatbuffers.ByteBuffer, obj?: EnableTraceEventRequest): EnableTraceEventRequest;
    static getSizePrefixedRootAsEnableTraceEventRequest(bb: flatbuffers.ByteBuffer, obj?: EnableTraceEventRequest): EnableTraceEventRequest;
    events(index: number): TraceEventType | null;
    eventsLength(): number;
    eventsArray(): Uint8Array | null;
    static startEnableTraceEventRequest(builder: flatbuffers.Builder): void;
    static addEvents(builder: flatbuffers.Builder, eventsOffset: flatbuffers.Offset): void;
    static createEventsVector(builder: flatbuffers.Builder, data: TraceEventType[]): flatbuffers.Offset;
    static startEventsVector(builder: flatbuffers.Builder, numElems: number): void;
    static endEnableTraceEventRequest(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createEnableTraceEventRequest(builder: flatbuffers.Builder, eventsOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): EnableTraceEventRequestT;
    unpackTo(_o: EnableTraceEventRequestT): void;
}
export declare class EnableTraceEventRequestT implements flatbuffers.IGeneratedObject {
    events: (TraceEventType)[];
    constructor(events?: (TraceEventType)[]);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=enable-trace-event-request.d.ts.map