import * as flatbuffers from 'flatbuffers';
export declare class EnableDelayAndLossRequest implements flatbuffers.IUnpackableObject<EnableDelayAndLossRequestT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): EnableDelayAndLossRequest;
    static getRootAsEnableDelayAndLossRequest(bb: flatbuffers.ByteBuffer, obj?: EnableDelayAndLossRequest): EnableDelayAndLossRequest;
    static getSizePrefixedRootAsEnableDelayAndLossRequest(bb: flatbuffers.ByteBuffer, obj?: EnableDelayAndLossRequest): EnableDelayAndLossRequest;
    delay(): boolean;
    loss(): boolean;
    static startEnableDelayAndLossRequest(builder: flatbuffers.Builder): void;
    static addDelay(builder: flatbuffers.Builder, delay: boolean): void;
    static addLoss(builder: flatbuffers.Builder, loss: boolean): void;
    static endEnableDelayAndLossRequest(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createEnableDelayAndLossRequest(builder: flatbuffers.Builder, delay: boolean, loss: boolean): flatbuffers.Offset;
    unpack(): EnableDelayAndLossRequestT;
    unpackTo(_o: EnableDelayAndLossRequestT): void;
}
export declare class EnableDelayAndLossRequestT implements flatbuffers.IGeneratedObject {
    delay: boolean;
    loss: boolean;
    constructor(delay?: boolean, loss?: boolean);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=enable-delay-and-loss-request.d.ts.map