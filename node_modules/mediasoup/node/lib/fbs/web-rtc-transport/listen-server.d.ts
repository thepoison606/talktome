import * as flatbuffers from 'flatbuffers';
export declare class ListenServer implements flatbuffers.IUnpackableObject<ListenServerT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): ListenServer;
    static getRootAsListenServer(bb: flatbuffers.ByteBuffer, obj?: ListenServer): ListenServer;
    static getSizePrefixedRootAsListenServer(bb: flatbuffers.ByteBuffer, obj?: ListenServer): ListenServer;
    webRtcServerId(): string | null;
    webRtcServerId(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    static startListenServer(builder: flatbuffers.Builder): void;
    static addWebRtcServerId(builder: flatbuffers.Builder, webRtcServerIdOffset: flatbuffers.Offset): void;
    static endListenServer(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createListenServer(builder: flatbuffers.Builder, webRtcServerIdOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): ListenServerT;
    unpackTo(_o: ListenServerT): void;
}
export declare class ListenServerT implements flatbuffers.IGeneratedObject {
    webRtcServerId: string | Uint8Array | null;
    constructor(webRtcServerId?: string | Uint8Array | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=listen-server.d.ts.map