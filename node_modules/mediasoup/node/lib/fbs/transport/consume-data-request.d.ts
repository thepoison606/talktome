import * as flatbuffers from 'flatbuffers';
import { Type } from '../../fbs/data-producer/type';
import { SctpStreamParameters, SctpStreamParametersT } from '../../fbs/sctp-parameters/sctp-stream-parameters';
export declare class ConsumeDataRequest implements flatbuffers.IUnpackableObject<ConsumeDataRequestT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): ConsumeDataRequest;
    static getRootAsConsumeDataRequest(bb: flatbuffers.ByteBuffer, obj?: ConsumeDataRequest): ConsumeDataRequest;
    static getSizePrefixedRootAsConsumeDataRequest(bb: flatbuffers.ByteBuffer, obj?: ConsumeDataRequest): ConsumeDataRequest;
    dataConsumerId(): string | null;
    dataConsumerId(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    dataProducerId(): string | null;
    dataProducerId(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    type(): Type;
    sctpStreamParameters(obj?: SctpStreamParameters): SctpStreamParameters | null;
    label(): string | null;
    label(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    protocol(): string | null;
    protocol(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    paused(): boolean;
    subchannels(index: number): number | null;
    subchannelsLength(): number;
    subchannelsArray(): Uint16Array | null;
    static startConsumeDataRequest(builder: flatbuffers.Builder): void;
    static addDataConsumerId(builder: flatbuffers.Builder, dataConsumerIdOffset: flatbuffers.Offset): void;
    static addDataProducerId(builder: flatbuffers.Builder, dataProducerIdOffset: flatbuffers.Offset): void;
    static addType(builder: flatbuffers.Builder, type: Type): void;
    static addSctpStreamParameters(builder: flatbuffers.Builder, sctpStreamParametersOffset: flatbuffers.Offset): void;
    static addLabel(builder: flatbuffers.Builder, labelOffset: flatbuffers.Offset): void;
    static addProtocol(builder: flatbuffers.Builder, protocolOffset: flatbuffers.Offset): void;
    static addPaused(builder: flatbuffers.Builder, paused: boolean): void;
    static addSubchannels(builder: flatbuffers.Builder, subchannelsOffset: flatbuffers.Offset): void;
    static createSubchannelsVector(builder: flatbuffers.Builder, data: number[] | Uint16Array): flatbuffers.Offset;
    /**
     * @deprecated This Uint8Array overload will be removed in the future.
     */
    static createSubchannelsVector(builder: flatbuffers.Builder, data: number[] | Uint8Array): flatbuffers.Offset;
    static startSubchannelsVector(builder: flatbuffers.Builder, numElems: number): void;
    static endConsumeDataRequest(builder: flatbuffers.Builder): flatbuffers.Offset;
    unpack(): ConsumeDataRequestT;
    unpackTo(_o: ConsumeDataRequestT): void;
}
export declare class ConsumeDataRequestT implements flatbuffers.IGeneratedObject {
    dataConsumerId: string | Uint8Array | null;
    dataProducerId: string | Uint8Array | null;
    type: Type;
    sctpStreamParameters: SctpStreamParametersT | null;
    label: string | Uint8Array | null;
    protocol: string | Uint8Array | null;
    paused: boolean;
    subchannels: (number)[];
    constructor(dataConsumerId?: string | Uint8Array | null, dataProducerId?: string | Uint8Array | null, type?: Type, sctpStreamParameters?: SctpStreamParametersT | null, label?: string | Uint8Array | null, protocol?: string | Uint8Array | null, paused?: boolean, subchannels?: (number)[]);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=consume-data-request.d.ts.map