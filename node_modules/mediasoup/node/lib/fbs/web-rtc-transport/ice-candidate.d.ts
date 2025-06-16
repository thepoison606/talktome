import * as flatbuffers from 'flatbuffers';
import { Protocol } from '../../fbs/transport/protocol';
import { IceCandidateTcpType } from '../../fbs/web-rtc-transport/ice-candidate-tcp-type';
import { IceCandidateType } from '../../fbs/web-rtc-transport/ice-candidate-type';
export declare class IceCandidate implements flatbuffers.IUnpackableObject<IceCandidateT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): IceCandidate;
    static getRootAsIceCandidate(bb: flatbuffers.ByteBuffer, obj?: IceCandidate): IceCandidate;
    static getSizePrefixedRootAsIceCandidate(bb: flatbuffers.ByteBuffer, obj?: IceCandidate): IceCandidate;
    foundation(): string | null;
    foundation(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    priority(): number;
    address(): string | null;
    address(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    protocol(): Protocol;
    port(): number;
    type(): IceCandidateType;
    tcpType(): IceCandidateTcpType | null;
    static startIceCandidate(builder: flatbuffers.Builder): void;
    static addFoundation(builder: flatbuffers.Builder, foundationOffset: flatbuffers.Offset): void;
    static addPriority(builder: flatbuffers.Builder, priority: number): void;
    static addAddress(builder: flatbuffers.Builder, addressOffset: flatbuffers.Offset): void;
    static addProtocol(builder: flatbuffers.Builder, protocol: Protocol): void;
    static addPort(builder: flatbuffers.Builder, port: number): void;
    static addType(builder: flatbuffers.Builder, type: IceCandidateType): void;
    static addTcpType(builder: flatbuffers.Builder, tcpType: IceCandidateTcpType): void;
    static endIceCandidate(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createIceCandidate(builder: flatbuffers.Builder, foundationOffset: flatbuffers.Offset, priority: number, addressOffset: flatbuffers.Offset, protocol: Protocol, port: number, type: IceCandidateType, tcpType: IceCandidateTcpType | null): flatbuffers.Offset;
    unpack(): IceCandidateT;
    unpackTo(_o: IceCandidateT): void;
}
export declare class IceCandidateT implements flatbuffers.IGeneratedObject {
    foundation: string | Uint8Array | null;
    priority: number;
    address: string | Uint8Array | null;
    protocol: Protocol;
    port: number;
    type: IceCandidateType;
    tcpType: IceCandidateTcpType | null;
    constructor(foundation?: string | Uint8Array | null, priority?: number, address?: string | Uint8Array | null, protocol?: Protocol, port?: number, type?: IceCandidateType, tcpType?: IceCandidateTcpType | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=ice-candidate.d.ts.map