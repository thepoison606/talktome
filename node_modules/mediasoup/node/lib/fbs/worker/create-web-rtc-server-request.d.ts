import * as flatbuffers from 'flatbuffers';
import { ListenInfo, ListenInfoT } from '../../fbs/transport/listen-info';
export declare class CreateWebRtcServerRequest implements flatbuffers.IUnpackableObject<CreateWebRtcServerRequestT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): CreateWebRtcServerRequest;
    static getRootAsCreateWebRtcServerRequest(bb: flatbuffers.ByteBuffer, obj?: CreateWebRtcServerRequest): CreateWebRtcServerRequest;
    static getSizePrefixedRootAsCreateWebRtcServerRequest(bb: flatbuffers.ByteBuffer, obj?: CreateWebRtcServerRequest): CreateWebRtcServerRequest;
    webRtcServerId(): string | null;
    webRtcServerId(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    listenInfos(index: number, obj?: ListenInfo): ListenInfo | null;
    listenInfosLength(): number;
    static startCreateWebRtcServerRequest(builder: flatbuffers.Builder): void;
    static addWebRtcServerId(builder: flatbuffers.Builder, webRtcServerIdOffset: flatbuffers.Offset): void;
    static addListenInfos(builder: flatbuffers.Builder, listenInfosOffset: flatbuffers.Offset): void;
    static createListenInfosVector(builder: flatbuffers.Builder, data: flatbuffers.Offset[]): flatbuffers.Offset;
    static startListenInfosVector(builder: flatbuffers.Builder, numElems: number): void;
    static endCreateWebRtcServerRequest(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createCreateWebRtcServerRequest(builder: flatbuffers.Builder, webRtcServerIdOffset: flatbuffers.Offset, listenInfosOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): CreateWebRtcServerRequestT;
    unpackTo(_o: CreateWebRtcServerRequestT): void;
}
export declare class CreateWebRtcServerRequestT implements flatbuffers.IGeneratedObject {
    webRtcServerId: string | Uint8Array | null;
    listenInfos: (ListenInfoT)[];
    constructor(webRtcServerId?: string | Uint8Array | null, listenInfos?: (ListenInfoT)[]);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=create-web-rtc-server-request.d.ts.map