import * as flatbuffers from 'flatbuffers';
import { NumSctpStreams, NumSctpStreamsT } from '../../fbs/sctp-parameters/num-sctp-streams';
export declare class Options implements flatbuffers.IUnpackableObject<OptionsT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): Options;
    static getRootAsOptions(bb: flatbuffers.ByteBuffer, obj?: Options): Options;
    static getSizePrefixedRootAsOptions(bb: flatbuffers.ByteBuffer, obj?: Options): Options;
    direct(): boolean;
    /**
     * Only needed for DirectTransport. This value is handled by base Transport.
     */
    maxMessageSize(): number | null;
    initialAvailableOutgoingBitrate(): number | null;
    enableSctp(): boolean;
    numSctpStreams(obj?: NumSctpStreams): NumSctpStreams | null;
    maxSctpMessageSize(): number;
    sctpSendBufferSize(): number;
    isDataChannel(): boolean;
    static startOptions(builder: flatbuffers.Builder): void;
    static addDirect(builder: flatbuffers.Builder, direct: boolean): void;
    static addMaxMessageSize(builder: flatbuffers.Builder, maxMessageSize: number): void;
    static addInitialAvailableOutgoingBitrate(builder: flatbuffers.Builder, initialAvailableOutgoingBitrate: number): void;
    static addEnableSctp(builder: flatbuffers.Builder, enableSctp: boolean): void;
    static addNumSctpStreams(builder: flatbuffers.Builder, numSctpStreamsOffset: flatbuffers.Offset): void;
    static addMaxSctpMessageSize(builder: flatbuffers.Builder, maxSctpMessageSize: number): void;
    static addSctpSendBufferSize(builder: flatbuffers.Builder, sctpSendBufferSize: number): void;
    static addIsDataChannel(builder: flatbuffers.Builder, isDataChannel: boolean): void;
    static endOptions(builder: flatbuffers.Builder): flatbuffers.Offset;
    unpack(): OptionsT;
    unpackTo(_o: OptionsT): void;
}
export declare class OptionsT implements flatbuffers.IGeneratedObject {
    direct: boolean;
    maxMessageSize: number | null;
    initialAvailableOutgoingBitrate: number | null;
    enableSctp: boolean;
    numSctpStreams: NumSctpStreamsT | null;
    maxSctpMessageSize: number;
    sctpSendBufferSize: number;
    isDataChannel: boolean;
    constructor(direct?: boolean, maxMessageSize?: number | null, initialAvailableOutgoingBitrate?: number | null, enableSctp?: boolean, numSctpStreams?: NumSctpStreamsT | null, maxSctpMessageSize?: number, sctpSendBufferSize?: number, isDataChannel?: boolean);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=options.d.ts.map