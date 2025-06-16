import * as flatbuffers from 'flatbuffers';
import { Type } from '../../fbs/data-producer/type';
import { SctpStreamParameters, SctpStreamParametersT } from '../../fbs/sctp-parameters/sctp-stream-parameters';
export declare class DumpResponse implements flatbuffers.IUnpackableObject<DumpResponseT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): DumpResponse;
    static getRootAsDumpResponse(bb: flatbuffers.ByteBuffer, obj?: DumpResponse): DumpResponse;
    static getSizePrefixedRootAsDumpResponse(bb: flatbuffers.ByteBuffer, obj?: DumpResponse): DumpResponse;
    id(): string | null;
    id(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    dataProducerId(): string | null;
    dataProducerId(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    type(): Type;
    sctpStreamParameters(obj?: SctpStreamParameters): SctpStreamParameters | null;
    label(): string | null;
    label(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    protocol(): string | null;
    protocol(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    bufferedAmountLowThreshold(): number;
    paused(): boolean;
    dataProducerPaused(): boolean;
    subchannels(index: number): number | null;
    subchannelsLength(): number;
    subchannelsArray(): Uint16Array | null;
    static startDumpResponse(builder: flatbuffers.Builder): void;
    static addId(builder: flatbuffers.Builder, idOffset: flatbuffers.Offset): void;
    static addDataProducerId(builder: flatbuffers.Builder, dataProducerIdOffset: flatbuffers.Offset): void;
    static addType(builder: flatbuffers.Builder, type: Type): void;
    static addSctpStreamParameters(builder: flatbuffers.Builder, sctpStreamParametersOffset: flatbuffers.Offset): void;
    static addLabel(builder: flatbuffers.Builder, labelOffset: flatbuffers.Offset): void;
    static addProtocol(builder: flatbuffers.Builder, protocolOffset: flatbuffers.Offset): void;
    static addBufferedAmountLowThreshold(builder: flatbuffers.Builder, bufferedAmountLowThreshold: number): void;
    static addPaused(builder: flatbuffers.Builder, paused: boolean): void;
    static addDataProducerPaused(builder: flatbuffers.Builder, dataProducerPaused: boolean): void;
    static addSubchannels(builder: flatbuffers.Builder, subchannelsOffset: flatbuffers.Offset): void;
    static createSubchannelsVector(builder: flatbuffers.Builder, data: number[] | Uint16Array): flatbuffers.Offset;
    /**
     * @deprecated This Uint8Array overload will be removed in the future.
     */
    static createSubchannelsVector(builder: flatbuffers.Builder, data: number[] | Uint8Array): flatbuffers.Offset;
    static startSubchannelsVector(builder: flatbuffers.Builder, numElems: number): void;
    static endDumpResponse(builder: flatbuffers.Builder): flatbuffers.Offset;
    unpack(): DumpResponseT;
    unpackTo(_o: DumpResponseT): void;
}
export declare class DumpResponseT implements flatbuffers.IGeneratedObject {
    id: string | Uint8Array | null;
    dataProducerId: string | Uint8Array | null;
    type: Type;
    sctpStreamParameters: SctpStreamParametersT | null;
    label: string | Uint8Array | null;
    protocol: string | Uint8Array | null;
    bufferedAmountLowThreshold: number;
    paused: boolean;
    dataProducerPaused: boolean;
    subchannels: (number)[];
    constructor(id?: string | Uint8Array | null, dataProducerId?: string | Uint8Array | null, type?: Type, sctpStreamParameters?: SctpStreamParametersT | null, label?: string | Uint8Array | null, protocol?: string | Uint8Array | null, bufferedAmountLowThreshold?: number, paused?: boolean, dataProducerPaused?: boolean, subchannels?: (number)[]);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=dump-response.d.ts.map