import * as flatbuffers from 'flatbuffers';
export declare class ChannelMessageHandlers implements flatbuffers.IUnpackableObject<ChannelMessageHandlersT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): ChannelMessageHandlers;
    static getRootAsChannelMessageHandlers(bb: flatbuffers.ByteBuffer, obj?: ChannelMessageHandlers): ChannelMessageHandlers;
    static getSizePrefixedRootAsChannelMessageHandlers(bb: flatbuffers.ByteBuffer, obj?: ChannelMessageHandlers): ChannelMessageHandlers;
    channelRequestHandlers(index: number): string;
    channelRequestHandlers(index: number, optionalEncoding: flatbuffers.Encoding): string | Uint8Array;
    channelRequestHandlersLength(): number;
    channelNotificationHandlers(index: number): string;
    channelNotificationHandlers(index: number, optionalEncoding: flatbuffers.Encoding): string | Uint8Array;
    channelNotificationHandlersLength(): number;
    static startChannelMessageHandlers(builder: flatbuffers.Builder): void;
    static addChannelRequestHandlers(builder: flatbuffers.Builder, channelRequestHandlersOffset: flatbuffers.Offset): void;
    static createChannelRequestHandlersVector(builder: flatbuffers.Builder, data: flatbuffers.Offset[]): flatbuffers.Offset;
    static startChannelRequestHandlersVector(builder: flatbuffers.Builder, numElems: number): void;
    static addChannelNotificationHandlers(builder: flatbuffers.Builder, channelNotificationHandlersOffset: flatbuffers.Offset): void;
    static createChannelNotificationHandlersVector(builder: flatbuffers.Builder, data: flatbuffers.Offset[]): flatbuffers.Offset;
    static startChannelNotificationHandlersVector(builder: flatbuffers.Builder, numElems: number): void;
    static endChannelMessageHandlers(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createChannelMessageHandlers(builder: flatbuffers.Builder, channelRequestHandlersOffset: flatbuffers.Offset, channelNotificationHandlersOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): ChannelMessageHandlersT;
    unpackTo(_o: ChannelMessageHandlersT): void;
}
export declare class ChannelMessageHandlersT implements flatbuffers.IGeneratedObject {
    channelRequestHandlers: (string)[];
    channelNotificationHandlers: (string)[];
    constructor(channelRequestHandlers?: (string)[], channelNotificationHandlers?: (string)[]);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=channel-message-handlers.d.ts.map