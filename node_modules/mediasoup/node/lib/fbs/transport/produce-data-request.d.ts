import * as flatbuffers from 'flatbuffers';
import { Type } from '../../fbs/data-producer/type';
import { SctpStreamParameters, SctpStreamParametersT } from '../../fbs/sctp-parameters/sctp-stream-parameters';
export declare class ProduceDataRequest implements flatbuffers.IUnpackableObject<ProduceDataRequestT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): ProduceDataRequest;
    static getRootAsProduceDataRequest(bb: flatbuffers.ByteBuffer, obj?: ProduceDataRequest): ProduceDataRequest;
    static getSizePrefixedRootAsProduceDataRequest(bb: flatbuffers.ByteBuffer, obj?: ProduceDataRequest): ProduceDataRequest;
    dataProducerId(): string | null;
    dataProducerId(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    type(): Type;
    sctpStreamParameters(obj?: SctpStreamParameters): SctpStreamParameters | null;
    label(): string | null;
    label(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    protocol(): string | null;
    protocol(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    paused(): boolean;
    static startProduceDataRequest(builder: flatbuffers.Builder): void;
    static addDataProducerId(builder: flatbuffers.Builder, dataProducerIdOffset: flatbuffers.Offset): void;
    static addType(builder: flatbuffers.Builder, type: Type): void;
    static addSctpStreamParameters(builder: flatbuffers.Builder, sctpStreamParametersOffset: flatbuffers.Offset): void;
    static addLabel(builder: flatbuffers.Builder, labelOffset: flatbuffers.Offset): void;
    static addProtocol(builder: flatbuffers.Builder, protocolOffset: flatbuffers.Offset): void;
    static addPaused(builder: flatbuffers.Builder, paused: boolean): void;
    static endProduceDataRequest(builder: flatbuffers.Builder): flatbuffers.Offset;
    unpack(): ProduceDataRequestT;
    unpackTo(_o: ProduceDataRequestT): void;
}
export declare class ProduceDataRequestT implements flatbuffers.IGeneratedObject {
    dataProducerId: string | Uint8Array | null;
    type: Type;
    sctpStreamParameters: SctpStreamParametersT | null;
    label: string | Uint8Array | null;
    protocol: string | Uint8Array | null;
    paused: boolean;
    constructor(dataProducerId?: string | Uint8Array | null, type?: Type, sctpStreamParameters?: SctpStreamParametersT | null, label?: string | Uint8Array | null, protocol?: string | Uint8Array | null, paused?: boolean);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=produce-data-request.d.ts.map